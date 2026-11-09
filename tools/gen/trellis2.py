#!/usr/bin/env python3
"""TRELLIS.2 client (always set $TRELLIS_SERVERS): image in, textured glb out, plus a sidecar json of
settings and timings (the hy3d.py counterpart; docs/model-pipeline.md).

The server (http://whiteglove-1:7861) is Microsoft's official TRELLIS.2
Gradio app (app.py, Gradio 6.1, sse_v3, api prefix /gradio_api). A job is
four calls in one session (the app keeps the generated latent in a
server-side gr.State per session_hash, so they must share it; the fn_index
numbers below are from one start of the app, the client resolves them by
api_name from /config):
  start_session      (fn 2)  makes the session's temp dir
  preprocess_image_1 (fn 4)  the upload hook: background removal unless the
                             picture has alpha, crop to the object, square
  image_to_3d        (fn 7)  image, seed, resolution 512/1024/1536, then
                             guidance strength / rescale / steps / rescale T
                             for the sparse structure, shape and texture
                             stages -> the latent (state) + an HTML preview
  extract_glb        (fn 9)  (state, decimation target, texture size) ->
                             the textured glb (PBR, simplified, UV-unwrapped)
State inputs are sent as null; the server fills them from the session.

Inputs: TRELLIS wants an alpha-masked foreground. A product render on white
is cut to alpha here (--cut, the default): near-white pixels connected to the
picture's border become transparent, so white highlights inside the gun
stay; the edge is softened by a pixel. --no-cut sends the picture as is (the
server's own remover then runs).

  python3 trellis2.py IMAGE.png OUT_DIR/name [--seed 0] [--res 1024]
      [--steps 12] [--ss-guidance 7.5] [--shape-guidance 7.5]
      [--tex-guidance 1.0] [--decimate 500000] [--texsize 2048] [--no-cut]
writes OUT_DIR/name.glb, OUT_DIR/name_input.png (what was sent),
OUT_DIR/name_pre.png (the server's preprocessed picture) and
OUT_DIR/name.json. Several --seed values run one after another, each into
name_s<seed>; the first failure stops the run (no retry), and /gradio_api/info is checked
before each further seed. OUT.log logs every queue/join response and SSE message
(jsonl, timestamped). Endpoints are looked up by api_name in /config.
Exit codes: 0 done, 1 failed.
Standard library plus Pillow and numpy (for the alpha cut).
"""
import argparse
import fcntl
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

# Servers, tried in turn: the first free one takes the job (a lock per server,
# so several clients share them, one job per server). $TRELLIS_SERVERS
# (comma-separated) or $TRELLIS_SERVER overrides the list.
SERVERS = [u.strip() for u in os.environ.get("TRELLIS_SERVERS", os.environ.get("TRELLIS_SERVER",
    "http://127.0.0.1:7860")).split(",") if u.strip()]
SERVER = SERVERS[0]
API = SERVER + "/gradio_api"
# fn_index per api_name, resolved from /config at startup (a restart may renumber them).
FN = {}
NAMES = ("start_session", "end_session", "preprocess_image_1", "image_to_3d", "extract_glb")
QUEUE_S = 120
RUN_S = {"start_session": 30, "end_session": 30, "preprocess_image_1": 60, "image_to_3d": 180, "extract_glb": 200}
# A healthy server sends a heartbeat every ~15 s; a frozen one sends nothing.
STREAM_TIMEOUT_S = 120
# The server's admin restart (it exits even with a job stuck; its launcher
# brings it back in about a minute). The token lives outside the repo.
TOKEN_DIR = os.path.expanduser("~/.config/trellis2")    # admin_token_<host>, else admin_token
RESTART_WAIT_S = 300
LOCK_DIR = os.path.expanduser("~/.cache")              # trellis2_<host>_<port>.lock, one per server


LOG = None   # per-job log file (jsonl): every queue/join response and SSE message, timestamped


def log(kind: str, **kw) -> None:
    if LOG is not None:
        LOG.write(json.dumps({"t": time.strftime("%H:%M:%S") + f".{int(time.time() * 1000) % 1000:03d}",
            "kind": kind, **kw}) + "\n")
        LOG.flush()


