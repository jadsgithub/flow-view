/**
 * Monta JSON de resposta a partir de API Resources (`toArray`) e expressões PHP estáticas.
 */

import { parseArrayLiteral, parseChain, matchClose, stringLiteral } from "./parse.mjs";
import { buildBodyFromRules, sampleFromFieldName } from "../samples.mjs";

const STR_RE = /^(["'])(?:\\.|(?!\1)[^\\])*\1$/s;
function strVal(e) {
  const t = String(e ?? "").trim();
  if (!STR_RE.test(t)) return null;
  return t.slice(1, -1);
}

function modelShortFromResource(name) {
  const short = String(name || "").split("\\").pop();
  return short.replace(/Resource$/, "");
}

function guessModelClass(resourceName, project, ctx) {
  const short = modelShortFromResource(resourceName);
  const tries = [
    `App\\Models\\${short}`,
    `App\\Model\\${short}`,
    short,
  ];
  for (const q of tries) {
    const cls = project.resolveClass(q, ctx && ctx.file, ctx && ctx.cls);
    if (cls) return cls;
  }
  return null;
}

function relationItemSample(relation, ctx) {
  const rules = (ctx && ctx.validatedFields) || [];
  const nested = rules
    .filter((r) => r.field && (r.field.startsWith(`${relation}.*.`) || r.field.startsWith(`${relation}.*`)))
    .map((r) => ({ ...r, field: r.field.replace(new RegExp(`^${relation}\\.\\*\\.?`), "") }))
    .filter((r) => r.field && !r.field.includes("*"));
  if (nested.length) {
    const body = buildBodyFromRules(nested);
    return Object.keys(body).length ? body : { id: 1 };
  }
  if (relation === "items") return { product_id: 1, quantity: 1 };
  return { id: 1 };
}

/** Mensagem padrão de uma exceção (corpo do `parent::__construct` no `__construct`). */
function exceptionSampleMessage(cls, project, ctx) {
  if (!cls) return "Mensagem do erro.";
  const con = project.findMethod(cls, "__construct");
  if (!con || con.bodyOpen < 0) return "Mensagem do erro.";
  const body = project.methodBody(con);
  const m = /parent::__construct\s*\(\s*(['"])([\s\S]*?)\1/.exec(body);
  if (!m) return "Mensagem do erro.";
  let msg = m[2]
    .replace(/\{\$(\w+)\}/g, (_, v) => (v === "product" ? "produto-exemplo" : v === "requested" ? "1" : "…"))
    .replace(/\$(\w+)/g, () => "…");
  return msg;
}

export function samplePhpExpr(expr, ctx, project, hintKey) {
  const t = String(expr ?? "").trim();
  if (!t) return null;

  const lit = strVal(t);
  if (lit != null) return lit;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^null$/i.test(t)) return null;

  if (/\$e->getMessage\s*\(\s*\)/.test(t) && ctx && ctx.catchException) {
    const ex = project.resolveClass(ctx.catchException, ctx.file, ctx.cls);
    return exceptionSampleMessage(ex, project, ctx);
  }

  const ch = parseChain(t);
  if (ch) {
    if (ch.head.kind === "new" && /Resource$/.test(ch.head.name.split("\\").pop())) {
      const inner = resourceDataShape(ch.head.name, project, ctx);
      return inner;
    }
    if (ch.head.kind === "var" && ch.head.name === "$this") {
      for (const c of ch.calls) {
        if (c.name === "whenLoaded" && c.args && c.args[0]) {
          const rel = strVal(c.args[0]) || stringLiteral(c.args[0]);
          if (rel) return [relationItemSample(rel, ctx)];
        }
        if (c.name === "when" && c.args && c.args[1]) return samplePhpExpr(c.args[1], ctx, project, hintKey);
        if (c.name === "mergeWhen" && c.args && c.args[1]) return samplePhpExpr(c.args[1], ctx, project, hintKey);
      }
      const prop = ch.calls.find((c) => c.prop);
      if (prop) {
        if (ch.calls.some((c) => /^(toIso8601String|toJSON|toDateTimeString|toAtomString)$/.test(c.name))) {
          return "2026-01-15T12:00:00+00:00";
        }
        if (ch.calls.some((c) => c.name === "toArray")) return [relationItemSample(prop.name, ctx)];
        if (hintKey === "status" && modelShortFromResource(ctx?.resourceClass) === "Order") return "pending";
        return sampleFromFieldName(prop.name);
      }
    }
    if (ch.head.kind === "var" && ch.head.name.startsWith("$")) {
      const prop = ch.calls.find((c) => c.prop);
      if (prop) return sampleFromFieldName(prop.name);
    }
  }

  if (hintKey) return sampleFromFieldName(hintKey);
  return "…";
}

function readToArrayEntries(resourceName, project, ctx) {
  const cls = project.resolveClass(resourceName, ctx && ctx.file, ctx && ctx.cls);
  if (!cls) return null;
  const m = project.findMethod(cls, "toArray");
  if (!m || m.bodyOpen < 0) return null;
  const body = project.methodBody(m);
  const r = /return\s*(?:\[|array\s*\()/.exec(body);
  if (!r) return null;
  const open = body.indexOf(r[0].endsWith("(") ? "(" : "[", r.index);
  const close = matchClose(body, open);
  if (close < 0) return null;
  return parseArrayLiteral(body.slice(open, close + 1));
}

export function resourceDataShape(resourceName, project, ctx) {
  const entries = readToArrayEntries(resourceName, project, ctx);
  if (!entries) return null;
  const out = {};
  const shapeCtx = { ...(ctx || {}), resourceClass: resourceName };
  for (const it of entries) {
    if (!it.key) continue;
    const key = strVal(it.key) ?? it.key;
    out[key] = samplePhpExpr(it.value, shapeCtx, project, key);
  }
  return Object.keys(out).length ? out : null;
}

/** Detecta coleção, `->response()` e paginação a partir da expressão de retorno. */
export function resourceResponseEnvelope(expr) {
  const t = String(expr || "");
  const collection = /::collection\s*\(/.test(t);
  const explicitResponse = /->response\s*\(\s*\)/.test(t);
  const paginated = /\.paginate\s*\(/.test(t) || collection;
  return { collection, explicitResponse, paginated, wrap: explicitResponse || collection || /new\s+\w+Resource\b/.test(t) };
}

export function buildLaravelResourceJson(expr, resourceName, project, ctx) {
  const shape = resourceDataShape(resourceName, project, ctx);
  if (!shape) return null;
  const env = resourceResponseEnvelope(expr);
  if (env.collection) {
    const out = { data: [shape] };
    if (env.paginated) {
      out.links = {
        first: "http://localhost/api/orders?page=1",
        last: "http://localhost/api/orders?page=1",
        prev: null,
        next: null,
      };
      out.meta = { current_page: 1, from: 1, last_page: 1, per_page: 15, to: 1, total: 1 };
    }
    return out;
  }
  if (env.wrap) return { data: shape };
  return shape;
}

export function buildJsonBodySample(keys, ctx, project) {
  if (!keys || !keys.length) return null;
  const out = {};
  for (const f of keys) {
    if (!f.k) continue;
    out[f.k] = samplePhpExpr(f.v, ctx, project, f.k);
  }
  return Object.keys(out).length ? out : null;
}