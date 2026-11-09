#!/usr/bin/env python3
"""Local PTY bridge for the typewriter's terminal mode. Python standard library only; a small WebSocket server over one
shell. Run it explicitly with `npm run term`; nothing starts it automatically.

This exposes a shell to a browser, so:
  - it binds 127.0.0.1 and nothing else (there is no option to change that);
  - every run generates a fresh random token, printed once inside the page URL; connections without it are refused;
  - the Origin and Host headers must match the local page and this server (cross-site pages and DNS rebinding);
  - one session at a time; closing the page hangs up the shell.

Protocol on the socket: binary frames are raw terminal bytes in both directions. Text frames from the page are JSON
control messages: {"type":"pause"}, {"type":"resume"}, {"type":"flush"}. While paused the PTY is simply not read, so a
writer in the shell blocks, the same flow control a real teletype line had.
"""
from pathlib import Path
import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
import pty
import secrets
import selectors
import signal
import socket
import struct
import sys
import termios
import time
from urllib.parse import parse_qs, urlsplit

BIND_HOST = "127.0.0.1"          # deliberately a constant: this server must never listen on any other interface
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HANDSHAKE_LIMIT = 16 * 1024
HANDSHAKE_TIMEOUT_S = 5.0
MAX_FRAME = 1024 * 1024
READ_CHUNK = 4096
MAX_OUTBUF = 256 * 1024          # bytes queued for the page before the PTY stops being read
MAX_INBUF = 64 * 1024            # keystrokes queued for the shell before they are dropped
MIN_COLS, MAX_COLS = 20, 200


def log(msg):
    print(f"[term] {msg}", file=sys.stderr, flush=True)


class Reject(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def http_response(status, reason):
    body = (reason + "\n").encode()
    return (
        f"HTTP/1.1 {status} {reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n"
    ).encode() + body


def parse_request(raw, port, token, origins):
    """Validate a WebSocket upgrade. Returns (accept_key, cols). Raises Reject with the reason on any failure."""
    try:
        head = raw.decode("latin-1")
        lines = head.split("\r\n")
        method, target, _version = lines[0].split(" ", 2)
    except Exception:
        raise Reject(400, "Bad Request")
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    url = urlsplit(target)
    query = parse_qs(url.query)
    given = query.get("token", [""])[0]
    if not hmac.compare_digest(given.encode(), token.encode()):
        raise Reject(403, "Forbidden: bad token")
    if method != "GET" or url.path != "/tty":
        raise Reject(404, "Not Found")
    if headers.get("host", "") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
        raise Reject(403, "Forbidden: bad host")
    if headers.get("origin", "") not in origins:
        raise Reject(403, "Forbidden: bad origin")
    if "websocket" not in headers.get("upgrade", "").lower() or "upgrade" not in headers.get("connection", "").lower():
        raise Reject(400, "Bad Request: not a WebSocket upgrade")
    if headers.get("sec-websocket-version") != "13" or not headers.get("sec-websocket-key"):
        raise Reject(400, "Bad Request: bad WebSocket headers")
    try:
        cols = max(MIN_COLS, min(MAX_COLS, int(query.get("cols", ["75"])[0])))
    except ValueError:
        cols = 75
    accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + WS_GUID).encode()).digest()).decode()
    return accept, cols


