/**
 * Primitivas de parsing PHP (sem dependências, sem executar nada): comentários, strings,
 * blocos balanceados, fim de instrução e uma AST leve de instruções
 * (if/elseif/else, foreach/for/while/do, switch, try/catch múltiplo/finally).
 *
 * Todos os índices (`idx`) são absolutos no texto já sem comentários — e como os comentários
 * são trocados por espaços (não removidos), eles também valem para o texto original.
 */

const LINE_CACHE = new Map();
/** Número da linha (1-based) de `pos` em `text`. Usa um índice de quebras de linha em cache (O(log n) por chamada). */
export function lineNoAt(text, pos) {
  let nl = LINE_CACHE.get(text);
  if (!nl) {
    nl = [];
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) nl.push(i);
    if (LINE_CACHE.size >= 8) LINE_CACHE.delete(LINE_CACHE.keys().next().value);
    LINE_CACHE.set(text, nl);
  }
  const end = Math.min(pos, text.length);
  let lo = 0;
  let hi = nl.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nl[mid] < end) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/** `s[i]` é uma aspa; devolve o índice logo após a string (PHP permite quebra de linha dentro). */
export function skipString(s, i) {
  const q = s[i];
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return i;
}

/** Se há um heredoc/nowdoc em `s[i]` (`<<<ID`), devolve o índice logo após ele; senão `-1`. */
function skipHeredoc(s, i) {
  const m = /^<<<[ \t]*(['"]?)([A-Za-z_]\w*)\1\r?\n/.exec(s.slice(i, i + 80));
  if (!m) return -1;
  const body = i + m[0].length;
  const re = new RegExp(`\\n[ \\t]*${m[2]}\\b`, "g");
  re.lastIndex = body - 1;
  const hit = re.exec(s);
  return hit ? hit.index + hit[0].length : s.length;
}

const blank = (t) => t.replace(/[^\n]/g, " ");

/** Troca comentários, atributos (`#[...]`) e tags `<?php` por espaços, preservando strings e linhas. */
export function stripPhpComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '"' || c === "'") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "<" && c2 === "<" && src[i + 2] === "<") {
      const end = skipHeredoc(src, i);
      if (end > 0) {
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === "<" && c2 === "?") {
      const m = /^<\?(?:php|=)?/.exec(src.slice(i, i + 6));
      out += " ".repeat(m[0].length);
      i += m[0].length;
      continue;
    }
    if (c === "?" && c2 === ">") {
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "#" && c2 === "[") {
      const close = matchClose(src, i + 1);
      const end = close < 0 ? src.length : close + 1;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === "#" || (c === "/" && c2 === "/")) {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      out += " ".repeat(j - i);
      i = j;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function ws(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** Índice do fechamento que casa com `s[open]` (um de `([{`), ou -1. */
export function matchClose(s, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

export function startsWithKw(src, i, kw) {
  return src.startsWith(kw, i) && !/[\w$]/.test(src[i + kw.length] || "") && (i === 0 || !/[\w$]/.test(src[i - 1]));
}

/** Fim (exclusivo) da instrução que começa em `st`: `;` no nível 0 ou `}` que fecha o bloco pai. */
export function readStatementEnd(src, st) {
  let depth = 0;
  let i = st;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i = skipString(src, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && c === ";") return i + 1;
    i++;
  }
  return src.length;
}

/** Divide `s` por `sep` apenas no nível 0 (fora de strings e parênteses). `null` se não houver. */
export function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      // palavras (and/or) só contam se isoladas
      if (/^[a-z]+$/i.test(sep) && (/[\w$]/.test(s[i - 1] || "") || /[\w$]/.test(s[i + sep.length] || ""))) continue;
      parts.push(s.slice(last, i));
      i += sep.length - 1;
      last = i + 1;
    }
  }
  if (!parts.length) return null;
  parts.push(s.slice(last));
  return parts.map((p) => p.trim());
}

