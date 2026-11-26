/**
 * Exemplos de request/response JSON e comando cURL derivados estaticamente do IR.
 */

import { requestBodyFromValidationRules } from "./php/static-json.mjs";

const PLACEHOLDER = {
  id: 1,
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  email: "usuario@exemplo.com",
  token: "<seu-token>",
};

function wordsText(rule) {
  return (rule.words || []).join(" ").toLowerCase();
}

/** Valor de exemplo para um campo a partir das regras de validação Laravel. */
export function sampleValueForRule(rule) {
  const field = String(rule.field || "").toLowerCase();
  const w = wordsText(rule);
  if (/\barray\b/.test(w) || field.endsWith("[]")) return [];
  if (/\binteger\b|\bnumeric\b|\bdecimal\b|\bdigits\b|inteiro|número/.test(w) || /_id$/.test(field) || field === "id") return 1;
  if (/\bboolean\b|\bbool\b/.test(w) || /^(is_|has_)/.test(field)) return true;
  if (/\bemail\b/.test(w) || field.includes("email")) return PLACEHOLDER.email;
  if (/\buuid\b/.test(w)) return PLACEHOLDER.uuid;
  if (/\bpassword\b/.test(w)) return "SenhaForte123!";
  if (/\bdate\b/.test(w) || field.includes("_at")) return "2026-01-15T12:00:00+00:00";
  if (/\burl\b/.test(w)) return "https://exemplo.com";
  if (/\bjson\b/.test(w)) return {};
  if (field.includes("name") || field.includes("nome")) return "Exemplo";
  if (field.includes("phone") || field.includes("telefone")) return "+5511999999999";
  if (field.includes("cpf")) return "12345678901";
  if (field.includes("cnpj")) return "12345678000199";
  if (field.includes("quantity") || field.includes("quantidade")) return 1;
  if (field.includes("price") || field.includes("total") || field.includes("amount")) return 99.9;
  return "exemplo";
}

function setDeep(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLast = i === parts.length - 1;
    const next = parts[i + 1];
    if (p === "*") {
      if (!Array.isArray(cur)) return;
      if (!cur.length) cur.push(isLast ? value : {});
      if (isLast) {
        cur[0] = value;
        return;
      }
      if (typeof cur[0] !== "object" || cur[0] === null) cur[0] = {};
      cur = cur[0];
      continue;
    }
    if (isLast) {
      cur[p] = value;
      return;
    }
    if (cur[p] == null) cur[p] = next === "*" ? [] : {};
    cur = cur[p];
  }
}

/** Monta corpo JSON a partir de regras de validação (`[{ field, words, required }]`). */
export function buildBodyFromRules(rules) {
  const body = {};
  const seen = new Set();
  const list = rules || [];
  for (const r of list) {
    if (!r.field || !String(r.field).includes("*")) continue;
    seen.add(r.field);
    setDeep(body, r.field, sampleValueForRule(r));
  }
  for (const r of list) {
    if (!r.field || seen.has(r.field)) continue;
    seen.add(r.field);
    const w = wordsText(r);
    if (/\barray\b/.test(w) && body[r.field] != null) continue;
    let val = sampleValueForRule(r);
    if (/\barray\b/.test(w) && !String(r.field).includes("*")) val = [{}];
    body[r.field] = val;
  }
  return body;
}

function sampleForInput(name, where) {
  const n = String(name || "").toLowerCase();
  if (where === "params") {
    if (/id|uuid/.test(n)) return 1;
    return "exemplo";
  }
  if (where === "query") return n.includes("page") ? 1 : "exemplo";
  if (where === "headers") return n.toLowerCase() === "authorization" ? "Bearer <token>" : "exemplo";
  if (/_id$/.test(n) || n === "id") return 1;
  return sampleValueForRule({ field: n, words: [] });
}

/** Corpo + query/params a partir de `meta.inputs`. */
export function buildRequestParts(inputs, rules) {
  const body = buildBodyFromRules(rules);
  const query = {};
  const pathParams = {};
  for (const i of inputs || []) {
    if (i.where === "params") pathParams[i.name] = sampleForInput(i.name, "params");
    else if (i.where === "query") query[i.name] = sampleForInput(i.name, "query");
    else if (i.where === "input" || i.where === "body") {
      if (body[i.name] === undefined) body[i.name] = sampleForInput(i.name, i.where);
    }
  }
  return { body, query, pathParams };
}

function hasBody(method) {
  return !/^(GET|HEAD|DELETE)$/i.test(method);
}

