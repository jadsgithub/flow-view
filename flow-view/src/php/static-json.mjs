/**
 * JSON de request/response derivado só do código (rules, literais, toArray, create/update).
 */

import { parseArrayLiteral, parseChain, matchClose, stringLiteral, splitArgs } from "./parse.mjs";
const STR_RE = /^(["'])(?:\\.|(?!\1)[^\\])*\1$/s;
function strVal(e) {
  const t = String(e ?? "").trim();
  if (!STR_RE.test(t)) return null;
  return t.slice(1, -1);
}

function ruleHas(tokens, name) {
  return (tokens || []).some((x) => typeof x === "string" && new RegExp(`^${name}(?::|$)`).test(x.trim()));
}

/** Valor JSON permitido só quando a regra de validação fixa o tipo/restrição. */
export function valueFromValidationRule(rule) {
  const tokens = rule.tokens || [];
  if (ruleHas(tokens, "nullable") && !ruleHas(tokens, "required")) return null;
  if (ruleHas(tokens, "boolean")) return true;
  if (ruleHas(tokens, "integer") || ruleHas(tokens, "numeric")) {
    const exists = tokens.find((t) => /^exists:/.test(t));
    if (exists) return 1;
    const min = tokens.find((t) => /^min:/.test(t));
    if (min) return Number(min.split(":")[1]) || 1;
    return 1;
  }
  if (ruleHas(tokens, "array")) return undefined; // preenchido pelos filhos items.*
  if (ruleHas(tokens, "email")) return "user@example.com";
  if (ruleHas(tokens, "uuid")) return "00000000-0000-0000-0000-000000000001";
  if (ruleHas(tokens, "date")) return "2026-01-01";
  if (ruleHas(tokens, "string")) {
    const max = tokens.find((t) => /^max:/.test(t));
    if (max) {
      const n = Math.min(Number(max.split(":")[1]) || 1, 32);
      return "x".repeat(Math.max(1, n));
    }
    return "";
  }
  return null;
}

/** Corpo JSON da requisição: só campos e tipos de `rules()`. */
export function requestBodyFromValidationRules(rules) {
  const list = rules || [];
  const body = {};
  const fields = [];
  for (const r of list) {
    if (!r.field) continue;
    const tokens = r.tokens || [];
    const type = r.type || (ruleHas(tokens, "array") ? "array" : ruleHas(tokens, "integer") ? "integer" : "string");
    fields.push({
      field: r.field,
      type,
      required: Boolean(r.required),
      rules: tokens,
      source: "FormRequest::rules()",
    });
    if (String(r.field).includes("*")) continue;
    if (ruleHas(tokens, "array")) {
      const prefix = `${r.field}.*.`;
      const nested = list.filter((x) => x.field.startsWith(prefix));
      const item = {};
      for (const nr of nested) {
        const subKey = nr.field.slice(prefix.length);
        item[subKey] = valueFromValidationRule(nr);
      }
      body[r.field] = Object.keys(item).length ? [item] : [];
    } else {
      const val = valueFromValidationRule(r);
      if (val !== undefined) body[r.field] = val;
    }
  }
  return { body, fields };
}

/** Último literal estático de um atributo em um método (ex.: `'status' => 'paid'`). */
export function lastStringLiteralForAttr(methodBody, attr) {
  const re = new RegExp(`['"]${attr}['"]\\s*=>\\s*['"]([^'"]+)['"]`, "g");
  let last = null;
  let m;
  while ((m = re.exec(methodBody))) last = m[1];
  return last;
}

/** Chaves do array passado a `->relation()->create([...])` no corpo do método. */
export function relationCreateKeys(project, cls, methodName, relation) {
  const m = project.findMethod(cls, methodName);
  if (!m || m.bodyOpen < 0) return [];
  const body = project.methodBody(m);
  const re = new RegExp(`->${relation}\\(\\)\\s*->\\s*create\\s*\\(\\s*(\\[|array\\s*\\()`, "g");
  let mch;
  const keys = new Set();
  while ((mch = re.exec(body))) {
    const open = body.indexOf(mch[1].startsWith("array") ? "(" : "[", mch.index);
    const close = matchClose(body, open);
    if (close < 0) continue;
    const arr = parseArrayLiteral(body.slice(open, close + 1));
    if (!arr) continue;
    for (const it of arr) {
      if (it.key) keys.add(strVal(it.key) ?? it.key);
    }
  }
  return [...keys];
}

function promotedPropertyType(project, cls, propName) {
  const con = project.findMethod(cls, "__construct");
  if (!con) return null;
  for (const p of con.params || []) {
    const bare = p.name.replace(/^\$/, "");
    if (bare === propName && p.type) return project.qualify(p.type, cls.file);
  }
  const bodyCon = project.methodBody(con);
  const tm = bodyCon.match(new RegExp(`(?:private|protected|public)\\s+readonly\\s+([\\w\\\\]+)\\s+\\$${propName}`));
  return tm ? project.qualify(tm[1], cls.file) : null;
}

/** Resolve `$var = $this->service->method(` no handler e devolve classes/método do serviço. */
export function handlerServiceCall(project, handlerMethod, varName) {
  const body = project.methodBody(handlerMethod);
  const re = new RegExp(`\\$${varName}\\s*=\\s*\\$this->(\\w+)->(\\w+)\\s*\\(`);
  const m = re.exec(body);
  if (!m) return null;
  const prop = m[1];
  const callee = m[2];
  const svcType = promotedPropertyType(project, handlerMethod.cls, prop);
  if (!svcType) return null;
  const svc = project.resolveClass(svcType, handlerMethod.cls.file, handlerMethod.cls);
  if (!svc) return null;
  const serviceMethod = project.findMethod(svc, callee);
  if (!serviceMethod || serviceMethod.bodyOpen < 0) return null;
  return { serviceClass: svc, methodName: callee, serviceMethod, varName };
}

function modelFromResource(resourceName) {
  return String(resourceName).split("\\").pop().replace(/Resource$/, "");
}

function numericLiteral(expr) {
  const t = String(expr).trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/** Monta valor estático para expressão do `toArray()` do Resource. */
export function staticResourceValue(expr, key, resourceName, project, ctx) {
  const t = String(expr ?? "").trim();
  const lit = strVal(t);
  if (lit != null) return { value: lit, source: t };
  const num = numericLiteral(t);
  if (num != null) return { value: num, source: t };

  if (/\$e->getMessage\s*\(\s*\)/.test(t) && ctx?.catchException) {
    const ex = project.resolveClass(ctx.catchException, ctx.file, ctx.cls);
    const con = ex && project.findMethod(ex, "__construct");
    if (con) {
      const body = project.methodBody(con);
      const tmpl = /parent::__construct\s*\(\s*(['"])([\s\S]*?)\1/.exec(body);
      if (tmpl) {
        const msg = tmpl[2]
          .replace(/\{\$(\w+)\}/g, (_, v) => (v === "product" ? "<produto>" : v === "requested" ? "<qtd>" : "…"))
          .replace(/\$(\w+)/g, "…");
        return { value: msg, source: "$e->getMessage() → " + ex.name.split("\\").pop() };
      }
    }
    return { value: null, source: t, note: "mensagem da exceção em tempo de execução" };
  }

  const ch = parseChain(t);
  if (ch?.head.kind === "var" && ch.head.name === "$this") {
    const wl = ch.calls.find((c) => c.name === "whenLoaded");
    if (wl && wl.args?.[0]) {
      const rel = strVal(wl.args[0]) ?? stringLiteral(wl.args[0]);
      const model = modelFromResource(resourceName);
      const trace = ctx?.handlerMethod && ctx?.orderVar
        ? handlerServiceCall(project, ctx.handlerMethod, ctx.orderVar)
        : ctx?.handlerMethod
          ? handlerServiceCall(project, ctx.handlerMethod, "order")
          : null;
      const keys =
        trace && rel
          ? relationCreateKeys(project, trace.serviceClass, trace.methodName, rel)
          : [];
      if (keys.length) {
        const row = {};
        for (const k of keys) row[k] = null;
        return { value: [row], source: `items()->create([...]) em ${trace.methodName}()`, keys };
      }
      return { value: [], source: `$this->whenLoaded('${rel || "?"}')` };
    }
    const prop = ch.calls.find((c) => c.prop);
    if (prop) {
      const attr = prop.name;
      if (ch.calls.some((c) => /^(toIso8601String|toDateTimeString|toAtomString)$/.test(c.name))) {
        return { value: null, source: t, note: "data formatada em tempo de execução" };
      }
      const model = modelFromResource(resourceName);
      const trace =
        ctx?.handlerMethod && (ctx.orderVar || model === "Order")
          ? handlerServiceCall(project, ctx.handlerMethod, ctx.orderVar || "order")
          : null;
      if (trace && attr === "status") {
        const literal = lastStringLiteralForAttr(project.methodBody(trace.serviceMethod), attr);
        if (literal) return { value: literal, source: `${trace.methodName}() → '${attr}'` };
      }
      if (trace && attr === "total") {
        return { value: null, source: `$this->${attr}`, note: "soma calculada em OrderService::place" };
      }
      if (attr === "id") return { value: null, source: `$this->${attr}`, note: "gerado pelo banco" };
      return { value: null, source: `$this->${attr}` };
    }
  }

  return { value: null, source: t };
}

function readToArrayEntries(resourceName, project, ctx) {
  const cls = project.resolveClass(resourceName, ctx?.file, ctx?.cls);
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

export function buildResourceJsonFromSource(expr, resourceName, project, ctx) {
  const entries = readToArrayEntries(resourceName, project, ctx);
  if (!entries) return null;
  const shape = {};
  const fields = [];
  for (const it of entries) {
    if (!it.key) continue;
    const key = strVal(it.key) ?? it.key;
    const st = staticResourceValue(it.value, key, resourceName, project, ctx);
    shape[key] = st.value;
    fields.push({ key, ...st });
  }
  const env = resourceResponseEnvelope(expr);
  let json = shape;
  if (env.wrap && !env.collection) json = { data: shape };
  else if (env.collection) {
    json = { data: [shape] };
    if (env.paginated) {
      const per = env.perPage ?? 15;
      json.meta = { current_page: 1, per_page: per, total: null };
      json.links = { first: null, last: null, prev: null, next: null };
    }
  }
  return { json, fields, source: `${resourceName.split("\\").pop()}::toArray()` };
}

export function resourceResponseEnvelope(expr) {
  const t = String(expr || "");
  const collection = /::collection\s*\(/.test(t);
  const explicitResponse = /->response\s*\(\s*\)/.test(t);
  const paginateM = /\.paginate\s*\(\s*(\d+)/.exec(t);
  const paginated = Boolean(paginateM) || collection;
  const perPage = paginateM ? Number(paginateM[1]) : null;
  return {
    collection,
    explicitResponse,
    paginated,
    perPage,
    wrap: explicitResponse || collection || /new\s+\w+Resource\b/.test(t),
  };
}

/** `response()->json([...])` — só literais e o que o parser resolve. */
export function jsonBodyFromPhpArray(expr, project, ctx) {
  const m = /=>\s*(\[|array\s*\()/.exec(expr) || /json\s*\(\s*(\[|array\s*\()/.exec(expr);
  if (!m) return null;
  const open = expr.indexOf(m[1].startsWith("array") ? "(" : "[", m.index);
  const close = matchClose(expr, open);
  if (close < 0) return null;
  const arr = parseArrayLiteral(expr.slice(open, close + 1));
  if (!arr) return null;
  const out = {};
  const fields = [];
  for (const it of arr) {
    if (!it.key) continue;
    const key = strVal(it.key) ?? it.key;
    const st = staticResourceValue(it.value, key, null, project, ctx);
    out[key] = st.value != null ? st.value : exprToJsonStatic(it.value);
    fields.push({ key, source: it.value.trim(), value: out[key] });
  }
  return { json: out, fields };
}

function exprToJsonStatic(expr) {
  const lit = strVal(expr);
  if (lit != null) return lit;
  if (/^-?\d+(\.\d+)?$/.test(String(expr).trim())) return Number(expr);
  if (/^true$/i.test(expr)) return true;
  if (/^false$/i.test(expr)) return false;
  if (/^null$/i.test(expr)) return null;
  return null;
}

export function detectHandlerOrderVar(project, handlerMethod) {
  const body = project.methodBody(handlerMethod);
  const m = /\$(\w+)\s*=\s*\$this->\w+->place\s*\(/.exec(body);
  return m ? m[1] : "order";
}

/** Contexto extra para analisar retorno do handler atual. */
export function ctxForReturn(handlerMethod, project) {
  if (!handlerMethod?.cls) return {};
  return {
    handlerMethod: { cls: handlerMethod.cls, ...handlerMethod },
    orderVar: detectHandlerOrderVar(project, handlerMethod),
  };
}