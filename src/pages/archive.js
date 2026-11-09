// The finished pages of this session, in the order the sheets came off the machine. Held as compressed blobs, in memory only.

/** @typedef {{ blob: Blob, thumb: Blob, width: number, height: number }} Page */

export class PageArchive {
  /** @param encode async snapshot -> Page; the snapshot's buffers are the encoder's to keep. */
  constructor({ encode }) {
    this.encode = encode;
    this.pages = [];
    this.pending = 0;
    this.onPage = null;
    this._seq = 0;
  }

  /** Called from SoftWorld.spawnSheet; returns at once and encodes in the background. */
  async retire(snapshot) {
    const seq = this._seq++;
    this.pending++;
    let page;
    try {
      page = await this.encode(snapshot);
    } catch (e) {
      console.warn('page could not be archived', e);
      return null;
    } finally {
      this.pending--;
    }
    page.seq = seq;
    let i = this.pages.length;
    while (i > 0 && this.pages[i - 1].seq > seq) i--;
    this.pages.splice(i, 0, page);
    this.onPage?.(page, i);
    return page;
  }
}

/** Encodes in a worker, so the main thread pays only for the postMessage. Jobs finish in the order sent. */
export function createWorkerEncoder() {
  const worker = new Worker(new URL('./encode-worker.js', import.meta.url), { type: 'module' });
  const waiting = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const job = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.page);
  };
  worker.onerror = (e) => {
    for (const job of waiting.values()) job.reject(new Error(e.message || 'encode worker failed'));
    waiting.clear();
  };
  return (snapshot) => new Promise((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, snapshot }, [snapshot.ink.buffer, ...(snapshot.mask ? [snapshot.mask.data.buffer] : [])]);
  });
}
