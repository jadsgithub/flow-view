/**
 * Rastreio estático leve: extrai o corpo do handler e gera nós/arestas com heurísticas.
 */

import path from "node:path";
import { buildJsCfg } from "./js-cfg.mjs";
import { matchClose } from "./jsparse.mjs";
import { createCalleeResolver } from "./callee.mjs";
import { findRequestInputs, describeInputs } from "./narrate.mjs";
import { buildLaravelFlow } from "./php/laravel.mjs";
import { MAX_NODES } from "./security.mjs";

let nodeSeq = 0;
function nextId(prefix = "n") {
  nodeSeq += 1;
  return `${prefix}_${nodeSeq}`;
}

function resetIds() {
  nodeSeq = 0;
}

function deriveRoot(absFile, relFile) {
  if (relFile && absFile.endsWith(relFile)) return absFile.slice(0, absFile.length - relFile.length) || path.dirname(absFile);
  return path.dirname(absFile);
}

function lineOffset(content, lineNum) {
  const lines = content.split("\n");
  let off = 0;
  for (let i = 0; i < lineNum - 1 && i < lines.length; i++) off += lines[i].length + 1;
  return off;
}

/** Extrai trecho do handler após declaração de rota (JS/TS) */
function extractJsHandler(content, startLine) {
  const lines = content.split("\n");
  const startIdx = Math.max(0, startLine - 1);
  const baseOff = lineOffset(content, startLine);
  const slice = content.slice(baseOff);

  // Localiza callback: (req, res) => { ou async (req, res) => {
  const arrow = slice.search(/(?:async\s*)?\([^)]*\)\s*=>/);
  const funcKw = slice.search(/function\s*\([^)]*\)\s*\{/);
  let pos = -1;
  if (arrow >= 0 && (funcKw < 0 || arrow <= funcKw)) pos = arrow;
  else if (funcKw >= 0) pos = funcKw;

  if (pos < 0) {
    // named handler: router.get('/x', handlerName)
    const named = slice.match(/\.(?:get|post|put|patch|delete|use|all)\s*\([^,]+,\s*(\w+)/i);
    if (named) {
      const name = named[1];
      const fnRe = new RegExp(
        `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`,
        "m"
      );
      const fullMatch = content.match(fnRe);
      if (fullMatch) {
        const idx = content.indexOf(fullMatch[0]);
        return extractBraceBlock(content, idx + fullMatch[0].length - 1);
      }
    }
    return { body: slice.slice(0, 4000), startLine: startIdx + 1 };
  }

  const from = slice.slice(pos);
  const open = from.indexOf("{");
  if (open < 0) {
    const expr = from.replace(/^[\s\S]*?=>\s*/, "");
    return { body: expr.trim(), startLine: startIdx + 1 };
  }
  const absoluteStart = baseOff + pos + open;
  return extractBraceBlock(content, absoluteStart);
}

/** Corpo entre `{` e o `}` correspondente (ciente de strings). `startLine` = linha do `{`. */
function extractBraceBlock(content, openBraceIndex) {
  const close = matchClose(content, openBraceIndex);
  const lineStart = content.slice(0, openBraceIndex + 1).split("\n").length;
  if (close < 0) return { body: content.slice(openBraceIndex + 1), startLine: lineStart };
  return { body: content.slice(openBraceIndex + 1, close), startLine: lineStart };
}

