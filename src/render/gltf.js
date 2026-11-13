// The one GLB loader: the build meshopt-compresses every model (vite/assets.js, tools/gen/compress_glb.mjs), so each
// GLTFLoader needs the decoder; the plain files the dev server sends load through it as well. A body that arrives
// gzipped is unpacked first.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { gunzip } from '../machine/glyphs.js';

/** A GLTFLoader with the meshopt decoder registered. */
export function gltfLoader() { return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); }

/** Fetches and parses a GLB; resolves to the loader's { scene, ... }. */
export async function loadGLTF(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = await gunzip(new Uint8Array(await res.arrayBuffer()));
  const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  return gltfLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
}
