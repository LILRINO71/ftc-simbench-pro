/* ============================================================
   KEYBOARD BINDINGS — which key presses which gamepad control
   ------------------------------------------------------------
   Without a controller the keyboard is the gamepad. Two layouts to start
   from: Classic (SimBench's own: I J K L drive, A B X Y buttons) and WASD
   (the driving-game layout other FTC sims use: W A S D drive, arrows turn
   and the D-pad on I J K L). Any control can then be moved to any key in
   the Controllers panel: click it, press the key. Kept in this browser.

   A binding is {control: code}; a stick direction is "left_stick_y-" (the
   stick pushed to -1) and a trigger is "left_trigger" (pulled to 1). The
   page reads the result as two tables (src/app.js KEYMAP, STICKKEYS).
   Pure apart from KeyBinds' page parts, for the tests.
   ============================================================ */
const KEY_CONTROLS=[
  ["left_stick_y-","Left stick up"],["left_stick_y+","Left stick down"],["left_stick_x-","Left stick left"],["left_stick_x+","Left stick right"],
  ["right_stick_x-","Right stick left (turn)"],["right_stick_x+","Right stick right (turn)"],["right_stick_y-","Right stick up"],["right_stick_y+","Right stick down"],
  ["a","A"],["b","B"],["x","X"],["y","Y"],["left_bumper","LB"],["right_bumper","RB"],["left_trigger","LT"],["right_trigger","RT"],
  ["dpad_up","D-pad up"],["dpad_down","D-pad down"],["dpad_left","D-pad left"],["dpad_right","D-pad right"],
  ["left_stick_button","Left stick press"],["right_stick_button","Right stick press"],["start","START"],["back","BACK"],
];
const KEY_PRESETS={
  classic:{"left_stick_y-":"KeyI","left_stick_y+":"KeyK","left_stick_x-":"KeyJ","left_stick_x+":"KeyL","right_stick_x-":"KeyU","right_stick_x+":"KeyO",
    "right_stick_y-":"KeyT","right_stick_y+":"KeyG",
    a:"KeyA",b:"KeyB",x:"KeyX",y:"KeyY",left_bumper:"KeyQ",right_bumper:"KeyE",left_trigger:"KeyZ",right_trigger:"KeyC",
    dpad_up:"ArrowUp",dpad_down:"ArrowDown",dpad_left:"ArrowLeft",dpad_right:"ArrowRight",
    left_stick_button:"KeyV",right_stick_button:"KeyN",start:"Enter",back:"Backspace"},
  wasd:{"left_stick_y-":"KeyW","left_stick_y+":"KeyS","left_stick_x-":"KeyA","left_stick_x+":"KeyD","right_stick_x-":"ArrowLeft","right_stick_x+":"ArrowRight",
    "right_stick_y-":"ArrowUp","right_stick_y+":"ArrowDown",
    a:"Digit1",b:"Digit2",x:"Digit3",y:"Digit4",left_bumper:"KeyQ",right_bumper:"KeyE",left_trigger:"ShiftLeft",right_trigger:"Space",
    dpad_up:"KeyI",dpad_down:"KeyK",dpad_left:"KeyJ",dpad_right:"KeyL",
    left_stick_button:"KeyZ",right_stick_button:"KeyX",start:"Enter",back:"Backspace"},
};
// the page's own keys: never a control (F fires a shot, [ and ] fold the side panels)
const KEY_RESERVED=new Set(["KeyF","BracketLeft","BracketRight","Escape","Tab"]);
/* the bindings: a preset with this browser's changes over it ({control: code}; null unbinds) */
function keyBindings(preset,changes){
  const base=Object.assign({},KEY_PRESETS[preset]||KEY_PRESETS.classic), out={};
  for(const [c] of KEY_CONTROLS){
    let k=changes&&Object.prototype.hasOwnProperty.call(changes,c)?changes[c]:base[c];
    if(typeof k!=="string"||!/^[A-Za-z][A-Za-z0-9]{1,24}$/.test(k)||KEY_RESERVED.has(k)) k=null;
    out[c]=k;
  }
  // one key, one control: a key moved to a control leaves the one it had
  const seen=new Map();
  for(const [c] of KEY_CONTROLS){ const k=out[c]; if(!k) continue; if(seen.has(k)){ const was=seen.get(k), mine=changes&&changes[c]===k; if(mine) out[was]=null; else { out[c]=null; continue; } } seen.set(k,c); }
  return out;
}
/* the two tables the page reads: buttons {code: control}, axes {code: [axis, value]} */
function keyTables(b){
  const buttons={}, axes={};
  for(const c in b){ const k=b[c]; if(!k) continue;
    const m=/^(left_stick_[xy]|right_stick_[xy])([+-])$/.exec(c);
    if(m) axes[k]=[m[1],m[2]==="-"?-1:1];
    else if(/_trigger$/.test(c)) axes[k]=[c,1];
    else buttons[k]=c; }
  return {buttons, axes};
}
/* a key's name as printed on it */
function keyLabel(code){
  if(!code) return "—";
  const m=/^Key([A-Z])$/.exec(code)||/^Digit(\d)$/.exec(code); if(m) return m[1];
  return {ArrowUp:"↑",ArrowDown:"↓",ArrowLeft:"←",ArrowRight:"→",Space:"Space",ShiftLeft:"L Shift",ShiftRight:"R Shift",Enter:"Enter",Backspace:"Bksp",
    ControlLeft:"L Ctrl",AltLeft:"L Alt",Semicolon:";",Quote:"'",Comma:",",Period:".",Slash:"/",Minus:"-",Equal:"="}[code]||code.replace(/^Numpad/,"Num ");
}

