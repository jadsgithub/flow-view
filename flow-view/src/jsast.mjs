/**
 * AST leve de instruções JS/TS (já sem comentários). Cobre if/else (com ou sem chaves),
 * for/while/do, switch/case, try/catch/finally, blocos e instruções simples (com ASI).
 * Todos os `idx` são índices absolutos em `src`.
 */

import {
  ws,
  matchClose,
  matchBrace,
  readStatementEnd,
  startsWithKw,
  classify,
} from "./jsparse.mjs";

/** Interpreta um corpo de instruções começando em `i`; termina em `}` solto, `case`/`default` (switch) ou fim. */
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

/** Um único "corpo" (bloco ou instrução sem chaves) → lista de instruções + índice seguinte. */
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

function parseStatement(src, i) {
  const idx = i;

  if (src[i] === "{") {
    const close = matchClose(src, i);
    const body = parseStatements(src, i + 1);
    return { node: { kind: "block", idx, body }, next: close < 0 ? src.length : close + 1 };
  }

  if (startsWithKw(src, i, "if")) {
    const p0 = ws(src, i + 2);
    const p1 = src[p0] === "(" ? matchClose(src, p0) : -1;
    if (p1 < 0) return { node: null, next: i + 2 };
    const cond = src.slice(p0 + 1, p1).trim();
    const then = parseBody(src, p1 + 1);
    let next = then.next;
    let els = null;
    const k = ws(src, next);
    if (startsWithKw(src, k, "else")) {
      const e = parseBody(src, k + 4);
      els = e.list;
      next = e.next;
    }
    return {
      node: { kind: "if", idx, cond, condIdx: p0 + 1, then: then.list, else: els },
      next,
    };
  }

  if (startsWithKw(src, i, "for") || startsWithKw(src, i, "while")) {
    const kw = startsWithKw(src, i, "for") ? "for" : "while";
    let p0 = ws(src, i + kw.length);
    if (kw === "for" && startsWithKw(src, p0, "await")) p0 = ws(src, p0 + 5);
    const p1 = src[p0] === "(" ? matchClose(src, p0) : -1;
    if (p1 < 0) return { node: null, next: i + kw.length };
    const head = src.slice(p0 + 1, p1).trim();
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
        next = p1 + 1;
      }
    }
    return { node: { kind: "loop", loopKind: "do", head, idx, body: body.list }, next };
  }

  if (startsWithKw(src, i, "switch")) {
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
            if (c === '"' || c === "'" || c === "`") {
              j = skipStr(src, j) - 1;
              continue;
            }
            if (c === "(" || c === "[" || c === "{") depth++;
            else if (c === ")" || c === "]" || c === "}") depth--;
            else if (c === ":" && depth === 0) break;
          }
          test = src.slice(k + 4, j).trim();
          k = j + 1;
        } else if (startsWithKw(src, k, "default")) {
          k = ws(src, k + 7);
          if (src[k] === ":") k++;
        } else {
          k++;
          continue;
        }
        const body = parseStatements(src, k, { inSwitch: true });
        cases.push({ test, idx: cIdx, body });
        k = body.end > k ? body.end : k + 1;
      }
    }
    return {
      node: { kind: "switch", disc, idx, cases },
      next: bClose < 0 ? src.length : bClose + 1,
    };
  }

  if (startsWithKw(src, i, "try")) {
    const b0 = ws(src, i + 3);
    if (src[b0] !== "{") return { node: null, next: i + 3 };
    const close = matchClose(src, b0);
    const tryBody = parseStatements(src, b0 + 1);
    let next = close < 0 ? src.length : close + 1;
    let k = ws(src, next);
    let catchNode = null;
    let finallyBody = null;
    let finallyIdx = 0;
    if (startsWithKw(src, k, "catch")) {
      const cIdx = k;
      let c0 = ws(src, k + 5);
      let param = "";
      if (src[c0] === "(") {
        const pe = matchClose(src, c0);
        param = src.slice(c0 + 1, pe).trim().split(":")[0].trim();
        c0 = ws(src, pe + 1);
      }
      if (src[c0] === "{") {
        const cc = matchClose(src, c0);
        catchNode = { param, idx: cIdx, body: parseStatements(src, c0 + 1) };
        next = cc < 0 ? src.length : cc + 1;
        k = ws(src, next);
      }
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
    return {
      node: { kind: "try", idx, body: tryBody, catch: catchNode, finally: finallyBody, finallyIdx },
      next,
    };
  }

  if (startsWithKw(src, i, "else")) return { node: null, next: i + 4 };

  const end = readStatementEnd(src, i);
  const text = src.slice(i, end).trim().replace(/;+$/, "").trim();
  const cl = classify(text);
  if (!text || cl === "decl") {
    // pula declaração inteira (function/class) já consumida por readStatementEnd
    return { node: null, next: Math.max(end, i + 1) };
  }
  if (/^(break|continue)\b/.test(text)) {
    return { node: { kind: "jump", jump: text.split(/\s+/)[0], idx }, next: Math.max(end, i + 1) };
  }
  return { node: { kind: "simple", text, idx }, next: Math.max(end, i + 1) };
}

function skipStr(s, i) {
  const q = s[i];
  i++;
  while (i < s.length) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === q) return i + 1;
    if (q !== "`" && s[i] === "\n") return i;
    i++;
  }
  return i;
}

export { matchBrace };
