// Off the main thread: a page snapshot to a full-size JPEG (the viewer image and the PDF's page data) and a desk thumbnail.
import { composePage } from './capture.js';

// willReadFrequently keeps these canvases off the GPU, where a 47 MB upload would hold up the WebGL frame.
const JPEG_QUALITY = 0.93, THUMB_QUALITY = 0.9, THUMB_WIDTH = 1024;

async function encode(snapshot) {
  const { rgba, width, height } = composePage(snapshot);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  const thumbH = Math.round((height * THUMB_WIDTH) / width);
  const small = new OffscreenCanvas(THUMB_WIDTH, thumbH);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, THUMB_WIDTH, thumbH);
  const thumb = await small.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY });
  const thumbPixels = new Uint8Array(ctx.getImageData(0, 0, THUMB_WIDTH, thumbH).data.buffer);
  return { blob, thumb, width, height, thumbPixels, thumbWidth: THUMB_WIDTH, thumbHeight: thumbH };
}

self.onmessage = async ({ data: { id, snapshot } }) => {
  try {
    const page = await encode(snapshot);
    self.postMessage({ id, page }, [page.thumbPixels.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};
