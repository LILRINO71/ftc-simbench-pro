/* ============================================================
   PARTS DATABASE — goBILDA and REV parts, by the part number in their name
   ------------------------------------------------------------
   A CAD part named "5203-2402-0019 Yellow Jacket" or "3614-0014-0096" says
   what it is in its number. This reads those numbers and answers:
     what it is        family, kind (motor, wheel, channel), a plain name
     wheels            kind (mecanum, omni, traction) and the diameter the
                       number encodes (goBILDA's wheels end in it, in mm)
     motors            gear ratio, free speed, encoder counts per turn
     mass              ONLY where the vendor's own product page gives a
                       weight; each row has its page beside it. A part with
                       no row here has no mass from this table (src/inertia.js
                       still weighs it by volume).
   The table is small on purpose: every row was read off the vendor's page
   (goBILDA and REV product pages, fetched 2026-11-19), and what could not be
   read there is not here. A number this does not know is "not recognised",
   never a guess.

   Pure, tested in Node. src/robotcheck.js shows the result; src/drivetrain.js
   asks partsWheel() whether a part is a drive wheel before it measures it.
   ============================================================ */

/* goBILDA part numbers are SSSS-MMMM-TTTT: series, a middle group (bore or
   length), and a trailing group. What the trailing group means depends on the
   series, so each series below says which way it reads. */

// goBILDA Yellow Jacket gearmotors. Series 5202: 6 mm D shaft; 5203: 8 mm REX shaft; 5204: 8 mm REX shaft,
// 80 mm gearbox. The trailing group is the reduction (0001 is the bare 1:1 motor, 5203 only). Ratio and
// free speed are as the product pages name them (e.g. "19.2:1 Ratio ... 312 RPM").
const PARTS_YJ_SERIES={
  5202:{mid:"2402", shaft:"6 mm D shaft", box:"36 mm gearbox"},
  5203:{mid:"2402", shaft:"8 mm REX shaft", box:"36 mm gearbox"},
  5204:{mid:"8002", shaft:"8 mm REX shaft", box:"80 mm gearbox"}
};
const PARTS_YJ_RATIO={
  1:{ratio:1, rpm:6000}, 3:{ratio:3.7, rpm:1620}, 5:{ratio:5.2, rpm:1150}, 14:{ratio:13.7, rpm:435}, 19:{ratio:19.2, rpm:312},
  27:{ratio:26.9, rpm:223}, 51:{ratio:50.9, rpm:117}, 71:{ratio:71.2, rpm:84}, 100:{ratio:99.5, rpm:60},
  139:{ratio:139.1, rpm:43}, 188:{ratio:188.1, rpm:30}
};