/** Primeiro operador de `ops` no nível 0 (da esquerda para a direita). */
export function findTopOp(s, ops) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0) {
      for (const op of ops) {
        if (!s.startsWith(op, i)) continue;
        if ((op === ">" || op === "<") && (s[i - 1] === "=" || s[i + 1] === "=" || s[i + 1] === ">" || s[i - 1] === "<" || s[i + 1] === "<")) continue;
        if (op === ">" && s[i - 1] === "-") continue;
        if (op === "<" && s[i + 1] === "?") continue;
        if ((op === "==" || op === "!=") && s[i + 2] === "=") continue;
        if ((op === "==" || op === "!=") && (s[i - 1] === "=" || s[i - 1] === "!")) continue;
        return { i, op };
      }
    }
  }
  return null;
}

/** Remove parênteses externos redundantes. */
export function stripParens(e) {
  let s = e.trim();
  while (s.startsWith("(") && matchClose(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
  return s;
}

/** Divide os argumentos de uma chamada (nível 0, por vírgula). */
export function splitArgs(argsStr) {
  const s = argsStr.trim();
  if (!s) return [];
  const parts = splitTop(s, ",") || [s];
  return parts.filter((p, i) => p !== "" || i < parts.length - 1);
}

/* ------------------------------------------------------------------ */
/* AST de instruções                                                   */
/* ------------------------------------------------------------------ */

/** Interpreta instruções a partir de `i`; termina em `}` solto, `case`/`default` (switch) ou no fim. */
export function parseStatements(src, i = 0, opt = {}) {
  const out = [];
  let guard = 0;
  while (guard++ < 100000) {
    i = ws(src, i);
    if (i >= src.length || src[i] === "}") break;
    if (src[i] === ";") {
      i++;
      continue;
    }
    if (opt.inSwitch && (startsWithKw(src, i, "case") || startsWithKw(src, i, "default"))) break;
    const r = parseStatement(src, i);
    if (r.node) out.push(r.node);
    i = r.next > i ? r.next : i + 1;
  }
  return Object.assign(out, { end: i });
}

function parseBody(src, i) {
  i = ws(src, i);
  if (src[i] === "{") {
    const close = matchClose(src, i);
    const list = parseStatements(src, i + 1);
    return { list, next: close < 0 ? src.length : close + 1 };
  }
  const r = parseStatement(src, i);
  return { list: r.node ? [r.node] : [], next: r.next > i ? r.next : i + 1 };
}

/** Corpo na sintaxe alternativa (`if (x): ... endif;`) — lê até uma das palavras-fim. */
function parseAltBody(src, i, enders) {
  const out = [];
  let guard = 0;
  while (guard++ < 100000) {
    i = ws(src, i);
    if (i >= src.length) break;
    if (enders.some((k) => startsWithKw(src, i, k))) break;
    const r = parseStatement(src, i);
    if (r.node) out.push(r.node);
    i = r.next > i ? r.next : i + 1;
  }
  return { list: out, next: i };
}

const DECL_RE = /^(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+\w|^function\s+&?\w/;

function skipSemi(src, i) {
  const k = ws(src, i);
  return src[k] === ";" ? k + 1 : i;
}

function parseStatement(src, i) {
  const idx = i;

  if (src[i] === "{") {
    const close = matchClose(src, i);
    const body = parseStatements(src, i + 1);
    return { node: { kind: "block", idx, body }, next: close < 0 ? src.length : close + 1 };
  }

  if (startsWithKw(src, i, "if")) return parseIf(src, i, "if");

  if (startsWithKw(src, i, "foreach") || startsWithKw(src, i, "for") || startsWithKw(src, i, "while")) {
    const kw = startsWithKw(src, i, "foreach") ? "foreach" : startsWithKw(src, i, "for") ? "for" : "while";
    const p0 = ws(src, i + kw.length);
    const p1 = src[p0] === "(" ? matchClose(src, p0) : -1;
    if (p1 < 0) return { node: null, next: i + kw.length };
    const head = src.slice(p0 + 1, p1).trim();
    const afterHead = ws(src, p1 + 1);
    if (src[afterHead] === ":") {
      const b = parseAltBody(src, afterHead + 1, ["endforeach", "endfor", "endwhile"]);
      const e = ws(src, b.next);
      const end = skipSemi(src, e + src.slice(e).match(/^\w+/)?.[0].length || e);
      return { node: { kind: "loop", loopKind: kw, head, idx, body: b.list }, next: end };
    }
    const body = parseBody(src, p1 + 1);
    return { node: { kind: "loop", loopKind: kw, head, idx, body: body.list }, next: body.next };
  }

  if (startsWithKw(src, i, "do")) {
    const body = parseBody(src, i + 2);
    const k = ws(src, body.next);
    let head = "";
    let next = body.next;
    if (startsWithKw(src, k, "while")) {
      const p0 = ws(src, k + 5);
      const p1 = matchClose(src, p0);
      if (p1 > 0) {
        head = src.slice(p0 + 1, p1).trim();
        next = skipSemi(src, p1 + 1);
      }
    }
    return { node: { kind: "loop", loopKind: "do", head, idx, body: body.list }, next };
  }

  if (startsWithKw(src, i, "switch")) return parseSwitch(src, i);

  if (startsWithKw(src, i, "try")) {
    const b0 = ws(src, i + 3);
    if (src[b0] !== "{") return { node: null, next: i + 3 };
    const close = matchClose(src, b0);
    const tryBody = parseStatements(src, b0 + 1);
    let next = close < 0 ? src.length : close + 1;
    let k = ws(src, next);
    const catches = [];
    let finallyBody = null;
    let finallyIdx = 0;
    while (startsWithKw(src, k, "catch")) {
      const cIdx = k;
      let c0 = ws(src, k + 5);
      let types = [];
      let param = "";
      if (src[c0] === "(") {
        const pe = matchClose(src, c0);
        const head = src.slice(c0 + 1, pe).trim();
        const pm = head.match(/^([\s\S]*?)\s*(\$\w+)?$/);
        param = pm && pm[2] ? pm[2] : "";
        types = (pm ? pm[1] : head)
          .split("|")
          .map((t) => t.trim().replace(/^\\/, ""))
          .filter(Boolean);
        c0 = ws(src, pe + 1);
      }
      if (src[c0] !== "{") break;
      const cc = matchClose(src, c0);
      catches.push({ types, param, idx: cIdx, body: parseStatements(src, c0 + 1) });
      next = cc < 0 ? src.length : cc + 1;
      k = ws(src, next);
    }
    if (startsWithKw(src, k, "finally")) {
      const f0 = ws(src, k + 7);
      if (src[f0] === "{") {
        const fc = matchClose(src, f0);
        finallyBody = parseStatements(src, f0 + 1);
        finallyIdx = k;
        next = fc < 0 ? src.length : fc + 1;
      }
    }
    return { node: { kind: "try", idx, body: tryBody, catches, finally: finallyBody, finallyIdx }, next };
  }

  const end = readStatementEnd(src, i);
  const text = src.slice(i, end).trim().replace(/;+$/, "").trim();
  if (!text) return { node: null, next: Math.max(end, i + 1) };

  if (DECL_RE.test(text)) {
    // declaração aninhada (function/class): pula inclusive o corpo
    const brace = src.indexOf("{", i);
    if (brace >= 0 && brace < end + 1) {
      const close = matchClose(src, brace);
      return { node: null, next: close < 0 ? src.length : close + 1 };
    }
    return { node: null, next: Math.max(end, i + 1) };
  }
  if (/^(break|continue)\b/.test(text)) {
    return { node: { kind: "jump", jump: text.split(/\s+/)[0], idx }, next: Math.max(end, i + 1) };
  }
  return { node: { kind: "simple", text, idx }, next: Math.max(end, i + 1) };
}

/** `if`/`elseif` (e `else if`): o `else` vira lista com um `if` aninhado quando há encadeamento. */
function parseIf(src, i, kw) {
  const idx = i;
  const p0 = ws(src, i + kw.length);
  const p1 = src[p0] === "(" ? matchClose(src, p0) : -1;
  if (p1 < 0) return { node: null, next: i + kw.length };
  const cond = src.slice(p0 + 1, p1).trim();
  const afterHead = ws(src, p1 + 1);

  // sintaxe alternativa: if (...): ... elseif (...): ... else: ... endif;
  if (src[afterHead] === ":") {
    const then = parseAltBody(src, afterHead + 1, ["elseif", "else", "endif"]);
    let k = ws(src, then.next);
    let els = null;
    let next = then.next;
    if (startsWithKw(src, k, "elseif")) {
      const r = parseIf(src, k, "elseif");
      els = r.node ? [r.node] : [];
      next = r.next;
    } else if (startsWithKw(src, k, "else")) {
      const e0 = ws(src, k + 4);
      const eb = parseAltBody(src, src[e0] === ":" ? e0 + 1 : e0, ["endif"]);
      els = eb.list;
      k = ws(src, eb.next);
      next = startsWithKw(src, k, "endif") ? skipSemi(src, k + 5) : eb.next;
    } else if (startsWithKw(src, k, "endif")) {
      next = skipSemi(src, k + 5);
    }
    return { node: { kind: "if", idx, cond, condIdx: p0 + 1, then: then.list, else: els }, next };
  }

  const then = parseBody(src, p1 + 1);
  let next = then.next;
  let els = null;
  const k = ws(src, next);
  if (startsWithKw(src, k, "elseif")) {
    const r = parseIf(src, k, "elseif");
    els = r.node ? [r.node] : [];
    next = r.next;
  } else if (startsWithKw(src, k, "else")) {
    const e = parseBody(src, k + 4);
    els = e.list;
    next = e.next;
  }
  return { node: { kind: "if", idx, cond, condIdx: p0 + 1, then: then.list, else: els }, next };
}

function parseSwitch(src, i) {
  const idx = i;
  const p0 = ws(src, i + 6);
  const p1 = matchClose(src, p0);
  if (p1 < 0) return { node: null, next: i + 6 };
  const disc = src.slice(p0 + 1, p1).trim();
  const b0 = ws(src, p1 + 1);
  const bClose = src[b0] === "{" ? matchClose(src, b0) : -1;
  const cases = [];
  if (bClose > 0) {
    let k = b0 + 1;
    while (k < bClose) {
      k = ws(src, k);
      if (k >= bClose) break;
      let test = null;
      const cIdx = k;
      if (startsWithKw(src, k, "case")) {
        let j = k + 4;
        let depth = 0;
        for (; j < bClose; j++) {
          const c = src[j];
          if (c === '"' || c === "'") {
            j = skipString(src, j) - 1;
            continue;
          }
          if (c === "(" || c === "[" || c === "{") depth++;
          else if (c === ")" || c === "]" || c === "}") depth--;
          else if ((c === ":" && depth === 0 && src[j + 1] !== ":" && src[j - 1] !== ":") || (c === ";" && depth === 0)) break;
        }
        test = src.slice(k + 4, j).trim();
        k = j + 1;
      } else if (startsWithKw(src, k, "default")) {
        k = ws(src, k + 7);
        if (src[k] === ":" || src[k] === ";") k++;
      } else {
        k++;
        continue;
      }
      const body = parseStatements(src, k, { inSwitch: true });
      cases.push({ test, idx: cIdx, body });
      k = body.end > k ? body.end : k + 1;
    }
  }
  return { node: { kind: "switch", disc, idx, cases }, next: bClose < 0 ? src.length : bClose + 1 };
}

/* ------------------------------------------------------------------ */
/* Cadeias de chamadas: `Foo::bar($a)->baz()->qux`                     */
/* ------------------------------------------------------------------ */

/**
 * Lê uma cadeia de chamadas/propriedades e devolve `{ head, calls[], whole }` (ou `null` se a expressão
 * não for exatamente uma cadeia).
 * `head`: `{ kind: "var"|"static"|"call"|"new"|"paren"|"ident", name, args?, text }`
 * `calls[i]`: `{ op: "->"|"?->"|"::", name, args: string[]|null, argsRaw, prop: boolean }`
 */
export function parseChain(expr) {
  const s = String(expr).trim();
  let i = 0;
  let head = null;

  const ident = /^\\?[A-Za-z_][\w\\]*/;
  let m;
  if (s[i] === "$") {
    m = /^\$[A-Za-z_]\w*/.exec(s);
    if (!m) return null;
    head = { kind: "var", name: m[0], text: m[0] };
    i = m[0].length;
  } else if (s[i] === "(") {
    const close = matchClose(s, 0);
    if (close < 0) return null;
    head = { kind: "paren", name: "", inner: s.slice(1, close), text: s.slice(0, close + 1) };
    i = close + 1;
  } else if (/^new\s/.test(s) || /^new\(/.test(s)) {
    const rest = s.slice(3).trimStart();
    const off = s.length - rest.length;
    const mm = ident.exec(rest) || (rest.startsWith("class") ? ["class"] : null);
    if (!mm) return null;
    let j = off + mm[0].length;
    let args = null;
    let argsRaw = "";
    const k = ws(s, j);
    if (s[k] === "(") {
      const close = matchClose(s, k);
      if (close < 0) return null;
      argsRaw = s.slice(k + 1, close);
      args = splitArgs(argsRaw);
      j = close + 1;
    }
    head = { kind: "new", name: mm[0].replace(/^\\/, ""), args: args || [], argsRaw, text: s.slice(0, j) };
    i = j;
  } else if ((m = ident.exec(s))) {
    const name = m[0];
    let j = name.length;
    const k = ws(s, j);
    if (s[k] === "(") {
      const close = matchClose(s, k);
      if (close < 0) return null;
      const argsRaw = s.slice(k + 1, close);
      head = { kind: "call", name: name.replace(/^\\/, ""), args: splitArgs(argsRaw), argsRaw, text: s.slice(0, close + 1) };
      i = close + 1;
    } else if (s.startsWith("::", j)) {
      head = { kind: "static", name: name.replace(/^\\/, ""), text: name };
      i = j;
    } else {
      head = { kind: "ident", name: name.replace(/^\\/, ""), text: name };
      i = j;
    }
  } else {
    return null;
  }

  const calls = [];
  for (let guard = 0; guard < 200; guard++) {
    let k = ws(s, i);
    let op = null;
    if (s.startsWith("?->", k)) op = "?->";
    else if (s.startsWith("->", k)) op = "->";
    else if (s.startsWith("::", k)) op = "::";
    if (!op) break;
    k = ws(s, k + op.length);
    const nm = /^\$?[A-Za-z_]\w*/.exec(s.slice(k));
    if (!nm) {
      // `->{$expr}` ou `::class` já cai acima; qualquer outra forma não é cadeia simples
      return null;
    }
    let j = k + nm[0].length;
    const p = ws(s, j);
    if (s[p] === "(") {
      const close = matchClose(s, p);
      if (close < 0) return null;
      const argsRaw = s.slice(p + 1, close);
      calls.push({ op, name: nm[0], args: splitArgs(argsRaw), argsRaw, prop: false });
      i = close + 1;
    } else if (s[p] === "[" && op !== "::") {
      // `$a->b['x']`: trata como propriedade e deixa o resto virar texto
      calls.push({ op, name: nm[0], args: null, argsRaw: "", prop: true });
      i = j;
      break;
    } else {
      calls.push({ op, name: nm[0], args: null, argsRaw: "", prop: true });
      i = j;
    }
  }
  if (ws(s, i) < s.length) return null;
  return { head, calls, text: s };
}

/** Texto de um literal de string PHP (sem aspas) ou `null`. */
export function stringLiteral(e) {
  const t = String(e).trim();
  const m = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(t);
  return m ? m[2] : null;
}

/** `Foo::class` → `Foo` (ou `null`). */
export function classConst(e) {
  const m = /^\\?([A-Za-z_][\w\\]*)::class$/.exec(String(e).trim());
  return m ? m[1] : null;
}

/** Itens de um literal de array (`[...]` ou `array(...)`): `[{ key: string|null, value: string, raw }]`. */
export function parseArrayLiteral(e) {
  let t = String(e).trim();
  let inner;
  if (t.startsWith("[") && matchClose(t, 0) === t.length - 1) inner = t.slice(1, -1);
  else {
    const m = /^array\s*\(/i.exec(t);
    if (!m) return null;
    const open = t.indexOf("(");
    if (matchClose(t, open) !== t.length - 1) return null;
    inner = t.slice(open + 1, -1);
  }
  return splitArgs(inner).map((raw) => {
    const arrow = findTopOp(raw, ["=>"]);
    if (arrow) {
      return { key: raw.slice(0, arrow.i).trim(), value: raw.slice(arrow.i + 2).trim(), raw };
    }
    return { key: null, value: raw.trim(), raw };
  });
}
