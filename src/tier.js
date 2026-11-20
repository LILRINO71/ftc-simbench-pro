/* ============================================================
   DEVICE TIERS — how much to draw, decided before the first frame
   ------------------------------------------------------------
   The bench used to start at full detail and back off once frames came
   slow, so a school Chromebook spent its first seconds stuttering through
   2048-pixel soft shadows. The tier is read from what the browser says
   about the machine, before anything is drawn:

     tier 0  a 4 GB Chromebook (Celeron N4500, MediaTek Kompanio 500), or
             a software renderer: no shadow map, pixel ratio 1, the robot's
             light copy, 2 physics substeps per tick. The look costs it
             nothing extra: a painted contact shadow under the robot instead
             of a shadow map, flat tiles, no glass reflections, no passes
     tier 1  an 8 GB laptop on integrated graphics (Intel UHD / Iris Xe):
             one 1024-pixel shadow map, pixel ratio 1, 4 substeps, ambient
             occlusion, the foam's bump, reflections on the perimeter glass
     tier 2  a discrete GPU or Apple silicon: 4096-pixel soft shadows,
             pixel ratio up to 2, 4 substeps, the same look as tier 1 with
             finer AO and a slight vignette

   The frame-rate watchdog (Perf in src/app.js) still backs off from there
   when a machine can't keep up. ?tier=0|1|2 or the saved choice overrides.
   ============================================================ */
/* bump: the foam tiles' bump map; glass: the perimeter's reflection layer;
   aoSamples: GTAO samples (0 = no AO pass), read from the scene's own depth (src/postfx.js);
   aoHalf: the AO at half resolution; vignette: a slight darkening at the corners;
   msaa: samples of the post buffer (it replaces SMAA); bloom: a glow on what is brighter than
   white (the venue's lamps, emissive parts); grade: the last pass's colour grade;
   crowd: the stands and the people in them (src/view3d.js buildVenue); minScale: the least
   of the pixel ratio the dynamic resolution (dynResStep) may drop to */
const TIER_BUDGETS=[
  {tier:0, shadows:0,    pixelRatio:1, lite:true,  substeps:2, ownTris:150000, otherTris:30000,
   bump:false, glass:false, aoSamples:0,  aoHalf:true,  vignette:false, msaa:0, bloom:false, grade:false, crowd:false, minScale:0.75},
  {tier:1, shadows:1024, pixelRatio:1, lite:false, substeps:4, ownTris:600000, otherTris:100000,
   bump:true,  glass:true,  aoSamples:8,  aoHalf:true,  vignette:false, msaa:4, bloom:true,  grade:true,  crowd:true,  minScale:0.67},
  {tier:2, shadows:4096, pixelRatio:2, lite:false, substeps:4, ownTris:Infinity, otherTris:Infinity,
   bump:true,  glass:true,  aoSamples:16, aoHalf:false, vignette:true,  msaa:4, bloom:true,  grade:true,  crowd:true,  minScale:0.6},
];
/* ------------------------------------------------------------
   DYNAMIC RESOLUTION — fewer pixels before a frame is late
   ------------------------------------------------------------
   Fed each frame with how long the GPU took (a timer query) or, where the browser
   has none, how long the frame took, and the frame budget (the display's refresh
   interval). Over 92% of the budget for most of ~20 frames drops the render scale a
   step; it comes back a step only when the frame, scaled by the pixels it would add,
   would still fit in 75% of the budget for ~3 s straight, so it never see-saws.
   s: {scale, min, max, step, hot, cool}; returns true when s.scale changed. */
function dynResInit(o){
  o=o||{};
  return {scale:o.scale||1, min:o.min||0.6, max:o.max||1, step:o.step||0.1, hot:0, cool:0, downAfter:o.downAfter||20, upAfter:o.upAfter||180};
}
function dynResStep(s,ms,budgetMs){
  if(!(ms>0)||!(budgetMs>0)) return false;
  const up=Math.min(s.max,s.scale+s.step), grow=(up/s.scale)*(up/s.scale);
  if(ms>budgetMs*0.92){ s.hot++; s.cool=0; }
  else{ s.hot=Math.max(0,s.hot-1); s.cool=up>s.scale+1e-6&&ms*grow<budgetMs*0.75?s.cool+1:0; }
  if(s.hot>=s.downAfter&&s.scale>s.min+1e-6){
    s.scale=Math.max(s.min,Math.round((s.scale-s.step)*100)/100); s.hot=0; s.cool=0; return true; }
  if(s.cool>=s.upAfter){ s.scale=Math.round(up*100)/100; s.hot=0; s.cool=0; return true; }
  return false;
}
/* The display's frame interval, from recent frame-to-frame times (ms): their 20th
   percentile, snapped to the nearest common refresh rate, 30 to 240 Hz. */
function refreshMs(intervals){
  const v=(intervals||[]).filter(x=>x>2&&x<100).sort((a,b)=>a-b);
  if(v.length<10) return 1000/60;
  const p=v[Math.floor(v.length*0.2)];
  const rates=[240,165,144,120,90,75,60,50,30];
  let best=60, bd=Infinity;
  for(const r of rates){ const d=Math.abs(1000/r-p); if(d<bd){ bd=d; best=r; } }
  return 1000/best;
}
/* A phone or a tablet, from the user agent and the touch points. iPadOS
   Safari sends a Mac's user agent ("Macintosh; Intel Mac OS X"), so a
   "Mac" with a touch screen is an iPad: no Mac has one. */
function tierMobile(ua, touchPoints){
  const s=String(ua||"");
  return /Mobi|Android|iPhone|iPad/i.test(s)||(/Macintosh/.test(s)&&Number(touchPoints)>1);
}
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
  // a phone or a tablet first: an iPad says "Apple GPU" just like a Mac does (tierMobile tells them apart)
  if(i.mobile) return pick(0,"a phone or tablet");
  // Safari names no chip: every Apple silicon Mac is "Apple GPU" there (Chrome says "Apple M2")
  const discrete=/nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|radeon\(tm\) rx|apple m\d|apple gpu/.test(r)&&!/intel/.test(r);
  const weakGpu=/mali-g(5|7)\d|mali-t|powervr|adreno \(tm\) [1-6]\d\d|adreno [1-6]\d\d|intel.*(hd graphics (4|5)\d\d|uhd graphics (600|605|610|615|617|620))|intel.*(jasperlake|gemini ?lake|elkhart)/.test(r);
  if(mem!=null&&mem<=4) return pick(0,mem+" GB of memory");
  if(weakGpu&&(mem==null||mem<=8)) return pick(0,"an entry-level GPU ("+i.renderer+")");
  if(cores!=null&&cores<=2) return pick(0,cores+" CPU cores");
  if(discrete&&(mem==null||mem>=8)) return pick(2,"a dedicated GPU ("+i.renderer+")");
  return pick(1,r?"integrated graphics ("+i.renderer+")":"no GPU name given");
}
