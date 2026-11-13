// The last step of every model export: EXT_meshopt_compression on a GLB, in place (docs/assets.md, Models).
//
//   node tools/gen/compress_glb.mjs [--strip TEXCOORD_1] [--no-meshopt] path/to/model.glb ...
//
// Lossless: the vertex and index streams are meshopt-encoded as they are (no filters, no further quantization), so a
// quantized file (KHR_mesh_quantization, tools/blender/quantize_glb.py) keeps its integers and a float one its floats.
// Node names, transforms, extras and materials are untouched. `--strip` drops an attribute no material reads (frame.glb's
// second UV set). Three's GLTFLoader decodes it with MeshoptDecoder (src/render/gltf.js), Blender's importer natively.
// Running it again on a compressed file decodes and re-encodes it to the same bytes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export async function compressGlb(bytes, { strip = [], meshopt = true } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(bytes);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const name of strip) {
        const a = prim.getAttribute(name);
        if (!a) continue;
        prim.setAttribute(name, null);
        if (a.listParents().every((p) => p === doc.getRoot())) a.dispose();
      }
    }
  }
  const ext = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME);
  if (meshopt) (ext ?? doc.createExtension(EXTMeshoptCompression)).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  else ext?.dispose();
  return io.writeBinary(doc);
}

async function main(argv) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const strip = [], files = [];
  let meshopt = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strip') strip.push(argv[++i]);
    else if (argv[i] === '--no-meshopt') meshopt = false;
    else files.push(argv[i]);
  }
  for (const f of files) {
    const before = await readFile(f);
    const after = await compressGlb(new Uint8Array(before), { strip, meshopt });
    await writeFile(f, after);
    console.log(`${f}: ${before.length} -> ${after.length} bytes`);
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