def use(server: str) -> None:
    """Points every call at `server` (this process runs one job at a time)."""
    global SERVER, API
    SERVER, API = server, server + "/gradio_api"
    FN.clear()


def claim():
    """Waits for a free server and holds its lock: returns (lock file, server).
    A server that doesn't answer is skipped, so one that's down or restarting
    doesn't stall the queue."""
    os.makedirs(LOCK_DIR, exist_ok=True)
    waited = 0.0
    while True:
        for srv in SERVERS:
            u = urllib.parse.urlparse(srv)
            f = open(os.path.join(LOCK_DIR, f"trellis2_{u.hostname}_{u.port}.lock"), "w")
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                f.close()
                continue
            use(srv)
            if alive():
                try:
                    resolve_fns()
                    return f, srv
                except (OSError, ValueError, RuntimeError):
                    pass
            f.close()
        time.sleep(3)
        waited += 3
        if waited > 3600:
            raise RuntimeError("no TRELLIS server free and answering for an hour")


def resolve_fns() -> dict:
    """fn_index for each api_name we use, from /config."""
    with urllib.request.urlopen(f"{SERVER}/config", timeout=30) as r:
        cfg = json.loads(r.read())
    fns = {}
    for i, d in enumerate(cfg["dependencies"]):
        name = d.get("api_name")
        if name in NAMES:
            fns[name] = d.get("id", i)
    missing = [n for n in NAMES if n not in fns]
    if missing:
        raise RuntimeError(f"/config has no endpoint named {missing}")
    FN.update(fns)
    return fns


def alive() -> bool:
    try:
        with urllib.request.urlopen(f"{API}/info", timeout=15) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


def restart() -> bool:
    """A stalled job: restart the server and wait until it answers again.
    Returns True once /gradio_api/info answers (and the endpoints resolve)."""
    try:
        host = urllib.parse.urlparse(SERVER).hostname
        tf = os.path.join(TOKEN_DIR, f"admin_token_{host}")
        token = open(tf if os.path.exists(tf) else os.path.join(TOKEN_DIR, "admin_token")).read().strip()
        req = urllib.request.Request(f"{SERVER}/admin/restart", data=b"", method="POST",
            headers={"X-Admin-Token": token})
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"trellis2: restart requested: {r.read().decode()[:80]}", file=sys.stderr)
    except (OSError, ValueError) as e:
        print(f"trellis2: restart failed: {e}", file=sys.stderr)
        return False
    time.sleep(20)                       # let the old process go down first
    t0 = time.time()
    while time.time() - t0 < RESTART_WAIT_S:
        if alive():
            try:
                resolve_fns()
                print(f"trellis2: server back after {20 + time.time() - t0:.0f} s", file=sys.stderr)
                return True
            except (OSError, ValueError, RuntimeError):
                pass
        time.sleep(10)
    print("trellis2: server not back after the restart", file=sys.stderr)
    return False


