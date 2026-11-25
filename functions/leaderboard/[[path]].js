/* ============================================================
   SHARED LEADERBOARD (Cloudflare Pages Function, /leaderboard/*)
   The final score of a match, posted by the player and kept for everyone:
   one board for TeleOp and one for Auto, the top 50 of each.

     GET  /leaderboard            {boards:{teleop:[…], auto:[…]}}
     GET  /leaderboard/<mode>     {mode, entries:[…]}     (teleop or auto)
     POST /leaderboard            {name, score, mode, robot, opmode}
                                  -> {ok, improved, rank, entries}

   An entry is {name, score, mode, robot, opmode, date}: a display name the player
   chose, the score, and the names of the robot and the OpMode. No account, no
   e-mail, no address; the date is the server's.

   It keeps the boards in the Durable Object bound as BOARDS (workers/room/board.js),
   or else in a KV namespace bound as LEADERBOARD (DEPLOY.md, "Shared leaderboard").
   KV has no transactions and is eventually consistent, so posts that overlap there
   can lose a score or slip past the rate limit; the object answers one post at a
   time and loses nothing. With neither binding every route answers 501
   {"error":"not set up"}, and the page quietly shows personal bests only.

   Kept honest, as far as a browser game allows: only this site's own pages may
   call it; a score must be a whole number between 1 and the most the game allows;
   a name is 1-24 letters, digits and a few marks, and not rude, a web address or a
   phone number; there is one entry per name, robot and mode, keeping the best; and
   each address may post 8 times in 10 minutes (only a hash of it is stored, with a
   10-minute expiry). The score itself comes from the player's browser: nothing here
   can prove it was played, so the board is for fun and for teams that trust each
   other, not for prizes.
   ============================================================ */
// the most one alliance can score in a match, with room to spare: TeleOp 2:00, Auto 0:30 (src/match.js MATCH_PTS)
export const LIMITS = { teleop: 500, auto: 150 };
export const TOP = 50;
export const RATE = { max: 8, windowMs: 10 * 60 * 1000 };
const NAME_MAX = 24, LABEL_MAX = 40, BODY_MAX = 2048;
const MODES = Object.keys(LIMITS);

// Pages does not apply dist/_headers to a Function's answers: nosniff is set here
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra) });
const bad = (error, message, status = 400) => json({ error, message }, status);

/* ---------------- names ---------------- */
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };
// words that are rude wherever they appear in a name
const RUDE_ANYWHERE = ['fuck', 'shit', 'nigg', 'fagg', 'bitch', 'whore', 'slut', 'retard', 'hitler', 'porn', 'bastard', 'asshole'];
// words that are rude on their own but part of ordinary names inside others (Hancock, Dickson, Essex)
const RUDE_WORD = ['dick', 'cock', 'pussy', 'penis', 'vagina', 'ass', 'rape', 'rapist', 'sex', 'tit', 'tits', 'anal', 'cum', 'kkk', 'cunt', 'cunts', 'twat', 'wank', 'nazi', 'nazis'];
/* Is this text rude? Looks through spacing, punctuation, repeated letters and 1337-speak. Numbers alone
   are left alone (a team number is never a word), so "455" is a team and "455hole" is read as letters. */
export function rude(text) {
  const t = String(text || '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
  const bare = (w) => w.replace(/(.)\1+/g, '$1');
  const words = (t.match(/[a-z0-9@$!|]+/g) || []).filter((w) => /[a-z]/.test(w))
    .map((w) => bare(w.replace(/[013457@$!|]/g, (c) => LEET[c]).replace(/[^a-z]/g, '')));
  const squashed = words.join('');
  if (RUDE_ANYWHERE.some((w) => squashed.includes(bare(w)))) return true;
  return words.some((w) => RUDE_WORD.some((r) => w === bare(r)));
}
const strip = (v) => String(v).normalize('NFKC').replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
const len = (s) => [...s].length;
const cut = (s, n) => [...s].slice(0, n).join('');
/* A display name: {name} or {error} */
export function cleanName(v) {
  if (typeof v !== 'string') return { error: 'A name is needed.' };
  const s = strip(v);
  if (!len(s)) return { error: 'A name is needed.' };
  if (len(s) > NAME_MAX) return { error: 'The name can be up to ' + NAME_MAX + ' characters.' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.'#+\-]*$/u.test(s)) return { error: 'Use letters, numbers and spaces in the name.' };
  if (/https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|dev|app|me|co|ly|xyz)\b/i.test(s) || /\d{7,}/.test(s.replace(/[ .\-]/g, ''))) return { error: 'Leave web addresses and phone numbers out of the name.' };
  if (rude(s)) return { error: 'Pick another name.' };
  return { name: s };
}
/* The robot's or the OpMode's name: tidied, and left as a dash when empty or rude */
export function cleanLabel(v, isFile) {
  if (typeof v !== 'string') return '—';
  let s = strip(v).replace(/[<>"`]/g, '');
  if (isFile) s = s.replace(/\.(step|stp|zip|urdf)$/i, '');
  s = cut(s, LABEL_MAX).trim();
  return !s || rude(s) ? '—' : s;
}
export const modeOf = (v) => /^auto/i.test(String(v || '')) ? 'auto' : /^tele/i.test(String(v || '')) ? 'teleop' : null;

/* ---------------- storage ---------------- */
const bKey = (mode) => 'board:' + mode;
const same = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && a.robot.toLowerCase() === b.robot.toLowerCase();
const order = (a, b) => b.score - a.score || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.name < b.name ? -1 : 1);
async function readBoard(kv, mode) {
  let raw = null; try { raw = await kv.get(bKey(mode)); } catch (e) { raw = null; }
  let a = []; try { a = raw ? JSON.parse(raw) : []; } catch (e) { a = []; }
  return (Array.isArray(a) ? a : []).filter((e) => e && typeof e.name === 'string' && Number.isInteger(e.score)).map((e) => ({
    name: e.name, score: e.score, mode, robot: String(e.robot || '—'), opmode: String(e.opmode || '—'), date: String(e.date || '') })).sort(order).slice(0, TOP);
}
/* Only a hash of the address is kept, so the list of who posted is never a list of addresses. */
async function ipKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|simbench-lb|' + (env.LEADERBOARD_SALT || ''))));
  return 'rl:' + [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function rateCheck(kv, key, now) {
  let rec = null; try { const raw = await kv.get(key); rec = raw ? JSON.parse(raw) : null; } catch (e) { rec = null; }
  if (!rec || !(now - rec.t0 < RATE.windowMs) || !(rec.n >= 0)) rec = { t0: now, n: 0 };
  if (rec.n >= RATE.max) return { ok: false, retry: Math.max(1, Math.ceil((rec.t0 + RATE.windowMs - now) / 1000)) };
  rec.n++;
  // a KV expiry can't be under 60 s
  await kv.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.ceil((rec.t0 + RATE.windowMs - now) / 1000)) });
  return { ok: true };
}

