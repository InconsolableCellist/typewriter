// IBM's own manuals, read in the page: the browser's PDF viewer in a frame, each scan loaded straight from bitsavers
// (no file is copied to this site). One viewer serves them all: open({ url, title }) shows that scan. A browser that cannot show a PDF inside a page (most phones) gets a button that
// opens it in a new tab instead, and so does the header always. While the viewer is open no key reaches the machine:
// keys typed into the frame stay in the frame, and the rest stop here in the capture phase (Esc closes).
const CSS = `
#wpPdf { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(5,6,8,.72);
  opacity: 0; transition: opacity .18s; font: 12px "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace; }
#wpPdf.on { opacity: 1; }
#wpPdf[hidden] { display: none; }
#wpPdf .win { width: min(980px, calc(100vw - 24px)); height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #1a1fa6; border-radius: 4px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
#wpPdf header { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; color: #e8e6ff; }
#wpPdf header .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: .04em; }
#wpPdf header a, #wpPdf header button, #wpPdf .fallback a { color: #fff; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.3);
  border-radius: 3px; padding: 4px 10px; text-decoration: none; font: inherit; cursor: pointer; white-space: nowrap; }
#wpPdf .frame { position: relative; flex: 1; background: #525659; }
#wpPdf iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
#wpPdf .fallback { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 24px;
  color: #e8e6ff; line-height: 1.6; }
#wpPdf .fallback p { max-width: 460px; margin: 0 0 16px; }
@media (max-width: 520px) { #wpPdf .win { height: calc(100vh - 16px); width: calc(100vw - 12px); } #wpPdf header .t { font-size: 11px; } }
`;

/**
 * Builds the viewer (hidden). `url` and `title`, optional, are what open() shows when called with nothing.
 * Returns { open({ url, title }?), close(), get isOpen, get url }.
 */
export function installPdfViewer({ url: defaultUrl = null, title: defaultTitle = 'IBM manual' } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const inline = navigator.pdfViewerEnabled !== false;     // undefined in older browsers: try the frame
  const root = document.createElement('div');
  root.id = 'wpPdf'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="win">
      <header><span class="t"></span><a class="ext" target="_blank" rel="noopener">open in a new tab</a>
        <button class="close" type="button" title="close (Esc)" aria-label="close">✕</button></header>
      <div class="frame"><div class="fallback"><div><p></p><a class="ext" target="_blank" rel="noopener">open the scanned manual</a></div></div></div>
    </div>`;
  const note = root.querySelector('.fallback p');
  note.textContent = inline
    ? 'Loading the scan from bitsavers.org (10 to 20 MB). If it does not appear, open it in a new tab.'
    : 'This browser cannot show a PDF inside the page. The scan opens in a new tab (10 to 20 MB, from bitsavers.org).';
  document.body.appendChild(root);
  const frameBox = root.querySelector('.frame');
  let frame = null, open = false, current = null;

  /** Points the header, the links and the frame at a scan. The frame is (re)made only when the scan changes. */
  const load = (url, title) => {
    root.setAttribute('aria-label', title);
    root.querySelector('.t').textContent = `${title} · scanned copy at bitsavers.org`;
    for (const a of root.querySelectorAll('a.ext')) a.href = url;
    if (!inline || url === current) return;
    current = url;
    frame?.remove();
    // Made on the first open of each scan: nothing is fetched from bitsavers until a binder is opened.
    frame = document.createElement('iframe');
    frame.title = title;
    frame.src = `${url}#view=FitH`;
    frameBox.appendChild(frame);
  };

  const show = (doc) => {
    const url = doc?.url ?? defaultUrl;
    if (!url) return;
    load(url, doc?.title ?? defaultTitle);
    if (!inline) current = url;
    if (open) return;
    open = true;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('on'));
    document.activeElement?.blur?.();
  };
  const hide = () => {
    if (!open) return;
    open = false; root.classList.remove('on');
    setTimeout(() => { if (!open) root.hidden = true; }, 180);
  };
  root.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); hide(); });
  root.addEventListener('click', (e) => { if (e.target === root) hide(); });
  for (const a of root.querySelectorAll('a.ext')) a.addEventListener('click', (e) => e.stopPropagation());

  const taken = new Set();
  window.addEventListener('keydown', (e) => {
    if (!open) return;
    e.stopImmediatePropagation();
    taken.add(e.code);
    if (e.key === 'Escape' && !e.repeat) { e.preventDefault(); hide(); }
  }, true);
  window.addEventListener('keyup', (e) => { if (taken.delete(e.code)) e.stopImmediatePropagation(); }, true);
  return { open: show, close: hide, get isOpen() { return open; }, get url() { return current; } };
}