// Published weights, grams, by exact part number. Page weight line ("Weight" in the specs table).
const PARTS_G={
  // goBILDA Yellow Jacket gearmotors, 5202 / 5203 / 5204 series (the weight in each product page's specs)
  "5202-2402-0014":435, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-24mm-length-6mm-d-shaft-435-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0139":483, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-139-1-ratio-24mm-length-6mm-d-shaft-43-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0188":522, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-188-1-ratio-24mm-length-6mm-d-shaft-30-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0019":435, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-6mm-d-shaft-312-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0027":435, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-26-9-1-ratio-24mm-length-6mm-d-shaft-223-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0003":394, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-24mm-length-6mm-d-shaft-1620-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0005":398, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-5-2-1-ratio-24mm-length-6mm-d-shaft-1150-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0051":479, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-50-9-1-ratio-24mm-length-6mm-d-shaft-117-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0071":484, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-71-2-1-ratio-24mm-length-6mm-d-shaft-84-rpm-36mm-gearbox-3-3-5v-encoder/
  "5202-2402-0100":486, // https://www.gobilda.com/5202-series-yellow-jacket-planetary-gear-motor-99-5-1-ratio-24mm-length-6mm-d-shaft-60-rpm-36mm-gearbox-3-3-5v-encoder/
  "5203-2402-0001":391, // https://www.gobilda.com/5203-series-yellow-jacket-motor-1-1-ratio-24mm-length-8mm-rex-shaft-6000-rpm-3-3-5v-encoder/
  "5203-2402-0014":438, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-24mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder/
  "5203-2402-0139":485, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-139-1-ratio-24mm-length-8mm-rex-shaft-43-rpm-3-3-5v-encoder/
  "5203-2402-0188":524, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-188-1-ratio-24mm-length-8mm-rex-shaft-30-rpm-3-3-5v-encoder/
  "5203-2402-0019":437, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/
  "5203-2402-0027":437, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-26-9-1-ratio-24mm-length-8mm-rex-shaft-223-rpm-3-3-5v-encoder/
  "5203-2402-0003":396, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-1620-rpm-3-3-5v-encoder/
  "5203-2402-0005":399, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-5-2-1-ratio-24mm-length-8mm-rex-shaft-1150-rpm-3-3-5v-encoder/
  "5203-2402-0051":481, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-50-9-1-ratio-24mm-length-8mm-rex-shaft-117-rpm-3-3-5v-encoder/
  "5203-2402-0071":486, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-71-2-1-ratio-24mm-length-8mm-rex-shaft-84-rpm-3-3-5v-encoder/
  "5203-2402-0100":486, // https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-99-5-1-ratio-24mm-length-8mm-rex-shaft-60-rpm-3-3-5v-encoder/
  "5204-8002-0014":435, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-13-7-1-ratio-80mm-length-8mm-rex-shaft-435-rpm-3-3-5v-encoder/
  "5204-8002-0139":501, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-139-1-ratio-80mm-length-8mm-rex-shaft-43-rpm-3-3-5v-encoder/
  "5204-8002-0188":543, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-188-1-ratio-80mm-length-8mm-rex-shaft-30-rpm-3-3-5v-encoder/
  "5204-8002-0019":458, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-80mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/
  "5204-8002-0027":458, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-26-9-1-ratio-80mm-length-8mm-rex-shaft-223-rpm-3-3-5v-encoder/
  "5204-8002-0003":411, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-3-7-1-ratio-80mm-length-8mm-rex-shaft-1620-rpm-3-3-5v-encoder/
  "5204-8002-0005":412, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-5-2-1-ratio-80mm-length-8mm-rex-shaft-1150-rpm-3-3-5v-encoder/
  "5204-8002-0051":465, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-50-9-1-ratio-80mm-length-8mm-rex-shaft-117-rpm-3-3-5v-encoder/
  "5204-8002-0071":501, // https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-71-2-1-ratio-80mm-length-8mm-rex-shaft-84-rpm-3-3-5v-encoder/
  // 5204-8002-0100: weight not stated with a unit on its page, left out  https://www.gobilda.com/5204-series-yellow-jacket-planetary-gear-motor-99-5-1-ratio-80mm-length-8mm-rex-shaft-60-rpm-3-3-5v-encoder/
  // goBILDA wheels
  "3213-3606-0002":207, // 96 mm mecanum wheel set, "207g Each": https://www.gobilda.com/96mm-mecanum-wheel-set-70a-durometer-bearing-supported-rollers/
  "3213-3606-0003":383, // 140 mm mecanum wheel set, "383g Each": https://www.gobilda.com/140mm-mecanum-wheel-set-70a-durometer-bearing-supported-rollers/
  "3625-0202-0104":236, // GripForce mecanum wheel set, 104 mm, "236g Each": https://www.gobilda.com/gripforce-mecanum-wheel-set-o104mm-40a-durometer-rollers/
  "3624-0014-0096":119, // 96 mm omni: https://www.gobilda.com/96mm-omni-wheel-14mm-bore-50a-durometer/
  "3624-0014-0072":89,  // 72 mm omni: https://www.gobilda.com/72mm-omni-wheel-14mm-bore-50a-durometer/
  "3624-4008-0032":11,  // 32 mm omni, 8 mm REX bore: https://www.gobilda.com/3624-series-omni-wheel-8mm-rex-bore-32mm-diameter-50a-durometer/
  "3614-0014-0096":142, // 3614 Rhino wheel 96 mm: https://www.gobilda.com/3614-series-rhino-wheel-14mm-bore-96mm-diameter-30a-durometer/
  "3614-0014-0072":85,  // 3614 Rhino wheel 72 mm: https://www.gobilda.com/3614-series-rhino-wheel-14mm-bore-72mm-diameter-30a-durometer/
  "3601-0014-0096":142, // 3601 Rhino wheel 96 mm: https://www.gobilda.com/3601-series-rhino-wheel-14mm-bore-96mm-diameter/
  "3601-0014-0120":194, // 3601 Rhino wheel 120 mm: https://www.gobilda.com/3601-series-rhino-wheel-14mm-bore-120mm-diameter/
  "3612-0014-0096":91,  // 3612 thin Rhino wheel 96 mm: https://www.gobilda.com/3612-series-thin-rhino-wheel-14mm-bore-96mm-diameter/
  "3619-0014-0096":92,  // 3619 thin Rhino wheel 96 mm: https://www.gobilda.com/3619-series-thin-rhino-wheel-14mm-bore-96mm-diameter-30a-durometer/
  "3613-0014-0096":105, // GripForce Gecko wheel 96 mm: https://www.gobilda.com/gripforce-gecko-wheel-14mm-bore-96mm-diameter-30a-durometer/
  "3613-0014-0072":52,  // GripForce Gecko wheel 72 mm: https://www.gobilda.com/gripforce-gecko-wheel-14mm-bore-72mm-diameter-30a-durometer/
  "3626-0014-0096":82,  // Hogback traction wheel 96 mm: https://www.gobilda.com/hogback-traction-wheel-96mm-diameter-50a-durometer/
  "3626-0014-0072":55,  // Hogback traction wheel 72 mm: https://www.gobilda.com/hogback-traction-wheel-72mm-diameter-50a-durometer/
  "3635-0014-0096":86,  // FlatTop Hogback wheel 96 mm: https://www.gobilda.com/flattop-hogback-wheel-96mm-diameter-15a-durometer/
  "3616-0014-0144":348, // Wasteland wheel 144 mm: https://www.gobilda.com/wasteland-wheel-144mm-diameter-52mm-width/
  "3607-0014-0096":37,  // 3607 disc wheel 96 mm, "37g Each": https://www.gobilda.com/3607-series-disc-wheel-14mm-bore-96mm-diameter-black-2-pack/
  // goBILDA 1120 series U-channel (last group: length in mm)
  "1120-0001-0048":35,  // https://www.gobilda.com/1120-series-u-channel-1-hole-48mm-length/
  "1120-0002-0072":51,  // https://www.gobilda.com/1120-series-u-channel-2-hole-72mm-length/
  "1120-0003-0096":66,  // https://www.gobilda.com/1120-series-u-channel-3-hole-96mm-length/
  "1120-0005-0144":97,  // https://www.gobilda.com/1120-series-u-channel-5-hole-144mm-length/
  "1120-0009-0240":159, // https://www.gobilda.com/1120-series-u-channel-9-hole-240mm-length/
  "1120-0013-0336":222, // https://www.gobilda.com/1120-series-u-channel-13-hole-336mm-length/
  "1120-0017-0432":284, // https://www.gobilda.com/1120-series-u-channel-17-hole-432mm-length/
  "1120-0025-0624":408, // https://www.gobilda.com/1120-series-u-channel-25-hole-624mm-length/
  "1120-0049-1200":780, // https://www.gobilda.com/1120-series-u-channel-49-hole-1200mm-length/
  // REV
  "REV-41-1291":234,    // HD Hex Motor, "Weight: 234g": https://www.revrobotics.com/rev-41-1291/
  "REV-41-1300":198,    // Core Hex Motor, "Weight: 7 oz" (7 oz = 198.4 g): https://www.revrobotics.com/rev-41-1300/
  "REV-45-1655":179     // DUO Mecanum wheel, "single wheel without Universal Hex Adapter: 179g": https://www.revrobotics.com/rev-45-1655/
};

