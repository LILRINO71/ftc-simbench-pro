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
export function tokenize(src) { return lex(src, 0, false).out; }

/* Regex or division after ')' and '}' depends on what the bracket closed, and
   the previous token alone can't say. So the scan keeps a stack of the open
   brackets and marks each closing ')' and '}' with `re` (a regex may follow):
     ')'  closed an if / while / for / with header: a statement follows (regex);
          any other ')' (a call, a group, parameters) ends an expression (division).
     '}'  closed a block, a function or class declaration, or an arrow body: the
          next token starts a statement (regex); one that closed an object literal
          or a function or class expression ends an expression (division).
   Each '{' on the stack knows two things: whether what it holds is statements
   (`stmts`: a block or a body, not an object literal) and whether a regex may
   follow its '}' (`re`). Both come from the token before it (startsStatement),
   with a '?' count per bracket so a ternary's ':' is not taken for a label's. */
const CONTROL_HEAD = new Set(['if', 'while', 'for', 'with']);
// reserved words that end an expression; any other is an operator or a statement
// keyword, after which an expression must still come
const VALUE_WORDS = new Set(['this', 'super', 'null', 'true', 'false']);
const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'switch',
  'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'await', 'of', 'async',
  'this', 'super', 'null', 'true', 'false']);
// a line break right after one of these ends the statement
const RESTRICTED = new Set(['return', 'yield', 'break', 'continue']);
// the brace after these opens a block
const BLOCK_WORDS = new Set(['else', 'do', 'try', 'finally', 'static']);

/* Tokens from `start`. Inside a template's ${…} (inTemplate) it stops at the
   brace that closes the expression and returns that brace's index as `end`:
   the expression is code like any other, with its own strings, regexes and
   comments. */
function lex(src, start, inTemplate) {
  const out = [];
  let i = start, depth = 0;
  const n = src.length;
  const sig = (k) => { for (; k >= 0; k--) { const t = out[k].t; if (t !== 'ws' && t !== 'lc' && t !== 'bc') return k; } return -1; };
  const last = () => { const k = sig(out.length - 1); return k < 0 ? null : out[k]; };
  const isMember = (k) => { const b = k >= 0 ? out[sig(k - 1)] : null; return !!b && b.t === 'punc' && (b.v === '.' || b.v === '?.'); };
  // the open brackets: {v:'(', ctl, fn} | {v:'['} | {v:'{', stmts, re}; each counts its open '?'
  // (a template's ${…} is an expression, so its root is not a statement list)
  const stack = [inTemplate ? { v: '(', q: 0 } : { v: '{', stmts: true, re: true, q: 0 }];
  const top = () => stack[stack.length - 1];
  let fnNext = null;      // after `function`: 'decl' or 'expr', until its parameter list opens
  let classNext = null;   // after `class`: {decl, at} until its body's '{' at the same bracket depth
  /* Would a token after out[k] begin a statement? Asked only before `{`,
     `function` and `class`, none of which can continue an expression, so after
     a token that ends one only an inserted semicolon puts them there. */
  const startsStatement = (k) => {
    if (top().v !== '{' || !top().stmts) return false;   // inside ( ), [ ] or an object literal
    if (k < 0) return true;
    const p = out[k];
    if (p.t === 'punc') {
      if (p.v === ';' || p.v === '}' || p.v === ')' || p.v === ']' || p.v === '++' || p.v === '--') return true;
      if (p.v === '{') return !!p.stmts;
      if (p.v === ':') return !!p.label;
      return false;
    }
    if (p.t === 'id') {
      if (isMember(k)) return true;                     // obj.else: a property name ends an expression
      if (BLOCK_WORDS.has(p.v)) return true;
      if (RESTRICTED.has(p.v)) {
        for (let j = k + 1; j < out.length; j++) if (out[j].t !== 'lc' && LINE_BREAK.test(out[j].v)) return true;
        return false;
      }
      return !RESERVED.has(p.v) || VALUE_WORDS.has(p.v);
    }
    return true;                                         // a literal
  };

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
      const v = src.slice(i, j);
      const k = sig(out.length - 1);
      if (!isMember(out.length) && v === 'function') {
        // `async function` stands where `async` does
        const p = k >= 0 ? out[k] : null;
        const at = p && p.t === 'id' && p.v === 'async' && !isMember(k) ? sig(k - 1) : k;
        fnNext = startsStatement(at) ? 'decl' : 'expr';
      }
      if (!isMember(out.length) && v === 'class') classNext = { decl: startsStatement(k), at: stack.length };
      out.push({ t: 'id', v }); i = j; continue;
    }
    // punctuators, longest first
    const three = src.substr(i, 3), four = src.substr(i, 4);
    const P4 = ['>>>='], P3 = ['===', '!==', '**=', '<<=', '>>=', '>>>', '...', '&&=', '||=', '??='];
    const P2 = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**'];
    let v = null;
    if (P4.includes(four)) v = four; else if (P3.includes(three)) v = three;
    else if (P2.includes(src.substr(i, 2))) v = src.substr(i, 2); else v = c;
    if (v === '?.' && /[0-9]/.test(src[i + 2] || '')) v = '?';   // `a?.5:1` is a ternary
    if (inTemplate && v === '{') depth++;
    else if (inTemplate && v === '}' && depth-- === 0) return { out, end: i };
    const tok = { t: 'punc', v };
    // `function` and `class` were a property name or key after all (`{ class: 1 }`)
    if (fnNext && v !== '(' && v !== '*') fnNext = null;
    if (classNext && classNext.at === stack.length && (v === ':' || v === ',' || v === ';' || v === '=' || v === '}' || v === ')')) classNext = null;
    if (v === '(') {
      const k = sig(out.length - 1), p = k >= 0 ? out[k] : null;
      // the header's keyword, one token further back for `for await (`
      let kw = p && p.t === 'id' && !isMember(k) ? p.v : null;
      if (kw === 'await') { const b = out[sig(k - 1)]; if (b && b.t === 'id' && b.v === 'for') kw = 'for'; }
      const entry = { v: '(', ctl: CONTROL_HEAD.has(kw), q: 0 };
      if (fnNext) { entry.fn = fnNext; fnNext = null; }
      stack.push(entry);
    } else if (v === '[') stack.push({ v: '[', q: 0 });
    else if (v === '{') {
      const k = sig(out.length - 1), p = k >= 0 ? out[k] : null;
      let stmts, re;
      if (classNext && classNext.at === stack.length) { stmts = true; re = classNext.decl; classNext = null; }
      // a body after a parameter list or a header: a function's says what it ends; a method's, catch's, switch's end nothing
      else if (p && p.t === 'punc' && p.v === ')') { stmts = true; re = p.fn ? p.fn === 'decl' : true; }
      // an arrow is the whole expression: after its body only a new line, so a new statement, can come
      else if (p && p.t === 'punc' && p.v === '=>') { stmts = true; re = true; }
      else stmts = re = startsStatement(k);
      tok.stmts = stmts;
      stack.push({ v: '{', stmts, re, q: 0 });
    } else if (v === ')' || v === ']' || v === '}') {
      const e = stack.length > 1 ? stack.pop() : top();   // a stray closer leaves the root alone
      if (v === ')') { tok.re = !!e.ctl; if (e.fn) tok.fn = e.fn; }
      if (v === '}') tok.re = !!e.re;
    } else if (v === '?') top().q++;
    else if (v === ':') {
      if (top().q > 0) top().q--;                                 // a ternary's
      else tok.label = top().v === '{' && !!top().stmts;          // a label's or a case's; else an object key's
    }
    out.push(tok); i += v.length; continue;
  }
  return { out, end: n };
}