const KeyBinds={
  preset:"classic", changes:{}, wait:null,
  load(){
    this.preset=store.get("ftcbench.keys.preset","classic")==="wasd"?"wasd":"classic";
    try{ const c=JSON.parse(store.get("ftcbench.keys.changes","{}")); this.changes=c&&typeof c==="object"?c:{}; }catch(e){ this.changes={}; }
    this.apply();
  },
  save(){ store.set("ftcbench.keys.preset",this.preset); store.set("ftcbench.keys.changes",JSON.stringify(this.changes)); },
  current(){ return keyBindings(this.preset,this.changes); },
  /* the page's tables follow the bindings (they are objects the key handlers read) */
  apply(){
    const T=keyTables(this.current());
    for(const k in KEYMAP) delete KEYMAP[k]; Object.assign(KEYMAP,T.buttons);
    for(const k in STICKKEYS) delete STICKKEYS[k]; Object.assign(STICKKEYS,T.axes);
    this.hints();
  },
  /* where the page names the keys (the help line, the tour) */
  hints(){
    const b=this.current(), L=c=>`<kbd>${esc(keyLabel(b[c]))}</kbd>`;
    const html=`${L("left_stick_y-")}${L("left_stick_x-")}${L("left_stick_y+")}${L("left_stick_x+")} drive, ${L("right_stick_x-")}${L("right_stick_x+")} turn, ${L("a")}${L("b")}${L("x")}${L("y")}, ${L("left_bumper")}${L("right_bumper")} bumpers, ${L("left_trigger")}${L("right_trigger")} triggers, <kbd>F</kbd> fire`;
    const h=$("#keyHint"); if(h) h.innerHTML=html;
  },
  init(){
    this.load();
    const box=$("#keyBinds"), ps=$("#keyPreset"); if(!box||!ps) return;
    ps.value=this.preset;
    ps.addEventListener("change",()=>{ this.preset=ps.value==="wasd"?"wasd":"classic"; this.changes={}; this.save(); this.apply(); this.render(); });
    $("#keyReset").addEventListener("click",()=>{ this.changes={}; this.save(); this.apply(); this.render(); });
    box.addEventListener("click",e=>{ const b=e.target.closest("[data-ctl]"); if(!b) return; this.wait=b.dataset.ctl; this.render(); });
    // the next key pressed is the waiting control's (Escape leaves it as it was, Delete unbinds it)
    addEventListener("keydown",e=>{
      if(!this.wait) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if(e.code==="Escape"){ this.wait=null; this.render(); return; }
      if(KEY_RESERVED.has(e.code)){ $("#keyNote").textContent=keyLabel(e.code)+" is the page's own key; pick another."; return; }
      this.changes[this.wait]=e.code==="Delete"?null:e.code; this.wait=null; this.save(); this.apply(); this.render();
    },true);
    this.render();
  },
  render(){
    const box=$("#keyBinds"); if(!box) return;
    const b=this.current();
    box.innerHTML=KEY_CONTROLS.map(([c,label])=>`<button type="button" class="kb-row${this.wait===c?" wait":""}" data-ctl="${c}"><span>${esc(label)}</span><kbd>${this.wait===c?"press a key…":esc(keyLabel(b[c]))}</kbd></button>`).join("");
    $("#keyNote").textContent=this.wait?"Press the key for it. Esc keeps the old one, Delete leaves it unbound.":"Click a control, then press its key.";
  },
};
