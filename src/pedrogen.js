/* ============================================================
   PEDRO PATHS — a drawn path as a Pedro Pathing 2.x autonomous
   ------------------------------------------------------------
   The path editor (src/pathedit.js) lets a team draw an auto on the field:
   a starting pose, then legs, each a line or a curve with one or two
   control points, a heading mode (linear, tangent, constant), driven
   forwards or backwards, and a wait after it. This turns that into the
   Java a team would write with Pedro Pathing 2.x (an OpMode with a
   PathChain per leg and a state machine), runs it on the bench through the
   Java VM (src/jvmprelude.js follows Pedro paths), and draws it.

   Coordinates are Pedro's: inches, (0, 0) at the field's corner on the red
   drivers' right, x toward the blue wall, y toward the red drivers' left,
   headings in degrees counterclockwise from +x. That is the bench's own
   field frame moved by 72 in, so a pose here is exactly where the robot
   stands on the bench: pedroToField / fieldToPedro.

   Pure, tested in Node.
   ============================================================ */
const PEDRO_FORMAT="ftc-simbench.pedropath", PEDRO_HALF=72;
const PEDRO_HEADINGS=["linear","tangent","constant"];

/* Pedro inches and degrees <-> the bench's field metres and radians */
function pedroToField(p){ return {x:(p.x-PEDRO_HALF)*0.0254, y:(p.y-PEDRO_HALF)*0.0254, h:(p.h||0)*Math.PI/180}; }
function fieldToPedro(f){ return {x:f.x/0.0254+PEDRO_HALF, y:f.y/0.0254+PEDRO_HALF, h:(f.h||0)*180/Math.PI}; }

/* a new path: the robot where it stands, one leg 24 in ahead (a tile: from the
   starting wall that stays clear of the HIVEs) */
function pedroNew(start){
  const s=start||{x:24,y:72,h:0}, r=(s.h||0)*Math.PI/180;
  return {format:PEDRO_FORMAT, v:1, name:"SimBench Path", start:{x:pR(s.x), y:pR(s.y), h:pR(s.h||0)},
    legs:[{to:{x:pR(s.x+24*Math.cos(r)), y:pR(s.y+24*Math.sin(r)), h:pR(s.h||0)}, ctrl:[], heading:"linear", reversed:false, wait:0}]};
}
const pR=v=>Math.round(v*10)/10;

/* each leg as its Bezier control polygon, start to end, in Pedro inches */
function pedroCurves(P){
  const out=[]; let at={x:P.start.x, y:P.start.y};
  for(const L of P.legs||[]){ const pts=[[at.x,at.y]].concat((L.ctrl||[]).map(c=>[c[0],c[1]]),[[L.to.x,L.to.y]]); out.push(pts); at=L.to; }
  return out;
}
/* a Bezier curve (any degree) at t, by de Casteljau */
function bezierAt(pts,t){
  let q=pts.map(p=>p.slice());
  while(q.length>1){ const n=[]; for(let i=0;i<q.length-1;i++) n.push([q[i][0]+(q[i+1][0]-q[i][0])*t, q[i][1]+(q[i+1][1]-q[i][1])*t]); q=n; }
  return q[0];
}
/* points along the whole path, n per leg, for drawing */
function pedroPolyline(P,n){
  n=n||24; const out=[];
  for(const pts of pedroCurves(P)) for(let i=out.length?1:0;i<=n;i++) out.push(bezierAt(pts,i/n));
  return out;
}
function pedroLength(P){
  let L=0; const pl=pedroPolyline(P,40);
  for(let i=1;i<pl.length;i++) L+=Math.hypot(pl[i][0]-pl[i-1][0],pl[i][1]-pl[i-1][1]);
  return L;
}
/* Where a path runs a robot into the field: obs are the field's obstacles (Field.obstacles():
   {what, r, a:[x,y], b:[x,y]}, metres, the bench's frame) and R the robot's half width (m).
   [{leg, what}], the first hit of each leg. */
function pedroHits(P,obs,R){
  const out=[]; if(!obs||!obs.length) return out;
  const dist=(x,y,a,b)=>{ const ux=b[0]-a[0], uy=b[1]-a[1], L2=ux*ux+uy*uy, t=L2>1e-12?Math.max(0,Math.min(1,((x-a[0])*ux+(y-a[1])*uy)/L2)):0; return Math.hypot(x-a[0]-ux*t,y-a[1]-uy*t); };
  pedroCurves(P).forEach((pts,i)=>{
    for(let k=1;k<=24;k++){
      const p=bezierAt(pts,k/24), f=pedroToField({x:p[0],y:p[1]});
      const o=obs.find(o=>dist(f.x,f.y,o.a,o.b)<(o.r||0)+R); if(o){ out.push({leg:i, what:o.what||"something on the field"}); break; }
    }
  });
  return out;
}
/* What a team should know before running it: off the field, a leg of no length, a wait too long,
   and (with the field's obstacles) a leg that drives into one */