function templateEnd(src, start) {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    // a ${…} expression is tokenized like the code around it, so a quote in a
    // regex (/can't/) or a comment can't end it early or run it past its brace
    if (c === '$' && src[i + 1] === '{') { i = lex(src, i + 2, true).end + 1; continue; }
    i++;
  }
  return src.length;
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.t === 'id') return KEYWORD_BEFORE_REGEX.has(prev.v);
  if (prev.t === 'num' || prev.t === 'str' || prev.t === 'tmpl' || prev.t === 'regex') return false;
  if (prev.t === 'punc') {
    if (prev.v === ')' || prev.v === '}') return !!prev.re;   // see lex(): what the bracket closed
    return !([']', '++', '--'].includes(prev.v));
  }
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

// LF, CR and the two Unicode line terminators (U+2028, U+2029)
const LINE_BREAK = new RegExp('[\\n\\r' + String.fromCharCode(0x2028, 0x2029) + ']');

export function minifyJS(src, opts = {}) {
  const toks = tokenize(src);
  const kept = [];
  const gap = (t) => t.t === 'ws' || t.t === 'lc' || t.t === 'bc';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (gap(t)) {
      // the whole run of whitespace and comments between two tokens is one gap:
      // `a // c\nb` has its newline after the comment, and a block comment with
      // a line break in it is a line break to ASI
      let j = i, nl = false;
      for (; j < toks.length && gap(toks[j]); j++) if (toks[j].t !== 'lc' && LINE_BREAK.test(toks[j].v)) nl = true;
      const prev = kept[kept.length - 1], next = toks[j];
      i = j - 1;
      if (!prev || !next) continue;
      // a newline only matters where ASI could fire; everything else is layout
      if (nl && CAN_END_STATEMENT(prev)) kept.push({ t: 'nl', v: '\n' });
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
  // NB: no tidy-up pass over the finished text. A regex like /\n{2,}/ would also
  // reach inside template literals, and the sample OpModes live in those.
  return opts.strings ? hideStrings(out) : out;
}

/* Move plain string literals into an encoded table. Object-literal keys and
   anything followed by ':' are left alone — a computed key would be needed and
   that is where a naive pass breaks code. */
function hideStrings(src) {
  const toks = tokenize(src);
  const table = [];
  const index = new Map();
  // a directive prologue ("use strict";) stays where it is, as written: hidden
  // in the table or behind the prelude it would be an expression, not a directive
  const gap = (t) => t && (t.t === 'ws' || t.t === 'lc' || t.t === 'bc');
  let body = 0;
  for (let k = 0; ; ) {
    while (gap(toks[k])) k++;
    if (!toks[k] || toks[k].t !== 'str') break;
    let s = k + 1; while (gap(toks[s])) s++;
    if (!toks[s] || toks[s].t !== 'punc' || toks[s].v !== ';') break;
    body = k = s + 1;
  }
  const head = toks.slice(0, body).map((t) => t.v).join('');
  let out = '';
  for (let i = body; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'str') { out += t.v; continue; }
    const nextTok = toks[i + 1];
    let pi = i - 1; while (pi >= 0 && (toks[pi].t === 'ws' || toks[pi].t === 'lc' || toks[pi].t === 'bc')) pi--;
    const prevTok = toks[pi];
    // a key comes after { or , — a string before a ternary's or a case's colon is a value
    const isKey = nextTok && nextTok.t === 'punc' && nextTok.v === ':' && (!prevTok || (prevTok.t === 'punc' && (prevTok.v === '{' || prevTok.v === ',')));
    const isMember = toks[i - 1] && toks[i - 1].t === 'punc' && (toks[i - 1].v === '.' || toks[i - 1].v === '?.');
    const value = decodeStringLiteral(t.v);
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
  return head + prelude + out;
}

/* The value a JS string literal denotes, or null when this pass can't be sure.
   Null is the safe answer: the literal is then left exactly as it was. */
export function decodeStringLiteral(lit) {
  if (typeof lit !== 'string' || lit.length < 2) return null;
  const q = lit[0];
  if ((q !== '"' && q !== "'") || lit[lit.length - 1] !== q) return null;
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { if (c === q) return null; out += c; continue; }
    const e = body[++i];
    if (e === undefined) return null;
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', "'": "'", '"': '"', '\\': '\\', '/': '/', '\n': '' };
    if (Object.prototype.hasOwnProperty.call(simple, e)) {
      if (e === '0' && /[0-9]/.test(body[i + 1] || '')) return null;   // legacy octal: not worth guessing
      out += simple[e]; continue;
    }
    if (e === 'x' || e === 'u') {
      let hex;
      if (e === 'x') { hex = body.substr(i + 1, 2); i += 2; }
      else if (body[i + 1] === '{') {                                   // \u{1F41D}
        const end = body.indexOf('}', i + 2); if (end < 0) return null;
        hex = body.slice(i + 2, end); i = end;
      } else { hex = body.substr(i + 1, 4); i += 4; }
      if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
      const cp = parseInt(hex, 16);
      if (cp > 0x10FFFF) return null;
      out += String.fromCodePoint(cp); continue;
    }
    if (/[0-9]/.test(e)) return null;                                   // octal escape
    out += e;                                                           // \q is just q
  }
  return out;
}

