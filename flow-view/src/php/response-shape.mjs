/**
 * Formato de resposta do projeto: macros Response::macro, helpers e arrays aninhados.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isInside, isReadableSource } from "../security.mjs";
import { parseArrayLiteral, matchClose, splitArgs, parseChain, stringLiteral, stripParens } from "./parse.mjs";
function statusFromExpr(e, ctx) {
  const t = String(e ?? "").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const cfg = configValue(t, ctx?.project);
  if (cfg != null && /^\d+$/.test(String(cfg).trim())) return Number(String(cfg).trim());
  return null;
}

const STR_RE = /^(["'])(?:\\.|(?!\1)[^\\])*\1$/s;
function strVal(e) {
  const t = String(e ?? "").trim();
  if (!STR_RE.test(t)) return null;
  return t.slice(1, -1);
}

function configValue(e, project) {
  const m = /^config\s*\(\s*(['"])([^'"]+)\1\s*\)$/.exec(String(e ?? "").trim());
  if (!m || !project || typeof project.config !== "function") return undefined;
  const v = project.config(m[2]);
  if (v == null) return null;
  if (/^\d+$/.test(String(v))) return Number(v);
  return v;
}

/** Macros `Response::macro('name', function (...) { return response()->json(...); })`. */
export function loadResponseMacros(project) {
  const root = project.root;
  const macros = new Map();
  const dirs = ["app/Providers", "app", "bootstrap"];
  for (const rel of dirs) {
    const dir = path.join(root, rel);
    if (!existsSync(dir) || !isInside(root, dir)) continue;
    let files = [];
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of files) {
      if (!ent.isFile() || !ent.name.endsWith(".php")) continue;
      const abs = path.join(dir, ent.name);
      if (!isReadableSource(abs)) continue;
      const src = readFileSync(abs, "utf8");
      for (const m of src.matchAll(/Response::macro\s*\(\s*(['"])(\w+)\1\s*,\s*function\s*\(([^)]*)\)\s*(?::[^{]+)?\{/g)) {
        const name = m[2];
        const params = m[3].split(",").map((p) => p.trim().replace(/^\$/, "").split(/\s/)[0]).filter(Boolean);
        const start = m.index + m[0].length - 1;
        const end = matchClose(src, start);
        if (end < 0) continue;
        const body = src.slice(start + 1, end);
        const ret = /return\s+([\s\S]+?);/m.exec(body);
        macros.set(name, { name, params, body, returnExpr: ret ? ret[1].trim() : null });
      }
    }
  }
  return macros;
}

function argBindings(params, args, project, ctx) {
  const b = new Map();
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const a = args[i];
    if (!p || a == null) continue;
    b.set(p, a);
    b.set("$" + p, a);
  }
  return b;
}

function castExpr(expr) {
  const t = String(expr).trim();
  let inner = t;
  const c = /^\((int|integer|float|string|bool|boolean)\)\s*(.+)$/.exec(t);
  if (c) inner = c[2].trim();
  return inner;
}

function resolveParam(expr, bindings, project, ctx) {
  const t = castExpr(expr);
  const cfg = configValue(t, project);
  if (cfg !== undefined) return cfg;
  const lit = strVal(t);
  if (lit != null) return lit;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^(true|false|null)$/i.test(t)) return t.toLowerCase() === "null" ? null : t.toLowerCase() === "true";
  if (bindings.has(t)) return bindings.get(t);
  if (/^\$\w+$/.test(t) && bindings.has(t.slice(1))) return bindings.get(t.slice(1));
  return t;
}

/** Converte expressão PHP em árvore JSON estática (literais, config, arrays, parâmetros do macro). */
export function exprToJsonTree(expr, bindings, project, ctx, fieldPath = "", fields = []) {
  const t = String(expr ?? "").trim();
  if (!t) return { value: null, fields };

  const cfg = configValue(t, project);
  if (cfg !== undefined) {
    fields.push({ key: fieldPath || "config", source: t, value: cfg });
    return { value: cfg, fields };
  }

  const lit = strVal(t);
  if (lit != null) {
    fields.push({ key: fieldPath, source: t, value: lit });
    return { value: lit, fields };
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    fields.push({ key: fieldPath, source: t, value: n });
    return { value: n, fields };
  }
  if (/^(true|false|null)$/i.test(t)) {
    const v = /^null$/i.test(t) ? null : /^true$/i.test(t);
    fields.push({ key: fieldPath, source: t, value: v });
    return { value: v, fields };
  }

  if (/^array_merge\s*\(/.test(t)) {
    const open = t.indexOf("(");
    const close = matchClose(t, open);
    if (close > 0) {
      const parts = splitArgs(t.slice(open + 1, close));
      let merged = {};
      for (const part of parts) {
        const inner = part.replace(/^\(array\)\s*/, "").trim();
        const sub = exprToJsonTree(inner, bindings, project, ctx, fieldPath, fields);
        if (sub.value && typeof sub.value === "object" && !Array.isArray(sub.value)) {
          merged = { ...merged, ...sub.value };
        }
      }
      return { value: merged, fields };
    }
  }

  const arrStart = t.match(/^(\[|array\s*\()/);
  if (arrStart) {
    const open = t.indexOf(arrStart[1].startsWith("array") ? "(" : "[");
    const close = matchClose(t, open);
    if (close > 0) {
      const items = parseArrayLiteral(t.slice(open, close + 1));
      if (!items) return { value: null, fields };
      const allNumeric = items.every((it) => !it.key);
      if (allNumeric) {
        const arr = [];
        for (let i = 0; i < items.length; i++) {
          const sub = exprToJsonTree(items[i].value, bindings, project, ctx, `${fieldPath}[${i}]`, fields);
          arr.push(sub.value);
        }
        return { value: arr, fields };
      }
      const obj = {};
      for (const it of items) {
        if (!it.key) continue;
        const key = strVal(it.key) ?? it.key.replace(/^['"]|['"]$/g, "");
        const sub = exprToJsonTree(it.value, bindings, project, ctx, fieldPath ? `${fieldPath}.${key}` : key, fields);
        obj[key] = sub.value;
      }
      return { value: obj, fields };
    }
  }

  const resolved = resolveParam(t, bindings, project, ctx);
  if (resolved !== t) {
    const sub = exprToJsonTree(
      typeof resolved === "string" && !/^[\[{']/.test(resolved) && STR_RE.test("'" + resolved + "'") ? `'${resolved}'` : String(resolved),
      bindings,
      project,
      ctx,
      fieldPath,
      fields
    );
    if (sub.value != null && typeof sub.value !== "string") return sub;
    if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
      fields.push({ key: fieldPath, source: t, value: resolved });
      return { value: resolved, fields };
    }
  }

  if (/^\$\w+$/.test(t)) {
    const name = t.slice(1);
    if (bindings.has(name)) {
      const bound = bindings.get(name);
      const sub = exprToJsonTree(bound, new Map(), project, ctx, fieldPath, fields);
      if (sub.value != null) return sub;
    }
    fields.push({ key: fieldPath, source: t, value: null, note: "parâmetro/runtime" });
    return { value: null, fields };
  }

  fields.push({ key: fieldPath, source: t, value: null, note: "não estático" });
  return { value: null, fields };
}

/** Expande macro `success`/`error` com os argumentos da chamada. */
export function expandResponseMacro(macro, callArgs, project, ctx) {
  if (!macro?.returnExpr) return null;
  const bindings = argBindings(macro.params, callArgs, project, ctx);
  let expr = macro.returnExpr;
  const ch = parseChain(expr);
  if (ch?.calls?.[0]?.name === "json") {
    const bodyArg = ch.calls[0].args?.[0];
    if (bodyArg) {
      const fields = [];
      const tree = exprToJsonTree(bodyArg, bindings, project, ctx, "", fields);
      const statusArg = ch.calls[0].args?.[1];
      const st = statusFromExpr(statusArg, ctx) ?? statusFromExpr(bindings.get(macro.params[1]), ctx);
      return { json: tree.value, fields, status: st, source: `Response::macro('${macro.name}')` };
    }
  }
  const fields = [];
  const tree = exprToJsonTree(expr, bindings, project, ctx, "", fields);
  return { json: tree.value, fields, source: `Response::macro('${macro.name}')` };
}

function expandClassResponseHelper(expr, project, ctx) {
  const e = stripParens(String(expr).trim());
  const ch = parseChain(e);
  const call = ch?.calls?.[0];
  if (!call || !/^(success|error|fail|ok)$/i.test(call.name)) return null;
  if (ch.head.kind !== "static" && !(ch.head.kind === "var" && ch.calls.length > 1)) return null;
  const clsName = ch.head.kind === "static" ? ch.head.name : null;
  if (!clsName) return null;
  const cls = project.resolveClass(clsName, ctx?.file, ctx?.cls);
  if (!cls) return null;
  const m = project.findMethod(cls, call.name);
  if (!m || m.bodyOpen < 0) return null;
  const body = project.methodBody(m);
  const ret = /return\s+([\s\S]+?);/m.exec(body);
  if (!ret) return null;
  return jsonFromReturnExpression(ret[1], project, ctx, httpParsed);
}

/** Extrai JSON de `return response()->json([...])` ou macro do projeto. */
export function jsonFromReturnExpression(expr, project, ctx, httpParsed) {
  const fromHelper = expandClassResponseHelper(expr, project, ctx);
  if (fromHelper) return fromHelper;

  const macros = project._responseMacros || (project._responseMacros = loadResponseMacros(project));
  const e = stripParens(String(expr).trim());
  const ch = parseChain(e);
  if (!ch) return null;
  const first = ch.calls[0];

  if (first && (first.name === "success" || first.name === "error" || first.name === "fail")) {
    const macro = macros.get(first.name);
    if (macro) return expandResponseMacro(macro, first.args || [], project, ctx);
    // convenção sem macro registrada: empacota como success { message, data }
    const args = first.args || [];
    const fields = [];
    const msg = exprToJsonTree(args[0] || "", new Map(), project, ctx, "success.message", fields);
    const code = statusFromExpr(args[1], ctx) ?? (configValue(args[1], project) != null ? Number(configValue(args[1], project)) : 200);
    const data = args[2] ? exprToJsonTree(args[2], new Map(), project, ctx, "success.data", fields) : { value: {}, fields };
    const payload =
      data.value && typeof data.value === "object" && !Array.isArray(data.value)
        ? { ...data.value }
        : data.value != null
          ? { payload: data.value }
          : {};
    if (code != null && payload.resourceStatus == null) payload.resourceStatus = code;
    const inner = { message: msg.value, data: payload };
    return { json: { [first.name === "error" || first.name === "fail" ? "error" : "success"]: inner }, fields, status: code, source: `response()->${first.name}()` };
  }

  if (first && /^(json|make)$/.test(first.name) && first.args?.[0]) {
    const fields = [];
    const tree = exprToJsonTree(first.args[0], new Map(), project, ctx, "", fields);
    const st = httpParsed?.status ?? statusFromExpr(first.args[1], ctx) ?? 200;
    return { json: tree.value, fields, status: st, source: "response()->json()" };
  }

  if (httpParsed?.kind === "json" && httpParsed.body) {
    const fields = [];
    const tree = exprToJsonTree(httpParsed.body, new Map(), project, ctx, "", fields);
    if (tree.value != null) return { json: tree.value, fields, status: httpParsed.status, source: "corpo HTTP" };
  }

  return null;
}