class Session:
    """One shell on a PTY, spoken to over one WebSocket."""

    def __init__(self, sock, cols, shell_argv):
        self.sock = sock
        self.cols = cols
        self.outbuf = bytearray()     # to the page
        self.frag = bytearray()
        self.inbuf = bytearray()      # from the page, raw socket bytes
        self.ptyin = bytearray()      # keystrokes for the shell
        self.paused = False
        self.closing = False
        self.frag_op = 0
        self.pid, self.master = self.spawn(shell_argv)
        os.set_blocking(self.master, False)

    def spawn(self, argv):
        env = dict(os.environ)
        for name in ("COLORTERM", "VTE_VERSION", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "WT_SESSION", "KONSOLE_VERSION", "LS_COLORS", "PROMPT_COMMAND"):
            env.pop(name, None)
        env.update(TERM="dumb", PAGER="cat", MANPAGER="cat", GIT_PAGER="cat", COLUMNS=str(self.cols), LINES="24", NO_COLOR="1", CLICOLOR="0", TYPEWRITER_TTY="1")
        pid, master = pty.fork()
        if pid == 0:
            try:
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, self.cols, 0, 0))
                os.execvpe(argv[0], argv, env)
            finally:
                os._exit(127)
        return pid, master

    # ---- websocket output -----------------------------------------------------------
    def send_frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(n)
        elif n < 65536:
            head.append(126)
            head += struct.pack(">H", n)
        else:
            head.append(127)
            head += struct.pack(">Q", n)
        self.outbuf += head + payload

    def close(self, code, reason=""):
        if self.closing:
            return
        self.closing = True
        self.send_frame(8, struct.pack(">H", code) + reason.encode()[:120])

    def flush_socket(self):
        while self.outbuf:
            try:
                n = self.sock.send(bytes(self.outbuf[:65536]))
            except (BlockingIOError, InterruptedError):
                return
            del self.outbuf[:n]

    # ---- websocket input ------------------------------------------------------------
    def feed_socket(self, data):
        self.inbuf += data
        while True:
            frame = self.next_frame()
            if frame is None:
                return
            self.on_frame(*frame)

    def next_frame(self):
        b = self.inbuf
        if len(b) < 2:
            return None
        fin_op, mask_len = b[0], b[1]
        if not mask_len & 0x80:
            raise ConnectionError("unmasked client frame")
        n = mask_len & 0x7F
        i = 2
        if n == 126:
            if len(b) < 4:
                return None
            n = struct.unpack(">H", bytes(b[2:4]))[0]
            i = 4
        elif n == 127:
            if len(b) < 10:
                return None
            n = struct.unpack(">Q", bytes(b[2:10]))[0]
            i = 10
        if n > MAX_FRAME:
            raise ConnectionError("frame too large")
        if len(b) < i + 4 + n:
            return None
        mask = bytes(b[i : i + 4])
        payload = bytes(c ^ mask[j % 4] for j, c in enumerate(b[i + 4 : i + 4 + n]))
        del b[: i + 4 + n]
        return fin_op, payload

    def on_frame(self, fin_op, payload):
        op = fin_op & 0x0F
        fin = fin_op & 0x80
        if op in (0, 1, 2):
            if op:
                self.frag_op = op
            self.frag += payload
            if len(self.frag) > MAX_FRAME:
                raise ConnectionError("message too large")
            if not fin:
                return
            msg, self.frag = bytes(self.frag), bytearray()
            if self.frag_op == 2:
                if len(self.ptyin) + len(msg) <= MAX_INBUF:
                    self.ptyin += msg
            else:
                self.on_control(msg)
        elif op == 8:
            self.close(1000)
        elif op == 9:
            self.send_frame(10, payload)

    def on_control(self, msg):
        try:
            kind = json.loads(msg).get("type")
        except (ValueError, AttributeError):
            return
        if kind == "pause":
            self.paused = True
        elif kind == "resume":
            self.paused = False
        elif kind == "flush":
            self.outbuf.clear()
            self.paused = False

    def write_pty(self):
        while self.ptyin:
            try:
                n = os.write(self.master, bytes(self.ptyin[:READ_CHUNK]))
            except (BlockingIOError, InterruptedError):
                return
            except OSError:
                self.ptyin.clear()
                return
            del self.ptyin[:n]

    def read_pty(self):
        """Pass shell output to the page. Returns False once the shell has gone away."""
        try:
            data = os.read(self.master, READ_CHUNK)
        except BlockingIOError:
            return True
        except OSError:
            return False
        if not data:
            return False
        self.send_frame(2, data)
        return True

    def hangup(self):
        """The shell does not outlive its page."""
        try:
            os.killpg(self.pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                done, _ = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                done = self.pid
            if done:
                break
            time.sleep(0.02)
        else:
            try:
                os.killpg(self.pid, signal.SIGKILL)
                os.waitpid(self.pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        try:
            os.close(self.master)
        except OSError:
            pass


def serve(listener, port, token, origins, shell_argv):
    sel = selectors.DefaultSelector()
    sel.register(listener, selectors.EVENT_READ, ("listen", None))
    pending = {}                 # socket -> [buffer, deadline] for connections still in their handshake
    session = None
    stop = [False]
    for s in (signal.SIGINT, signal.SIGTERM):
        signal.signal(s, lambda *_: stop.__setitem__(0, True))

    def end_session():
        nonlocal session
        if session is None:
            return
        for fileobj in (session.sock, session.master):
            try:
                sel.unregister(fileobj)
            except (KeyError, ValueError):
                pass
        session.hangup()
        try:
            session.sock.close()
        except OSError:
            pass
        session = None
        log("session ended")

    def drop(conn):
        pending.pop(conn, None)
        try:
            sel.unregister(conn)
        except (KeyError, ValueError):
            pass
        conn.close()

    while not stop[0]:
        now = time.monotonic()
        for conn in [c for c, p in pending.items() if p[1] < now]:
            log("handshake timed out")
            drop(conn)
        if session is not None:
            # Reading the PTY only while the page can keep up is the whole of the flow control.
            want_pty = not session.paused and len(session.outbuf) < MAX_OUTBUF and not session.closing
            events = (selectors.EVENT_READ if want_pty else 0) | (selectors.EVENT_WRITE if session.ptyin else 0)
            try:
                if events:
                    sel.modify(session.master, events, ("pty", None)) if session.master in sel.get_map() else sel.register(session.master, events, ("pty", None))
                elif session.master in sel.get_map():
                    sel.unregister(session.master)
                sel.modify(session.sock, selectors.EVENT_READ | (selectors.EVENT_WRITE if session.outbuf else 0), ("ws", None))
            except OSError:
                end_session()
                continue
        for key, mask in sel.select(timeout=0.25):
            kind, _ = key.data
            if kind == "listen":
                conn, addr = listener.accept()
                if addr[0] != BIND_HOST:     # cannot happen on a loopback bind; kept so the property is local to this code
                    log(f"refused connection from {addr[0]}")
                    conn.close()
                    continue
                conn.setblocking(False)
                pending[conn] = [bytearray(), now + HANDSHAKE_TIMEOUT_S]
                sel.register(conn, selectors.EVENT_READ, ("handshake", None))
            elif kind == "handshake":
                conn = key.fileobj
                try:
                    data = conn.recv(READ_CHUNK)
                except (BlockingIOError, InterruptedError):
                    continue
                except OSError:
                    drop(conn)
                    continue
                buf = pending[conn][0]
                buf += data
                if not data or len(buf) > HANDSHAKE_LIMIT:
                    drop(conn)
                    continue
                if b"\r\n\r\n" not in buf:
                    continue
                try:
                    if session is not None:
                        parse_request(bytes(buf), port, token, origins)   # still validate before saying anything else
                        raise Reject(409, "Conflict: a session is already running")
                    accept, cols = parse_request(bytes(buf), port, token, origins)
                except Reject as r:
                    log(f"refused ({r.status}): {r.reason}")
                    try:
                        conn.send(http_response(r.status, r.reason))
                    except OSError:
                        pass
                    drop(conn)
                    continue
                pending.pop(conn, None)
                sel.unregister(conn)
                conn.send(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n".encode())
                session = Session(conn, cols, shell_argv)
                sel.register(conn, selectors.EVENT_READ, ("ws", None))
                log(f"session started, {cols} columns, pid {session.pid}")
            elif kind == "ws" and session is not None:
                alive = True
                if mask & selectors.EVENT_READ:
                    try:
                        data = session.sock.recv(READ_CHUNK)
                        if not data:
                            alive = False
                        else:
                            session.feed_socket(data)
                    except (BlockingIOError, InterruptedError):
                        pass
                    except (OSError, ConnectionError) as e:
                        log(f"connection error: {e}")
                        alive = False
                if alive and mask & selectors.EVENT_WRITE:
                    try:
                        session.flush_socket()
                    except OSError:
                        alive = False
                if not alive or (session.closing and not session.outbuf):
                    end_session()
            elif kind == "pty" and session is not None:
                if mask & selectors.EVENT_WRITE:
                    session.write_pty()
                if mask & selectors.EVENT_READ and not session.read_pty():
                    session.close(1000, "shell exited")
                    session.flush_socket()
                    end_session()
    end_session()
    for conn in list(pending):
        drop(conn)
    listener.close()


def main():
    ap = argparse.ArgumentParser(description="Local shell bridge for the typewriter's terminal mode (127.0.0.1 only).")
    ap.add_argument("--port", type=int, default=5318, help="port on 127.0.0.1 (0 picks a free one)")
    ap.add_argument("--page-origin", action="append", default=[], metavar="ORIGIN", help="origin of the typewriter page, e.g. http://127.0.0.1:5317 (repeatable)")
    ap.add_argument("--plain-shell", action="store_true", help="use bash without rc files and with a plain prompt (for testing)")
    args = ap.parse_args()

    origins = set(args.page_origin)
    if not origins:
        origins = {"http://127.0.0.1:5317", "http://localhost:5317"}
    for origin in origins:
        if urlsplit(origin).scheme not in ("http", "https") or urlsplit(origin).netloc == "" or urlsplit(origin).path not in ("", "/"):
            sys.exit(f"--page-origin must look like http://127.0.0.1:5317, got {origin!r}")

    if args.plain_shell:
        shell_argv = ["bash", "--noprofile", "--norc", "-i"]
        os.environ["PS1"] = "$ "
        os.environ["HISTFILE"] = "/dev/null"
    else:
        shell = os.environ.get("SHELL") or "/bin/sh"
        if not os.path.isabs(shell) or not os.access(shell, os.X_OK):
            sys.exit(f"SHELL is not an executable absolute path: {shell!r}")
        if os.path.basename(shell) == "bash":
            # Keeps the user's aliases and PATH, but ends on a prompt that prints once and never redraws.
            shell_argv = [shell, "--rcfile", str(Path(__file__).resolve().with_name("term-rc.bash")), "-i"]
        else:
            os.environ["PS1"] = "$ "
            shell_argv = [shell, "-i"]

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((BIND_HOST, args.port))
    listener.listen(4)
    listener.setblocking(False)
    port = listener.getsockname()[1]

    token = secrets.token_urlsafe(32)
    page = sorted(origins)[0]
    print(f"Typewriter terminal bridge on {BIND_HOST}:{port} (loopback only, one session).")
    print("Start the page in another terminal with `npm run dev`, then open:")
    print(f"  {page}/?terminal={token}&termport={port}")
    print("The token changes every run. Ctrl-C here stops the bridge and hangs up the shell.", flush=True)
    serve(listener, port, token, origins, shell_argv)


if __name__ == "__main__":
    main()
