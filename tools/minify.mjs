// Ship-build minifier for the Pro bundle.
//
// There is no parser here and no identifier mangling, because a renamer that is
// wrong 0.1 % of the time ships a broken product. What this does is safe by
// construction and verified: it tokenizes JS properly (strings, template
// literals with nested ${}, regex literals, both comment forms), drops the
// comments and the indentation, and only removes a newline when the previous
// token cannot end a statement — so automatic semicolon insertion can never
// change meaning. tests/ship.test.mjs runs the whole engine test suite against
// the minified bundle, so "it still behaves identically" is a checked claim.
//
// Optional --strings pass hides every plain string literal in an encoded table.
// That is obfuscation, not security: anything shipped to a browser can be read.
// It raises the effort of lifting the physics model, nothing more.

const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await']);
const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;

/** JS -> tokens: {t, v} where t is ws|lc|bc|str|tmpl|regex|num|id|punc. */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const last = () => { for (let k = out.length - 1; k >= 0; k--) { const t = out[k].t; if (t !== 'ws' && t !== 'lc' && t !== 'bc') return out[k]; } return null; };

  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      let j = i; while (j < n && ' \t\r\n'.includes(src[j])) j++;
      out.push({ t: 'ws', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      out.push({ t: 'lc', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      out.push({ t: 'bc', v: src.slice(i, end) }); i = end; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') j += 2; else if (src[j] === c) { j++; break; } else j++; }
      out.push({ t: 'str', v: src.slice(i, j) }); i = j; continue;
    }
    if (c === '`') { const end = templateEnd(src, i); out.push({ t: 'tmpl', v: src.slice(i, end) }); i = end; continue; }
    if (c === '/' && regexAllowed(last())) {
      const end = regexEnd(src, i);
      if (end > 0) { out.push({ t: 'regex', v: src.slice(i, end) }); i = end; continue; }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObBn._]/.test(src[j])) {
        if ((src[j] === 'e' || src[j] === 'E') && /[+-]/.test(src[j + 1] || '')) j++;
        j++;
      }
      out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue;
    }
    if (ID_START.test(c)) {
      let j = i; while (j < n && ID_PART.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
    }
    // punctuators, longest first
    const three = src.substr(i, 3), four = src.substr(i, 4);
    const P4 = ['>>>='], P3 = ['===', '!==', '**=', '<<=', '>>=', '>>>', '...', '&&=', '||=', '??='];
    const P2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];
    let v = null;
    if (P4.includes(four)) v = four; else if (P3.includes(three)) v = three;
    else if (P2.includes(src.substr(i, 2))) v = src.substr(i, 2); else v = c;
    out.push({ t: 'punc', v }); i += v.length; continue;
  }
  return out;
}

function templateEnd(src, start) {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {           // nested expression: walk braces, strings and templates
      let depth = 1; i += 2;
      while (i < src.length && depth > 0) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '`') { i = templateEnd(src, i); continue; }
        if (d === '"' || d === "'") { i++; while (i < src.length) { if (src[i] === '\\') i += 2; else if (src[i] === d) { i++; break; } else i++; } continue; }
        if (d === '{') depth++;
        if (d === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return src.length;
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.t === 'id') return KEYWORD_BEFORE_REGEX.has(prev.v);
  if (prev.t === 'num' || prev.t === 'str' || prev.t === 'tmpl' || prev.t === 'regex') return false;
  if (prev.t === 'punc') return !([')', ']', '}', '++', '--'].includes(prev.v));
  return true;
}

/** End index of a regex literal starting at `start`, or -1 if it isn't one. */
function regexEnd(src, start) {
  let i = start + 1, inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') return -1;                      // no line breaks in a regex: it was division
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { i++; while (i < src.length && /[a-z]/.test(src[i])) i++; return i; }
    i++;
  }
  return -1;
}

const CAN_END_STATEMENT = (t) => t && (t.t === 'id' || t.t === 'num' || t.t === 'str' || t.t === 'tmpl' || t.t === 'regex' ||
  (t.t === 'punc' && [')', ']', '}', '++', '--'].includes(t.v)));

/* Two tokens need a space between them when joining would make one token
   (ab, 1e3) or a different operator (+ + becoming ++, / / starting a comment). */
