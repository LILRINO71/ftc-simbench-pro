// three.js for the page, as ES modules (no UMD build exists any more). The site's
// own copy (dist/vendor/, put there by tools/build.mjs) comes first, through the
// page's import map, so a school network that blocks CDNs still works and the first
// load makes fewer requests. If it is missing, jsDelivr is tried, then esm.sh, which
// serves the same version, add-ons included, all importing one copy of three.js. The
// add-ons (post-processing, the studio environment) are a nicety: if they
// fail, the view draws without them (src/view3d.js checks THREE_ADDONS). If
// neither CDN answers, the page says so instead of staying blank.

export const ADDONS = [
  ['EffectComposer', 'postprocessing/EffectComposer.js'],
  ['RenderPass', 'postprocessing/RenderPass.js'],
  ['GTAOPass', 'postprocessing/GTAOPass.js'],
  ['SMAAPass', 'postprocessing/SMAAPass.js'],
  ['OutputPass', 'postprocessing/OutputPass.js'],
  ['ShaderPass', 'postprocessing/ShaderPass.js'],
  ['RoomEnvironment', 'environments/RoomEnvironment.js'],
];

/* The loader itself. imp is the page's import(); local is the absolute URL of the
   site's own three.js folder (trailing slash) or empty; returns {THREE, addons, from}
   or throws when no source gave three.js. It runs in the page as written here
   (serialised by threeLoaderScript), so it uses nothing outside its arguments.
   A source whose add-ons are incomplete is kept as a second choice and the next
   source is tried: add-ons from jsDelivr import "three" through the import map,
   which points at the site's copy, so they can load only when that copy does. */
export async function loadThree(imp, version, addons, local) {
  const routes = [];
  if (local) routes.push({ from: 'site', core: 'three', add: local + 'examples/jsm/' });
  // three.module.js, the file the package publishes, not .min.js, which jsDelivr makes itself:
  // only a published file's bytes are known here, so only it can carry an integrity hash
  routes.push(
    { from: 'jsdelivr', core: 'https://cdn.jsdelivr.net/npm/three@' + version + '/build/three.module.js', add: 'https://cdn.jsdelivr.net/npm/three@' + version + '/examples/jsm/' },
    { from: 'esm.sh', core: 'https://esm.sh/three@' + version, add: 'https://esm.sh/three@' + version + '/examples/jsm/' },
  );
  let last = null, partial = null;
  for (const r of routes) {
    let THREE;
    try { THREE = await imp(r.core); } catch (e) { last = e; continue; }
    if (!THREE || !THREE.WebGLRenderer) { last = new Error('three.js from ' + r.from + ' is incomplete'); continue; }
    // all or none: the composer without its passes would only half draw
    let A = {};
    try {
      const mods = await Promise.all(addons.map(([, p]) => imp(r.add + p)));
      addons.forEach(([k], i) => { A[k] = mods[i][k]; });
      if (addons.some(([k]) => !A[k])) A = {};
    } catch (e) { A = {}; }
    if (Object.keys(A).length || !addons.length) return { THREE, addons: A, from: r.from };
    if (!partial) partial = { THREE, addons: A, from: r.from };
  }
  if (partial) return partial;
  throw last || new Error('three.js did not load');
}

/* Where tools/build.mjs puts the site's copies (versioned, so they can be cached for good). */
export const VENDOR_THREE = (version) => 'vendor/three-' + version + '/';
export const VENDOR_TRYSTERO = (version) => 'vendor/trystero-' + version + '/';
/* The import map: "three" (what the add-ons import) and Trystero's three bare imports
   point at the site's copies; each file's own relative imports need no entry. Its
   `integrity` (when given) holds the CDN fallbacks' hashes: a module import() of one of
   those URLs is refused unless the bytes match (browsers without it ignore the key). */
export function importMap(version, trysteroVersion, integrity) {
  const t = VENDOR_TRYSTERO(trysteroVersion);
  const map = { imports: {
    three: './' + VENDOR_THREE(version) + 'build/three.module.js',
    '@trystero-p2p/nostr': './' + t + 'nostr.mjs',
    '@trystero-p2p/core': './' + t + 'core/index.mjs',
    '@noble/secp256k1': './' + t + 'secp256k1.mjs',
  } };
  if (integrity && Object.keys(integrity).length) map.integrity = integrity;
  return map;
}

/* The CDN fallbacks whose bytes are a published file, so their hashes can be known here:
   three.js from jsDelivr (the core, three.core.js it imports, every add-on and what each
   imports) and Jolt from jsDelivr (src/joltmech.js). Trystero's fallbacks (jsDelivr's
   +esm, esm.sh) and esm.sh's three.js are built by the CDN, so no hash could hold;
   OpenCascade loads with importScripts in a worker, which takes no integrity.
   read(rel) returns a file under node_modules as bytes; returns {url: 'sha384-…'}. */
export function cdnIntegrity(read, sha384, { three, jolt }) {
  const out = {};
  const put = (url, rel) => { out[url] = 'sha384-' + sha384(read(rel)); };
  const T = 'https://cdn.jsdelivr.net/npm/three@' + three + '/';
  for (const f of ['build/three.module.js', 'build/three.core.js']) put(T + f, 'three/' + f);
  const seen = new Set();
  const walk = (rel) => {   // rel: a path under examples/jsm/
    if (seen.has(rel)) return;
    seen.add(rel);
    put(T + 'examples/jsm/' + rel, 'three/examples/jsm/' + rel);
    const text = new TextDecoder().decode(read('three/examples/jsm/' + rel));
    for (const m of text.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) walk(posixJoin(rel, m[1]));
  };
  for (const [, p] of ADDONS) walk(p);
  if (jolt) put('https://cdn.jsdelivr.net/npm/jolt-physics@' + jolt + '/dist/jolt-physics.wasm-compat.js', 'jolt-physics/dist/jolt-physics.wasm-compat.js');
  return out;
}
const posixJoin = (from, rel) => {
  const parts = from.split('/').slice(0, -1);
  for (const p of rel.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
};

/* The page's two tags: the import map and the module that loads three.js. */
export function threeLoaderScript(version, trysteroVersion, integrity) {
  return `<script type="importmap">${JSON.stringify(importMap(version, trysteroVersion, integrity))}</script>
<script type="module">
const loadThree=${loadThree.toString()};
loadThree(u=>import(u),${JSON.stringify(version)},${JSON.stringify(ADDONS)},new URL(${JSON.stringify(VENDOR_THREE(version))},document.baseURI).href).then(r=>{
  window.THREE=r.THREE; window.THREE_ADDONS=r.addons;
  window.dispatchEvent(new Event("three-ready"));
},e=>{
  console.error("three.js:",e);
  const d=document.createElement("div");
  d.setAttribute("role","alert");
  d.style.cssText="position:fixed;inset:auto 16px 16px 16px;z-index:99999;padding:14px 16px;border-radius:10px;background:#fff3f0;color:#5a1a10;font:15px/1.4 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.2)";
  d.textContent="SimBench couldn't load its 3D engine (three.js), not from this site and not from cdn.jsdelivr.net or esm.sh. Try reloading, or try another network.";
  (document.body||document.documentElement).appendChild(d);
});
</script>`;
}