def _post(url: str, body: bytes, ctype: str) -> dict:
    req = urllib.request.Request(url, data=body, headers={"Content-Type": ctype}, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def upload(path: str) -> dict:
    """Uploads a file; returns a FileData dict for it."""
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    p = _post(f"{API}/upload", body, f"multipart/form-data; boundary={boundary}")[0]
    return {"path": p, "orig_name": name, "mime_type": mime, "meta": {"_type": "gradio.FileData"}}


def _brief(x, n=400):
    t = json.dumps(x)
    return t if len(t) <= n else t[:n] + f"...({len(t)} chars)"


def call(session: str, endpoint: str, data: list) -> list:
    """Queues one call in the session and follows its event stream; every
    message goes to the job log."""
    log("join_request", endpoint=endpoint, fn_index=FN[endpoint], data=_brief(data))
    ev = _post(f"{API}/queue/join", json.dumps({"data": data, "fn_index": FN[endpoint],
        "session_hash": session, "event_data": None, "trigger_id": None}).encode(), "application/json")
    log("join_response", endpoint=endpoint, response=ev)
    eid = ev.get("event_id")
    t0 = time.time()
    started = None
    req = urllib.request.Request(f"{API}/queue/data?session_hash={session}")
    with urllib.request.urlopen(req, timeout=STREAM_TIMEOUT_S) as r:
        for raw in r:
            now = time.time()
            line = raw.decode().strip()
            if not line:
                continue
            if not line.startswith("data:"):
                log("sse_raw", endpoint=endpoint, line=line[:400])
                continue
            msg = json.loads(line[5:])
            kind = msg.get("msg")
            log("sse", endpoint=endpoint, dt=round(now - t0, 1), msg=_brief(msg, 1500))
            if msg.get("event_id") not in (None, eid):
                continue
            if kind == "process_starts":
                started = now
            elif kind == "process_completed":
                if not msg.get("success"):
                    raise RuntimeError(f"{endpoint} failed: {msg.get('output')}")
                return msg["output"]["data"]
            elif kind == "close_stream":
                break
            if started is None and now - t0 > QUEUE_S:
                raise RuntimeError(f"{endpoint}: still queued after {now - t0:.0f} s")
            if started is not None and now - started > RUN_S[endpoint]:
                _post(f"{API}/cancel", json.dumps({"session_hash": session, "fn_index": FN[endpoint],
                    "event_id": eid}).encode(), "application/json")
                raise RuntimeError(f"{endpoint}: over its {RUN_S[endpoint]} s budget")
    raise RuntimeError(f"{endpoint}: stream ended without a result")


def _fileobj(x):
    if isinstance(x, dict) and "__type__" in x:
        x = x.get("value")
    return x


def download(fileobj: dict, dest: str) -> None:
    fileobj = _fileobj(fileobj)
    url = fileobj.get("url") or f"{API}/file={fileobj['path']}"
    with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())


def cut_alpha(image: str, out: str, thresh: int = 236) -> str:
    """White background to alpha: near-white pixels connected to the border,
    and enclosed openings showing the same flat background."""
    import numpy as np
    from PIL import Image, ImageFilter
    im = Image.open(image).convert("RGBA")
    a = np.asarray(im).copy()
    rgb = a[..., :3].astype(int)
    white = (rgb.min(axis=2) >= thresh)
    bg = np.zeros_like(white)
    bg[0, :] = white[0, :]; bg[-1, :] = white[-1, :]; bg[:, 0] = white[:, 0]; bg[:, -1] = white[:, -1]
    while True:          # flood fill by repeated 4-neighbour dilation inside `white`
        g = bg.copy()
        g[1:, :] |= bg[:-1, :]; g[:-1, :] |= bg[1:, :]; g[:, 1:] |= bg[:, :-1]; g[:, :-1] |= bg[:, 1:]
        g &= white
        if (g == bg).all():
            break
        bg = g
    # Background seen through an opening (a trigger guard, a thumbhole, a stock
    # window) is enclosed by the gun, so the border fill misses it, and TRELLIS
    # builds it as a solid disc. Clear enclosed patches that look like the
    # background: big, near-white and flat. Small or shaded white (highlights,
    # white paint) stays.
    try:
        from scipy import ndimage
        bg_rgb = rgb[bg].mean(axis=0) if bg.any() else np.array([255, 255, 255])
        cand = (rgb.min(axis=2) >= max(thresh, 240)) & ~bg
        lab, n = ndimage.label(cand)
        min_px = max(150, int(white.size * 0.00025))
        holes = 0
        for i in range(1, n + 1):
            m = lab == i
            k = int(m.sum())
            if k < min_px:
                continue
            px = rgb[m]
            if np.abs(px.mean(axis=0) - bg_rgb).max() <= 8 and px.std(axis=0).max() <= 6:
                bg |= m
                holes += 1
        if holes:
            print(f"trellis2: cleared {holes} enclosed background opening(s)", file=sys.stderr)
    except ImportError:
        pass
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    a[..., 3] = np.minimum(np.asarray(alpha), a[..., 3])
    path = out + "_input.png"
    Image.fromarray(a).save(path)
    return path