/* goBILDA wheel families whose trailing group IS the wheel's diameter in mm (read off each family's
   product pages: 3601-0014-0096 is the 96 mm Rhino, 3624-0014-0072 the 72 mm omni, 3616-0014-0144 the
   144 mm Wasteland ...). kind is how the wheel drives: "omni" has free rollers, the rest grip. */
const PARTS_WHEEL_FAMILY={
  3601:{kind:"traction", name:"Rhino wheel"},          3612:{kind:"traction", name:"thin Rhino wheel"},
  3613:{kind:"traction", name:"GripForce Gecko wheel"},3614:{kind:"traction", name:"Rhino wheel (30A)"},
  3616:{kind:"traction", name:"Wasteland wheel"},      3619:{kind:"traction", name:"thin Rhino wheel (30A)"},
  3624:{kind:"omni",     name:"omni wheel"},            3626:{kind:"traction", name:"Hogback traction wheel"},
  3635:{kind:"traction", name:"FlatTop Hogback wheel"}
};
// wheels whose number does not carry the diameter: named by the exact number, diameter in mm from the product page
const PARTS_WHEEL_EXACT={
  "3213-3606-0002":{kind:"mecanum", name:"96 mm mecanum wheel", dMm:96},
  "3213-3606-0003":{kind:"mecanum", name:"140 mm mecanum wheel", dMm:140},
  "3625-0202-0104":{kind:"mecanum", name:"GripForce 104 mm mecanum wheel", dMm:104},
  // the REV page gives "Diameter: 75-78mm", so a range, not one number
  "REV-45-1655":{kind:"mecanum", name:"REV DUO mecanum wheel", dMm:null, dRange:[75,78]}
};
// other REV parts the page names (motor figures: see hwFromPart in src/hardware.js)
const PARTS_REV={
  "REV-41-1291":{kind:"motor", name:"REV HD Hex Motor (no gearbox)"},
  "REV-41-1300":{kind:"motor", name:"REV Core Hex Motor"}
};

/* The first goBILDA or REV part number in a name, or null. "Hub 3606-0014-0096 v3" gives
   "3606-0014-0096"; a number inside a longer one (a drawing number) is not read. */
