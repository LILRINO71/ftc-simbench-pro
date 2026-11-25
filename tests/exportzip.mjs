// Fixtures for the export tests: a GLB cube and a zip, built in memory the way
// Onshape's URDF export packs them (stored and deflated entries side by side).
import zlib from 'node:zlib';

export function glb(color, size = 1, offset = [0, 0, 0]) {
  const s = size / 2, pos = new Float32Array([-s, -s, -s, s, -s, -s, s, s, -s, -s, s, -s, -s, -s, s, s, -s, s, s, s, s, -s, s, s]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength); bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: offset }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1] } }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] };
  let js = JSON.stringify(json); while (js.length % 4) js += ' ';
  const jb = new TextEncoder().encode(js), out = new Uint8Array(12 + 8 + jb.length + 8 + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jb, 20);
  dv.setUint32(20 + jb.length, bin.length, true); dv.setUint32(24 + jb.length, 0x004E4942, true); out.set(bin, 28 + jb.length);
  return out;
}
export function zip(entries) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const raw = e.deflate ? zlib.deflateRawSync(data) : data, m = e.deflate ? 8 : 0;
    const lh = new Uint8Array(30 + name.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(8, m, true); d.setUint32(18, raw.length, true); d.setUint32(22, data.length, true); d.setUint16(26, name.length, true); lh.set(name, 30);
    parts.push(lh, raw);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(10, m, true); c.setUint32(20, raw.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true); ch.set(name, 46); cd.push(ch);
    off += lh.length + raw.length;
  }
  const cdLen = cd.reduce((s, c) => s + c.length, 0), eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const all = [...parts, ...cd, eocd], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}
