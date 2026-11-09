// Node side of src/audio/samples.js: decodes the sprite with ffmpeg for tests and offline renders.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../public/assets/audio/samples/', import.meta.url));

export function readSamples() {
  const manifest = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
  const raw = execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', dir + manifest.sprite, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 1 << 28 });
  const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  return { pcm, manifest };
}