def job(image: str, out: str, a) -> dict:
    """One job in its own session; end_session is always called. Every
    queue/join response and SSE message goes to OUT.log (jsonl)."""
    global LOG
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    lock, srv = claim()          # the first free server; its lock is held for the whole job
    print(f"trellis2: {os.path.basename(out)} on {srv}", flush=True)
    rec = {"image": os.path.abspath(image), "server": SERVER, "seed": a.seed, "resolution": a.res,
        "ss": [a.ss_guidance, 0.7, a.steps, 5.0], "shape": [a.shape_guidance, 0.5, a.steps, 3.0],
        "tex": [a.tex_guidance, 0.0, a.steps, 3.0], "decimation_target": a.decimate,
        "texture_size": a.texsize, "cut": a.cut, "extract_pause": a.extract_pause, "when": time.strftime("%Y-%m-%d %H:%M:%S")}
    with lock, open(out + ".log", "w") as LOG:
        session = uuid.uuid4().hex[:11]
        log("job", session=session, fn=FN, **rec)
        t = {}
        rec["seconds"] = t
        try:
            t0 = time.time()
            sent = cut_alpha(image, out) if a.cut else image
            call(session, "start_session", [])
            up = upload(sent)
            log("upload", file=up)
            pre = call(session, "preprocess_image_1", [up])[0]
            download(pre, out + "_pre.png")
            t["preprocess"] = round(time.time() - t0, 1)
            t1 = time.time()
            call(session, "image_to_3d", [_fileobj(pre), a.seed, str(a.res), *rec["ss"], *rec["shape"], *rec["tex"]])
            t["generate"] = round(time.time() - t1, 1)
            if a.extract_pause > 0:      # the UI's two clicks: generate, then Extract GLB
                log("pause", seconds=a.extract_pause)
                time.sleep(a.extract_pause)
            t2 = time.time()
            res = call(session, "extract_glb", [None, a.decimate, a.texsize])
            download(res[0], out + ".glb")
            t["extract"] = round(time.time() - t2, 1)
            log("done", seconds=t)
        except BaseException as e:
            rec["error"] = f"{type(e).__name__}: {e}"
            log("error", error=rec["error"], seconds=t)
            if not isinstance(e, (KeyboardInterrupt, FileNotFoundError, PermissionError)):
                # A stall or a dead stream: restart the server (still holding
                # the lock, so no other job is in flight) before giving up.
                rec["restarted"] = restart()
                log("restart", ok=rec["restarted"])
                session = None
            raise
        finally:
            try:
                if session:
                    call(session, "end_session", [])
            except Exception as e:
                log("end_session_error", error=f"{type(e).__name__}: {e}")
            try:
                rec["glb_bytes"] = os.path.getsize(out + ".glb")
            except OSError:
                pass
            with open(out + ".json", "w") as f:
                json.dump(rec, f, indent=1)
    LOG = None
    return rec


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("out", help="OUT_DIR/name (no extension)")
    ap.add_argument("--seed", type=int, action="append", help="repeatable; default 0")
    ap.add_argument("--res", type=int, default=1024, choices=(512, 1024, 1536))
    ap.add_argument("--steps", type=int, default=12, help="sampling steps, all three stages")
    ap.add_argument("--ss-guidance", type=float, default=7.5)
    ap.add_argument("--shape-guidance", type=float, default=7.5)
    ap.add_argument("--tex-guidance", type=float, default=1.0)
    ap.add_argument("--decimate", type=int, default=500000, help="extract_glb decimation target (faces)")
    ap.add_argument("--texsize", type=int, default=2048)
    ap.add_argument("--extract-pause", type=float, default=float(os.environ.get("TRELLIS_PAUSE", "0")),
        help="seconds between generate and extract_glb (default $TRELLIS_PAUSE or 0)")
    ap.add_argument("--no-cut", dest="cut", action="store_false", help="send the picture as is")
    a = ap.parse_args()
    seeds = a.seed or [0]
    if not os.path.isfile(a.image):
        # Checked before touching the server: a local mistake must never
        # restart it under another agent's job.
        print(f"trellis2: no such input image: {a.image}", file=sys.stderr)
        return 1
    print(f"trellis2: servers {SERVERS}")
    for i, s in enumerate(seeds):
        if i and not alive():
            print("trellis2: /gradio_api/info doesn't answer; stopping", file=sys.stderr)
            return 1
        a.seed = s
        out = a.out if len(seeds) == 1 else f"{a.out}_s{s}"
        try:
            r = job(a.image, out, a)
            print(f"{out}.glb  seed {s}  {r['seconds']}")
        except (RuntimeError, OSError, ValueError) as e:
            print(f"trellis2: {out}: {e} (log: {out}.log); stopping, no retry", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
