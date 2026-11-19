/* Astro Outpost — export the surface detail packed in js/assets.js for the Godot version.
   rocks, the lookout seat and the mountain ranges become glTF files (positions, smooth normals, the baked shade as
   vertex colour); the regolith tiles become JPEG files. Run from the repository root:
     node tools/godot/export_surface.js
   Output: godot/assets/surface/ (then run tools/godot/convert_tiles.py: Godot needs the tiles as PNG) */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = { JA: {} };
require(path.resolve(__dirname, '../../js/assets.js'));
const AS = global.window.JA_ASSETS;
const OUT = path.resolve(__dirname, '../../godot/assets/surface');
fs.mkdirSync(OUT, { recursive: true });

function bytes(b64) { return Buffer.from(b64, 'base64'); }

// d: { s, n, w, p: Int16 positions * s, c: Uint8 shade per vertex, i: indices (Uint16, or Uint32 when w === 4) }
// lo: how dark the deepest shade may get (the same as world.js assetGeo)
function writeMesh(name, d, lo) {
  const pb = bytes(d.p), cb = bytes(d.c), ib = bytes(d.i);
  const p16 = new Int16Array(pb.buffer, pb.byteOffset, pb.length / 2);
  const idx = d.w === 4 ? new Uint32Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.length)) : new Uint16Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + ib.length));
  const n = p16.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 4), nor = new Float32Array(n * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i++) { pos[i] = p16[i] * d.s; min[i % 3] = Math.min(min[i % 3], pos[i]); max[i % 3] = Math.max(max[i % 3], pos[i]); }
  for (let i = 0; i < n; i++) { const v = lo + (1 - lo) * cb[i] / 255; col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = v; col[i * 4 + 3] = 1; }
  // smooth normals, like three.js computeVertexNormals
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
    nor[i * 3] /= l; nor[i * 3 + 1] /= l; nor[i * 3 + 2] /= l;
  }
  const idx32 = new Uint32Array(idx.length); idx32.set(idx);
  const parts = [Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(col.buffer), Buffer.from(idx32.buffer)];
  const offs = []; let o = 0;
  for (const b of parts) { offs.push(o); o += b.length; }
  const buf = Buffer.concat(parts);
  const gltf = {
    asset: { version: '2.0', generator: 'Astro Outpost export_surface.js' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: name, mesh: 0 }],
    meshes: [{ name: name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'Rock', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: buf.length, uri: 'data:application/octet-stream;base64,' + buf.toString('base64') }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: parts[0].length, target: 34962 },
      { buffer: 0, byteOffset: offs[1], byteLength: parts[1].length, target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: parts[2].length, target: 34962 },
      { buffer: 0, byteOffset: offs[3], byteLength: parts[3].length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: min, max: max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC4' },
      { bufferView: 3, componentType: 5125, count: idx32.length, type: 'SCALAR' }
    ]
  };
  fs.writeFileSync(path.join(OUT, name + '.gltf'), JSON.stringify(gltf));
  return n;
}

function writeImage(name, dataUrl) {
  const m = /^data:image\/(\w+);base64,(.*)$/.exec(dataUrl);
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  fs.writeFileSync(path.join(OUT, name + '.' + ext), Buffer.from(m[2], 'base64'));
  return name + '.' + ext;
}

const made = [];
AS.rocks.forEach((d, i) => made.push('rock_' + i + ' (' + writeMesh('rock_' + i, d, 0.42) + ' verts)'));
made.push('seat (' + writeMesh('seat', AS.seat, 0.42) + ' verts)');
['moon', 'mars'].forEach((site) => {
  made.push('mountains_' + site + ' (' + writeMesh('mountains_' + site, AS.mountains[site], 0.35) + ' verts)');
  const g = AS.ground[site];
  made.push(writeImage('ground_' + site + '_n', g.n), writeImage('ground_' + site + '_a', g.a));
});
fs.writeFileSync(path.join(OUT, 'ground_tiles.json'), JSON.stringify({ moon: AS.ground.moon.tile, mars: AS.ground.mars.tile }));
console.log('Wrote to ' + OUT + ':\n  ' + made.join('\n  '));