function needsSpace(a, b) {
  if (!a || !b) return false;
  const wordy = (t) => t.t === 'id' || t.t === 'num' || t.t === 'regex';
  if (wordy(a) && wordy(b)) return true;
  if (a.t === 'num' && b.t === 'punc' && b.v.startsWith('.')) return true;   // 1 .toFixed
  if (a.t === 'punc' && b.t === 'punc') {
    const j = a.v + b.v;
    return /^(\+\+|--|\+\+\+|---|\/\/|\/\*|<!--|-->)/.test(j) ||
      (a.v.endsWith('+') && b.v.startsWith('+')) || (a.v.endsWith('-') && b.v.startsWith('-')) ||
      (a.v.endsWith('/') && (b.v.startsWith('/') || b.v.startsWith('*')));
  }
  if (a.t === 'punc' && b.t === 'regex' && a.v.endsWith('/')) return true;
  if (a.t === 'regex' && b.t === 'punc' && b.v.startsWith('/')) return true;
  return false;
}

export function minifyJS(src, opts = {}) {
  const toks = tokenize(src);
  const kept = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'bc' || t.t === 'lc') continue;
    if (t.t === 'ws') {
      const prev = kept[kept.length - 1];
      let next = null;
      for (let j = i + 1; j < toks.length; j++) { const u = toks[j]; if (u.t !== 'ws' && u.t !== 'lc' && u.t !== 'bc') { next = u; break; } }
      if (!prev || !next) continue;
      // a newline only matters where ASI could fire; everything else is layout
      if (t.v.includes('\n') && CAN_END_STATEMENT(prev)) kept.push({ t: 'nl', v: '\n' });
      else if (needsSpace(prev, next)) kept.push({ t: 'sp', v: ' ' });
      continue;
    }
    kept.push(t);
  }
  let out = '';
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i], prev = kept[i - 1];
    if ((t.t === 'nl' || t.t === 'sp') && (!prev || prev.t === 'nl' || prev.t === 'sp')) continue;
    out += t.v;
  }
  out = out.replace(/\n{2,}/g, '\n').trim();
  return opts.strings ? hideStrings(out) : out;
}

/* Move plain string literals into an encoded table. Object-literal keys and
   anything followed by ':' are left alone — a computed key would be needed and
   that is where a naive pass breaks code. */
function hideStrings(src) {
  const toks = tokenize(src);
  const table = [];
  const index = new Map();
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'str') { out += t.v; continue; }
    const nextTok = toks[i + 1];
    const prevTok = toks[i - 1];
    const isKey = nextTok && nextTok.t === 'punc' && nextTok.v === ':';
    const isMember = prevTok && prevTok.t === 'punc' && (prevTok.v === '.' || prevTok.v === '?.');
    let value;
    try { value = JSON.parse(t.v[0] === "'" ? JSON.stringify(unquote(t.v)) : t.v); } catch (e) { value = null; }
    if (isKey || isMember || value === null || value.length < 3) { out += t.v; continue; }
    let id = index.get(value);
    if (id === undefined) { id = table.length; table.push(value); index.set(value, id); }
    // a quote needed no space before it, but _s does: `return"x"` -> `return _s(3)`
    if (/[A-Za-z0-9_$]$/.test(out)) out += ' ';
    out += '_s(' + id + ')';
  }
  if (!table.length) return src;
  const enc = Buffer.from(JSON.stringify(table), 'utf8').toString('base64');
  const prelude = 'var _st=JSON.parse(typeof atob==="function"?decodeURIComponent(escape(atob("' + enc + '"))):Buffer.from("' + enc + '","base64").toString("utf8"));function _s(i){return _st[i]}\n';
  return prelude + out;
}

const unquote = (lit) => {
  const body = lit.slice(1, -1);
  return body.replace(/\\(['"\\nrtbfv0]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/g, (m, g) => {
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', "'": "'", '"': '"', '\\': '\\' };
    if (simple[g] !== undefined) return simple[g];
    return String.fromCharCode(parseInt(g.slice(1), 16));
  });
};

export function minifyCSS(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s*([{};,>])\s*/g, '$1');
  out = out.replace(/;\}/g, '}');
  // a colon inside a selector (:hover, ::before) or a media query keeps its space rules simple:
  out = out.replace(/:\s+/g, ':');
  return out.trim();
}

/* Conservative: comments and inter-tag whitespace only, and never inside a
   pre/textarea/script/style where whitespace is content. */
export function minifyHTML(src) {
  const keep = /<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi;
  const holes = [];
  let masked = src.replace(keep, (m) => { holes.push(m); return '\u0000' + (holes.length - 1) + '\u0000'; });
  masked = masked.replace(/<!--[\s\S]*?-->/g, '');
  masked = masked.replace(/\n\s*/g, '\n').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
  return masked.replace(/\u0000(\d+)\u0000/g, (m, i) => holes[+i]).trim();
}