function pedroCheck(P,obs,R){
  const out=[], inField=(x,y)=>x>=6&&x<=138&&y>=6&&y<=138;
  if(!P||!Array.isArray(P.legs)||!P.legs.length) return ["The path has no legs: add one."];
  if(!inField(P.start.x,P.start.y)) out.push("The start is off the field or against a wall.");
  let at=P.start;
  P.legs.forEach((L,i)=>{
    if(Math.hypot(L.to.x-at.x,L.to.y-at.y)<1&&!(L.ctrl||[]).length) out.push("Leg "+(i+1)+" goes nowhere.");
    if(!inField(L.to.x,L.to.y)) out.push("Leg "+(i+1)+" ends off the field or against a wall.");
    if(PEDRO_HEADINGS.indexOf(L.heading)<0) out.push("Leg "+(i+1)+" has no heading mode.");
    if(L.wait>10) out.push("Leg "+(i+1)+" waits "+L.wait+" s; an auto has 30.");
    at=L.to;
  });
  for(const h of pedroHits(P,obs,R||0.2)) out.push("Leg "+(h.leg+1)+" runs into the "+h.what+".");
  return out;
}
/* untrusted (a pasted or dropped path): numbers in range, known modes, at most 40 legs */
function pedroClean(P){
  if(!P||typeof P!=="object") throw new Error("it isn't a path");
  const num=(v,lo,hi,d)=>{ v=+v; return Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):d; };
  const pose=p=>({x:num(p&&p.x,-36,180,72), y:num(p&&p.y,-36,180,72), h:num(p&&p.h,-720,720,0)});
  const legs=(Array.isArray(P.legs)?P.legs:[]).slice(0,40).map(L=>({
    to:pose(L&&L.to), ctrl:(Array.isArray(L&&L.ctrl)?L.ctrl:[]).slice(0,2).map(c=>[num(c&&c[0],-36,180,72),num(c&&c[1],-36,180,72)]),
    heading:PEDRO_HEADINGS.indexOf(L&&L.heading)>=0?L.heading:"linear", reversed:!!(L&&L.reversed), wait:num(L&&L.wait,0,30,0)}));
  if(!legs.length) throw new Error("the path has no legs");
  const name=String(P.name||"SimBench Path").replace(/[^\w .-]+/g,"").trim().slice(0,40)||"SimBench Path";
  return {format:PEDRO_FORMAT, v:1, name, start:pose(P.start), legs};
}
/* A path in a link (#path=...): the numbers only, as compact text, base64url. A dozen legs
   is a few hundred characters, fine in a Discord message. pedroFromHash reads it back
   through pedroClean, so a link can only ever give a path within the field. */