/* ---------------- the routes ---------------- */
export async function handle(request, env, fetchImpl, ctx) {
  const now = ctx && typeof ctx.now === 'function' ? ctx.now() : Date.now();
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/leaderboard\/?/, '').replace(/\/+$/, '');
  // only this site's own pages may use it: another site can't post from a visitor's browser
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== url.origin) return bad('origin', 'This board answers only its own site.', 403);
  if (site && site !== 'same-origin' && site !== 'none') return bad('origin', 'This board answers only its own site.', 403);
  // with the Durable Object bound, the board lives there: one post at a time, nothing lost
  // (workers/room/board.js, which runs this same handle() against its own storage)
  if (env && env.BOARDS) return env.BOARDS.get(env.BOARDS.idFromName('leaderboard')).fetch(request);
  const kv = env && env.LEADERBOARD;
  if (!kv) return json({ error: 'not set up' }, 501);

  if (request.method === 'GET') {
    if (route === '') {
      const boards = {}; for (const m of MODES) boards[m] = await readBoard(kv, m);
      return json({ boards, limits: LIMITS }, 200, { 'Cache-Control': 'public, max-age=15' });
    }
    if (MODES.includes(route)) return json({ mode: route, entries: await readBoard(kv, route) }, 200, { 'Cache-Control': 'public, max-age=15' });
    return json({ error: 'not-found' }, 404);
  }
  if (route !== '') return json({ error: 'not-found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method' }, 405, { Allow: 'GET, POST' });
  // a post must say where it came from
  if (origin !== url.origin) return bad('origin', 'This board answers only its own site.', 403);

  // every post counts against the address, valid or not
  const rl = await rateCheck(kv, await ipKey(request, env), now);
  if (!rl.ok) return json({ error: 'rate', message: 'Too many scores from this connection. Try again in ' + Math.ceil(rl.retry / 60) + ' minutes.' }, 429, { 'Retry-After': String(rl.retry) });

  let text = ''; try { text = await request.text(); } catch (e) { text = ''; }
  if (text.length > BODY_MAX) return bad('too-big', 'That is too much to post.', 413);
  let b = null; try { b = JSON.parse(text); } catch (e) { b = null; }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('json', 'Send the score as JSON.');

  const mode = modeOf(b.mode);
  if (!mode) return bad('mode', 'The mode is TeleOp or Auto.');
  const score = b.score;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > LIMITS[mode]) return bad('score', 'A ' + (mode === 'auto' ? 'Auto' : 'TeleOp') + ' score is a whole number from 1 to ' + LIMITS[mode] + '.');
  const n = cleanName(b.name);
  if (n.error) return bad('name', n.error);
  const entry = { name: n.name, score, mode, robot: cleanLabel(b.robot, true), opmode: cleanLabel(b.opmode, false), date: new Date(now).toISOString().slice(0, 10) };

  const board = await readBoard(kv, mode);
  const i = board.findIndex((e) => same(e, entry));
  let improved = false;
  if (i < 0) { board.push(entry); improved = true; }
  else if (score > board[i].score) { board[i] = entry; improved = true; }
  board.sort(order);
  const top = board.slice(0, TOP);
  const at = top.findIndex((e) => same(e, entry));
  if (improved && at >= 0) await kv.put(bKey(mode), JSON.stringify(top));
  return json({ ok: true, improved: improved && at >= 0, rank: at >= 0 ? at + 1 : null, entry: at >= 0 ? top[at] : null, entries: top });
}

export const onRequest = (context) => handle(context.request, context.env, fetch, context);
