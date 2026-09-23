// Fetches an Onshape assembly's mates for FTC SimBench Pro, with API keys.
//
//   ONSHAPE_ACCESS_KEY=… ONSHAPE_SECRET_KEY=… node tools/onshape-mates.mjs <assembly URL> [out-prefix]
//
// Writes <out-prefix>.assembly.json (the mates) and <out-prefix>.features.json
// (the mate limits). Drop both on the app's Onshape mates panel, next to the
// STEP exported from the same assembly.
//
// You don't need this if you can sign in to Onshape in a browser: the panel
// builds the same two links, and the saved pages are the same files. This is
// for scripting, or for accounts where a browser session isn't handy.
//
// Keys come from https://dev-portal.onshape.com/keys. They're read from the
// environment only, sent only to the Onshape host in the URL (by HTTPS basic
// auth), and never written or printed.
import fs from 'node:fs';

const [url, prefix = 'onshape'] = process.argv.slice(2);
const m = /^(https:\/\/(?:[a-z0-9-]+\.)*onshape\.com)\/documents\/([0-9a-f]{24})\/(w|v|m)\/([0-9a-f]{24})\/e\/([0-9a-f]{24})(?:[/?#]|$)/i.exec(url || '');
if (!m) {
  console.error('usage: node tools/onshape-mates.mjs https://cad.onshape.com/documents/<did>/w/<wid>/e/<eid> [out-prefix]');
  process.exit(2);
}
const { ONSHAPE_ACCESS_KEY: ak, ONSHAPE_SECRET_KEY: sk } = process.env;
if (!ak || !sk) {
  console.error('set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY (from https://dev-portal.onshape.com/keys)');
  process.exit(2);
}
const base = `${m[1]}/api/assemblies/d/${m[2]}/${m[3]}/${m[4]}/e/${m[5]}`;
const auth = 'Basic ' + Buffer.from(ak + ':' + sk).toString('base64');

async function get(path) {
  const r = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path.split('?')[0] || '/'} — check the URL is an assembly tab and the keys can read it`);
  return r.json();
}

const asm = await get('?includeMateFeatures=true&includeMateConnectors=true&includeNonSolids=false');
fs.writeFileSync(prefix + '.assembly.json', JSON.stringify(asm));
let limits = 'no';
try {
  fs.writeFileSync(prefix + '.features.json', JSON.stringify(await get('/features')));
  limits = 'with';
} catch (e) { console.warn('mate limits unavailable: ' + e.message); }
const mates = [asm.rootAssembly, ...(asm.subAssemblies || [])].reduce((n, a) => n + (a.features || []).filter((f) => f.featureType === 'mate').length, 0);
console.log(`${mates} mates, ${(asm.rootAssembly.occurrences || []).length} occurrences, ${limits} limits -> ${prefix}.assembly.json` + (limits === 'with' ? `, ${prefix}.features.json` : ''));