function pedroToHash(P){
  const n=v=>Math.round(v*10)/10, H={n:P.name, s:[n(P.start.x),n(P.start.y),n(P.start.h)],
    l:P.legs.map(L=>[n(L.to.x),n(L.to.y),n(L.to.h),PEDRO_HEADINGS.indexOf(L.heading),L.reversed?1:0,n(L.wait),(L.ctrl||[]).map(c=>[n(c[0]),n(c[1])])])};
  const bytes=new TextEncoder().encode(JSON.stringify(H));
  let bin=""; for(const b of bytes) bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function pedroFromHash(h){
  let s=String(h||"").replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="=";
  if(s.length>20000) throw new Error("that link is too long to be a path");
  const bin=atob(s), bytes=Uint8Array.from(bin,c=>c.charCodeAt(0)), H=JSON.parse(new TextDecoder().decode(bytes));
  if(!H||!Array.isArray(H.s)||!Array.isArray(H.l)) throw new Error("that link has no path in it");
  return pedroClean({name:H.n, start:{x:H.s[0],y:H.s[1],h:H.s[2]},
    legs:H.l.map(L=>({to:{x:L[0],y:L[1],h:L[2]}, heading:PEDRO_HEADINGS[L[3]]||"linear", reversed:!!L[4], wait:L[5], ctrl:Array.isArray(L[6])?L[6]:[]}))});
}
/* the Java class name for the path's name */
function pedroClass(name){
  const w=String(name||"").replace(/[^A-Za-z0-9 ]+/g," ").trim().split(/\s+/).filter(Boolean).map(s=>s[0].toUpperCase()+s.slice(1));
  let c=w.join("")||"SimBenchPath"; if(/^\d/.test(c)) c="Path"+c;
  return c.slice(0,48);
}

/* The OpMode a team would write: Pedro Pathing 2.x, one PathChain per leg, a state machine
   that follows them in turn and waits after each where asked. */
function pedroJava(P,o){
  o=o||{};
  const pkg=o.pkg||"org.firstinspires.ftc.teamcode", cls=pedroClass(P.name), n=(v)=>{ const r=Math.round(v*1000)/1000; return Number.isInteger(r)?r.toFixed(1):String(r); };
  const pose=p=>`new Pose(${n(p.x)}, ${n(p.y)}, Math.toRadians(${n(p.h||0)}))`;
  const L=[];
  L.push(`package ${pkg};`,"");
  L.push("import com.pedropathing.follower.Follower;","import com.pedropathing.geometry.BezierCurve;","import com.pedropathing.geometry.BezierLine;",
    "import com.pedropathing.geometry.Pose;","import com.pedropathing.paths.PathChain;","import com.qualcomm.robotcore.eventloop.opmode.Autonomous;",
    "import com.qualcomm.robotcore.eventloop.opmode.OpMode;","import com.qualcomm.robotcore.util.ElapsedTime;",
    `import ${o.constants||"org.firstinspires.ftc.teamcode.pedroPathing.Constants"};`,"");
  L.push(`@Autonomous(name = "${String(P.name).replace(/["\\]/g,"")}")`,`public class ${cls} extends OpMode {`);
  L.push("    private Follower follower;","    private final ElapsedTime timer = new ElapsedTime();","    private int state = 0;","");
  L.push(`    private final Pose startPose = ${pose(P.start)};`);
  P.legs.forEach((leg,i)=>L.push(`    private final Pose pose${i+1} = ${pose(leg.to)};`));
  L.push("");
  P.legs.forEach((leg,i)=>L.push(`    private PathChain path${i+1};`));
  L.push("","    private void buildPaths() {");
  P.legs.forEach((leg,i)=>{
    const from=i?`pose${i}`:"startPose", to=`pose${i+1}`;
    const geo=(leg.ctrl||[]).length?`new BezierCurve(${from}, ${leg.ctrl.map(c=>`new Pose(${n(c[0])}, ${n(c[1])})`).join(", ")}, ${to})`:`new BezierLine(${from}, ${to})`;
    const head=leg.heading==="tangent"?".setTangentHeadingInterpolation()":leg.heading==="constant"?`.setConstantHeadingInterpolation(${to}.getHeading())`
      :`.setLinearHeadingInterpolation(${from}.getHeading(), ${to}.getHeading())`;
    L.push(`        path${i+1} = follower.pathBuilder()`,`                .addPath(${geo})`,`                ${head}`);
    if(leg.reversed) L.push("                .setReversed(true)");
    L.push("                .build();");
  });
  L.push("    }","");
  L.push("    private void setState(int s) {","        state = s;","        timer.reset();","    }","");
  L.push("    @Override","    public void init() {","        follower = Constants.createFollower(hardwareMap);","        buildPaths();","        follower.setStartingPose(startPose);","    }","");
  L.push("    @Override","    public void start() {","        setState(0);","    }","");
  L.push("    @Override","    public void loop() {","        follower.update();","        switch (state) {");
  // state 2i: start leg i; state 2i+1: leg i done (and its wait), then on to the next
  P.legs.forEach((leg,i)=>{
    L.push(`            case ${2*i}:`,`                follower.followPath(path${i+1}, true);`,`                setState(${2*i+1});`,"                break;");
    L.push(`            case ${2*i+1}:`);
    const cond=leg.wait>0?`!follower.isBusy() && timer.seconds() > ${n(leg.wait)}`:"!follower.isBusy()";
    if(leg.wait>0) L.push(`                // leg ${i+1} done: your mechanism here`);
    L.push(`                if (${cond}) setState(${i===P.legs.length-1?-1:2*i+2});`,"                break;");
  });
  L.push("        }");
  L.push('        telemetry.addData("state", state);','        telemetry.addData("x", follower.getPose().getX());','        telemetry.addData("y", follower.getPose().getY());',
    '        telemetry.addData("heading", Math.toDegrees(follower.getPose().getHeading()));','        telemetry.update();');
  L.push("    }","}","");
  return {file:cls+".java", cls, src:L.join("\n")};
}

/* A stand-in for the team's pedroPathing/Constants.java, for the bench only: a mecanum
   follower on the default motor names, read by the VM like the team's own. */
const PEDRO_CONSTANTS_JAVA=`package org.firstinspires.ftc.teamcode.pedroPathing;

import com.pedropathing.follower.Follower;
import com.pedropathing.follower.FollowerConstants;
import com.pedropathing.ftc.FollowerBuilder;
import com.pedropathing.ftc.drivetrains.MecanumConstants;
import com.pedropathing.ftc.localization.constants.PinpointConstants;
import com.pedropathing.paths.PathConstraints;
import com.qualcomm.robotcore.hardware.DcMotorSimple;
import com.qualcomm.robotcore.hardware.HardwareMap;

public class Constants {
    public static FollowerConstants followerConstants = new FollowerConstants().mass(12);
    public static MecanumConstants driveConstants = new MecanumConstants().maxPower(1)
            .leftFrontMotorName("leftFront").leftRearMotorName("leftRear").rightFrontMotorName("rightFront").rightRearMotorName("rightRear")
            .leftFrontMotorDirection(DcMotorSimple.Direction.REVERSE).leftRearMotorDirection(DcMotorSimple.Direction.REVERSE);
    public static PinpointConstants localizerConstants = new PinpointConstants().hardwareMapName("pinpoint");
    public static PathConstraints pathConstraints = new PathConstraints(0.99, 100, 1, 1);

    public static Follower createFollower(HardwareMap hardwareMap) {
        return new FollowerBuilder(followerConstants, hardwareMap).pathConstraints(pathConstraints)
                .mecanumDrivetrain(driveConstants).pinpointLocalizer(localizerConstants).build();
    }
}
`;
