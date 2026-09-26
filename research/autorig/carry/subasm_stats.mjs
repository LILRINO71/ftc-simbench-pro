// How well do the CAD's subassemblies follow motion? (explains the subassembly-first result)
import { loadITD } from '../lib.mjs';
const { cad, truth } = loadITD();
const T = truth.solids.map((s) => s.mech ?? null);
const occ = new Map(); for (const o of cad.occs) if (o.solid >= 0 && !occ.has(o.solid)) occ.set(o.solid, o);
let rootMoving = 0, rootAll = 0, moving = 0;
const groups = new Map();
cad.solids.forEach((s, i) => {
  const o = occ.get(i), depth = o ? o.path.length - 1 : 0; if (T[i] != null) moving++;
  if (depth === 0) { rootAll++; if (T[i] != null) rootMoving++; return; }
  const key = o.path.slice(1).map((p) => p.n).join(' / ');
  if (!groups.has(key)) groups.set(key, []); groups.get(key).push(T[i] ?? 'frame');
});
console.log(`parts at the root (no subassembly): ${rootAll} of ${cad.solids.length}; moving parts at the root: ${rootMoving} of ${moving}`);
let pure = 0, mixed = 0, partsInMixed = 0;
const rows = [];
for (const [k, L] of groups) { const c = new Map(); for (const l of L) c.set(l, (c.get(l) || 0) + 1); if (c.size === 1) pure++; else { mixed++; partsInMixed += L.length; rows.push([k, L.length, [...c].map(([l, n]) => `${l}:${n}`).join(' ')]); } }
console.log(`deepest subassemblies: ${groups.size}, one motion each: ${pure}, mixed: ${mixed} (${partsInMixed} parts)`);
for (const r of rows.sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${r[0].slice(0, 60).padEnd(60)} ${String(r[1]).padStart(3)} parts: ${r[2]}`);
