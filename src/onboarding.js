/* ============================================================
   16.  ONBOARDING + STATUS — the first-run tour, and the one light
   that tells you whether the robot is fine.
   The rule for the whole product: stay out of the way. The bench shows a
   single green light while everything agrees, and only opens a panel when
   something is actually wrong (code and CAD disagree, a servo can't hold its
   load, or the loop is blocked). No badge spam, no "0 issues" celebration.
   Pure data — app.js renders it.
   ============================================================ */

/* The first-run tour. Each step points at something real on the page; the app
   highlights `target` and switches to `tab` before showing the step. */
const TOUR = [
  { id: "drop", tab: "robot", target: "#cadDrop", title: "Drop in your CAD",
    body: "Export your assembly from Onshape as a <b>STEP</b> file and drop it here. SimBench reads the assembly tree, places every part, and works out mass, centre of mass and the drivetrain on its own — nothing to tag.",
    tip: "Onshape: right-click the tab → Export → STEP AP242, assembly structure on." },
  { id: "code", tab: "teleop", target: "#opListTele", title: "Add your OpMode",
    body: "Drop a <code>.java</code> file, paste it in the Java tab, or pull it straight from your team's GitHub repo. SimBench interprets the real code at 50 Hz — it doesn't ask you to rewrite it.",
    tip: "Import from GitHub is in the Session menu, top right." },
  { id: "map", tab: "robot", target: '[data-sec="hwmap"]', title: "Check the hardware map",
    body: "Every <code>hardwareMap.get(...)</code> name is matched to a part in the CAD automatically. The map is editable, and if your Control Hub configuration .xml is loaded it gets checked against that too.",
    tip: "A red row means the code and the CAD disagree — that's the one thing worth fixing before you drive." },
  { id: "drive", tab: "teleop", target: "#viewport", title: "Drive it",
    body: "Press <b>INIT</b> then <b>START</b>. Plug in a controller and press a button on it, or use <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd>. Drag the robot on the field to move it, shift-drag to turn it.",
    tip: "The robot has real mass now: it leans under acceleration, and it can break traction." },
  { id: "shot", tab: "shot", target: '[data-pane="shot"]', title: "Shoot the HIVE",
    body: "If your code spins a flywheel and runs a feeder, SimBench launches BIOBUZZ POLLEN with the real ball flight model — drag, spin, the CELL lip, and the 190 g tipping point.",
    tip: "The verdict tells you whether the shot is possible from where you're standing, and your odds of making it." },
  { id: "math", tab: "math", target: '[data-tab="math"]', title: "Take the math to your portfolio",
    body: "The <b>Math</b> tab prints the real equations for <i>your</i> robot — gear ratios, holding torque, odometry, traction limits, feedforward — with your numbers substituted. Copy it straight into your Engineering Portfolio.",
    tip: "Every line says where the number came from: CAD, code, vendor spec or assumption." },
  { id: "save", tab: null, target: "#sessionBtn", title: "Save the whole workspace",
    body: "<b>Save session</b> writes a <code>.ftcsim</code> file holding the parsed CAD, the map, your code and the robot's pose. Drop it back in later and you're exactly where you left off — no re-parsing the STEP.",
    tip: "It's a plain file: commit it next to your OpMode, or send it to a teammate." },
];

const STATUS_RANK = { go: 0, warn: 1, stop: 2 };

/* One traffic light for the whole bench.
   findings: what analyze() returned. runtime: live things analyze can't see —
   stalled actuators, a blocked loop, hardware names missing from the config. */
function statusOf(findings, runtime) {
  const F = Array.isArray(findings) ? findings : [];
  const rt = runtime || {};
  const items = [];
  const push = (level, text, where, key) => items.push({ level, text, where, key });

  for (const f of F) {
    if (f.sev === "fail") push("stop", stripTags(f.title), "checks", f.key);
    else if (f.sev === "warn") push("warn", stripTags(f.title), "checks", f.key);
  }
  for (const n of rt.stalled || []) push("stop", n + " is stalled against its load", "checks", "stall:" + n);
  for (const n of rt.missing || []) push("stop", n + " is not in the robot configuration", "robot", "cfg:" + n);
  if (rt.blocked) push("stop", "the OpMode loop is blocked", "checks", "blocked");
  if (rt.slipping) push("warn", "the drivetrain is slipping", "checks", "slip");
  // a front 90 degrees off the wheels makes every turn slide: the sim is wrong until it's fixed
  if (rt.frontAcross) push("stop", "CAD front is set across the wheels", "robot", "front");

  const counts = { stop: 0, warn: 0 };
  for (const i of items) counts[i.level]++;
  const level = counts.stop ? "stop" : (counts.warn ? "warn" : "go");
  const label = level === "go" ? "Go"
    : level === "warn" ? counts.warn + " to look at"
      : counts.stop + (counts.stop > 1 ? " problems" : " problem");
  // headline is what the pill says out loud when someone asks why it isn't green
  const headline = level === "go"
    ? "Code, CAD and configuration agree, and nothing is over its limit."
    : items.filter((i) => i.level === level)[0].text;
  return { level, label, headline, items, counts, rank: STATUS_RANK[level] };
}

const stripTags = (s) => String(s == null ? "" : s).replace(/<[^>]*>/g, "");
