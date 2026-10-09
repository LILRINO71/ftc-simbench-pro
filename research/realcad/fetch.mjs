// Download the real-team CAD test set (sources.json) into a folder outside the repo.
//   node research/realcad/fetch.mjs [folder]      default: ../ftc-cad-corpus next to the repo
// Files already there are kept. Nothing here runs anything it downloads; it only reads STEP text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '..', '..', '..', 'ftc-cad-corpus'));
const { files } = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
for (const f of files) {
  const dest = path.join(OUT, f.name);
  if (fs.existsSync(dest)) { console.log('have   ' + f.name); continue; }
  const url = `https://github.com/${f.repo}/raw/${f.ref}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) { console.log(`FAILED ${f.name}: ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 20).toString().includes('ISO-10303')) { console.log(`FAILED ${f.name}: not a STEP file`); continue; }
  fs.writeFileSync(dest, buf);
  console.log(`got    ${f.name} (${(buf.length / 1048576).toFixed(1)} MB)`);
}
console.log('in ' + OUT);
