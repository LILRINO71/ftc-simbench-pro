// three.js for the page, as ES modules (no UMD build exists any more), with a
// second CDN. jsDelivr comes first, through the page's import map; if three.js
// itself doesn't load from it (a school filter, an outage), esm.sh serves the
// same version, add-ons included, all importing one copy of three.js. The
// add-ons (post-processing, the studio environment) are a nicety: if they
// fail, the view draws without them (src/view3d.js checks THREE_ADDONS). If
// neither CDN answers, the page says so instead of staying blank.

export const ADDONS = [
  ['EffectComposer', 'postprocessing/EffectComposer.js'],
  ['RenderPass', 'postprocessing/RenderPass.js'],
  ['GTAOPass', 'postprocessing/GTAOPass.js'],
  ['SMAAPass', 'postprocessing/SMAAPass.js'],
  ['OutputPass', 'postprocessing/OutputPass.js'],
  ['RoomEnvironment', 'environments/RoomEnvironment.js'],
];

/* The loader itself. imp is the page's import(); returns {THREE, addons, from}
   or throws when no CDN gave three.js. It runs in the page as written here
   (serialised by threeLoaderScript), so it uses nothing outside its arguments. */
export async function loadThree(imp, version, addons) {
  const routes = [
    { from: 'jsdelivr', core: 'three', add: 'https://cdn.jsdelivr.net/npm/three@' + version + '/examples/jsm/' },
    { from: 'esm.sh', core: 'https://esm.sh/three@' + version, add: 'https://esm.sh/three@' + version + '/examples/jsm/' },
  ];
  let last = null;
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
    return { THREE, addons: A, from: r.from };
  }
  throw last || new Error('three.js did not load');
}

/* The page's two tags: the import map (jsDelivr's add-ons import "three") and the module that loads it. */
export function threeLoaderScript(version) {
  const map = { imports: { three: 'https://cdn.jsdelivr.net/npm/three@' + version + '/build/three.module.min.js' } };
  return `<script type="importmap">${JSON.stringify(map)}</script>
<script type="module">
const loadThree=${loadThree.toString()};
loadThree(u=>import(u),${JSON.stringify(version)},${JSON.stringify(ADDONS)}).then(r=>{
  window.THREE=r.THREE; window.THREE_ADDONS=r.addons;
  window.dispatchEvent(new Event("three-ready"));
},e=>{
  console.error("three.js:",e);
  const d=document.createElement("div");
  d.setAttribute("role","alert");
  d.style.cssText="position:fixed;inset:auto 16px 16px 16px;z-index:99999;padding:14px 16px;border-radius:10px;background:#fff3f0;color:#5a1a10;font:15px/1.4 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.2)";
  d.textContent="SimBench couldn't load its 3D engine (three.js) from cdn.jsdelivr.net or esm.sh. A school or work network may block them: try another network, or ask for those two sites to be allowed.";
  (document.body||document.documentElement).appendChild(d);
});
</script>`;
}
