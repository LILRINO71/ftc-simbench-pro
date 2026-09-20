/* ============================================================
   7c.  CONTROLLERS — a real gamepad, read the way the FTC SDK reads it
   The browser's "standard" mapping lines up with the SDK's fields:
   A/B/X/Y (cross/circle/square/triangle on a PlayStation pad), bumpers,
   analog triggers, sticks with up as −1, and the d-pad.
   ============================================================ */
const PAD_BUTTONS=["a","b","x","y","left_bumper","right_bumper","left_trigger","right_trigger",
  "back","start","left_stick_button","right_stick_button","dpad_up","dpad_down","dpad_left","dpad_right","guide"];

function padFromGamepad(gp,deadzone){
  const out={}, dz=deadzone==null?0.08:deadzone;
  const btn=i=>{ const b=gp&&gp.buttons?gp.buttons[i]:null;
    if(b==null) return {pressed:false,value:0};
    return typeof b==="object"?b:{pressed:!!b,value:b?1:0}; };
  PAD_BUTTONS.forEach((n,i)=>{ const b=btn(i);
    out[n]=(n==="left_trigger"||n==="right_trigger")?Math.max(0,Math.min(1,+b.value||0)):!!b.pressed; });
  const ax=i=>{ const v=+((gp&&gp.axes&&gp.axes[i])||0); return Math.abs(v)<dz?0:Math.max(-1,Math.min(1,v)); };
  out.left_stick_x=ax(0); out.left_stick_y=ax(1); out.right_stick_x=ax(2); out.right_stick_y=ax(3);
  // the PlayStation names the SDK also answers to
  out.cross=out.a; out.circle=out.b; out.square=out.x; out.triangle=out.y;
  out.share=out.back; out.options=out.start; out.ps=out.guide;
  return out;
}

/* A readable name out of the browser's long controller id. */
function padName(id){
  let s=String(id||"")
    .replace(/\s*\((?:STANDARD GAMEPAD|XInput)[^)]*\)/gi,"")
    .replace(/\s*\(Vendor:[^)]*\)/gi,"")
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i,"").trim();
  if(!s||/^xinput$/i.test(s)) s="Xbox-style controller";
  return s.length>34?s.slice(0,32)+"…":s;
}

/* Which gamepad a keyboard key should press: the one the OpMode actually
   reads that control from, so the keys drive whatever the code expects. */
function padFor(code,control,fallback){
  const pads={};
  for(const b of (code&&code.bindings)||[]){
    if(b.btn===control) pads[b.pad]=1;
    for(const a of b.axes||[]){ const r=splitPadRef(a); if(r&&r.btn===control) pads[r.pad]=1; }
  }
  const k=Object.keys(pads);
  return k.length===1?+k[0]:(fallback||1);
}

/* The gamepad a lone controller should start on: the one this OpMode
   reads most, gamepad1 on a tie. */
function busiestPad(code){
  const n={1:0,2:0};
  for(const b of (code&&code.bindings)||[]) n[b.pad]=(n[b.pad]||0)+1+(b.axes?b.axes.length:0);
  return n[2]>n[1]?2:1;
}
