// A small PDF writer for full-bleed JPEG pages. Bytes are assembled directly, so the JPEG streams stay binary-safe and the
// xref offsets are the positions the bytes were actually written at.

const LETTER_PT = [612, 792];

function ascii(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * @param pages [{ jpeg: Uint8Array, width, height }], one PDF page each, in order
 * @returns Uint8Array, a complete PDF file
 */
export function buildPdf(pages, { pageSize = LETTER_PT } = {}) {
  if (!pages.length) throw new Error('buildPdf: no pages');
  const [W, H] = pageSize;
  const chunks = [];
  let pos = 0;
  const offsets = [];
  const put = (bytes) => { chunks.push(bytes); pos += bytes.length; };
  const text = (s) => put(ascii(s));
  const object = (n, body) => { offsets[n] = pos; text(`${n} 0 obj\n${body}\nendobj\n`); };
  const stream = (n, dict, bytes) => {
    offsets[n] = pos;
    text(`${n} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);
    put(bytes);
    text('\nendstream\nendobj\n');
  };

  text('%PDF-1.4\n');
  put(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));   // marks the file as binary

  // Objects 1 and 2 are the catalog and page tree; each page then takes three: page, contents, image.
  const pageObj = (i) => 3 + i * 3;
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    if (p.jpeg[0] !== 0xff || p.jpeg[1] !== 0xd8) throw new Error(`buildPdf: page ${i + 1} is not a JPEG`);
    const n = pageObj(i);
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${n + 1} 0 R /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> >>`);
    stream(n + 1, '', ascii(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
    stream(n + 2, `/Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.jpeg);
  });

  const size = offsets.length;
  const xref = pos;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  text(`${table}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** PDF bytes for archived pages. */
export async function pagesToPdf(pages) {
  const jpegs = await Promise.all(pages.map((p) => p.blob.arrayBuffer()));
  return buildPdf(pages.map((p, i) => ({ jpeg: new Uint8Array(jpegs[i]), width: p.width, height: p.height })));
}