export function minifyCSS(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s*([{};,>])\s*/g, '$1');
  out = out.replace(/;\}/g, '}');
  // a colon inside a selector (:hover, ::before) or a media query keeps its space rules simple:
  out = out.replace(/:\s+/g, ':');
  return out.trim();
}

/* Elements whose neighbouring whitespace never renders: block boxes, table
   parts, things in <head>, SVG shapes. Whitespace next to anything else (b,
   kbd, span, button, input...) is a visible space between inline boxes. */
const NO_SPACE_AROUND = new Set(('html head body meta link title script style div p ul ol li dl dt dd table thead tbody ' +
  'tfoot tr td th caption colgroup col section article aside header footer nav main h1 h2 h3 h4 h5 h6 form fieldset ' +
  'legend details summary dialog pre hr br blockquote figure figcaption option optgroup template noscript ' +
  'svg g defs rect path circle ellipse line polyline polygon use symbol').split(' '));

/* Conservative: comments and inter-tag whitespace only, and never inside a
   pre/textarea/script/style where whitespace is content. Whitespace between
   two tags goes when either tag is a block one, and is one space otherwise:
   "<b>Keys</b> <kbd>I</kbd>" must not render as "KeysI". */
export function minifyHTML(src) {
  const keep = /<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi;
  const holes = [];
  let masked = src.replace(keep, (m) => { holes.push(m); return '\u0000' + (holes.length - 1) + '\u0000'; });
  masked = masked.replace(/<!--[\s\S]*?-->/g, '');
  const tagAt = (s, i) => { const m = /^<\/?([A-Za-z][\w-]*)/.exec(s.slice(i, i + 64)); return m ? m[1].toLowerCase() : null; };
  masked = masked.replace(/\n\s*/g, '\n').replace(/>\s+</g, (m, off, s) => {
    const left = tagAt(s, s.lastIndexOf('<', off)), right = tagAt(s, off + m.length - 1);
    return !left || !right || NO_SPACE_AROUND.has(left) || NO_SPACE_AROUND.has(right) ? '><' : '> <';
  }).replace(/\s{2,}/g, ' ');
  return masked.replace(/\u0000(\d+)\u0000/g, (m, i) => holes[+i]).trim();
}
