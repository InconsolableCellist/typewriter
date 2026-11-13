// Content-hashed /assets/ URLs (vite/assets.js, src/asset-version.js): a file's URL follows its bytes and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { processAssets, assetMap, hashedName } from '../vite/assets.js';
import { versionedWith } from '../src/asset-version.js';

const PUBLIC = new URL('../public/assets/', import.meta.url).pathname;

function tempAssets(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  return dir;
}

test('hashed names keep the folder and the extensions', () => {
  assert.equal(hashedName('models/frame.glb', 'abc', '.gz.bin'), 'models/frame.abc.glb.gz.bin');
  assert.equal(hashedName('glyphs.gz.bin', 'abc'), 'glyphs.abc.gz.bin');
  assert.equal(hashedName('audio/samples/sprite.ogg', 'abc'), 'audio/samples/sprite.abc.ogg');
  assert.equal(hashedName('LICENSE', 'abc'), 'LICENSE.abc');
});

test('the map: an unchanged file keeps its URL, a changed one gets a new one, notes are not mapped', async () => {
  const one = tempAssets({ 'a.json': '{"x":1}', 'textures/b.avif': 'bbbb', 'SOURCES.md': '# notes' });
  const two = tempAssets({ 'a.json': '{"x":2}', 'textures/b.avif': 'bbbb', 'SOURCES.md': '# changed notes' });
  const [m1, m2] = [assetMap(await processAssets(one)), assetMap(await processAssets(two))];
  assert.deepEqual(Object.keys(m1).sort(), ['a.json', 'textures/b.avif']);
  assert.equal(m1['textures/b.avif'], m2['textures/b.avif'], 'unchanged: same URL across builds');
  assert.notEqual(m1['a.json'], m2['a.json'], 'changed: new URL');
  assert.match(m1['textures/b.avif'], /^textures\/b\.[0-9a-f]{10}\.avif$/);
});

test('every file of public/assets is mapped, models as gzipped meshopt GLBs, and each name is its content\'s hash', async () => {
  const entries = await processAssets(PUBLIC);
  const map = assetMap(entries);
  for (const rel of ['glyphs.gz.bin', 'glyphs.json', 'glyphs_wp.gz.bin', 'textures/walnut_desk_albedo.avif', 'hdri/combination_room_1k.exr',
    'models/frame.glb', 'models/desk.glb', 'audio/ambience/rain.ogg', 'fonts/caveat-600.woff2', 'wordlist_en.gz.bin']) assert.ok(map[rel], rel);
  assert.equal(new Set(Object.values(map)).size, entries.length, 'no two files share a name');
  const again = assetMap(await processAssets(PUBLIC));
  assert.deepEqual(again, map, 'the same tree gives the same map');
  const frame = entries.find((e) => e.rel === 'models/frame.glb');
  assert.match(frame.out, /^models\/frame\.[0-9a-f]{10}\.glb\.gz\.bin$/);
  const glb = gunzipSync(frame.bytes);
  assert.equal(glb.readUInt32LE(0), 0x46546C67, 'a GLB inside the gzip');
  assert.ok(JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()).extensionsRequired.includes('EXT_meshopt_compression'));
  const json = entries.find((e) => e.rel === 'glyphs.json');
  assert.deepEqual(Buffer.from(json.bytes), fs.readFileSync(path.join(PUBLIC, 'glyphs.json')), 'other files as they are');
});

test('versioned(): /assets/ paths of this origin go to their hashed names, everything else is left alone', () => {
  const map = { 'models/frame.glb': 'models/frame.0123456789.glb.gz.bin', 'audio/ambience/rain.ogg': 'audio/ambience/rain.abcdef0123.ogg' };
  const base = 'https://typewriter.example/?machine=frontstrike1926';
  assert.equal(versionedWith(map, '/assets/models/frame.glb', base), 'https://typewriter.example/assets/models/frame.0123456789.glb.gz.bin');
  assert.equal(versionedWith(map, 'https://typewriter.example/assets/audio/ambience/rain.ogg', base), 'https://typewriter.example/assets/audio/ambience/rain.abcdef0123.ogg');
  assert.equal(versionedWith(map, '/assets/models/unknown.glb', base), '/assets/models/unknown.glb', 'not in the map');
  assert.equal(versionedWith(map, '/assets/models/frame.0123456789.glb.gz.bin', base), '/assets/models/frame.0123456789.glb.gz.bin', 'already hashed');
  assert.equal(versionedWith(map, 'https://cdn.example/assets/models/frame.glb', base), 'https://cdn.example/assets/models/frame.glb', 'another origin');
  assert.equal(versionedWith(map, '/_app/index-abc.js', base), '/_app/index-abc.js', 'Vite\'s own chunks');
  assert.equal(versionedWith(null, '/assets/models/frame.glb', base), '/assets/models/frame.glb', 'no map (dev server)');
  // Applying it twice changes nothing more: the hashed name is not a key.
  const once = versionedWith(map, '/assets/models/frame.glb', base);
  assert.equal(versionedWith(map, once, base), once);
});