/** Python: corpo após def handler */
function extractPyHandler(content, handlerName, decoratorLine) {
  const lines = content.split("\n");
  let defLine = -1;
  if (handlerName) {
    const re = new RegExp(`^\\s*(?:async\\s+)?def\\s+${handlerName}\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        defLine = i;
        break;
      }
    }
  }
  if (defLine < 0) {
    for (let i = Math.max(0, (decoratorLine || 1) - 1); i < lines.length; i++) {
      if (/^\s*(?:async\s+)?def\s+\w+\s*\(/.test(lines[i])) {
        defLine = i;
        break;
      }
    }
  }
  if (defLine < 0) return { body: "", startLine: 1 };
  const defIndent = lines[defLine].match(/^(\s*)/)[1].length;
  const out = [lines[defLine]];
  for (let j = defLine + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "") {
      out.push(line);
      continue;
    }
    const ind = line.match(/^(\s*)/)[1].length;
    if (ind <= defIndent && line.trim()) break;
    out.push(line);
  }
  return { body: out.join("\n"), startLine: defLine + 1 };
}

function tokenizeCalls(line) {
  const calls = [];
  const re = /(\b[\w$.]+)\s*\(/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const name = m[1];
    if (/^(if|for|while|switch|catch|function|async)$/.test(name)) continue;
    calls.push(name.split(".").pop());
  }
  return calls;
}

function classifyLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("//") || t.startsWith("*")) return "skip";
  if (/^if\s*\(/.test(t)) return "if";
  if (/^else\s+if\b/.test(t)) return "else_if";
  if (/^else\b/.test(t)) return "else";
  if (/^try\s*\{/.test(t)) return "try";
  if (/^catch\s*\(/.test(t)) return "catch";
  if (/^return\b/.test(t)) return "return";
  if (/^throw\b/.test(t)) return "throw";
  if (/\b(await\s+)?fetch\s*\(/.test(t)) return "external";
  if (/\baxios\.(get|post|put|delete|patch)\s*\(/.test(t)) return "external";
  if (/\brequests\.(get|post|put|delete|patch)\s*\(/.test(t)) return "external";
  if (/\bhttpx?\./.test(t)) return "external";
  return "stmt";
}

function classifyPyLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return "skip";
  if (/^if\s+/.test(t)) return "if";
  if (/^elif\s+/.test(t)) return "else_if";
  if (/^else\s*:/.test(t)) return "else";
  if (/^try\s*:/.test(t)) return "try";
  if (t.startsWith("except")) return "catch";
  if (/^return\b/.test(t)) return "return";
  if (/^raise\b/.test(t)) return "throw";
  return "stmt";
}

function classifyGoLine(line) {
  const t = line.trim();
  if (!t || t.startsWith("//")) return "skip";
  if (/^if\s+/.test(t)) return "if";
  if (/^else\s+if\s+/.test(t)) return "else_if";
  if (/^else\b/.test(t)) return "else";
  if (t.startsWith("switch ")) return "if";
  if (t.startsWith("case ")) return "stmt";
  if (/^\s*return\b/.test(t)) return "return";
  if (/^\s*panic\s*\(/.test(t)) return "throw";
  return "stmt";
}

/**
 * @param {{ scan: object, content?: string, filePath: string }} input
 */
export async function traceRoute(input) {
  resetIds();
  const scan = input.scan;
  const { readFile } = await import("node:fs/promises");
  const filePath = input.filePath || scan.absFile;
  const content =
    input.content ?? (await readFile(filePath, "utf8"));

  let body = "";
  let baseLine = scan.line || 1;
  const lang = filePath.endsWith(".py")
    ? "py"
    : filePath.endsWith(".go")
      ? "go"
      : "js";

  if (lang === "js") {
    const ex = extractJsHandler(content, scan.line || 1);
    body = ex.body;
    baseLine = ex.startLine || baseLine;
  } else if (lang === "py") {
    const ex = extractPyHandler(content, scan.handlerName, scan.line);
    body = ex.body;
    baseLine = ex.startLine || baseLine;
  } else if (lang === "go") {
    const lines = content.split("\n");
    const from = Math.max(0, (scan.line || 1) - 1);
    body = lines.slice(from, from + 250).join("\n");
    baseLine = from + 1;
  }

  const nodes = [];
  const edges = [];

  const pushNode = (partial) => {
    if (nodes.length >= MAX_NODES) {
      throw new Error(`O fluxo desta rota passa de ${MAX_NODES} passos (limite de segurança). Escolha uma rota menor ou divida o handler.`);
    }
    const id = partial.id || nextId();
    nodes.push({
      id,
      type: partial.type || "unknown",
      label: partial.label || "",
      technical: partial.technical || "",
      symbol: partial.symbol || {},
      file: partial.file ?? scan.file,
      line: partial.line ?? baseLine,
      snippet: partial.snippet || "",
      explanation: partial.explanation ?? "",
      branch: partial.branch ?? null,
      meta: partial.meta && typeof partial.meta === "object" ? partial.meta : {},
    });
    return id;
  };

  if (scan.framework === "laravel") {
    const rootDir = input.rootDir || deriveRoot(filePath, scan.file);
    const entryId = pushNode({
      type: "route_entry",
      label: `Entrada laravel: ${scan.routePath || ""}`,
      technical: scan.handlerName || "",
      line: scan.line,
      symbol: { functionName: scan.handlerName || null, className: null, variables: [], params: [], returnType: null },
    });
    const entryNode = nodes.find((n) => n.id === entryId);
    const r = buildLaravelFlow({ scan, root: rootDir, pushNode, edges, entryId, entryNode });
    return { nodes, edges, entry: entryId, handlerBody: r.handlerBody.slice(0, 8000), handler: r.handler, laravel: r.meta };
  }

  const entryId = pushNode({
    type: "route_entry",
    label: `Entrada ${scan.framework || "handler"}: ${scan.routePath || ""}`,
    technical: `${scan.match || scan.handlerExport || ""}`,
    line: scan.line,
    symbol: {
      functionName: scan.handlerName || null,
      className: null,
      variables: [],
      params: [],
      returnType: null,
    },
  });

  if (lang === "js") {
    const rootDir = input.rootDir || deriveRoot(filePath, scan.file);
    const resolver = createCalleeResolver({ filePath, content, rootDir });
    const inputs = findRequestInputs(body);
    const entry = nodes.find((n) => n.id === entryId);
    entry.meta = {
      ...entry.meta,
      inputs,
      facts: describeInputs(inputs),
      handlerName: scan.handlerName || null,
      method: scan.method || null,
      routePath: scan.routePath || null,
    };
    buildJsCfg({
      fullBody: body,
      baseLine,
      entryId,
      pushNode,
      edges,
      ctx: { resolver, deep: true },
    });
    return {
      nodes,
      edges,
      entry: entryId,
      handlerBody: body.slice(0, 8000),
    };
  }

  let prevId = entryId;
  const lines = body.split("\n");

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const classify =
      lang === "py"
        ? classifyPyLine(line)
        : lang === "go"
          ? classifyGoLine(line)
          : classifyLine(line);
    if (classify === "skip") continue;

    const lineNo = baseLine + li;
    const calls = tokenizeCalls(line);
    const sym = {
      functionName: calls[0] || null,
      className: null,
      variables: [],
      params: [],
      returnType: null,
    };

    if (classify === "if" || classify === "else_if") {
      const id = pushNode({
        type: "condition",
        label: "Decisão (condicional)",
        technical: line.trim().slice(0, 200),
        line: lineNo,
        snippet: line.trim(),
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: "segue" });
      prevId = id;
      continue;
    }
    if (classify === "else") {
      const id = pushNode({
        type: "condition",
        label: "Ramificação alternativa (else)",
        technical: line.trim(),
        line: lineNo,
        branch: "false",
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: "else" });
      prevId = id;
      continue;
    }
    if (classify === "try" || classify === "catch") {
      const id = pushNode({
        type: classify === "catch" ? "condition" : "group",
        label: classify === "catch" ? "Tratamento de erro" : "Bloco try",
        technical: line.trim().slice(0, 200),
        line: lineNo,
        branch: classify === "catch" ? "catch" : null,
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: classify });
      prevId = id;
      continue;
    }
    if (classify === "return") {
      const id = pushNode({
        type: "return",
        label: "Resposta ao cliente",
        technical: line.trim().slice(0, 200),
        line: lineNo,
        snippet: line.trim(),
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: "retorno" });
      prevId = id;
      continue;
    }
    if (classify === "throw") {
      const id = pushNode({
        type: "throw",
        label: "Erro lançado",
        technical: line.trim().slice(0, 200),
        line: lineNo,
        snippet: line.trim(),
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: "throw" });
      prevId = id;
      continue;
    }
    if (classify === "external") {
      const id = pushNode({
        type: "external_call",
        label: "Chamada externa (rede/serviço)",
        technical: line.trim().slice(0, 200),
        line: lineNo,
        snippet: line.trim(),
        symbol: sym,
      });
      edges.push({ from: prevId, to: id, label: "HTTP/IO" });
      prevId = id;
      continue;
    }

    if (calls.length > 0) {
      const id = pushNode({
        type: "function",
        label: `Chamada: ${calls[0]}`,
        technical: line.trim().slice(0, 200),
        line: lineNo,
        snippet: line.trim(),
        symbol: { ...sym, functionName: calls[0] },
      });
      edges.push({ from: prevId, to: id, label: "chama" });
      prevId = id;
    }
  }

  return {
    nodes,
    edges,
    entry: entryId,
    handlerBody: body.slice(0, 8000),
  };
}