function needsAuth(middleware) {
  const mw = (middleware || []).map((m) => String(m).toLowerCase());
  return mw.some((m) => /^auth(?::|$)/.test(m) || m.includes("sanctum") || m.includes("passport") || m.includes("jwt"));
}

function applyPathParams(path, pathParams) {
  let p = path;
  for (const [k, v] of Object.entries(pathParams)) {
    p = p.replace(new RegExp(`\\{${k}\\??\\}`, "g"), encodeURIComponent(String(v)));
  }
  return p.replace(/\{[^}]+\}/g, "1");
}

function shellEscape(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Gera linha de comando cURL (multi-linha com `\`). */
export function buildCurl({ method, path, baseUrl = "http://localhost", inputs, rules, middleware, isApi }) {
  const m = String(method || "GET").toUpperCase();
  const fromRules = rules && rules.length ? requestBodyFromValidationRules(rules).body : null;
  const { query, pathParams } = buildRequestParts(inputs, []);
  const body = fromRules && Object.keys(fromRules).length ? fromRules : buildRequestParts(inputs, rules).body;
  let urlPath = applyPathParams(path, pathParams);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
  const q = qs.toString();
  if (q) urlPath += (urlPath.includes("?") ? "&" : "?") + q;
  const url = baseUrl.replace(/\/$/, "") + (urlPath.startsWith("/") ? urlPath : `/${urlPath}`);

  const lines = [`curl -X ${m} ${shellEscape(url)}`];
  if (needsAuth(middleware)) lines.push(`  -H ${shellEscape("Authorization: Bearer <token>")}`);
  const jsonBody = hasBody(m) && Object.keys(body).length > 0;
  if (jsonBody || isApi) lines.push(`  -H ${shellEscape("Accept: application/json")}`);
  if (jsonBody) {
    lines.push(`  -H ${shellEscape("Content-Type: application/json")}`);
    const data = JSON.stringify(body, null, 2);
    lines.push(`  -d ${shellEscape(data)}`);
  }
  return lines.join(" \\\n");
}

const STR_RE = /^(["'])(?:\\.|(?!\1)[^\\])*\1$/s;
function strVal(e) {
  const t = String(e ?? "").trim();
  if (!STR_RE.test(t)) return null;
  return t.slice(1, -1);
}

/** Tenta converter uma expressão PHP/JS estática em valor JSON. */
export function exprToJsonValue(expr) {
  const t = String(expr ?? "").trim();
  const s = strVal(t);
  if (s != null) return s;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if (/^null$/i.test(t)) return null;
  const arrM = t.match(/^\[([\s\S]*)\]$/);
  if (arrM) {
    const inner = arrM[1].trim();
    if (!inner) return [];
    return inner.split(",").map((p) => exprToJsonValue(p.trim()));
  }
  const objM = t.match(/^\{([\s\S]*)\}$/);
  if (objM) {
    const out = {};
    for (const part of objM[1].split(",")) {
      const kv = part.match(/^(['"]?)([\w$.-]+)\1\s*=>\s*([\s\S]+)$/);
      if (kv) out[kv[2]] = exprToJsonValue(kv[3].trim());
    }
    return out;
  }
  return null;
}

export function sampleFromFieldName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "id") return 1;
  if (n.includes("status")) return "ok";
  if (n.includes("email")) return PLACEHOLDER.email;
  if (n.includes("total") || n.includes("amount") || n.includes("price")) return 99.9;
  if (n.includes("_at") || n.includes("date")) return "2026-01-15T12:00:00+00:00";
  if (n.startsWith("is_") || n.startsWith("has_")) return true;
  return "exemplo";
}

function laravelValidation422(rules) {
  const fields = [...new Set((rules || []).map((r) => r.field && r.field.split(".")[0]).filter(Boolean))];
  const errors = {};
  for (const f of fields.slice(0, 24)) errors[f] = ["O campo é inválido."];
  return {
    message: "The given data was invalid.",
    errors: Object.keys(errors).length ? errors : { campo: ["O campo é inválido."] },
  };
}

/**
 * Monta JSON de resposta a partir do que o analisador já extraiu.
 * @param {{ status?: number|null, kind?: string, keys?: {k:string,v:string}[], jsonBody?: object, resourceBody?: object, resourceFields?: string[], validationFields?: object[], message?: string }} opts
 */
export function buildResponseSample(opts) {
  const st = opts.status;
  if (st == null) return null;
  const kind = opts.kind || "json";

  if (kind === "empty" || st === 204) return null;

  if (kind === "redirect" || kind === "view" || kind === "file") {
    return { _nota: kind === "redirect" ? "Redirecionamento HTTP (sem corpo JSON)" : "Resposta não-JSON" };
  }

  if (opts.resourceBody && typeof opts.resourceBody === "object") return opts.resourceBody;

  let data = opts.jsonBody && typeof opts.jsonBody === "object" ? { ...opts.jsonBody } : null;
  const keys = opts.keys || [];
  if (!data && keys.length && keys.every((x) => x.k)) {
    data = {};
    for (const f of keys) {
      const v = exprToJsonValue(f.v);
      data[f.k] = v != null ? v : sampleFromFieldName(f.k);
    }
  } else if (!data && opts.resourceFields && opts.resourceFields.length) {
    data = {};
    for (const f of opts.resourceFields) data[f] = sampleFromFieldName(f);
  }

  if (data && Object.keys(data).length) {
    if (st === 422 && !data.errors && Object.keys(data).length === 1 && data.message) return data;
    if (!(st === 422 && data.errors)) return data;
  }

  if (st === 422) return laravelValidation422(opts.validationFields);

  if (st === 401) return { message: opts.message || "Unauthenticated." };
  if (st === 403) return { message: opts.message || "This action is unauthorized." };
  if (st === 404) return { message: opts.message || "Not found." };
  if (st >= 400) return { message: opts.message || "Erro na requisição." };

  return null;
}

function requestSampleNonEmpty(parts) {
  const hasBody = Object.keys(parts.body).length > 0;
  const hasQuery = Object.keys(parts.query).length > 0;
  const hasParams = Object.keys(parts.pathParams).length > 0;
  if (!hasBody && !hasQuery && !hasParams) return null;
  return {
    ...(hasParams ? { path: parts.pathParams } : {}),
    ...(hasQuery ? { query: parts.query } : {}),
    ...(hasBody ? { body: parts.body } : {}),
  };
}

/**
 * Completa o IR com requestSample nos cards relevantes, responseSample onde faltar e meta.curl.
 * @param {object} flow
 * @param {{ trace?: { laravel?: { middleware?: string[], isApi?: boolean } } }} [ctx]
 */
export function enrichHttpSamples(flow, ctx = {}) {
  const route = flow.meta?.route || {};
  const method = route.method || "GET";
  const path = route.path || "/";
  const laravel = ctx.trace?.laravel || flow.meta.entry?.route || {};
  const middleware = laravel.middleware || [];

  const allRules = [];
  for (const n of flow.nodes || []) {
    if (n.meta?.validationRules?.length) allRules.push(...n.meta.validationRules);
  }

  const entry = flow.nodes.find((n) => n.id === flow.entry);
  const inputs = entry?.meta?.inputs || flow.meta.inputs || [];

  const builtReq = allRules.length ? requestBodyFromValidationRules(allRules) : null;
  const parts = builtReq ? { body: builtReq.body, query: {}, pathParams: buildRequestParts(inputs, []).pathParams } : buildRequestParts(inputs, allRules);
  const entryReq = requestSampleNonEmpty(parts);
  if (entry && entryReq) {
    entry.meta = {
      ...entry.meta,
      requestSample: { body: parts.body, ...(Object.keys(parts.query).length ? { query: parts.query } : {}), ...(Object.keys(parts.pathParams).length ? { path: parts.pathParams } : {}) },
      ...(builtReq ? { requestFields: builtReq.fields } : {}),
    };
  }

  for (const n of flow.nodes || []) {
    if (n.type === "validation" && n.meta?.validationRules?.length) {
      const vr = requestBodyFromValidationRules(n.meta.validationRules);
      n.meta = {
        ...n.meta,
        requestSample: { body: vr.body },
        requestFields: vr.fields,
      };
    }
    if (n.type === "return" && !n.meta?.responseSample && n.meta?.outcome?.status != null) {
      const st = n.meta.outcome.status;
      const sample =
        st === 422
          ? laravelValidation422(allRules)
          : buildResponseSample({
              status: st,
              kind: "json",
              validationFields: allRules,
              message: typeof n.meta.outcome.detail === "string" && !/^\{/.test(n.meta.outcome.detail) ? n.meta.outcome.detail : undefined,
            });
      if (sample) n.meta = { ...n.meta, responseSample: sample };
    }
  }

  flow.meta.curl = buildCurl({
    method,
    path,
    inputs,
    rules: allRules,
    middleware,
    isApi: laravel.isApi,
  });
}