function partsParse(text){
  const s=String(text==null?"":text);
  let m=/(?:^|[^0-9A-Za-z-])(\d{4}-\d{4}-\d{4})(?![0-9-]|[A-Za-z0-9])/.exec(s);
  if(m) return m[1];
  m=/(?:^|[^0-9A-Za-z-])(REV-\d{2}-\d{4})(?![0-9-]|[A-Za-z0-9])/i.exec(s);
  return m?m[1].toUpperCase():null;
}

/* What a part number is. {part, vendor, kind, name, dMm?, wheelKind?, ratio?, rpm?, tpr?, massKg, massKnown}
   or null when the number isn't in the table. massKg is null unless the vendor's page gives the weight. */
function partsLookup(text){
  const pn=partsParse(text); if(!pn) return null;
  const grams=Object.prototype.hasOwnProperty.call(PARTS_G,pn)?PARTS_G[pn]:null;
  const out={part:pn, vendor:/^REV/.test(pn)?"REV":"goBILDA", kind:null, name:null, massKg:grams==null?null:grams/1000, massKnown:grams!=null};
  const g=pn.split("-"), series=+g[0], mid=g[1], tail=+g[2];
  const yj=PARTS_YJ_SERIES[series];
  if(yj&&mid===yj.mid&&PARTS_YJ_RATIO[tail]){
    const R=PARTS_YJ_RATIO[tail], hw=typeof hwFromPart==="function"?hwFromPart(pn,""):null;
    return Object.assign(out,{kind:"motor", name:"Yellow Jacket "+series+" "+(R.ratio===1?"1:1 (6000 rpm)":R.ratio+":1, "+R.rpm+" rpm")+", "+yj.shaft+(series===5204?", 80 mm gearbox":""),
      ratio:R.ratio, rpm:R.rpm, tpr:hw&&hw.tpr?hw.tpr:Math.round(28*R.ratio*10)/10});
  }
  const ex=PARTS_WHEEL_EXACT[pn];
  if(ex) return Object.assign(out,{kind:"wheel", name:ex.name, wheelKind:ex.kind, dMm:ex.dMm, dRange:ex.dRange||null});
  if(PARTS_REV[pn]){
    const hw=typeof hwFromPart==="function"?hwFromPart(pn,""):null;
    return Object.assign(out,{kind:PARTS_REV[pn].kind, name:PARTS_REV[pn].name, ratio:hw&&hw.ratio||null, rpm:hw&&hw.rpm||null, tpr:hw&&hw.tpr||null});
  }
  const wf=PARTS_WHEEL_FAMILY[series];
  if(wf&&tail>=24&&tail<=320) return Object.assign(out,{kind:"wheel", name:tail+" mm "+wf.name, wheelKind:wf.kind, dMm:tail});
  if(series===3607&&tail>=24&&tail<=320) return Object.assign(out,{kind:"disc", name:tail+" mm disc wheel (a hub, not a drive wheel)", dMm:tail});
  if(series===1120){
    const holes=+mid, len=tail;
    // every 1120 channel on the page: length = 24 mm x (holes + 1)
    if(holes>=1&&len===24*(holes+1)) return Object.assign(out,{kind:"channel", name:"U-channel, "+holes+" hole"+(holes===1?"":"s")+", "+len+" mm", lengthMm:len});
  }
  return null;
}

/* A drive wheel by part number: {kind, dMm, dRange?, name} or null (not a wheel, a disc, or not known).
   src/drivetrain.js treats a part with one as a wheel candidate and checks its measured size against dMm. */
function partsWheel(text){
  const p=partsLookup(text);
  return p&&p.kind==="wheel"?{kind:p.wheelKind, dMm:p.dMm, dRange:p.dRange||null, name:p.name, part:p.part}:null;
}

/* The recognised parts of a CAD: one row per part number, with how many parts carry it.
   [{part, name, kind, vendor, count, massKg, massKnown, ...}] most numerous first. cad.parts is the
   inventory the importers keep ({name, part, n}); a part with no number is read from its name. */
function partsOfCad(cad){
  const rows=(cad&&Array.isArray(cad.parts)&&cad.parts.length)?cad.parts.map(p=>({name:p.name, part:p.part, n:p.n||1}))
    :((cad&&cad.solids)||[]).map(s=>({name:s.name, part:s.part, n:1}));
  const by=new Map();
  for(const r of rows){
    const hit=partsLookup(r.part||"")||partsLookup(r.name||""); if(!hit) continue;
    const e=by.get(hit.part)||Object.assign({}, hit, {count:0, names:[]});
    e.count+=r.n; if(r.name&&e.names.length<3&&e.names.indexOf(r.name)<0) e.names.push(r.name);
    by.set(hit.part,e);
  }
  return [...by.values()].sort((a,b)=>b.count-a.count||(a.part<b.part?-1:1));
}
