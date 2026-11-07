/**
 * Resolve chamadas de função/método para sua definição (mesmo arquivo ou imports relativos)
 * e produz um resumo narrativo "por dentro" da função chamada.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { isInside, isReadableSource } from "./security.mjs";
import path from "node:path";
import {
  stripJsComments,
  ws,
  matchClose,
  readStatementEnd,
  lineNoAt,
  splitArgs,
} from "./jsparse.mjs";
import { parseStatements } from "./jsast.mjs";
import { describeStatement, describeCondition, code, trunc } from "./narrate.mjs";

const EXTS = ["", ".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx"];
const IGNORED_FIELDS = new Set(["length", "push", "map", "filter", "forEach", "reduce", "includes", "then", "catch", "toString", "trim"]);

function parseParams(str) {
  return splitArgs(str)
    .map((p) => p.replace(/^\.\.\./, "").split(":")[0].split("=")[0].trim())
    .filter(Boolean);
}

/** Pula o separador capturado pela regex (espaço, `;` ou `}`) até o início real da declaração. */
function defStart(src, idx) {
  let i = ws(src, idx);
  if ((src[i] === ";" || src[i] === "}") && /\s|;|}/.test(src[idx] || "")) {
    i = ws(src, i + 1);
  }
  return i;
}

function resolveFile(fromAbs, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromAbs), spec);
  for (const ext of EXTS) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  for (const ext of EXTS.slice(1)) {
    const f = path.join(base, "index" + ext);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Descobre funções e métodos de classe em um arquivo. */
function indexFile(abs, content) {
  const src = stripJsComments(content);
  const defs = [];

  const addDef = (name, className, paramsStr, bodyOpen, extra = {}) => {
    const close = matchClose(src, bodyOpen);
    defs.push({
      name,
      className,
      params: parseParams(paramsStr),
      bodyOpen,
      bodyClose: close < 0 ? src.length : close,
      idx: extra.idx ?? bodyOpen,
    });
  };

  const afterParams = (open) => {
    const close = matchClose(src, open);
    if (close < 0) return null;
    let k = ws(src, close + 1);
    // anotação de retorno TS
    if (src[k] === ":") {
      while (k < src.length && src[k] !== "{" && !(src[k] === "=" && src[k + 1] === ">")) k++;
    }
    return { close, k };
  };

  // function nome(...) {
  for (const m of src.matchAll(/(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const ap = afterParams(open);
    if (ap && src[ap.k] === "{") addDef(m[1], null, src.slice(open + 1, ap.close), ap.k, { idx: m.index });
  }

  // const nome = (...) => { } | async (...) => | function (...) { }
  for (const m of src.matchAll(/(?:^|[\s;}])(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?/g)) {
    let k = m.index + m[0].length;
    const name = m[1];
    if (src.startsWith("function", k)) {
      const open = src.indexOf("(", k);
      const ap = open >= 0 ? afterParams(open) : null;
      if (ap && src[ap.k] === "{") addDef(name, null, src.slice(open + 1, ap.close), ap.k, { idx: m.index });
      continue;
    }
    if (src[k] === "(") {
      const ap = afterParams(k);
      if (ap && src[ap.k] === "=" && src[ap.k + 1] === ">") {
        const b = ws(src, ap.k + 2);
        if (src[b] === "{") addDef(name, null, src.slice(k + 1, ap.close), b, { idx: m.index });
        else {
          const e = readStatementEnd(src, b);
          defs.push({
            name,
            className: null,
            params: parseParams(src.slice(k + 1, ap.close)),
            bodyOpen: b - 1,
            bodyClose: e,
            exprBody: src.slice(b, e).trim(),
            idx: m.index,
          });
        }
      }
      continue;
    }
    const idArrow = src.slice(k).match(/^([\w$]+)\s*=>\s*/);
    if (idArrow) {
      const b = k + idArrow[0].length;
      if (src[b] === "{") addDef(name, null, idArrow[1], b, { idx: m.index });
    }
  }

  // classes e métodos
  for (const m of src.matchAll(/(?:^|[\s;}])class\s+([\w$]+)[^{]*\{/g)) {
    const classOpen = m.index + m[0].length - 1;
    const classClose = matchClose(src, classOpen);
    if (classClose < 0) continue;
    const className = m[1];
    let i = classOpen + 1;
    let guard = 0;
    while (i < classClose && guard++ < 5000) {
      i = ws(src, i);
      if (i >= classClose) break;
      const mm = src.slice(i).match(/^((?:(?:public|private|protected|static|async|readonly|override|get|set)\s+)*)(\*?\s*[#\w$]+)\s*(?=[(<])/);
      if (mm) {
        let p = i + mm[0].length;
        if (src[p] === "<") {
          const gc = matchClose(src.replace(/</g, "(").replace(/>/g, ")"), p);
          p = gc > 0 ? gc + 1 : p + 1;
        }
        if (src[p] === "(") {
          const ap = afterParams(p);
          if (ap && src[ap.k] === "{") {
            const nm = mm[2].replace(/^\*\s*/, "").replace(/^#/, "");
            addDef(nm, className, src.slice(p + 1, ap.close), ap.k, { idx: i });
            i = matchClose(src, ap.k) + 1;
            continue;
          }
          i = ap ? ap.close + 1 : p + 1;
          continue;
        }
      }
      i = readStatementEnd(src, i);
      if (src[i] === ";") i++;
      else if (i < classClose && /\S/.test(src[i] || "")) i++;
    }
  }

  // imports
  const imports = new Map(); // local → { abs, imported }
  const addImport = (local, spec, imported) => {
    const target = resolveFile(abs, spec);
    if (target) imports.set(local, { abs: target, imported });
  };
  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) addImport(m[1], m[3], "default");
    if (m[2]) {
      for (const part of m[2].split(",")) {
        const [imp, loc] = part.trim().split(/\s+as\s+/);
        if (imp) addImport((loc || imp).trim(), m[3], imp.trim());
      }
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g)) {
    for (const part of m[1].split(",")) {
      const [imp, loc] = part.trim().split(":");
      if (imp) addImport((loc || imp).trim(), m[2], imp.trim());
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g)) {
    addImport(m[1], m[2], "default");
  }

  return { abs, src, defs, imports };
}

export function createCalleeResolver({ filePath, content, rootDir, maxDepth = 2 }) {
  const files = new Map();
  const root = rootDir || path.dirname(filePath);

  const load = (abs, text) => {
    if (files.has(abs)) return files.get(abs);
    let c = text;
    if (c == null) {
      // Nunca sai da raiz do projeto (../ ou symlink) nem lê arquivos gigantes.
      if (!isInside(root, abs) || !isReadableSource(abs)) return null;
      try {
        c = readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    }
    const idx = indexFile(abs, c);
    files.set(abs, idx);
    return idx;
  };
  const main = load(filePath, content);
  const stack = [];
  const cache = new Map();

  const rel = (abs) => path.relative(root, abs) || path.basename(abs);

  function findDef(file, name, className) {
    const cands = file.defs.filter((d) => d.name === name);
    if (className) {
      const hit = cands.find((d) => d.className === className);
      if (hit) return hit;
    }
    return cands.find((d) => !d.className) || cands[0] || null;
  }

  function lookup(name, recv, from) {
    const main = from; // arquivo onde a chamada acontece
    // 1) função local
    if (recv === "this") {
      const d = main.defs.find((x) => x.className && x.name === name);
      if (d) return { file: main, def: d };
    }
    if (!recv || recv === "this") {
      const d = findDef(main, name);
      if (d) return { file: main, def: d };
      const imp = main.imports.get(name);
      if (imp) {
        const f = load(imp.abs);
        const dd = f && findDef(f, imp.imported === "default" ? name : imp.imported);
        if (dd) return { file: f, def: dd };
      }
      return null;
    }
    const root0 = recv.split(".")[0];
    // 2) instância de classe local: const x = new Cls()
    const nm = main.src.match(new RegExp(`(?:const|let|var)\\s+${root0.replace(/\$/g, "\\$")}\\s*=\\s*(?:await\\s+)?new\\s+([\\w$]+)`));
    const clsName = nm ? nm[1] : null;
    if (clsName) {
      const d = main.defs.find((x) => x.className === clsName && x.name === name);
      if (d) return { file: main, def: d };
      const imp = main.imports.get(clsName);
      if (imp) {
        const f = load(imp.abs);
        const dd = f && f.defs.find((x) => x.className === clsName && x.name === name);
        if (dd) return { file: f, def: dd };
      }
    }
    // 3) objeto/classe importados
    const imp = main.imports.get(root0);
    if (imp) {
      const f = load(imp.abs);
      const dd = f && findDef(f, name);
      if (dd) return { file: f, def: dd };
    }
    // 4) classe ou objeto com esse método no próprio arquivo
    const own = main.defs.find((x) => x.className && x.name === name && (x.className === root0 || !clsName));
    if (own) return { file: main, def: own };
    return null;
  }

  function usesFields(def, src) {
    const body = def.exprBody ?? src.slice(def.bodyOpen + 1, def.bodyClose);
    const out = [];
    for (const p of def.params) {
      if (!/^[\w$]+$/.test(p)) continue;
      const set = new Set();
      for (const m of body.matchAll(new RegExp(`(?<![\\w$.])${p.replace(/\$/g, "\\$")}\\??\\.([\\w$]+)`, "g"))) {
        if (!IGNORED_FIELDS.has(m[1])) set.add(m[1]);
      }
      for (const m of body.matchAll(new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${p.replace(/\$/g, "\\$")}\\b`, "g"))) {
        m[1].split(",").forEach((x) => {
          const n = x.split(":")[0].split("=")[0].trim();
          if (n) set.add(n);
        });
      }
      if (set.size) out.push({ param: p, fields: [...set].slice(0, 12) });
    }
    return out;
  }

  function summarize(file, def) {
    const items = [];
    const src = file.src;
    const lineOf = (i) => lineNoAt(src, i);
    const ctx = { resolver: apiFor(file), deep: true };

    if (def.exprBody) {
      const d = describeStatement("return " + def.exprBody, ctx);
      items.push({ text: d.short || d.story, line: lineOf(def.bodyOpen + 1), depth: 0, tone: d.tone, file: rel(file.abs) });
      return items;
    }
    const stmts = parseStatements(src, def.bodyOpen + 1);
    walk(stmts, 0, items, ctx, file, lineOf);
    for (const it of items) if (!it.file) it.file = rel(file.abs);
    return items;
  }

  const LIMIT = 40;

  function walk(stmts, depth, out, ctx, file, lineOf) {
    for (const s of stmts) {
      if (out.length >= LIMIT) return;
      switch (s.kind) {
        case "simple": {
          const d = describeStatement(s.text, ctx);
          out.push({ text: d.short || d.story, line: lineOf(s.idx), depth, tone: d.tone, kind: d.nodeType });
          if (d.callee && d.callee.summary && d.callee.summary.length) {
            out.push({
              text: `Dentro de ${code(d.callee.name)} (${code(`${d.callee.file}:${d.callee.line}`)}):`,
              line: d.callee.line,
              file: d.callee.file,
              depth: depth + 1,
              kind: "enter",
            });
            for (const it of d.callee.summary) {
              if (out.length >= LIMIT) return;
              out.push({ ...it, depth: it.depth + depth + 2 });
            }
          }
          break;
        }
        case "if": {
          const c = describeCondition(s.cond);
          out.push({ text: `Se ${c.pos}:`, line: lineOf(s.idx), depth, kind: "if" });
          walk(s.then, depth + 1, out, ctx, file, lineOf);
          if (s.else && s.else.length) {
            out.push({ text: `Caso contrário (${c.neg}):`, line: lineOf(s.idx), depth, kind: "else" });
            walk(s.else, depth + 1, out, ctx, file, lineOf);
          }
          break;
        }
        case "loop":
          out.push({ text: `Repete para ${code(trunc(s.head, 50))}:`, line: lineOf(s.idx), depth, kind: "loop" });
          walk(s.body, depth + 1, out, ctx, file, lineOf);
          break;
        case "try":
          out.push({ text: "Tenta executar (protegido por tratamento de erro):", line: lineOf(s.idx), depth, kind: "try" });
          walk(s.body, depth + 1, out, ctx, file, lineOf);
          if (s.catch) {
            out.push({ text: "Se der erro:", line: lineOf(s.catch.idx), depth, kind: "catch" });
            walk(s.catch.body, depth + 1, out, ctx, file, lineOf);
          }
          break;
        case "switch":
          out.push({ text: `Conforme o valor de ${code(trunc(s.disc, 40))}:`, line: lineOf(s.idx), depth, kind: "switch" });
          for (const c of s.cases) {
            out.push({ text: c.test ? `Se for ${code(trunc(c.test, 40))}:` : "Em qualquer outro caso:", line: lineOf(c.idx), depth: depth + 1, kind: "case" });
            walk(c.body, depth + 2, out, ctx, file, lineOf);
          }
          break;
        case "block":
          walk(s.body, depth, out, ctx, file, lineOf);
          break;
        default:
          break;
      }
    }
  }

  const apiFor = (from) => ({
    /**
     * @returns {{name:string,file:string,line:number,className:string|null,params:string[],usesFields:object[],summary:object[]}|null}
     */
    resolve(name, recv) {
      const hit = lookup(name, recv || "", from);
      if (!hit) return null;
      const { file, def } = hit;
      const key = `${file.abs}#${def.className || ""}.${def.name}@${def.bodyOpen}`;
      if (cache.has(key)) return cache.get(key);
      const info = {
        name: def.name,
        file: rel(file.abs),
        line: lineNoAt(file.src, defStart(file.src, def.idx)),
        className: def.className,
        params: def.params,
        usesFields: usesFields(def, file.src),
        summary: [],
      };
      if (stack.includes(key) || stack.length >= maxDepth) return info;
      stack.push(key);
      try {
        info.summary = summarize(file, def);
      } finally {
        stack.pop();
      }
      cache.set(key, info);
      return info;
    },
  });
  return apiFor(main);
}
