/* ============================================================
   DEVICE TIERS — how much to draw, decided before the first frame
   ------------------------------------------------------------
   The bench used to start at full detail and back off once frames came
   slow, so a school Chromebook spent its first seconds stuttering through
   2048-pixel soft shadows. The tier is read from what the browser says
   about the machine, before anything is drawn:

     tier 0  a 4 GB Chromebook (Celeron N4500, MediaTek Kompanio 500), or
             a software renderer: no shadow map, pixel ratio 1, the robot's
             light copy, 2 physics substeps per tick
     tier 1  an 8 GB laptop on integrated graphics (Intel UHD / Iris Xe):
             one 1024-pixel shadow map, pixel ratio 1, 4 substeps
     tier 2  a discrete GPU or Apple silicon: 2048-pixel soft shadows,
             pixel ratio up to 2, 4 substeps

   The frame-rate watchdog (Perf in src/app.js) still backs off from there
   when a machine can't keep up. ?tier=0|1|2 or the saved choice overrides.
   ============================================================ */
const TIER_BUDGETS=[
  {tier:0, shadows:0,    pixelRatio:1, lite:true,  substeps:2, ownTris:150000, otherTris:30000},
  {tier:1, shadows:1024, pixelRatio:1, lite:false, substeps:4, ownTris:600000, otherTris:100000},
  {tier:2, shadows:2048, pixelRatio:2, lite:false, substeps:4, ownTris:Infinity, otherTris:Infinity},
];
/* info: {memoryGB, cores, renderer (the unmasked WebGL renderer string),
   webgl2, mobile, override (0|1|2 or null)} -> {tier, why, budget} */
function deviceTier(info){
  const i=info||{};
  const pick=(t,why)=>({tier:t, why, budget:TIER_BUDGETS[t]});
  if(i.override===0||i.override===1||i.override===2) return pick(i.override,"chosen by hand");
  const r=String(i.renderer||"").toLowerCase();
  const mem=Number.isFinite(i.memoryGB)?i.memoryGB:null, cores=Number.isFinite(i.cores)?i.cores:null;
  if(/swiftshader|llvmpipe|softpipe|software|microsoft basic render/.test(r)) return pick(0,"the browser is drawing in software ("+(i.renderer||"no GPU")+")");
  if(i.webgl2===false) return pick(0,"no WebGL 2");
  // a phone or a tablet first: an iPad says "Apple GPU" just like a Mac does
  if(i.mobile) return pick(0,"a phone or tablet");
  const discrete=/nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|radeon\(tm\) rx|apple m\d/.test(r)&&!/intel/.test(r);
  const weakGpu=/mali-g(5|7)\d|mali-t|powervr|adreno \(tm\) [1-6]\d\d|adreno [1-6]\d\d|intel.*(hd graphics (4|5)\d\d|uhd graphics (600|605|610|615|617|620))|intel.*(jasperlake|gemini ?lake|elkhart)/.test(r);
  if(mem!=null&&mem<=4) return pick(0,mem+" GB of memory");
  if(weakGpu&&(mem==null||mem<=8)) return pick(0,"an entry-level GPU ("+i.renderer+")");
  if(cores!=null&&cores<=2) return pick(0,cores+" CPU cores");
  if(discrete&&(mem==null||mem>=8)) return pick(2,"a dedicated GPU ("+i.renderer+")");
  return pick(1,r?"integrated graphics ("+i.renderer+")":"no GPU name given");
}
