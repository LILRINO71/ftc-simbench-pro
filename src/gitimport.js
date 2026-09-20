/* ============================================================
   15.  GITHUB IMPORT — pull OpModes straight out of a team's repo.
   This module only parses what the user typed and builds the URLs; app.js does
   the fetching. Two rules: only github.com / raw.githubusercontent.com hosts are
   ever produced (so a pasted link can't make the app fetch something else), and
   only .java files come back.
   ============================================================ */

const GH_HOSTS = ["github.com", "www.github.com", "raw.githubusercontent.com", "api.github.com"];
const SEG = /^[\w.-]+$/;                       // owner, repo and branch segments
const SAFE_PATH = /^[\w./-]*$/;                // no .., no spaces, no query junk

/* Anything a team might paste:
     LILRINO71/IDK-WHAT-TEAM-IM-ON
     https://github.com/owner/repo
     https://github.com/owner/repo/tree/main/TeamCode/src/.../pedroPathing
     https://github.com/owner/repo/blob/main/.../AutoAim.java
     https://raw.githubusercontent.com/owner/repo/main/.../AutoAim.java
   -> {owner, repo, ref, path, kind:'repo'|'dir'|'file'} or null with a reason. */
function parseRepoRef(input) {
  const s = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!s) return null;
  let owner, repo, ref = null, path = "", kind = "repo";

  if (/^[\w.-]+\/[\w.-]+$/.test(s)) {
    [owner, repo] = s.split("/");
  } else {
    let u;
    try { u = new URL(s.startsWith("http") ? s : "https://" + s); } catch (e) { return null; }
    if (!GH_HOSTS.includes(u.hostname)) return null;
    const p = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (p.length < 2) return null;
    owner = p[0]; repo = p[1];
    if (u.hostname === "raw.githubusercontent.com") {
      ref = p[2] || null; path = p.slice(3).join("/"); kind = "file";
    } else if (p[2] === "tree" || p[2] === "blob") {
      ref = p[3] || null; path = p.slice(4).join("/"); kind = p[2] === "blob" ? "file" : "dir";
    } else if (p.length > 2) {
      return null;                              // issues, pulls, releases — not code
    }
  }
  if (!SEG.test(owner || "") || !SEG.test(repo || "")) return null;
  if (ref != null && !SEG.test(ref)) return null;
  if (!SAFE_PATH.test(path) || path.includes("..")) return null;
  if (kind === "file" && !/\.java$/i.test(path)) return null;
  return { owner, repo, ref, path, kind };
}

/* The URLs app.js may fetch for a ref. `ref.ref` may be null — GitHub's API
   then resolves the repo's default branch for us, which is what teams expect. */
function rawUrlsFor(ref) {
  if (!ref) return null;
  const base = "https://api.github.com/repos/" + ref.owner + "/" + ref.repo;
  const at = ref.ref ? "?ref=" + encodeURIComponent(ref.ref) : "";
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  return {
    repo: base,
    contents: base + "/contents/" + enc(ref.path) + at,
    // the whole tree in one request, for finding OpModes anywhere in TeamCode
    tree: base + "/git/trees/" + encodeURIComponent(ref.ref || "HEAD") + "?recursive=1",
    raw: (p) => "https://raw.githubusercontent.com/" + ref.owner + "/" + ref.repo + "/" +
      encodeURIComponent(ref.ref || "HEAD") + "/" + enc(p),
    page: "https://github.com/" + ref.owner + "/" + ref.repo,
  };
}

/* Out of a repo tree listing, the files worth offering: .java under a TeamCode
   (or similarly named) source folder, best guesses first, examples last. */
function pickOpModes(entries, opts) {
  const max = (opts && opts.max) || 60;
  const under = (opts && opts.under) || "";
  const out = [];
  for (const e of entries || []) {
    const p = String((e && (e.path || e.name)) || "");
    if (!/\.java$/i.test(p)) continue;
    if (e && e.type && e.type !== "blob" && e.type !== "file") continue;
    if (under && !p.startsWith(under)) continue;
    const name = p.split("/").pop();
    const sample = /\/(samples?|external|ftc_?app|examples?)\//i.test("/" + p + "/") || /^(Concept|Sensor|Robot|Basic)[A-Z]/.test(name);
    const teamcode = /(^|\/)TeamCode\//i.test(p) || /\/teamcode\//i.test(p);
    const named = /(teleop|auto|opmode|drive|shoot|aim)/i.test(name);
    out.push({
      path: p, name, size: (e && e.size) || 0,
      score: (teamcode ? 4 : 0) + (named ? 2 : 0) - (sample ? 5 : 0),
      sample,
    });
  }
  out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return out.slice(0, max);
}

/* A cheap check that a fetched file really is an OpMode, so the picker can warn
   before someone imports a hardware class and wonders why nothing runs. */
function javaLooksLikeOpMode(src) {
  const s = String(src || "");
  return /@(TeleOp|Autonomous)\b/.test(s) || /\bextends\s+(LinearOpMode|OpMode)\b/.test(s);
}
