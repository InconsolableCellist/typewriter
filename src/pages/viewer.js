// The overlay for browsing finished pages and saving them as PDF.
import { pagesToPdf } from './pdf.js';

const ZOOM_MAX = 6;

export class PageViewer {
  constructor({ archive }) {
    this.archive = archive;
    this.isOpen = false;
    this.index = 0;
    this.zoom = 1;
    this.url = null;
    this.saving = false;
    this.build();
    // Registered before KeyboardInput and the terminal's capture-phase listener (see main.js), and same-target
    // listeners run in registration order, so while the overlay is open no keystroke reaches the machine or the shell.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('paste', (e) => this.isOpen && e.stopImmediatePropagation(), true);
    window.addEventListener('resize', () => this.isOpen && this.layout());
  }

  build() {
    const el = document.createElement('div');
    el.id = 'pagesViewer'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Finished pages');
    el.innerHTML = `
      <header>
        <span class="title">FINISHED PAGES</span>
        <span class="count" id="pvCount"></span>
        <span class="status" id="pvStatus" role="status"></span>
        <span class="gap"></span>
        <button id="pvPrev" title="previous page (left arrow)">prev</button>
        <button id="pvNext" title="next page (right arrow)">next</button>
        <button id="pvOut" title="zoom out (-)">&minus;</button>
        <button id="pvFit" title="fit to window (0)">fit</button>
        <button id="pvIn" title="zoom in (+)">+</button>
        <button id="pvSave" title="save this page as a PDF">save page</button>
        <button id="pvSaveAll" title="save every page as one PDF">save all</button>
        <button id="pvClose" title="close (Esc)">close</button>
      </header>
      <div class="stage" id="pvStage"><img id="pvImage" alt="" draggable="false"></div>`;
    document.body.append(el);
    this.el = el;
    const $ = (id) => el.querySelector(id);
    this.stage = $('#pvStage'); this.img = $('#pvImage');
    this.elCount = $('#pvCount'); this.elStatus = $('#pvStatus');
    this.btnPrev = $('#pvPrev'); this.btnNext = $('#pvNext'); this.btnSave = $('#pvSave'); this.btnSaveAll = $('#pvSaveAll');
    this.btnPrev.addEventListener('click', () => this.go(this.index - 1));
    this.btnNext.addEventListener('click', () => this.go(this.index + 1));
    $('#pvOut').addEventListener('click', () => this.setZoom(this.zoom / 1.4));
    $('#pvIn').addEventListener('click', () => this.setZoom(this.zoom * 1.4));
    $('#pvFit').addEventListener('click', () => this.setZoom(1));
    $('#pvClose').addEventListener('click', () => this.close());
    this.btnSave.addEventListener('click', () => this.save(false));
    this.btnSaveAll.addEventListener('click', () => this.save(true));
    this.img.addEventListener('load', () => this.layout());

    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * Math.exp(-Math.sign(e.deltaY) * 0.18), e.clientX, e.clientY);
    }, { passive: false });
    // A click on the backdrop closes; a drag pans a zoomed page.
    let drag = null;
    this.stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false, onImage: e.target === this.img };
      this.stage.setPointerCapture(e.pointerId);
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (dx || dy) drag.moved = true;
      this.stage.scrollLeft -= dx; this.stage.scrollTop -= dy;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const end = () => {
      if (drag && !drag.moved && !drag.onImage) this.close();
      drag = null;
    };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', () => { drag = null; });
  }

  get count() { return this.archive.pages.length; }

  /** Opens on the newest page, the one on top of the pile. */
  open() {
    if (this.isOpen || !this.count) return;
    this.isOpen = true;
    this.el.hidden = false;
    this.show(this.count - 1);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    this.elStatus.textContent = '';
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.img.removeAttribute('src');
    document.activeElement?.blur?.();     // typing must not land on a button
  }

  go(i) { if (i >= 0 && i < this.count && i !== this.index) this.show(i); }

  show(i) {
    this.index = i;
    this.zoom = 1;
    const previous = this.url;
    this.url = URL.createObjectURL(this.archive.pages[i].blob);
    this.img.src = this.url;
    if (previous) URL.revokeObjectURL(previous);
    this.stage.scrollTop = this.stage.scrollLeft = 0;
    this.refresh();
  }

  /** The archive grew or the page changed. */
  refresh() {
    if (!this.isOpen) return;
    this.elCount.textContent = `page ${this.index + 1} of ${this.count}`;
    this.btnPrev.disabled = this.index <= 0;
    this.btnNext.disabled = this.index >= this.count - 1;
    this.btnSave.disabled = this.btnSaveAll.disabled = this.saving;
    this.layout();
  }

  layout() {
    const page = this.archive.pages[this.index];
    if (!page) return;
    const margin = 32;
    const fit = Math.min(this.stage.clientWidth - margin, (this.stage.clientHeight - margin) * (page.width / page.height));
    this.img.style.width = `${Math.max(1, Math.round(fit * this.zoom))}px`;
  }

  /** Changes zoom keeping the point under the cursor (or the view's centre) still. */
  setZoom(z, cx, cy) {
    const zoom = Math.min(ZOOM_MAX, Math.max(1, z));
    if (zoom === this.zoom) return;
    const box = this.stage.getBoundingClientRect();
    const px = cx ?? box.left + box.width / 2, py = cy ?? box.top + box.height / 2;
    const before = this.img.getBoundingClientRect();
    const fx = (px - before.left) / before.width, fy = (py - before.top) / before.height;
    this.zoom = zoom;
    this.layout();
    const after = this.img.getBoundingClientRect();
    this.stage.scrollLeft += after.left + fx * after.width - px;
    this.stage.scrollTop += after.top + fy * after.height - py;
    this.stage.classList.toggle('zoomed', zoom > 1);
  }

  onKey(e) {
    if (!this.isOpen) return;
    e.stopImmediatePropagation();
    const act = {
      Escape: () => this.close(),
      ArrowLeft: () => this.go(this.index - 1), PageUp: () => this.go(this.index - 1),
      ArrowRight: () => this.go(this.index + 1), PageDown: () => this.go(this.index + 1),
      Home: () => this.go(0), End: () => this.go(this.count - 1),
      '+': () => this.setZoom(this.zoom * 1.4), '=': () => this.setZoom(this.zoom * 1.4),
      '-': () => this.setZoom(this.zoom / 1.4), '0': () => this.setZoom(1),
    }[e.key];
    if (!act || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    act();
  }

  async save(all) {
    if (this.saving || !this.count) return;
    const pages = all ? this.archive.pages.slice() : [this.archive.pages[this.index]];
    const name = all ? 'typewriter-pages.pdf' : `typewriter-page-${this.index + 1}.pdf`;
    this.saving = true;
    this.btnSave.disabled = this.btnSaveAll.disabled = true;
    this.elStatus.textContent = 'writing PDF';
    try {
      download(new Blob([await pagesToPdf(pages)], { type: 'application/pdf' }), name);
      this.elStatus.textContent = `saved ${name}`;
    } catch (e) {
      console.warn('PDF failed', e);
      this.elStatus.textContent = 'could not write the PDF';
    }
    this.saving = false;
    this.refresh();
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
