/**
 * Primitivas de parsing JS/TS (sem dependências): comentários, strings, blocos balanceados,
 * fim de instrução (com heurística de ASI) e classificação de instruções.
 */

/** Remove comentários preservando quebras de linha e strings. */
export function stripJsComments(src) {
  let o = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      o += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "/" && c2 === "/") {
      i += 2;
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      // mantém as quebras de linha para não deslocar a numeração de linhas
      o += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    o += c;
    i++;
  }
  return o;
}

export function ws(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** `s[i]` é uma aspa; devolve o índice logo após a string. */
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
    if (q !== "`" && c === "\n") return i;
    i++;
  }
  return i;
}

/** Índice do fechamento que casa com `s[open]` (um de `([{`), ou -1. */
export function matchClose(s, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
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

export function matchParen(s, open) {
  return s[open] === "(" ? matchClose(s, open) : -1;
}

/** Bloco `{ ... }`: devolve o interior e o índice logo após o `}`. */
export function matchBrace(s, open) {
  if (s[open] !== "{") return { inner: "", end: open };
  const close = matchClose(s, open);
  if (close < 0) return { inner: s.slice(open + 1), end: s.length };
  return { inner: s.slice(open + 1, close), end: close + 1 };
}

function lastNonWs(s, from, min) {
  for (let i = from - 1; i >= min; i--) if (!/\s/.test(s[i])) return s[i];
  return "";
}

/**
 * Fim (exclusivo) da instrução que começa em `st`.
 * Termina em `;` no nível 0, em `}`/`)` que fecha o bloco pai, ou numa quebra de linha
 * quando a próxima linha claramente inicia outra instrução (ASI).
 */
export function readStatementEnd(src, st) {
  let depth = 0;
  let i = st;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && c === ";") return i + 1;
    else if (depth === 0 && c === "\n") {
      const prev = lastNonWs(src, i, st);
      const nextIdx = ws(src, i);
      if (nextIdx >= src.length) return i;
      const next = src[nextIdx];
      if (prev && /[+\-*/%&|^<>=?:,.([]/.test(prev)) {
        i++;
        continue;
      }
      if (/[.?:+*/%&|=,)\]}]/.test(next) && !(next === "}" && depth === 0)) {
        i++;
        continue;
      }
      if (next === "(" || next === "[") {
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return src.length;
}

export function startsWithKw(src, i, kw) {
  return src.startsWith(kw, i) && !/[\w$]/.test(src[i + kw.length] || "");
}

/** Classifica uma instrução simples (texto já aparado). */
export function classify(t) {
  if (!t) return "x";
  if (/^return\b/.test(t)) return "ret";
  if (/^throw\b/.test(t)) return "thr";
  if (/^(?:async\s+)?function\b/.test(t) || /^class\b/.test(t)) return "decl";
  return "st";
}

/** Número da linha (1-based) em `text` na posição `pos`. */
export function lineNoAt(text, pos) {
  let n = 1;
  const end = Math.min(pos, text.length);
  for (let i = 0; i < end; i++) if (text[i] === "\n") n++;
  return n;
}

/** Divide `s` em partes por `sep` apenas no nível 0 (fora de strings e parênteses). */
export function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(last, i));
      i += sep.length - 1;
      last = i + 1;
    }
  }
  if (!parts.length) return null;
  parts.push(s.slice(last));
  return parts.map((p) => p.trim());
}

/** Primeiro operador de `ops` no nível 0 (procura da esquerda p/ direita). */
export function findTopOp(s, ops) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0) {
      for (const op of ops) {
        if (!s.startsWith(op, i)) continue;
        if ((op === ">" || op === "<") && (s[i - 1] === "=" || s[i + 1] === "=")) continue;
        if (op === ">" && s[i - 1] === "-") continue;
        if ((op === "==" || op === "!=") && s[i + 2] === "=") continue;
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
  return splitTop(s, ",") || [s];
}
