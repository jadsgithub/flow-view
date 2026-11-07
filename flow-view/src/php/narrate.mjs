/**
 * Tradução de código PHP/Laravel em português narrativo (sem LLM): condições, atribuições,
 * Eloquent, facades, helpers, respostas HTTP e exceções. Convenção de texto: `código` e **destaque**.
 */

import { splitTop, findTopOp, stripParens, splitArgs, matchClose, parseChain, stringLiteral, classConst, parseArrayLiteral } from "./parse.mjs";
import { statusText, code, trunc, cap, de, humanizeName } from "../narrate.mjs";

export { statusText, code, trunc, cap, de };

const STR_RE = /^(["'])(?:\\.|(?!\1)[^\\])*\1$/s;
const isStringLit = (e) => STR_RE.test(String(e).trim());
const strVal = (e) => (isStringLit(e) ? String(e).trim().slice(1, -1) : null);
const isNullLit = (e) => /^null$/i.test(String(e).trim());
const isLiteral = (e) => {
  const t = String(e).trim();
  return isStringLit(t) || /^-?\d+(\.\d+)?$/.test(t) || /^(true|false|null)$/i.test(t);
};

const HTTP_CONST = {
  OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204, RESET_CONTENT: 205, MOVED_PERMANENTLY: 301, FOUND: 302, SEE_OTHER: 303,
  NOT_MODIFIED: 304, TEMPORARY_REDIRECT: 307, PERMANENT_REDIRECT: 308, BAD_REQUEST: 400, UNAUTHORIZED: 401, PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405, NOT_ACCEPTABLE: 406, REQUEST_TIMEOUT: 408, CONFLICT: 409, GONE: 410,
  PRECONDITION_FAILED: 412, PAYLOAD_TOO_LARGE: 413, REQUEST_ENTITY_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422, UNPROCESSABLE_CONTENT: 422, LOCKED: 423, TOO_MANY_REQUESTS: 429, INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501, BAD_GATEWAY: 502, SERVICE_UNAVAILABLE: 503, GATEWAY_TIMEOUT: 504,
};

/** `201`, `Response::HTTP_CREATED`, `config('api.http-status-code.x')` → 201; desconhecido → `null`. */
export function statusFromExpr(e, ctx) {
  const t = String(e ?? "").trim();
  if (/^\d{3}$/.test(t)) return Number(t);
  const m = /(?:^|::)HTTP_([A-Z_]+)$/.exec(t);
  if (m && HTTP_CONST[m[1]]) return HTTP_CONST[m[1]];
  const cfg = configValue(t, ctx);
  if (cfg != null && /^\d{3}$/.test(String(cfg).trim())) return Number(String(cfg).trim());
  return null;
}

/** `config('a.b.c')` → valor estático do `config/a.php`, se houver. */
function configValue(e, ctx) {
  const m = /^config\s*\(\s*(['"])([^'"]+)\1\s*\)$/.exec(String(e ?? "").trim());
  if (!m || !ctx || !ctx.project || typeof ctx.project.config !== "function") return null;
  return ctx.project.config(m[2]);
}

/** Exceções conhecidas do Laravel/Symfony → status HTTP. */
const EXC_STATUS = {
  ModelNotFoundException: 404, NotFoundHttpException: 404, RecordsNotFoundException: 404, RouteNotFoundException: 404,
  AuthorizationException: 403, AccessDeniedHttpException: 403, AuthenticationException: 401, UnauthorizedHttpException: 401,
  ValidationException: 422, UnprocessableEntityHttpException: 422, ConflictHttpException: 409, BadRequestHttpException: 400,
  MethodNotAllowedHttpException: 405, TooManyRequestsHttpException: 429, ThrottleRequestsException: 429,
  ServiceUnavailableHttpException: 503, GoneHttpException: 410, PreconditionFailedHttpException: 412, TokenMismatchException: 419,
  PostTooLargeException: 413, UnsupportedMediaTypeHttpException: 415, LockedHttpException: 423, NotAcceptableHttpException: 406,
};

export function excStatus(name) {
  const short = String(name || "").split("\\").pop();
  return EXC_STATUS[short] || null;
}

/* ------------------------------------------------------------------ */
/* Leituras da requisição                                              */
/* ------------------------------------------------------------------ */

const REQ_VAR = /^\$(?:request|req)$/;

const isRequestVar = (name, ctx) => REQ_VAR.test(name) || (name === "$this" && ctx && ctx.requestSelf) || Boolean(ctx && ctx.requestVars && ctx.requestVars.has(name));

const INPUT_METHODS = new Set(["input", "get", "post", "string", "str", "integer", "float", "boolean", "date", "collect", "enum", "array", "query_or_input"]);

/** Retorna `{ kind, name, names }` se a expressão lê dados da requisição. */
export function requestRead(expr, ctx = {}) {
  const e = stripParens(String(expr).trim());
  const ch = parseChain(e);
  if (!ch) return null;
  const { head, calls } = ch;

  // request('x') / request()->input('x')
  let name0 = null;
  let rest = calls;
  if (head.kind === "call" && head.name === "request") {
    if (!calls.length) {
      const a = strVal(head.args[0]);
      return a != null ? { kind: "input", name: a } : { kind: "request", name: null };
    }
  } else if (head.kind === "static" && /^(?:Illuminate\\Support\\Facades\\)?Request$/.test(head.name)) {
    name0 = "static";
  } else if (head.kind === "var" && isRequestVar(head.name, ctx)) {
    name0 = "var";
  } else return null;

  if (!rest.length) return { kind: "request", name: null };
  const c = rest[0];
  const a0 = c.args ? strVal(c.args[0] || "") : null;

  if (c.prop) {
    if (rest.length === 1) return { kind: "input", name: c.name };
    return null;
  }
  if (INPUT_METHODS.has(c.name) && rest.length === 1) return a0 != null ? { kind: "input", name: a0 } : { kind: "all", name: null };
  if (c.name === "query" && rest.length === 1) return a0 != null ? { kind: "query", name: a0 } : { kind: "query", name: null };
  if (c.name === "header" && rest.length === 1) return { kind: "header", name: a0 };
  if (c.name === "cookie" && rest.length === 1) return { kind: "cookie", name: a0 };
  if (c.name === "file" && rest.length === 1) return { kind: "file", name: a0 };
  if (c.name === "route" && rest.length === 1) return { kind: "route", name: a0 };
  if (c.name === "user" && rest.length === 1) return { kind: "user", name: null };
  if (c.name === "bearerToken") return { kind: "bearer", name: null };
  if (c.name === "ip") return { kind: "ip", name: null };
  if (c.name === "validated" && rest.length === 1) return { kind: "validated", name: a0 };
  if (c.name === "safe" && rest.length === 2 && rest[1].name === "only") return { kind: "only", names: listStrings(rest[1].args[0]) };
  if (c.name === "all" && rest.length === 1) return { kind: "all", name: null };
  if (c.name === "only" && rest.length === 1) return { kind: "only", names: listStrings(c.args.join(",")) };
  if (c.name === "except" && rest.length === 1) return { kind: "except", names: listStrings(c.args.join(",")) };
  return null;
}

function listStrings(s) {
  const arr = parseArrayLiteral(String(s || "").trim().startsWith("[") ? s : `[${s}]`);
  const flat = [];
  const take = (it) => {
    const v = strVal(it.value);
    if (v != null) flat.push(v);
    else {
      const inner = parseArrayLiteral(it.value);
      if (inner) inner.forEach(take);
    }
  };
  (arr || []).forEach(take);
  return flat;
}

const REQ_PHRASE = {
  input: (n) => `o campo ${code(n)} da requisição`,
  query: (n) => `o parâmetro de query ${code(n)}`,
  header: (n) => `o cabeçalho ${code(n)}`,
  cookie: (n) => `o cookie ${code(n)}`,
  file: (n) => `o arquivo enviado ${code(n)}`,
  route: (n) => `o parâmetro da URL ${code(n)}`,
  validated: (n) => `o campo validado ${code(n)}`,
};

function describeRequestRead(rr) {
  if (!rr) return null;
  switch (rr.kind) {
    case "user":
      return "o usuário autenticado";
    case "all":
      return "todos os dados da requisição";
    case "request":
      return "a requisição HTTP";
    case "bearer":
      return "o token enviado no cabeçalho `Authorization`";
    case "ip":
      return "o endereço IP de quem chamou";
    case "validated":
      return rr.name ? REQ_PHRASE.validated(rr.name) : "os dados já validados da requisição";
    case "only":
      return `apenas os campos ${rr.names.map(code).join(", ")} da requisição`;
    case "except":
      return `todos os dados da requisição, exceto ${rr.names.map(code).join(", ")}`;
    case "query":
      return rr.name ? REQ_PHRASE.query(rr.name) : "os parâmetros de query";
    case "header":
      return rr.name ? REQ_PHRASE.header(rr.name) : "os cabeçalhos";
    case "cookie":
      return rr.name ? REQ_PHRASE.cookie(rr.name) : "os cookies";
    default:
      return rr.name ? (REQ_PHRASE[rr.kind] || REQ_PHRASE.input)(rr.name) : "os dados da requisição";
  }
}

/* ------------------------------------------------------------------ */
/* Expressões → frase                                                  */
/* ------------------------------------------------------------------ */

const USER_CHAIN = /^(?:Auth::user\(\)|Auth::id\(\)|auth\(\)->user\(\)|auth\(\)->id\(\)|\$request->user\(\)|request\(\)->user\(\)|Auth::guard\([^)]*\)->user\(\))$/;

export function describeExpr(raw, ctx = {}) {
  let e = stripParens(String(raw).trim());
  if (!e) return code("");
  if (isStringLit(e) || /^-?\d+(\.\d+)?$/.test(e)) return code(e);
  if (/^true$/i.test(e)) return "verdadeiro";
  if (/^false$/i.test(e)) return "falso";
  if (isNullLit(e)) return "vazio (nulo)";

  const rr = requestRead(e, ctx);
  if (rr) return describeRequestRead(rr);
  if (USER_CHAIN.test(e.replace(/\s+/g, ""))) return /id\(\)$/.test(e) ? "o id do usuário autenticado" : "o usuário autenticado";

  for (const op of ["??", "?:"]) {
    const p = splitTop(e, op);
    if (p && p.length === 2 && p[0]) return `${describeExpr(p[0], ctx)} (se ausente, usa ${describeExpr(p[1], ctx)})`;
  }
  const tern = ternaryParts(e);
  if (tern) {
    return `${describeExpr(tern.a, ctx)} se ${describeCondition(tern.cond, ctx).pos}, senão ${describeExpr(tern.b, ctx)}`;
  }

  const cast = /^\((int|integer|float|double|string|bool|boolean|array|object)\)\s*([\s\S]+)$/.exec(e);
  if (cast) {
    const to = { int: "número inteiro", integer: "número inteiro", float: "número", double: "número", string: "texto", bool: "verdadeiro/falso", boolean: "verdadeiro/falso", array: "lista", object: "objeto" }[cast[1]];
    return `${describeExpr(cast[2], ctx)}, convertido para ${to}`;
  }

  if (/^\[[\s\S]*\]$/.test(e) || /^array\s*\(/i.test(e)) {
    const arr = parseArrayLiteral(e);
    if (arr && arr.length && arr.every((it) => it.key)) return `um conjunto de dados com ${arr.slice(0, 6).map((it) => code(strVal(it.key) ?? it.key)).join(", ")}${arr.length > 6 ? "…" : ""}`;
    return `uma lista ${code(trunc(e, 50))}`;
  }

  const ch = parseChain(e);
  if (ch) {
    const { head, calls } = ch;
    if (head.kind === "call" && !calls.length) {
      const a = head.args;
      switch (head.name) {
        case "config":
          return `a configuração ${code(strVal(a[0] || "") ?? a[0] ?? "")}`;
        case "env":
          return `a variável de ambiente ${code(strVal(a[0] || "") ?? a[0] ?? "")}`;
        case "now":
        case "today":
          return "a data e hora atuais";
        case "count":
          return `a quantidade de itens de ${describeExpr(a[0] || "", ctx)}`;
        case "route":
          return `a URL da rota ${code(strVal(a[0] || "") ?? "")}`;
        case "collect":
          return `uma coleção com ${describeExpr(a[0] || "[]", ctx)}`;
        case "__":
        case "trans":
          return `o texto traduzido ${code(strVal(a[0] || "") ?? "")}`;
        default:
      }
    }
    if (head.kind === "static" && /^(?:Carbon|CarbonImmutable)$/.test(head.name) && calls.length === 1) {
      if (calls[0].name === "now") return "a data e hora atuais";
      if (calls[0].name === "parse") return `a data ${describeExpr((calls[0].args || [])[0] || "", ctx)}`;
    }
    if (head.kind === "static" && head.name === "Str" && calls.length === 1) {
      const n = calls[0].name;
      if (n === "uuid") return "um UUID novo";
      if (n === "random") return "um texto aleatório";
      if (n === "slug") return `o slug de ${describeExpr((calls[0].args || [])[0] || "", ctx)}`;
    }
    if (head.kind === "static" && /^(?:Hash)$/.test(head.name) && calls.length === 1 && calls[0].name === "make") {
      return `o hash (senha criptografada) de ${describeExpr((calls[0].args || [])[0] || "", ctx)}`;
    }
    if (head.kind === "new") return `uma nova instância de ${code(head.name)}`;
    if (head.kind === "var" && calls.length === 1 && calls[0].prop) return `${code(trunc(e, 60))}`;
    if (calls.length || head.kind === "call") return `o resultado de ${code(trunc(e, 60))}`;
  }
  const idx = /^(\$[\w]+(?:->\w+)*)\[([\s\S]+)\]$/.exec(e);
  if (idx && matchClose(e, e.indexOf("[")) === e.length - 1) return `o item ${describeExpr(idx[2], ctx)} de ${code(idx[1])}`;
  return code(trunc(e, 60));
}

/** `a ? b : c` no nível 0 (sem confundir com `??`, `?->`, `?:`). */
function ternaryParts(e) {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === '"' || c === "'") {
      const m = /^(["'])(?:\\.|(?!\1)[^\\])*\1/s.exec(e.slice(i));
      if (m) i += m[0].length - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === "?" && e[i + 1] !== "?" && e[i + 1] !== ">" && e[i + 1] !== ":" && e[i - 1] !== "?" && e[i - 1] !== "-") {
      q = i;
      break;
    }
  }
  if (q < 0) return null;
  const rest = e.slice(q + 1);
  const parts = splitTopColon(rest);
  if (!parts) return null;
  return { cond: e.slice(0, q).trim(), a: parts[0].trim(), b: parts[1].trim() };
}

function splitTopColon(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const m = /^(["'])(?:\\.|(?!\1)[^\\])*\1/s.exec(s.slice(i));
      if (m) i += m[0].length - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === ":" && s[i + 1] !== ":" && s[i - 1] !== ":") return [s.slice(0, i), s.slice(i + 1)];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Condições                                                           */
/* ------------------------------------------------------------------ */

const mk = (q, nq, pos, neg) => ({ q, nq, pos, neg });
const swap = (d) => ({ q: d.nq, nq: d.q, pos: d.neg, neg: d.pos });
const unq = (s) => String(s).replace(/\?$/, "");

const CMP = ["===", "!==", "==", "!=", "<>", ">=", "<=", ">", "<"];

const LEN_PHRASE = {
  "===": (n) => (n === "0" ? "estiver vazio" : `tiver exatamente ${n} item(ns)`),
  "==": (n) => (n === "0" ? "estiver vazio" : `tiver exatamente ${n} item(ns)`),
  "!==": (n) => (n === "0" ? "tiver itens" : `não tiver exatamente ${n} item(ns)`),
  "!=": (n) => (n === "0" ? "tiver itens" : `não tiver exatamente ${n} item(ns)`),
  "<>": (n) => (n === "0" ? "tiver itens" : `não tiver exatamente ${n} item(ns)`),
  ">": (n) => (n === "0" ? "tiver itens" : `tiver mais de ${n} item(ns)`),
  ">=": (n) => (n === "1" ? "tiver itens" : `tiver pelo menos ${n} item(ns)`),
  "<": (n) => (n === "1" ? "estiver vazio" : `tiver menos de ${n} item(ns)`),
  "<=": (n) => (n === "0" ? "estiver vazio" : `tiver no máximo ${n} item(ns)`),
};
const LEN_NEG = { "estiver vazio": "tiver itens", "tiver itens": "estiver vazio" };
const NUM_OP = {
  ">": ["for maior que", "for menor ou igual a"],
  ">=": ["for maior ou igual a", "for menor que"],
  "<": ["for menor que", "for maior ou igual a"],
  "<=": ["for menor ou igual a", "for maior que"],
};

function hasBoolOp(e) {
  if (findTopOp(e, CMP)) return true;
  if (/^!/.test(e)) return true;
  if (splitTop(e, "&&") || splitTop(e, "||") || splitTop(e, "and") || splitTop(e, "or")) return true;
  if (/^(?:isset|empty|is_null|is_array|is_string|is_numeric|in_array|str_contains|str_starts_with|str_ends_with|array_key_exists|preg_match|password_verify|hash_equals|filter_var)\s*\(/.test(e)) return true;
  if (/\binstanceof\b/.test(e)) return true;
  const ch = parseChain(e);
  if (ch && ch.calls.length) {
    const last = ch.calls[ch.calls.length - 1];
    if (!last.prop && /^(has|filled|missing|hasFile|exists|doesntExist|isEmpty|isNotEmpty|contains|doesntContain|can|cannot|cant|hasRole|hasAnyRole|hasPermissionTo|check|guest|allows|denies|fails|passes|expectsJson|wantsJson|ajax|isMethod|is[A-Z]\w*|has[A-Z]\w*|can[A-Z]\w*|isDirty|isClean|wasChanged|is|any|none)$/.test(last.name)) return true;
    if (last.prop && /^(wasRecentlyCreated|exists)$/.test(last.name)) return true;
  }
  return false;
}

export function isConditionLike(raw) {
  return hasBoolOp(stripParens(String(raw).trim()));
}

function descLen(name, a, op, n) {
  const phrase = LEN_PHRASE[op](n);
  const subj = describeExpr(a);
  const neg = LEN_NEG[phrase] || `não ${phrase}`;
  return mk(`${cap(subj)} ${phrase.replace(/^(tiver|estiver)/, (w) => (w === "tiver" ? "tem" : "está"))}?`, `${cap(subj)} ${neg.replace(/^(tiver|estiver)/, (w) => (w === "tiver" ? "tem" : "está"))}?`, `${subj} ${phrase}`, `${subj} ${neg}`);
}

function describeCallCondition(chain, ctx) {
  const { head, calls } = chain;
  const text = chain.text;
  const callCode = code(trunc(text, 60));
  const A = (i) => {
    const args = head.kind === "call" && !calls.length ? head.args : (calls[calls.length - 1].args || []);
    return args[i];
  };

  // funções nativas
  if (head.kind === "call" && !calls.length) {
    const n = head.name;
    const a0 = head.args[0] || "";
    const d0 = describeExpr(a0, ctx);
    switch (n) {
      case "isset":
        return mk(`${cap(d0)} existe?`, `${cap(d0)} NÃO existe?`, `${d0} existir (não for nulo)`, `${d0} não existir (for nulo)`);
      case "empty":
        return mk(`${cap(d0)} está vazio?`, `${cap(d0)} NÃO está vazio?`, `${d0} estiver vazio (nulo, falso, 0 ou lista vazia)`, `${d0} tiver algum valor`);
      case "is_null":
        return mk(`${cap(d0)} é nulo?`, `${cap(d0)} NÃO é nulo?`, `${d0} for nulo`, `${d0} não for nulo`);
      case "is_array":
        return mk(`${cap(d0)} é uma lista?`, `${cap(d0)} NÃO é uma lista?`, `${d0} for uma lista`, `${d0} não for uma lista`);
      case "is_string":
        return mk(`${cap(d0)} é um texto?`, `${cap(d0)} NÃO é um texto?`, `${d0} for um texto`, `${d0} não for um texto`);
      case "is_numeric":
        return mk(`${cap(d0)} é numérico?`, `${cap(d0)} NÃO é numérico?`, `${d0} for numérico`, `${d0} não for numérico`);
      case "in_array": {
        const l = describeExpr(head.args[1] || "", ctx);
        return mk(`${cap(d0)} está em ${l}?`, `${cap(d0)} NÃO está em ${l}?`, `${d0} estiver em ${l}`, `${d0} não estiver em ${l}`);
      }
      case "str_contains":
      case "str_starts_with":
      case "str_ends_with": {
        const w = n === "str_contains" ? ["contém", "contiver"] : n === "str_starts_with" ? ["começa com", "começar com"] : ["termina com", "terminar com"];
        const b = describeExpr(head.args[1] || "", ctx);
        return mk(`${cap(d0)} ${w[0]} ${b}?`, `${cap(d0)} NÃO ${w[0]} ${b}?`, `${d0} ${w[1]} ${b}`, `${d0} não ${w[1]} ${b}`);
      }
      case "array_key_exists": {
        const b = describeExpr(head.args[1] || "", ctx);
        return mk(`${cap(b)} tem a chave ${d0}?`, `${cap(b)} NÃO tem a chave ${d0}?`, `${b} tiver a chave ${d0}`, `${b} não tiver a chave ${d0}`);
      }
      case "preg_match":
        return mk(`${cap(describeExpr(head.args[1] || "", ctx))} segue o formato esperado?`, `${cap(describeExpr(head.args[1] || "", ctx))} NÃO segue o formato esperado?`, `${describeExpr(head.args[1] || "", ctx)} seguir o formato esperado (${code(trunc(a0, 40))})`, `${describeExpr(head.args[1] || "", ctx)} não seguir o formato esperado`);
      case "password_verify":
        return mk("A senha confere com o hash salvo?", "A senha NÃO confere com o hash salvo?", "a senha informada conferir com o hash salvo", "a senha informada não conferir com o hash salvo");
      case "hash_equals":
        return mk("Os dois valores são idênticos (comparação segura)?", "Os dois valores são diferentes?", "os dois valores forem idênticos", "os dois valores forem diferentes");
      case "filter_var":
        return mk(`${cap(d0)} é válido?`, `${cap(d0)} NÃO é válido?`, `${d0} passar na validação (${code(trunc(head.args[1] || "", 30))})`, `${d0} não passar na validação`);
      case "count":
      default:
    }
  }

  const last = calls[calls.length - 1];
  const name = last ? last.name : head.name;

  // facades
  if (head.kind === "static" && calls.length === 1) {
    const f = head.name.split("\\").pop();
    const a0 = describeExpr(A(0) || "", ctx);
    if (f === "Auth") {
      if (name === "check") return mk("O usuário está autenticado?", "O usuário NÃO está autenticado?", "o usuário estiver autenticado", "o usuário não estiver autenticado");
      if (name === "guest") return mk("O usuário é visitante (não autenticado)?", "O usuário está autenticado?", "o usuário for um visitante (não autenticado)", "o usuário estiver autenticado");
    }
    if (f === "Gate" && /^(allows|check|any)$/.test(name)) {
      return mk(`O usuário tem permissão para ${a0}?`, `O usuário NÃO tem permissão para ${a0}?`, `o usuário tiver permissão para ${a0} (${callCode})`, `o usuário não tiver permissão para ${a0}`);
    }
    if (f === "Gate" && /^(denies|none)$/.test(name)) {
      return mk(`O usuário NÃO tem permissão para ${a0}?`, `O usuário tem permissão para ${a0}?`, `o usuário não tiver permissão para ${a0} (${callCode})`, `o usuário tiver permissão para ${a0}`);
    }
    if (f === "Hash" && name === "check") {
      return mk("A senha confere com o hash salvo?", "A senha NÃO confere com o hash salvo?", "a senha informada conferir com o hash salvo", "a senha informada não conferir com o hash salvo");
    }
    if (f === "Cache" && /^(has|missing)$/.test(name)) {
      const has = name === "has";
      return mk(`${has ? "Existe" : "NÃO existe"} ${a0} no cache?`, `${has ? "NÃO existe" : "Existe"} ${a0} no cache?`, `${has ? "existir" : "não existir"} ${a0} no cache`, `${has ? "não existir" : "existir"} ${a0} no cache`);
    }
    if (f === "Storage" && name === "exists") return mk(`O arquivo ${a0} existe?`, `O arquivo ${a0} NÃO existe?`, `o arquivo ${a0} existir`, `o arquivo ${a0} não existir`);
    if (f === "Str" && /^(contains|startsWith|endsWith)$/.test(name)) {
      const w = name === "contains" ? ["contém", "contiver"] : name === "startsWith" ? ["começa com", "começar com"] : ["termina com", "terminar com"];
      const b = describeExpr(A(1) || "", ctx);
      return mk(`${cap(a0)} ${w[0]} ${b}?`, `${cap(a0)} NÃO ${w[0]} ${b}?`, `${a0} ${w[1]} ${b}`, `${a0} não ${w[1]} ${b}`);
    }
    if (f === "Str" && name === "isUuid") return mk(`${cap(a0)} é um UUID válido?`, `${cap(a0)} NÃO é um UUID válido?`, `${a0} for um UUID válido`, `${a0} não for um UUID válido`);
  }

  // instâncias / encadeamentos
  if (last && !last.prop) {
    const recvText = text.slice(0, text.lastIndexOf(last.op + last.name)).trim();
    const R = () => describeExpr(recvText, ctx);
    const rr = requestRead(recvText, ctx);
    const a0s = strVal(A(0) || "");
    const a0 = describeExpr(A(0) || "", ctx);
    const isReq = Boolean(parseChain(recvText) && (parseChain(recvText).head.kind === "var" && isRequestVar(parseChain(recvText).head.name, ctx) && !parseChain(recvText).calls.length));
    if (isReq || (rr && rr.kind === "request")) {
      const fld = a0s != null ? code(a0s) : a0;
      switch (name) {
        case "has":
        case "hasAny":
          return mk(`A requisição trouxe ${fld}?`, `A requisição NÃO trouxe ${fld}?`, `a requisição trouxer o campo ${fld}`, `a requisição não trouxer o campo ${fld}`);
        case "filled":
          return mk(`O campo ${fld} foi preenchido?`, `O campo ${fld} NÃO foi preenchido?`, `o campo ${fld} vier preenchido (não vazio)`, `o campo ${fld} vier vazio ou ausente`);
        case "missing":
          return mk(`O campo ${fld} está ausente?`, `O campo ${fld} está presente?`, `o campo ${fld} estiver ausente`, `o campo ${fld} estiver presente`);
        case "hasFile":
          return mk(`Foi enviado o arquivo ${fld}?`, `NÃO foi enviado o arquivo ${fld}?`, `um arquivo ${fld} for enviado`, `nenhum arquivo ${fld} for enviado`);
        case "boolean":
          return mk(`O campo ${fld} é verdadeiro?`, `O campo ${fld} é falso?`, `o campo ${fld} for verdadeiro`, `o campo ${fld} for falso`);
        case "expectsJson":
        case "wantsJson":
        case "ajax":
          return mk("O cliente espera uma resposta JSON?", "O cliente NÃO espera JSON?", "o cliente esperar uma resposta JSON", "o cliente não esperar JSON");
        case "isMethod":
          return mk(`O método HTTP é ${a0}?`, `O método HTTP NÃO é ${a0}?`, `o método HTTP for ${a0}`, `o método HTTP não for ${a0}`);
        case "is":
          return mk(`A rota atual é ${a0}?`, `A rota atual NÃO é ${a0}?`, `a rota atual for ${a0}`, `a rota atual não for ${a0}`);
        default:
      }
    }
    if (/^(failed|successful|ok|clientError|serverError)$/.test(name) && recvText) {
      const bad = /^(failed|clientError|serverError)$/.test(name);
      return bad
        ? mk("A chamada externa falhou?", "A chamada externa deu certo?", "a chamada ao serviço externo falhar (resposta de erro 4xx/5xx)", "a chamada ao serviço externo der certo")
        : mk("A chamada externa deu certo?", "A chamada externa falhou?", "a chamada ao serviço externo der certo", "a chamada ao serviço externo falhar");
    }
    if (/^(isEmpty|isNotEmpty)$/.test(name)) {
      const r = R();
      const empty = name === "isEmpty";
      return mk(`${cap(r)} ${empty ? "está vazio" : "tem itens"}?`, `${cap(r)} ${empty ? "tem itens" : "está vazio"}?`, `${r} ${empty ? "estiver vazio" : "tiver itens"}`, `${r} ${empty ? "tiver itens" : "estiver vazio"}`);
    }
    if (/^(contains|doesntContain)$/.test(name) && recvText) {
      const r = R();
      const c = name === "contains";
      return mk(`${cap(r)} ${c ? "contém" : "NÃO contém"} ${a0}?`, `${cap(r)} ${c ? "NÃO contém" : "contém"} ${a0}?`, `${r} ${c ? "contiver" : "não contiver"} ${a0}`, `${r} ${c ? "não contiver" : "contiver"} ${a0}`);
    }
    if (/^(exists|doesntExist)$/.test(name) && recvText) {
      const r = R();
      const ex = name === "exists";
      return mk(`Existe ${ex ? "algum registro" : "NENHUM registro"} em ${r}?`, `Existe ${ex ? "NENHUM registro" : "algum registro"} em ${r}?`, `${ex ? "existir algum registro" : "não existir nenhum registro"} em ${r}`, `${ex ? "não existir nenhum registro" : "existir algum registro"} em ${r}`);
    }
    if (/^(can|cannot|cant)$/.test(name) && recvText) {
      const allow = name === "can";
      const ab = a0s != null ? code(a0s) : a0;
      const on = A(1) ? ` em ${describeExpr(A(1), ctx)}` : "";
      return mk(`O usuário ${allow ? "tem" : "NÃO tem"} permissão para ${ab}${on}?`, `O usuário ${allow ? "NÃO tem" : "tem"} permissão para ${ab}${on}?`, `o usuário ${allow ? "tiver" : "não tiver"} permissão para ${ab}${on}`, `o usuário ${allow ? "não tiver" : "tiver"} permissão para ${ab}${on}`);
    }
    if (/^(hasRole|hasAnyRole|hasPermissionTo|hasAllRoles)$/.test(name)) {
      const what = name === "hasPermissionTo" ? "a permissão" : "o papel (role)";
      return mk(`O usuário tem ${what} ${a0}?`, `O usuário NÃO tem ${what} ${a0}?`, `o usuário tiver ${what} ${a0}`, `o usuário não tiver ${what} ${a0}`);
    }
    if (/^(fails|passes)$/.test(name)) {
      const f = name === "fails";
      return mk(`A validação ${f ? "falhou" : "passou"}?`, `A validação ${f ? "passou" : "falhou"}?`, `a validação ${f ? "falhar" : "passar"}`, `a validação ${f ? "passar" : "falhar"}`);
    }
    if (/^(isDirty|isClean|wasChanged)$/.test(name)) {
      const fld = a0s != null ? ` ${code(a0s)}` : "";
      const clean = name === "isClean";
      return mk(`O registro ${clean ? "NÃO foi alterado" : "foi alterado"}${fld ? ` (campo${fld})` : ""}?`, `O registro ${clean ? "foi alterado" : "NÃO foi alterado"}?`, `o registro ${clean ? "não tiver alterações" : "tiver alterações"}${fld ? ` no campo${fld}` : ""}`, `o registro ${clean ? "tiver alterações" : "não tiver alterações"}`);
    }
    if (/^(isPast|isFuture|isToday)$/.test(name) && recvText) {
      const w = { isPast: "no passado", isFuture: "no futuro", isToday: "hoje" }[name];
      const r = R();
      return mk(`${cap(r)} está ${w}?`, `${cap(r)} NÃO está ${w}?`, `${r} estiver ${w}`, `${r} não estiver ${w}`);
    }
    if (/^(isAfter|isBefore|gt|lt|gte|lte|greaterThan|lessThan|equalTo)$/.test(name) && recvText) {
      const r = R();
      const w = { isAfter: ["for depois de", "não for depois de"], gt: ["for maior que", "não for maior que"], greaterThan: ["for maior que", "não for maior que"], isBefore: ["for antes de", "não for antes de"], lt: ["for menor que", "não for menor que"], lessThan: ["for menor que", "não for menor que"], gte: ["for maior ou igual a", "for menor que"], lte: ["for menor ou igual a", "for maior que"], equalTo: ["for igual a", "for diferente de"] }[name];
      return mk(`${cap(r)} ${w[0].replace("for", "é")} ${a0}?`, `${cap(r)} ${w[1].replace("for", "é")} ${a0}?`, `${r} ${w[0]} ${a0}`, `${r} ${w[1]}`.concat(` ${a0}`));
    }
    // is*/has*/can* genéricos — com nomes de credencial/auth do Laravel
    if (/^(is|has|can|should|was|needs|requires)[A-Z]/.test(name)) {
      const rest = name.replace(/^(is|has|can|should|was|needs|requires)/, "");
      const known = {
        PassportBearer: "um token Bearer (Passport)",
        BackToBack: "autenticada por chave de API (back-to-back)",
        IntegratorPlatform: "plataforma integradora",
        Parceiro: "parceiro",
        Corban: "Corban",
      };
      const topic = known[rest] || rest.replace(/([A-Z])/g, " $1").trim().toLowerCase();
      const recvIsCred = /credentialType\s*\(/.test(recvText);
      if (name === "isPassportBearer") {
        return mk("A requisição tem um token Bearer (Passport)?", "A requisição NÃO tem um token Bearer (Passport)?", "a requisição tiver um token Bearer (Passport)", "a requisição não tiver um token Bearer (Passport)");
      }
      if (name === "isBackToBack") {
        return mk("A requisição veio autenticada por chave de API (back-to-back)?", "A requisição NÃO veio autenticada por chave de API?", "a requisição vier autenticada por chave de API (back-to-back)", "a requisição não vier autenticada por chave de API");
      }
      if (recvIsCred) {
        return mk(`O tipo de credencial é ${topic}?`, `O tipo de credencial NÃO é ${topic}?`, `o tipo de credencial for ${topic}`, `o tipo de credencial não for ${topic}`);
      }
      const r = recvText && !/^\$this$/.test(recvText.trim()) ? describeExpr(recvText, ctx) : "";
      const w = name.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^is /, "");
      return mk(`${cap(r || "A condição")} ${r ? w : `é ${topic}`}?`, `${cap(r || "A condição")} NÃO ${r ? w : `é ${topic}`}?`, r ? `${r} ${w}` : `for ${topic}`, r ? `${r} não ${w}` : `não for ${topic}`);
    }
  }
  if (last && last.prop && /^(wasRecentlyCreated|exists)$/.test(last.name)) {
    const recvText = text.slice(0, text.lastIndexOf(last.op + last.name)).trim();
    const r = describeExpr(recvText, ctx);
    if (last.name === "wasRecentlyCreated") return mk(`${cap(r)} acabou de ser criado?`, `${cap(r)} já existia?`, `${r} tiver acabado de ser criado nesta requisição`, `${r} já existir antes desta requisição`);
    return mk(`${cap(r)} já existe no banco?`, `${cap(r)} ainda NÃO existe no banco?`, `${r} já existir no banco`, `${r} ainda não existir no banco`);
  }
  return null;
}

/** Texto de uma condição (`if (...)`): `q` (pergunta), `nq`, `pos` e `neg` (frases com "quando"). */
export function describeCondition(raw, ctx = {}) {
  const e = stripParens(String(raw).trim());
  if (!e) return mk("A condição é verdadeira?", "A condição é falsa?", "a condição for verdadeira", "a condição for falsa");

  const or = splitTop(e, "||") || splitTop(e, " or ");
  if (or) {
    const ps = or.map((p) => describeCondition(p, ctx));
    return mk(
      `${ps.map((p) => unq(p.q)).join(" ou ")}?`,
      `Nenhuma destas é verdade: ${ps.map((p) => unq(p.q)).join("; ")}?`,
      ps.map((p) => p.pos).join(", **ou** "),
      `nenhuma destas for verdade (${ps.map((p) => p.neg).join("; ")})`
    );
  }
  const and = splitTop(e, "&&") || splitTop(e, " and ");
  if (and) {
    const ps = and.map((p) => describeCondition(p, ctx));
    return mk(
      `${ps.map((p) => unq(p.q)).join(" e ")}?`,
      `Alguma destas falha: ${ps.map((p) => unq(p.q)).join("; ")}?`,
      ps.map((p) => p.pos).join(", **e** "),
      `alguma destas falhar (${ps.map((p) => p.neg).join("; ou ")})`
    );
  }

  if (/^!(?!=)/.test(e)) {
    const rest = e.replace(/^!\s*/, "");
    const inner = stripParens(rest);
    if (isConditionLike(inner) || /^\$/.test(inner) || parseChain(inner)) {
      if (isConditionLike(inner)) return swap(describeCondition(inner, ctx));
      const d = describeExpr(inner, ctx);
      return mk(`${cap(d)} está vazio ou ausente?`, `${cap(d)} tem valor?`, `${d} estiver vazio ou ausente (nulo, falso ou 0)`, `${d} tiver valor`);
    }
  }

  const io = /^([\s\S]+?)\s+instanceof\s+([\\\w]+)$/.exec(e);
  if (io) {
    const a = describeExpr(io[1], ctx);
    return mk(`${cap(a)} é do tipo ${code(io[2])}?`, `${cap(a)} NÃO é do tipo ${code(io[2])}?`, `${a} for do tipo ${code(io[2])}`, `${a} não for do tipo ${code(io[2])}`);
  }

  const cmp = findTopOp(e, CMP);
  if (cmp) {
    const left = e.slice(0, cmp.i).trim();
    const right = e.slice(cmp.i + cmp.op.length).trim();
    const op = cmp.op;
    const strictNe = op === "!==" || op === "!=" || op === "<>";
    const eq = op === "===" || op === "==" || strictNe;

    const lenM = (s) => /^(?:count|strlen|mb_strlen|sizeof)\(([\s\S]+)\)$/.exec(s) || /^([\s\S]+)->count\(\)$/.exec(s);
    const lm = lenM(left);
    if (lm && /^-?\d+$/.test(right)) return descLen(left, lm[1], op, right);
    const rm = lenM(right);
    if (rm && /^-?\d+$/.test(left)) {
      const flip = { ">": "<", "<": ">", ">=": "<=", "<=": ">=" }[op] || op;
      return descLen(right, rm[1], flip, left);
    }

    if (isNullLit(right) || isNullLit(left)) {
      const x = describeExpr(isNullLit(right) ? left : right, ctx);
      return eq && !strictNe
        ? mk(`${cap(x)} é nulo?`, `${cap(x)} existe?`, `${x} for nulo (não existir)`, `${x} existir`)
        : mk(`${cap(x)} existe?`, `${cap(x)} é nulo?`, `${x} existir (não for nulo)`, `${x} for nulo`);
    }
    if (eq && /^(true|false)$/i.test(right)) {
      const x = describeExpr(left, ctx);
      const truth = /^true$/i.test(right) !== strictNe;
      return truth
        ? mk(`${cap(x)} é verdadeiro?`, `${cap(x)} NÃO é verdadeiro?`, `${x} for verdadeiro`, `${x} não for verdadeiro`)
        : mk(`${cap(x)} é falso?`, `${cap(x)} NÃO é falso?`, `${x} for falso`, `${x} não for falso`);
    }
    if (eq && /^(['"])\1$/.test(right)) {
      const x = describeExpr(left, ctx);
      return strictNe
        ? mk(`${cap(x)} tem conteúdo?`, `${cap(x)} está vazio?`, `${x} tiver conteúdo`, `${x} estiver vazio`)
        : mk(`${cap(x)} está vazio?`, `${cap(x)} tem conteúdo?`, `${x} estiver vazio`, `${x} tiver conteúdo`);
    }
    if (NUM_OP[op]) {
      const a = describeExpr(left, ctx);
      const b = describeExpr(right, ctx);
      return mk(`${cap(a)} ${NUM_OP[op][0].replace("for", "é")} ${b}?`, `${cap(a)} ${NUM_OP[op][1].replace("for", "é")} ${b}?`, `${a} ${NUM_OP[op][0]} ${b}`, `${a} ${NUM_OP[op][1]} ${b}`);
    }
    const a = describeExpr(left, ctx);
    const b = describeExpr(right, ctx);
    return strictNe
      ? mk(`${cap(a)} é diferente de ${b}?`, `${cap(a)} é igual a ${b}?`, `${a} for diferente de ${b}`, `${a} for igual a ${b}`)
      : mk(`${cap(a)} é igual a ${b}?`, `${cap(a)} é diferente de ${b}?`, `${a} for igual a ${b}`, `${a} for diferente de ${b}`);
  }

  const ch = parseChain(e);
  if (ch) {
    const c = describeCallCondition(ch, ctx);
    if (c) return c;
    if (ch.head.kind === "var" && !ch.calls.length) {
      const d = describeExpr(e, ctx);
      return mk(`${cap(d)} tem valor?`, `${cap(d)} está vazio ou ausente?`, `${code(e)} tiver valor (não for nulo, falso ou 0)`, `${code(e)} estiver vazio ou ausente (nulo, falso ou 0)`);
    }
  }
  if (ch && ch.head.kind === "var" && ch.calls.length === 1 && ch.calls[0].prop) {
    const fld = `o campo ${code(ch.calls[0].name)} de ${code(ch.head.name)}`;
    return mk(`${cap(fld)} é verdadeiro?`, `${cap(fld)} é falso?`, `${fld} for verdadeiro`, `${fld} for falso`);
  }
  const c = code(trunc(e, 60));
  return mk(`${c} é verdadeiro?`, `${c} é falso?`, `${c} for verdadeiro`, `${c} for falso`);
}

export function describeDecision(expr, ctx = {}) {
  const d = describeCondition(expr, ctx);
  return {
    ...d,
    title: d.q,
    story:
      `Aqui o fluxo se divide por uma regra do código. O sistema pergunta: **${unq(d.q)}?** ` +
      `A resposta decide qual caminho seguir — os dois caminhos possíveis estão descritos abaixo.`,
  };
}

/* ------------------------------------------------------------------ */
/* Respostas HTTP                                                      */
/* ------------------------------------------------------------------ */

function bodyKeys(body) {
  const arr = body ? parseArrayLiteral(body) : null;
  if (!arr) return null;
  return arr.map((it) => ({ k: it.key ? strVal(it.key) ?? it.key : null, v: it.value }));
}

/**
 * Lê status e corpo de uma expressão de resposta HTTP do Laravel.
 * @returns {{ status: number|null, kind: string, body: string, redirect?: boolean, view?: string, resource?: string }|null}
 */
export function parseHttpReturn(expr, ctx) {
  const e = stripParens(String(expr).trim());
  const ch = parseChain(e);
  if (!ch) return null;
  const { head, calls } = ch;
  const calc = (def) => {
    let st = def;
    for (const c of calls) {
      if ((c.name === "setStatusCode" || c.name === "withStatus") && c.args && c.args[0]) {
        const s = statusFromExpr(c.args[0], ctx);
        st = s != null ? s : null;
      }
    }
    return st;
  };
  const argAt = (a, i) => (a && a[i] != null ? a[i] : null);

  // response()->... / Response::... / response(...)
  const isRespFacade = head.kind === "static" && /^(?:Illuminate\\Support\\Facades\\)?Response$/.test(head.name);
  if ((head.kind === "call" && head.name === "response") || isRespFacade) {
    const first = isRespFacade ? calls[0] : calls[0];
    if (head.kind === "call" && !calls.length) {
      const st = statusFromExpr(argAt(head.args, 1), ctx);
      return { status: head.args[1] ? st : 200, kind: "json", body: head.args[0] || "" };
    }
    if (head.kind === "call" && calls[0] && /^(header|withHeaders|cookie|withCookie|setStatusCode)$/.test(calls[0].name)) {
      const st = head.args[1] ? statusFromExpr(head.args[1], ctx) : 200;
      return { status: calc(st), kind: "json", body: head.args[0] || "" };
    }
    if (first) {
      const a = first.args || [];
      switch (first.name) {
        case "json":
        case "jsonp":
          return { status: calc(a[1] ? statusFromExpr(a[1], ctx) : 200), kind: "json", body: a[0] || "" };
        case "noContent":
          return { status: calc(a[0] ? statusFromExpr(a[0], ctx) : 204), kind: "empty", body: "" };
        case "make":
          return { status: calc(a[1] ? statusFromExpr(a[1], ctx) : 200), kind: "json", body: a[0] || "" };
        case "view":
          return { status: calc(a[2] ? statusFromExpr(a[2], ctx) : 200), kind: "view", view: strVal(a[0] || "") || "", body: a[1] || "" };
        case "download":
        case "file":
        case "streamDownload":
        case "stream":
          return { status: calc(200), kind: "file", body: a[0] || "" };
        case "redirectTo":
        case "redirectToRoute":
        case "redirectToAction":
          return { status: calc(302), kind: "redirect", redirect: true, body: a[0] || "" };
        case "error":
          return { status: calc(a[1] ? statusFromExpr(a[1], ctx) : 400) ?? 400, kind: "json", body: a[0] || "", message: a[0] || "" };
        case "success":
          return { status: calc(a[1] ? statusFromExpr(a[1], ctx) : 200) ?? 200, kind: "json", body: a[2] || a[0] || "", message: a[0] || "" };
        default:
      }
    }
    return { status: calc(200), kind: "json", body: "" };
  }

  if ((head.kind === "call" && /^(redirect|back|to_route|redirect_to)$/.test(head.name)) || (head.kind === "static" && /^(?:Illuminate\\Support\\Facades\\)?Redirect$/.test(head.name))) {
    const targetCall = calls.find((c) => /^(to|route|action|away|back|intended|home|secure|refresh|guest)$/.test(c.name));
    let target = head.name === "redirect" ? head.args[0] || "" : head.name === "to_route" ? head.args[0] || "" : head.name === "back" ? "a página anterior" : "";
    let status = 302;
    if (head.kind === "call" && head.name === "redirect" && head.args[1]) status = statusFromExpr(head.args[1], ctx) ?? 302;
    if (targetCall) {
      target = targetCall.name === "back" ? "a página anterior" : (targetCall.args && targetCall.args[0]) || target;
      if (targetCall.name === "route" || head.name === "to_route") target = `rota ${target}`;
    }
    if (!target && calls.some((c) => c.name === "back")) target = "a página anterior";
    return { status: calc(status), kind: "redirect", redirect: true, body: target };
  }

  if (head.kind === "call" && head.name === "view") {
    return { status: calc(200), kind: "view", view: strVal(head.args[0] || "") || "", body: head.args[1] || "" };
  }
  if (head.kind === "static" && /^(?:Inertia|Livewire)$/.test(head.name) && calls[0] && calls[0].name === "render") {
    return { status: calc(200), kind: "view", view: strVal((calls[0].args || [])[0] || "") || "", body: (calls[0].args || [])[1] || "", inertia: true };
  }
  if (head.kind === "new") {
    const n = head.name.split("\\").pop();
    if (n === "JsonResponse") return { status: calc(head.args[1] ? statusFromExpr(head.args[1], ctx) : 200), kind: "json", body: head.args[0] || "" };
    if (n === "Response") return { status: calc(head.args[1] ? statusFromExpr(head.args[1], ctx) : 200), kind: "json", body: head.args[0] || "" };
    if (n === "RedirectResponse") return { status: calc(head.args[1] ? statusFromExpr(head.args[1], ctx) : 302), kind: "redirect", redirect: true, body: head.args[0] || "" };
    if (/Resource$|Collection$/.test(n)) return { status: calc(200), kind: "resource", resource: head.name, body: head.args[0] || "" };
    if (/^(StreamedResponse|BinaryFileResponse|StreamedJsonResponse)$/.test(n)) return { status: calc(200), kind: "file", body: "" };
  }
  if (head.kind === "paren") {
    const inner = parseChain(head.inner.trim());
    if (inner && inner.head.kind === "new" && /Resource$|Collection$/.test(inner.head.name.split("\\").pop())) {
      return { status: calc(200), kind: "resource", resource: inner.head.name, body: inner.head.args[0] || "" };
    }
  }
  if (head.kind === "static" && calls[0] && /^(collection|make)$/.test(calls[0].name) && /(Resource|Collection)$/.test(head.name)) {
    return { status: calc(200), kind: "resource", resource: head.name, body: (calls[0].args || [])[0] || "" };
  }
  if (head.kind === "var" && calls.some((c) => c.name === "response") && calls.some((c) => c.name === "setStatusCode")) {
    return { status: calc(200), kind: "resource", resource: null, body: head.name };
  }
  return null;
}

const RESP_KIND_PT = { json: "JSON", view: "uma página (view)", file: "um arquivo", empty: "sem corpo", resource: "um recurso JSON (API Resource)" };

function describeReturn(rest, ctx) {
  const e = rest.trim();
  const handler = ctx && ctx.handler;
  if (!e) {
    return { nodeType: "return", title: "Encerra a função", story: "Encerra esta função sem devolver valor e volta para quem a chamou.", facts: [], tone: "neutral", short: "Encerra a função sem devolver valor." };
  }
  const resp = parseHttpReturn(e, ctx);
  if (resp) {
    const st = resp.status;
    const known = st != null;
    const txt = known ? statusText(st) : "";
    const tone = known && st >= 400 ? "error" : "ok";
    const facts = [];
    if (known) facts.push({ k: "Status HTTP", v: `${st} · ${txt}` });
    const cfgMsg = resp.message ? configValue(resp.message, ctx) : null;
    if (cfgMsg && typeof cfgMsg === "string" && !/^\d{3}$/.test(cfgMsg.trim())) {
      facts.push({ k: "Mensagem", v: cfgMsg });
    }
    const keys = resp.kind === "json" || resp.kind === "view" ? bodyKeys(resp.body) : null;
    let detail = cfgMsg && typeof cfgMsg === "string" && !/^\d{3}$/.test(cfgMsg.trim()) ? cfgMsg : "";
    if (!detail && keys && keys.length && keys.every((x) => x.k)) {
      for (const f of keys) facts.push({ k: `Devolve ${code(f.k)}`, v: describeExpr(f.v, ctx) });
      detail = `{ ${keys.map((x) => x.k).slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`;
    } else if (!detail && resp.kind === "resource") {
      const fields = ctx && ctx.resolver && ctx.resolver.resourceFields ? ctx.resolver.resourceFields(resp.resource, ctx) : null;
      facts.push({ k: "Formato da resposta", v: resp.resource ? code(resp.resource) : "recurso JSON" });
      if (fields && fields.length) facts.push({ k: "Campos do recurso", v: fields.slice(0, 14).map(code).join(", ") });
      detail = resp.resource ? resp.resource.split("\\").pop() : "";
      if (resp.body) facts.push({ k: "Modelo/dados", v: describeExpr(resp.body, ctx) });
    } else if (resp.kind === "view") {
      facts.push({ k: "Página (view)", v: code(resp.view || "?") });
      detail = resp.view ? `view ${resp.view}` : "";
    } else if (!detail && resp.body && resp.kind !== "redirect") {
      facts.push({ k: "Corpo", v: describeExpr(resp.body, ctx) });
      detail = trunc(resp.body.replace(/\s+/g, " "), 38);
    }

    if (resp.redirect) {
      const to = resp.body ? describeExpr(resp.body, ctx) : "outra página";
      facts.push({ k: "Destino", v: to });
      const base = {
        nodeType: "return",
        title: "Redireciona o cliente",
        story: `Encerra a requisição **redirecionando** o cliente para ${to}.`,
        short: `Redireciona o cliente para ${to}.`,
        facts,
        tone: "ok",
      };
      return handler ? { ...base, outcome: { status: st ?? 302, statusText: txt || "Redirecionamento", tone: "ok", detail: "redireciona" } } : base;
    }

    const kindTxt = RESP_KIND_PT[resp.kind] || "uma resposta";
    const verdict =
      tone === "error"
        ? st === 401 || st === 403
          ? "É um caminho de **recusa**: o acesso é negado e o processamento para aqui."
          : st === 404
          ? "É um caminho de **não encontrado**: o que foi pedido não existe e o processamento para aqui."
          : st >= 500
          ? "É um caminho de **falha**: algo deu errado e o cliente recebe um erro."
          : "É um caminho de **rejeição**: a requisição é recusada e o processamento para aqui."
        : "É um caminho de **sucesso**: o pedido foi atendido e o processamento termina aqui.";
    const title = known ? `Responde ${st} · ${txt}` : "Devolve a resposta ao cliente";
    const short = `Devolve ${kindTxt}${known ? ` com status ${st} (${txt})` : ""}.`;
    const base = {
      nodeType: "return",
      title,
      story: `Encerra a requisição respondendo${known ? ` **${st} (${txt})**` : ""} com ${kindTxt}. ${verdict}`,
      short,
      facts,
      tone,
    };
    return handler ? { ...base, outcome: { status: st, statusText: txt || "Retorno ao cliente", tone: known ? tone : "neutral", detail } } : base;
  }

  // retorno de valor simples
  if (isConditionLike(e)) {
    const c = describeCondition(e, ctx);
    return {
      nodeType: "return",
      title: "Devolve verdadeiro/falso",
      story: `Devolve **verdadeiro** quando ${c.pos}; caso contrário, **falso**.`,
      short: `Devolve verdadeiro quando ${c.pos}; senão, falso.`,
      facts: [],
      tone: "neutral",
      ...(handler ? { outcome: { status: 200, statusText: "OK", tone: "ok", detail: "valor" } } : {}),
    };
  }
  if (handler) {
    const d = describeExpr(e, ctx);
    return {
      nodeType: "return",
      title: "Devolve o resultado (200 · OK)",
      story: `O Laravel converte o valor devolvido (${d}) em resposta HTTP **200 (OK)** — objetos e listas viram JSON automaticamente.`,
      short: `Devolve ${d} como resposta 200.`,
      facts: [{ k: "Status HTTP", v: "200 · OK" }, { k: "Valor devolvido", v: d }],
      tone: "ok",
      outcome: { status: 200, statusText: "OK", tone: "ok", detail: trunc(e.replace(/\s+/g, " "), 38) },
    };
  }
  return {
    nodeType: "return",
    title: "Retorna um valor",
    story: `Devolve ${describeExpr(e, ctx)} para quem chamou e encerra esta função.`,
    short: `Devolve ${describeExpr(e, ctx)}.`,
    facts: [{ k: "Valor devolvido", v: code(trunc(e, 80)) }],
    tone: "neutral",
  };
}

/* ------------------------------------------------------------------ */
/* Exceções                                                            */
/* ------------------------------------------------------------------ */

function describeThrow(rest, ctx) {
  const e = rest.trim();
  const ch = parseChain(e);
  const cls = ch && ch.head.kind === "new" ? ch.head.name : null;
  const short = cls ? cls.split("\\").pop() : null;
  const args = ch && ch.head.kind === "new" ? ch.head.args : [];
  const sv = (i) => (args[i] && isStringLit(args[i]) ? strVal(args[i]) : null);
  let msg = sv(0);
  let status = cls ? excStatus(cls) : null;
  if (short === "HttpException" || short === "HttpResponseException") {
    const s = statusFromExpr(args[0]);
    if (s) {
      status = s;
      msg = sv(1);
    }
  }
  if (!status && cls && ctx && ctx.resolver && ctx.resolver.exceptionStatus) status = ctx.resolver.exceptionStatus(cls, ctx);
  const label = short || (ch && ch.head.kind === "var" ? `exceção em ${ch.head.name}` : "erro");
  const handledBy = status
    ? `O Laravel converte essa exceção em uma resposta **${status} (${statusText(status)})**.`
    : "Se ninguém tratar (`catch`), o Laravel responde **500 (Erro interno)** — ou usa o `render()` da exceção, quando existir.";
  return {
    nodeType: "throw",
    title: msg ? `Lança erro: “${trunc(msg, 40)}”` : `Lança ${label}`,
    short: `Lança ${code(label)}${msg ? ` com a mensagem “${msg}”` : ""}, interrompendo este caminho.`,
    story:
      `Lança a exceção ${code(label)}${msg ? ` com a mensagem “${msg}”` : ""}. ` +
      `Isso **interrompe** o caminho atual: o fluxo salta para o ${code("catch")} compatível mais próximo. ${handledBy}`,
    facts: [...(msg ? [{ k: "Mensagem do erro", v: `“${msg}”` }] : []), ...(status ? [{ k: "Vira resposta HTTP", v: `${status} · ${statusText(status)}` }] : [])],
    tone: "error",
    exception: cls,
    outcome: status ? { status, statusText: statusText(status), tone: "error", detail: msg ? trunc(msg, 38) : short || "" } : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Eloquent / facades / helpers                                        */
/* ------------------------------------------------------------------ */

const FACADES = new Set([
  "DB", "Cache", "Log", "Http", "Mail", "Notification", "Event", "Bus", "Queue", "Storage", "Auth", "Hash", "Gate", "Session", "Artisan",
  "Validator", "Schema", "Config", "Str", "Arr", "Carbon", "CarbonImmutable", "Redirect", "Response", "URL", "Route", "App", "File", "Password",
  "RateLimiter", "Crypt", "Cookie", "Lang", "Process", "Request", "Inertia", "Redis", "Broadcast", "Date", "Number", "Collection", "Sanctum",
  "Socialite", "Cashier", "Pipeline", "Lottery", "Context", "Concurrency", "Vite", "View", "Blade", "Exceptions", "Mockery", "Carbon\\Carbon",
]);

const READ_ONE = new Set(["first", "find", "firstOrFail", "findOrFail", "sole", "firstWhere", "value", "findOr", "firstOr", "soleValue"]);
const READ_MANY = new Set(["get", "all", "paginate", "simplePaginate", "cursorPaginate", "pluck", "findMany", "cursor", "lazy", "chunk", "each"]);
const AGGREGATE = new Set(["count", "sum", "avg", "max", "min", "exists", "doesntExist"]);
const CREATE = new Set(["create", "insert", "firstOrCreate", "updateOrCreate", "forceCreate", "createMany", "insertGetId", "upsert", "insertOrIgnore", "saveMany", "createQuietly", "firstOrNew"]);
const UPDATE = new Set(["update", "increment", "decrement", "touch", "fill", "save", "push", "updateQuietly", "restore", "saveQuietly", "forceFill", "updateOrInsert"]);
const DELETE = new Set(["delete", "destroy", "forceDelete", "truncate", "deleteQuietly"]);
const REL_SYNC = new Set(["attach", "detach", "sync", "toggle", "syncWithoutDetaching", "associate", "dissociate", "updateExistingPivot"]);
const REFRESH = new Set(["fresh", "refresh", "load", "loadMissing", "loadCount", "loadSum"]);
const FILTER = new Set(["where", "orWhere", "whereIn", "whereNotIn", "whereNull", "whereNotNull", "whereHas", "orWhereHas", "doesntHave", "has", "whereBetween", "whereDate", "whereMonth", "whereYear", "whereRelation", "whereKey", "whereColumn", "whereLike", "whereNot", "whereBelongsTo", "withWhereHas", "whereDoesntHave", "whereJsonContains"]);
const MODEL_STATIC_ONLY = new Set(["find", "findOrFail", "first", "firstOrFail", "all", "where", "create", "query", "with", "whereIn", "orderBy", "latest", "oldest", "paginate", "findMany", "firstOrCreate", "updateOrCreate", "destroy", "count", "insert", "upsert", "withTrashed", "onlyTrashed", "whereKey", "sole", "firstWhere", "forceCreate", "factory", "select", "has", "whereHas", "pluck", "exists", "max", "min", "sum", "avg", "orWhere", "whereNull", "whereNotNull", "whereBetween", "lockForUpdate"]);

const modelWord = (n) => code(String(n || "?").split("\\").pop());

function rawWhere(c) {
  const a = c.args || [];
  const col = strVal(a[0] || "");
  switch (c.name) {
    case "where":
    case "orWhere":
    case "whereNot":
      if (a.length === 1) return code(trunc(a[0], 40));
      if (a.length >= 3) return `${code(col ?? a[0])} ${strVal(a[1]) ?? a[1]} ${describeExpr(a[2])}`;
      return `${code(col ?? a[0])} = ${describeExpr(a[1])}`;
    case "whereIn":
      return `${code(col ?? a[0])} está em ${describeExpr(a[1] || "")}`;
    case "whereNotIn":
      return `${code(col ?? a[0])} não está em ${describeExpr(a[1] || "")}`;
    case "whereNull":
      return `${code(col ?? a[0])} é nulo`;
    case "whereNotNull":
      return `${code(col ?? a[0])} não é nulo`;
    case "whereHas":
    case "orWhereHas":
    case "withWhereHas":
    case "whereRelation":
      return `a relação ${code(col ?? a[0])} atende a uma condição`;
    case "has":
      return `tem registros em ${code(col ?? a[0])}`;
    case "doesntHave":
    case "whereDoesntHave":
      return `não tem registros em ${code(col ?? a[0])}`;
    case "whereBetween":
      return `${code(col ?? a[0])} está entre os valores informados`;
    case "whereKey":
      return `o id é ${describeExpr(a[0] || "")}`;
    default:
      return `${code(col ?? a[0] ?? "")} (${c.name})`;
  }
}

function eloquentFacts(model, calls, term, ctx) {
  const facts = [];
  if (model) facts.push({ k: "Modelo", v: modelWord(model) });
  const filters = calls.filter((c) => !c.prop && FILTER.has(c.name)).map(rawWhere);
  if (filters.length) facts.push({ k: "Filtros", v: filters.slice(0, 6).join("; ") + (filters.length > 6 ? "…" : "") });
  const order = calls.filter((c) => !c.prop && /^(orderBy|orderByDesc|latest|oldest)$/.test(c.name));
  if (order.length) {
    facts.push({
      k: "Ordenação",
      v: order
        .map((c) => {
          const col = strVal((c.args || [])[0] || "") || (c.name === "latest" || c.name === "oldest" ? "created_at" : "?");
          const desc = c.name === "latest" || c.name === "orderByDesc" || /desc/i.test((c.args || [])[1] || "");
          return `${code(col)} ${desc ? "(do mais novo/maior)" : "(do mais antigo/menor)"}`;
        })
        .join(", "),
    });
  }
  const withs = calls.filter((c) => !c.prop && /^(with|withCount|load|loadMissing|withSum)$/.test(c.name));
  if (withs.length) {
    const names = withs.flatMap((c) => (c.args || []).flatMap((a) => listStrings(a)));
    facts.push({ k: "Relações carregadas", v: names.length ? names.map(code).join(", ") : "relações do modelo" });
  }
  const lim = calls.find((c) => !c.prop && /^(limit|take|paginate|simplePaginate)$/.test(c.name));
  if (lim) facts.push({ k: lim.name === "paginate" || lim.name === "simplePaginate" ? "Paginação" : "Limite", v: (lim.args || [])[0] ? describeExpr(lim.args[0]) : "padrão (15 por página)" });
  if (calls.some((c) => c.name === "lockForUpdate")) facts.push({ k: "Bloqueio", v: "trava os registros até o fim da transação (`lockForUpdate`)" });
  if (calls.some((c) => /^(withTrashed|onlyTrashed)$/.test(c.name))) facts.push({ k: "Excluídos", v: "inclui registros apagados (soft delete)" });
  const arr = term && term.args && term.args.length ? parseArrayLiteral(term.args[0]) : null;
  if (arr && arr.length && arr.every((it) => it.key)) {
    facts.push({ k: "Campos gravados", v: arr.map((it) => code(strVal(it.key) ?? it.key)).join(", ") });
  }
  return facts;
}

/**
 * Operações Eloquent/DB. `chain` = `parseChain(expr)`. Devolve uma descrição ou `null`.
 */
function describeEloquent(chain, ctx, opt = {}) {
  const { head, calls } = chain;
  if (!calls.length) return null;
  const term = calls[calls.length - 1];
  if (term.prop) return null;
  const tn = term.name;
  const varName = opt.varName;
  const into = varName ? ` e guarda o resultado em ${code(varName)}` : "";

  let model = null;
  let isModelHead = false;
  let relation = null;

  if (head.kind === "static") {
    const short = head.name.split("\\").pop();
    if (FACADES.has(short) || FACADES.has(head.name)) return null;
    const cls = ctx.project ? ctx.project.resolveClass(head.name, ctx.file, ctx.cls) : null;
    const isModel = cls ? ctx.project.isKindOf(cls, ["Illuminate\\Database\\Eloquent\\Model", "Model", "Authenticatable", "Pivot"]) : false;
    if (isModel || (!cls && MODEL_STATIC_ONLY.has(calls[0].name))) {
      model = head.name;
      isModelHead = true;
    } else return null;
  } else if (head.kind === "var" || (head.kind === "call" && /^(auth|request)$/.test(head.name))) {
    if (head.kind === "var") {
      const lt = ctx.locals && ctx.locals.get(head.name);
      const cls = lt && ctx.project ? ctx.project.resolveClass(lt, ctx.file, ctx.cls) : null;
      const isModel = cls ? ctx.project.isKindOf(cls, ["Illuminate\\Database\\Eloquent\\Model", "Model", "Authenticatable", "Pivot"]) : false;
      if (cls && !isModel) return null;
      if (isModel) model = cls.name;
      if (!isModel && !lt) {
        // sem tipo conhecido: só aceita operações típicas de modelo/relação
        const known = REL_SYNC.has(tn) || UPDATE.has(tn) || DELETE.has(tn) || REFRESH.has(tn) || (calls.length >= 2 && !calls[0].prop && CREATE.has(tn));
        if (!known || /^(\$this|\$request|\$req|\$job|\$event|\$service)$/.test(head.name)) return null;
        if (isRequestVar(head.name, ctx)) return null;
      }
      if (calls.length >= 2 && !calls[0].prop && !FILTER.has(calls[0].name) && /^[a-z]\w*$/.test(calls[0].name) && !REFRESH.has(calls[0].name)) {
        relation = calls[0].name;
      }
      model = model || head.name;
    } else {
      model = "User";
    }
  } else return null;

  const isInstance = head.kind === "var";
  const holder = code(head.name || model);
  const modelShort = String(model).split("\\").pop();
  // "em `Order`" / "na relação `items` de `$order`"
  const inS = relation ? `na relação ${code(relation)} de ${holder}` : isInstance && !MODEL_NAMED(model, head) ? `em ${holder}` : `em ${modelWord(model)}`;
  const ofS = relation ? `da relação ${code(relation)} de ${holder}` : `de ${modelWord(model)}`;
  const target = isInstance && !relation ? holder : modelWord(model);
  const facts = eloquentFacts(relation ? null : model, calls, term, ctx);
  if (relation) facts.unshift({ k: "Relação", v: `${code(relation)} de ${holder}` });
  const filtersTxt = (() => {
    const f = calls.filter((c) => !c.prop && FILTER.has(c.name)).map(rawWhere);
    return f.length ? ` onde ${f.slice(0, 3).join(" e ")}` : "";
  })();
  const modelClass = relation ? null : head.kind === "static" ? head.name : isInstance ? ctx.locals && ctx.locals.get(head.name) : null;

  const mkR = (nodeType, title, story, extra = {}) => ({ nodeType, title, story, short: story, facts, tone: "neutral", callName: tn, varName, ...extra });
  const byId = (a) => (a ? ` pelo id (${describeExpr(a, ctx)})` : "");

  if (tn === "findOrFail" || tn === "firstOrFail" || tn === "sole") {
    const by = tn === "findOrFail" ? byId(term.args && term.args[0]) || filtersTxt : filtersTxt;
    return mkR(
      "database",
      `Busca ${modelShort}${tn === "findOrFail" ? " pelo id" : ""} (404 se não existir)`,
      `Consulta o banco ${inS}${by}${into}. Se **nenhum registro** for encontrado, o Laravel lança \`ModelNotFoundException\` e responde **404 (Não encontrado)**.`,
      {
        modelClass: modelClass || (head.kind === "static" ? head.name : null),
        single: true,
        guard: {
          nodeType: "database",
          q: `Existe ${inS.replace(/^em /, "").replace(/`/g, "")}${by ? by.replace(/`/g, "") : ""}?`,
          pos: `o registro de ${modelWord(model)} for encontrado`,
          neg: `o registro de ${modelWord(model)} não existir`,
          failOn: "não",
          exception: "ModelNotFoundException",
          outcome: { status: 404, statusText: "Não encontrado", tone: "error", detail: `${modelShort} inexistente` },
        },
      }
    );
  }
  if (READ_ONE.has(tn)) {
    const by = tn === "find" ? byId(term.args && term.args[0]) || filtersTxt : filtersTxt;
    return mkR("database", `Busca ${modelShort}${tn === "find" ? " pelo id" : ""}`, `Consulta o banco ${inS}${by}${into}. Se não houver registro, o resultado é **vazio (nulo)** — nenhum erro é lançado.`, { modelClass, single: true });
  }
  if (READ_MANY.has(tn)) {
    const pg = /paginate|cursorPaginate/i.test(tn);
    return mkR("database", `Lista ${modelShort}${pg ? " (paginado)" : ""}`, `Consulta o banco e traz ${pg ? "uma **página** de registros" : tn === "pluck" ? "uma lista de valores" : "uma **lista** de registros"} ${ofS}${filtersTxt}${into}.`);
  }
  if (AGGREGATE.has(tn)) {
    const w = { count: "conta quantos registros existem", sum: "soma um campo", avg: "calcula a média de um campo", max: "pega o maior valor de um campo", min: "pega o menor valor de um campo", exists: "verifica se existe algum registro", doesntExist: "verifica se não existe nenhum registro" }[tn];
    return mkR("database", `Consulta agregada (${tn})`, `Consulta o banco e ${w} ${inS}${filtersTxt}${into}.`);
  }
  if (CREATE.has(tn)) {
    const upsert = /OrCreate|upsert|OrNew|OrIgnore|OrInsert/i.test(tn);
    return mkR("database", `Grava ${modelShort} no banco`, `${upsert ? "Procura o registro e, se não existir, **cria**" : "**Cria** um novo registro"} ${inS}${into}.`, { modelClass, single: !/Many/.test(tn) });
  }
  if (UPDATE.has(tn)) {
    const col = strVal((term.args || [])[0] || "");
    const amount = (term.args || [])[1];
    let story;
    if (tn === "save" || tn === "push" || tn === "saveQuietly") story = `**Salva** no banco as alterações feitas em ${relation ? inS.replace(/^na /, "a ") : target}`;
    else if (tn === "restore") story = `**Restaura** (desfaz a exclusão d${isInstance ? "e" : "e registros de"}) ${target}`;
    else if (tn === "touch") story = `Atualiza a data de modificação de ${target}`;
    else if (tn === "increment" || tn === "decrement") {
      story = `${tn === "increment" ? "Soma" : "Subtrai"} ${amount ? describeExpr(amount, ctx) : "1"} ${tn === "increment" ? "ao" : "do"} campo ${col ? code(col) : "informado"} de ${target}`;
    } else story = isInstance || relation ? `**Atualiza** os dados de ${relation ? inS.replace(/^na /, "a ") : target}` : `**Atualiza** registros de ${target}${filtersTxt}`;
    return mkR("database", tn === "save" ? `Salva ${modelShort}` : tn === "increment" || tn === "decrement" ? `${tn === "increment" ? "Soma" : "Subtrai"} em ${col || "campo"}` : `Atualiza ${modelShort}`, `${story}${into}.`);
  }
  if (DELETE.has(tn)) {
    const soft = tn === "forceDelete" ? " de forma **definitiva**" : "";
    const what = isInstance || relation ? `o registro ${relation ? inS.replace(/^na /, "a ") : target}` : `registros de ${target}${filtersTxt}`;
    return mkR("database", `Remove ${modelShort}`, `**Remove** ${what}${soft}. Se o modelo usa \`SoftDeletes\`, o registro só é marcado como apagado.`);
  }
  if (REL_SYNC.has(tn)) {
    const w = { attach: "Associa", detach: "Desassocia", sync: "Sincroniza", toggle: "Alterna", syncWithoutDetaching: "Sincroniza (sem remover)", associate: "Associa", dissociate: "Desassocia", updateExistingPivot: "Atualiza o vínculo de" }[tn];
    return mkR("database", `${w} relação ${relation || ""}`.trim(), `${w} registros na relação ${code(relation || calls[0]?.name || "")} de ${holder}.`);
  }
  if (REFRESH.has(tn)) {
    return mkR("database", tn === "fresh" || tn === "refresh" ? "Recarrega do banco" : "Carrega relações", `${tn === "fresh" || tn === "refresh" ? "Busca de novo no banco os dados atualizados" : "Carrega relacionamentos"} de ${holder}${into}.`, { modelClass, single: true });
  }
  return null;
}

/** O nome do "modelo" é um nome de classe de verdade (não o nome de uma variável)? */
function MODEL_NAMED(model, head) {
  return !String(model).startsWith("$") && head.kind === "var";
}

function urlOf(args) {
  const u = args && args[0] ? args[0] : "?";
  return strVal(u) ?? trunc(u, 70);
}

function hostOf(url) {
  const m = String(url).match(/^https?:\/\/([^/\s"'`]+)/);
  return m ? m[1] : "";
}

/** Facades e helpers do framework. */
function describeFramework(chain, ctx, opt = {}) {
  const { head, calls } = chain;
  const varName = opt.varName;
  const into = varName ? ` e guarda o resultado em ${code(varName)}` : "";
  const mkR = (nodeType, title, story, extra = {}) => ({ nodeType, title, story, short: story, facts: extra.facts || [], tone: "neutral", callName: extra.callName, varName, ...extra });
  const A = (c, i) => (c && c.args ? c.args[i] : undefined);
  const first = calls[0];
  const last = calls[calls.length - 1];

  if (head.kind === "static") {
    const f = head.name.split("\\").pop();
    const lastName = last ? last.name : "";

    if (f === "DB") {
      if (first && first.name === "transaction") return mkR("group", "Abre uma transação no banco", "Executa os passos do bloco dentro de uma **transação**: se algum lançar exceção, tudo é desfeito (rollback); se terminar bem, é confirmado (commit).", { callName: "transaction", transaction: true });
      if (first && /^(beginTransaction)$/.test(first.name)) return mkR("group", "Inicia uma transação", "Abre uma transação no banco: as alterações só valem após o `commit`.", { callName: "beginTransaction" });
      if (first && first.name === "commit") return mkR("group", "Confirma a transação (commit)", "Confirma de vez todas as alterações feitas desde o início da transação.", { callName: "commit" });
      if (first && first.name === "rollBack") return mkR("group", "Desfaz a transação (rollback)", "Desfaz todas as alterações feitas desde o início da transação.", { callName: "rollBack", tone: "error" });
      const tbl = first && first.name === "table" ? strVal(A(first, 0) || "") : null;
      const op = lastName;
      const opTxt = { insert: "grava", insertGetId: "grava", update: "atualiza", delete: "remove", get: "lê", first: "lê", count: "conta", select: "consulta", statement: "executa SQL", raw: "usa SQL cru" }[op] || "consulta";
      return mkR("database", `Acessa o banco${tbl ? ` (tabela ${tbl})` : ""}`, `Usa o construtor de consultas do Laravel (${code("DB::" + (first ? first.name : ""))}) e ${opTxt} dados${tbl ? ` na tabela ${code(tbl)}` : ""}${into}.`, { callName: lastName, facts: tbl ? [{ k: "Tabela", v: code(tbl) }] : [] });
    }
    if (f === "Http" && /^(get|post|put|patch|delete|head|send)$/.test(lastName)) {
      const url = urlOf(last.args);
      const method = lastName === "send" ? strVal(A(last, 0) || "")?.toUpperCase() || "?" : lastName.toUpperCase();
      return mkR("external_call", `Chama serviço externo${hostOf(url) ? ` (${hostOf(url)})` : ""}`, `Faz uma chamada HTTP **${method}** para ${code(url)}${into}. É uma dependência externa: se o serviço falhar ou demorar, o fluxo é afetado${calls.some((c) => c.name === "throw") ? " — e, como há `->throw()`, uma resposta de erro vira exceção" : ""}.`, { callName: "Http", facts: [{ k: "Serviço", v: code(url) }, { k: "Método HTTP", v: method }], mayThrow: true });
    }
    if (f === "Log" || (f === "Cache" && false)) {
      return mkR("function", "Registra log", `Escreve uma mensagem de log (nível ${code(lastName)}): ${(last.args || []).slice(0, 2).map((a) => describeExpr(a, ctx)).join(", ") || "sem texto"}. Não altera o resultado da requisição.`, { callName: lastName });
    }
    if (f === "Cache") {
      const k = (last.args || [])[0] ? describeExpr(last.args[0], ctx) : "uma chave";
      const w = { get: `Lê ${k} do cache`, put: `Grava ${k} no cache`, remember: `Usa o cache ${k} (calcula e guarda se ainda não existir)`, rememberForever: `Usa o cache ${k} (sem expirar)`, forget: `Apaga ${k} do cache`, has: `Verifica se ${k} está no cache`, increment: `Soma 1 em ${k} no cache`, flush: "Limpa todo o cache", add: `Grava ${k} no cache se ainda não existir`, lock: `Obtém um bloqueio ${k}` }[lastName] || `Usa o cache (${lastName})`;
      return mkR("function", w.split(" ").slice(0, 3).join(" ") === w ? w : `Cache: ${lastName}`, `${w}${into}.`, { callName: lastName });
    }
    if (f === "Mail" || f === "Notification") {
      const sent = calls.find((c) => /^(send|queue|later|sendNow|route)$/.test(c.name));
      const arg = sent && sent.args && sent.args[0] ? sent.args[0] : (last.args || []).find((a) => /^new\s/.test(a.trim()));
      const mc = arg && parseChain(arg);
      const cname = mc && mc.head.kind === "new" ? mc.head.name.split("\\").pop() : null;
      const queued = calls.some((c) => /^(queue|later)$/.test(c.name));
      const to = calls.find((c) => c.name === "to");
      return mkR("notify", `${f === "Mail" ? "Envia e-mail" : "Envia notificação"}${cname ? ` (${cname})` : ""}`, `${queued ? "Coloca na **fila** o envio" : "Envia"} ${f === "Mail" ? "de um e-mail" : "de uma notificação"}${cname ? ` ${code(cname)}` : ""}${to ? ` para ${describeExpr((to.args || [])[0] || "", ctx)}` : ""}. ${queued ? "O envio acontece em segundo plano, fora desta requisição." : "O envio acontece durante a requisição (a menos que a classe seja enfileirada)."}`, { callName: lastName, facts: [...(cname ? [{ k: "Classe", v: code(cname) }] : []), ...(to ? [{ k: "Destinatário", v: describeExpr((to.args || [])[0] || "", ctx) }] : [])], eventClass: cname });
    }
    if (f === "Event" || f === "Bus" || f === "Queue" || f === "Broadcast") {
      const arg = (last.args || [])[0] || "";
      const ac = parseChain(arg);
      const cname = ac && ac.head.kind === "new" ? ac.head.name.split("\\").pop() : classConst(arg) ? classConst(arg).split("\\").pop() : null;
      return mkR("queue", `Dispara ${f === "Event" ? "evento" : "trabalho"}${cname ? ` ${cname}` : ""}`, `${f === "Event" ? "Dispara o evento" : "Despacha"} ${cname ? code(cname) : "um item"}${f === "Event" ? ": os **listeners** registrados reagem a ele (alguns podem rodar em fila)" : ": jobs que implementam `ShouldQueue` rodam em segundo plano"}.`, { callName: lastName, eventClass: cname, facts: cname ? [{ k: "Classe", v: code(cname) }] : [] });
    }
    if (f === "Storage") {
      const w = { put: "Grava um arquivo", get: "Lê um arquivo", delete: "Remove um arquivo", putFile: "Grava um arquivo enviado", putFileAs: "Grava um arquivo enviado", url: "Obtém a URL de um arquivo", exists: "Verifica se um arquivo existe", download: "Baixa um arquivo", copy: "Copia um arquivo", move: "Move um arquivo" }[lastName] || `Operação de arquivo (${lastName})`;
      const disk = first && first.name === "disk" ? strVal(A(first, 0) || "") : null;
      return mkR("function", w, `${w} no armazenamento${disk ? ` (disco ${code(disk)})` : ""}${into}.`, { callName: lastName });
    }
    if (f === "Auth") {
      const w = { attempt: "Tenta autenticar com as credenciais", login: "Autentica o usuário", logout: "Encerra a sessão do usuário", loginUsingId: "Autentica pelo id", once: "Autentica só nesta requisição", user: "Obtém o usuário autenticado", id: "Obtém o id do usuário autenticado" }[lastName] || `Autenticação (${lastName})`;
      return mkR("function", w, `${w}${into}.`, { callName: lastName });
    }
    if (f === "Hash" && lastName === "make") return mkR("function", "Gera hash da senha", `Gera o **hash** (versão criptografada, irreversível) de ${describeExpr((last.args || [])[0] || "", ctx)}${into}.`, { callName: "make" });
    if (f === "Gate" && /^(authorize|allows|denies|check)$/.test(lastName)) return null; // tratado como guarda
    if (f === "Session") return mkR("function", "Usa a sessão", `Lê ou grava dados na sessão do usuário (${code(lastName)})${into}.`, { callName: lastName });
    if (f === "Artisan") return mkR("function", "Executa comando Artisan", `Roda o comando ${code(strVal(A(last, 0) || "") || "artisan")} do Laravel${into}.`, { callName: "call" });
    if (f === "Validator" && lastName === "make") return null;
    if (f === "RateLimiter") return mkR("function", "Controla limite de tentativas", `Usa o limitador de tentativas (${code(lastName)}) para evitar abuso${into}.`, { callName: lastName });
    if (f === "File") return mkR("function", "Usa o sistema de arquivos", `Operação de arquivo local (${code(lastName)})${into}.`, { callName: lastName });
    if (f === "Redis") return mkR("function", "Usa o Redis", `Executa ${code(lastName)} no Redis${into}.`, { callName: lastName });
    if (f === "Config" || f === "Date" || f === "Carbon" || f === "CarbonImmutable" || f === "Str" || f === "Arr" || f === "Number") return null;
  }

  if (head.kind === "call") {
    const a = head.args;
    switch (head.name) {
      case "event": {
        const ac = a[0] ? parseChain(a[0]) : null;
        const cname = ac && ac.head.kind === "new" ? ac.head.name.split("\\").pop() : null;
        return mkR("queue", `Dispara evento${cname ? ` ${cname}` : ""}`, `Dispara o evento ${cname ? code(cname) : "informado"}: os **listeners** registrados reagem a ele (alguns podem rodar em fila).`, { callName: "event", eventClass: cname, facts: cname ? [{ k: "Classe", v: code(cname) }] : [] });
      }
      case "dispatch":
      case "dispatch_sync":
      case "dispatch_now": {
        const ac = a[0] ? parseChain(a[0]) : null;
        const cname = ac && ac.head.kind === "new" ? ac.head.name.split("\\").pop() : null;
        const sync = head.name !== "dispatch";
        return mkR("queue", `Despacha trabalho${cname ? ` ${cname}` : ""}`, `${sync ? "Executa na hora" : "Coloca na **fila**"} o trabalho ${cname ? code(cname) : "informado"}${sync ? "" : ": ele roda em segundo plano, fora desta requisição"}.`, { callName: "dispatch", eventClass: cname, facts: cname ? [{ k: "Classe", v: code(cname) }] : [] });
      }
      case "logger":
      case "info":
        return mkR("function", "Registra log", `Escreve uma mensagem de log: ${a.slice(0, 2).map((x) => describeExpr(x, ctx)).join(", ") || "sem texto"}. Não altera o resultado da requisição.`, { callName: "logger" });
      case "report":
        return mkR("function", "Reporta o erro", "Envia o erro para o log/monitoramento **sem interromper** a requisição.", { callName: "report" });
      case "cache":
        return mkR("function", "Usa o cache", `Lê ou grava no cache${into}.`, { callName: "cache" });
      case "session":
        return mkR("function", "Usa a sessão", `Lê ou grava dados na sessão do usuário${into}.`, { callName: "session" });
      case "auth":
        if (calls.length) {
          const lastN = last.name;
          if (/^(user|id|check|guest)$/.test(lastN)) return null;
          return mkR("function", `Autenticação (${lastN})`, `Usa o sistema de autenticação (${code(lastN)})${into}.`, { callName: lastN });
        }
        return null;
      case "tap":
      case "rescue":
        return mkR("function", head.name === "rescue" ? "Executa tolerando falhas" : "Executa e devolve o valor", `Chama ${code("tap/rescue")}: roda o bloco informado e segue${head.name === "rescue" ? " mesmo que ele lance uma exceção" : ""}.`, { callName: head.name });
      default:
    }
  }

  // $user->createToken('x')->plainTextToken, $model->notify(new X)
  if (head.kind === "var" && calls.length) {
    if (first.name === "notify") {
      const ac = first.args && first.args[0] ? parseChain(first.args[0]) : null;
      const cname = ac && ac.head.kind === "new" ? ac.head.name.split("\\").pop() : null;
      return mkR("notify", `Envia notificação${cname ? ` (${cname})` : ""}`, `Notifica ${code(head.name)}${cname ? ` com ${code(cname)}` : ""}. Dependendo da classe, o envio vai para a fila.`, { callName: "notify", eventClass: cname, facts: cname ? [{ k: "Classe", v: code(cname) }] : [] });
    }
    if (first.name === "createToken") return mkR("function", "Gera token de acesso", `Cria um **token de API** para ${code(head.name)} (Sanctum/Passport)${into}.`, { callName: "createToken" });
    if (/^(store|storeAs|storePublicly)$/.test(first.name) && calls.length === 1 && /file|upload|image|avatar|photo|doc/i.test(head.name)) {
      return mkR("function", "Grava o arquivo enviado", `Salva o arquivo ${code(head.name)} no armazenamento${into}.`, { callName: first.name });
    }
  }
  if (head.kind === "var" && isRequestVar(head.name, ctx) && first) {
    if (first.name === "validate" || first.name === "validateWithBag") return null; // guarda
    if (first.name === "merge" || first.name === "mergeIfMissing") return mkR("function", "Ajusta os dados da requisição", "Acrescenta/substitui campos nos dados da requisição antes de seguir.", { callName: "merge" });
    if (first.name === "session") return mkR("function", "Usa a sessão", "Lê ou grava dados na sessão do usuário.", { callName: "session" });
    if (first.name === "file" && calls.length > 1 && /^(store|storeAs)/.test(calls[1].name)) return mkR("function", "Grava o arquivo enviado", `Salva o arquivo ${code(strVal(A(first, 0) || "") ?? "")} enviado na requisição no armazenamento${into}.`, { callName: calls[1].name });
  }
  // Job::dispatch(...) / Event::dispatch(...)
  if (head.kind === "static" && calls.length >= 1 && /^(dispatch|dispatchSync|dispatchIf|dispatchUnless|dispatchAfterResponse)$/.test(calls[0].name)) {
    const cname = head.name.split("\\").pop();
    const sync = /Sync/.test(calls[0].name);
    return mkR("queue", `Despacha ${cname}`, `${sync ? "Executa na hora" : "Coloca na **fila**"} ${code(cname)}${sync ? "" : ": roda em segundo plano, fora desta requisição (se implementar `ShouldQueue`)"}.`, { callName: calls[0].name, eventClass: cname, facts: [{ k: "Classe", v: code(cname) }] });
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Guardas: abort, authorize, validate                                 */
/* ------------------------------------------------------------------ */

function abortInfo(args, statusIdx = 0) {
  const st = statusFromExpr(args[statusIdx]);
  const msg = args[statusIdx + 1] && isStringLit(args[statusIdx + 1]) ? strVal(args[statusIdx + 1]) : null;
  return { status: st, msg };
}

export function ruleWords(rules) {
  return rules;
}

/** Condições "sempre falha": `abort(403)` etc. e guardas com condição. */
function describeGuard(chain, ctx, opt = {}) {
  const { head, calls } = chain;
  const varName = opt.varName;
  const into = varName ? ` e guarda o resultado em ${code(varName)}` : "";

  if (head.kind === "call" && /^(abort|abort_if|abort_unless)$/.test(head.name) && !calls.length) {
    const a = head.args;
    if (head.name === "abort") {
      const { status, msg } = abortInfo(a, 0);
      const st = status ?? 500;
      return {
        nodeType: "throw",
        title: `Aborta com ${st} · ${statusText(st)}`,
        short: `Aborta a requisição com ${st} (${statusText(st)})${msg ? `: “${msg}”` : ""}.`,
        story: `Chama \`abort(${st})\`: a requisição é **interrompida na hora** e o cliente recebe **${st} (${statusText(st)})**${msg ? ` com a mensagem “${msg}”` : ""}.`,
        facts: [{ k: "Status HTTP", v: `${st} · ${statusText(st)}` }, ...(msg ? [{ k: "Mensagem", v: `“${msg}”` }] : [])],
        tone: "error",
        outcome: { status: st, statusText: statusText(st), tone: "error", detail: msg ? trunc(msg, 38) : "" },
        abort: true,
      };
    }
    const { status, msg } = abortInfo(a, 1);
    const st = status ?? 500;
    let c = describeCondition(a[0] || "", ctx);
    const unless = head.name === "abort_unless";
    if (unless) c = swap(c);
    // `c.pos` = quando aborta
    return {
      nodeType: "condition",
      title: c.q,
      short: `Se ${c.pos}, aborta com ${st} (${statusText(st)}).`,
      story: `Verifica **${unq(c.q)}?** Se sim, chama \`${head.name}\` e a requisição é **interrompida** com **${st} (${statusText(st)})**${msg ? ` — “${msg}”` : ""}. Se não, o fluxo segue.`,
      facts: [{ k: "Se verdadeiro", v: `aborta com ${st} · ${statusText(st)}` }, ...(msg ? [{ k: "Mensagem", v: `“${msg}”` }] : [])],
      tone: "neutral",
      guard: {
        nodeType: "condition",
        q: c.q,
        pos: c.pos,
        neg: c.neg,
        failOn: "sim",
        exception: "HttpException",
        outcome: { status: st, statusText: statusText(st), tone: "error", detail: msg ? trunc(msg, 38) : "" },
      },
    };
  }

  // $this->authorize('ability', $model) / Gate::authorize(...)
  const isAuthorize =
    (head.kind === "var" && head.name === "$this" && calls.length === 1 && /^authorize(?:ForUser)?$/.test(calls[0].name)) ||
    (head.kind === "static" && head.name.split("\\").pop() === "Gate" && calls.length === 1 && /^authorize$/.test(calls[0].name)) ||
    (head.kind === "var" && calls.length === 1 && /^(?:authorize)$/.test(calls[0].name) && /^\$(user|request)$/.test(head.name));
  if (isAuthorize) {
    const a = calls[0].args || [];
    const ab = strVal(a[0] || "") ?? a[0] ?? "?";
    const target = a[1] ? describeExpr(a[1], ctx) : null;
    const policy = ctx.resolver && ctx.resolver.policyFor ? ctx.resolver.policyFor(strVal(a[0] || ""), a[1], ctx) : null;
    return {
      nodeType: "validation",
      title: `Verifica permissão (${ab})`,
      short: `Checa se o usuário pode ${code(ab)}${target ? ` em ${target}` : ""}; senão, responde 403.`,
      story: `Pergunta ao Laravel se o usuário pode **${ab}**${target ? ` em ${target}` : ""} (via Gate/Policy). Se **não** puder, lança \`AuthorizationException\` e responde **403 (Proibido)**.`,
      facts: [{ k: "Permissão", v: code(ab) }, ...(target ? [{ k: "Sobre", v: target }] : [])],
      tone: "neutral",
      callee: policy || undefined,
      guard: {
        nodeType: "validation",
        q: `O usuário pode ${ab}${target ? " neste registro" : ""}?`,
        pos: `o usuário tiver permissão para ${code(ab)}${target ? ` em ${target}` : ""}`,
        neg: `o usuário não tiver permissão para ${code(ab)}`,
        failOn: "não",
        exception: "AuthorizationException",
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "não autorizado" },
      },
    };
  }

  // $request->validate([...]) / $this->validate($request, [...]) / Validator::make(...)->validate()
  const isReqValidate = head.kind === "var" && isRequestVar(head.name, ctx) && calls.length === 1 && /^validate(?:WithBag)?$/.test(calls[0].name);
  const isThisValidate = head.kind === "var" && head.name === "$this" && calls.length === 1 && calls[0].name === "validate";
  const isFacadeValidate = head.kind === "static" && head.name.split("\\").pop() === "Validator" && calls.length === 2 && calls[0].name === "make" && /^validate(d)?$/.test(calls[1].name);
  if (isReqValidate || isThisValidate || isFacadeValidate) {
    const rulesArg = isReqValidate ? calls[0].args[0] : isThisValidate ? calls[0].args[1] : calls[0].args[1];
    const rules = rulesArg ? parseRules(rulesArg) : [];
    return {
      nodeType: "validation",
      title: "Valida os dados da requisição",
      short: `Valida ${rules.length || "os"} campo(s); se algum for inválido, responde 422.`,
      story: `Valida os dados recebidos contra as regras abaixo. Se **algum campo for inválido**, o Laravel interrompe e responde **422 (Dados inválidos)** com a lista de erros por campo${isReqValidate || isThisValidate ? " (ou volta ao formulário, em páginas web)" : ""}. Se tudo estiver certo, o fluxo segue${varName ? ` e ${code(varName)} guarda os dados validados` : ""}.`,
      facts: ruleFacts(rules),
      tone: "neutral",
      rules,
      guard: {
        nodeType: "validation",
        q: "Os dados enviados são válidos?",
        pos: "todos os campos enviados forem válidos",
        neg: "algum campo enviado for inválido",
        failOn: "não",
        exception: "ValidationException",
        outcome: { status: 422, statusText: "Dados inválidos", tone: "error", detail: "errors por campo" },
      },
    };
  }
  void into;
  return null;
}

/* ------------------------------------------------------------------ */
/* Regras de validação                                                 */
/* ------------------------------------------------------------------ */

const RULE_PT = {
  required: "obrigatório", nullable: "pode ser nulo", sometimes: "só validado se enviado", filled: "não pode ser vazio quando enviado", present: "precisa estar presente",
  string: "texto", integer: "número inteiro", numeric: "número", boolean: "verdadeiro/falso", array: "lista", email: "e-mail válido", url: "URL válida",
  date: "data válida", uuid: "UUID válido", ulid: "ULID válido", json: "JSON válido", alpha: "só letras", alpha_dash: "letras, números, - e _", alpha_num: "letras e números",
  confirmed: "precisa de confirmação (`_confirmation`)", accepted: "deve ser aceito", declined: "deve ser recusado", file: "arquivo", image: "imagem", ip: "endereço IP",
  active_url: "URL ativa", timezone: "fuso horário válido", prohibited: "proibido", distinct: "sem valores repetidos", bail: "para na primeira falha", lowercase: "minúsculas", uppercase: "maiúsculas",
  decimal: "decimal", mac_address: "endereço MAC", ascii: "ASCII", hex_color: "cor hexadecimal",
};

function ruleToken(tok, ctxType) {
  const t = String(tok).trim();
  const [name, ...rest] = t.split(":");
  const arg = rest.join(":");
  const parts = arg ? arg.split(",") : [];
  if (RULE_PT[name]) return RULE_PT[name];
  switch (name) {
    case "min":
      return ctxType === "array" ? `mínimo de ${arg} itens` : ctxType === "number" ? `valor mínimo ${arg}` : `mínimo de ${arg} caracteres`;
    case "max":
      return ctxType === "array" ? `máximo de ${arg} itens` : ctxType === "number" ? `valor máximo ${arg}` : `máximo de ${arg} caracteres`;
    case "size":
      return `tamanho exato ${arg}`;
    case "between":
      return `entre ${parts[0]} e ${parts[1]}`;
    case "digits":
      return `exatamente ${arg} dígitos`;
    case "digits_between":
      return `entre ${parts[0]} e ${parts[1]} dígitos`;
    case "in":
      return `um de: ${parts.join(", ")}`;
    case "not_in":
      return `diferente de: ${parts.join(", ")}`;
    case "unique":
      return `único em ${parts[0] ? `\`${parts[0]}${parts[1] ? "." + parts[1] : ""}\`` : "tabela"}`;
    case "exists":
      return `precisa existir em \`${parts[0]}${parts[1] ? "." + parts[1] : ""}\``;
    case "regex":
      return `segue o padrão \`${trunc(arg, 30)}\``;
    case "date_format":
      return `data no formato \`${arg}\``;
    case "after":
    case "after_or_equal":
      return `data depois${name === "after_or_equal" ? " (ou igual)" : ""} de \`${arg}\``;
    case "before":
    case "before_or_equal":
      return `data antes${name === "before_or_equal" ? " (ou igual)" : ""} de \`${arg}\``;
    case "same":
      return `igual a \`${arg}\``;
    case "different":
      return `diferente de \`${arg}\``;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${{ gt: "maior que", gte: "maior ou igual a", lt: "menor que", lte: "menor ou igual a" }[name]} \`${arg}\``;
    case "required_if":
      return `obrigatório quando \`${parts[0]}\` = ${parts.slice(1).join(", ")}`;
    case "required_unless":
      return `obrigatório, exceto quando \`${parts[0]}\` = ${parts.slice(1).join(", ")}`;
    case "required_with":
      return `obrigatório quando houver ${parts.map((x) => `\`${x}\``).join(", ")}`;
    case "required_with_all":
      return `obrigatório quando houver todos: ${parts.map((x) => `\`${x}\``).join(", ")}`;
    case "required_without":
      return `obrigatório quando faltar ${parts.map((x) => `\`${x}\``).join(", ")}`;
    case "required_without_all":
      return `obrigatório quando faltarem todos: ${parts.map((x) => `\`${x}\``).join(", ")}`;
    case "mimes":
      return `arquivo do tipo ${parts.join(", ")}`;
    case "mimetypes":
      return `arquivo MIME ${parts.join(", ")}`;
    case "dimensions":
      return `dimensões da imagem: ${arg}`;
    case "starts_with":
      return `começa com ${parts.join(" ou ")}`;
    case "ends_with":
      return `termina com ${parts.join(" ou ")}`;
    case "current_password":
      return "igual à senha atual do usuário";
    case "exclude_if":
    case "exclude_unless":
    case "exclude":
      return "excluído dos dados validados em certas condições";
    default:
      return `regra \`${t}\``;
  }
}

/** Uma regra (string `a|b:1`, `Rule::in([...])`, `new Foo`, `Password::min(8)`) → frases. */
function ruleItemToWords(raw, ctxType) {
  const t = raw.trim();
  const s = strVal(t);
  if (s != null) return s.split("|").filter(Boolean).map((x) => ruleToken(x, ctxType));
  const ch = parseChain(t);
  if (ch && ch.head.kind === "static") {
    const h = ch.head.name.split("\\").pop();
    const c0 = ch.calls[0];
    const a = c0 && c0.args ? c0.args : [];
    if (h === "Rule" && c0) {
      switch (c0.name) {
        case "in":
          return [`um de: ${listStrings(a[0] || "").join(", ") || trunc(a[0] || "", 30)}`];
        case "notIn":
          return [`diferente de: ${listStrings(a[0] || "").join(", ")}`];
        case "unique":
          return [`único em \`${strVal(a[0] || "") ?? "tabela"}${a[1] && strVal(a[1]) ? "." + strVal(a[1]) : ""}\`${ch.calls.some((x) => x.name === "ignore") ? " (ignorando o próprio registro)" : ""}`];
        case "exists":
          return [`precisa existir em \`${strVal(a[0] || "") ?? "tabela"}${a[1] && strVal(a[1]) ? "." + strVal(a[1]) : ""}\``];
        case "requiredIf":
          return ["obrigatório sob condição"];
        case "enum":
          return [`valor do enum \`${classConst(a[0] || "") ?? "?"}\``];
        case "dimensions":
          return ["dimensões da imagem restritas"];
        case "when":
          return ["regras condicionais"];
        case "file":
          return ["arquivo"];
        case "forEach":
          return ["regras por item"];
        default:
      }
    }
    if (h === "Password") return [`senha forte (${ch.calls.map((x) => (x.name === "min" ? `mín. ${(x.args || [])[0]} caracteres` : x.name === "letters" ? "letras" : x.name === "mixedCase" ? "maiúsculas e minúsculas" : x.name === "numbers" ? "números" : x.name === "symbols" ? "símbolos" : x.name === "uncompromised" ? "não vazada" : x.name)).join(", ")})`];
    if (h === "File" || h === "Dimensions") return ["arquivo/imagem com restrições"];
  }
  if (ch && ch.head.kind === "new") return [`regra personalizada \`${ch.head.name.split("\\").pop()}\``];
  if (/^function|^fn\b/.test(t)) return ["regra personalizada (função)"];
  return [`regra \`${trunc(t, 30)}\``];
}

/** Interpreta um array de regras → `[{ field, words: string[], raw }]`. */
export function parseRules(arrText) {
  const arr = parseArrayLiteral(arrText);
  if (!arr) return [];
  const out = [];
  for (const it of arr) {
    if (!it.key) continue;
    const field = strVal(it.key) ?? it.key;
    let items = [];
    const v = it.value.trim();
    if (strVal(v) != null) items = [v];
    else {
      const inner = parseArrayLiteral(v);
      items = inner ? inner.map((x) => x.value) : [v];
    }
    const tokens = items.flatMap((x) => (strVal(x) != null ? strVal(x).split("|") : [x]));
    const has = (n) => tokens.some((x) => typeof x === "string" && new RegExp(`^${n}(?::|$)`).test(x.trim()));
    const ctxType = has("array") ? "array" : has("integer") || has("numeric") || has("decimal") ? "number" : "string";
    const words = items.flatMap((x) => ruleItemToWords(x, ctxType));
    out.push({ field, words, required: has("required"), optional: has("nullable") || has("sometimes") });
  }
  return out;
}

function ruleFacts(rules) {
  const req = rules.filter((r) => r.required).map((r) => code(r.field));
  const opt = rules.filter((r) => !r.required).map((r) => code(r.field));
  const facts = [];
  if (rules.length) facts.push({ k: "Campos validados", v: String(rules.length) });
  if (req.length) facts.push({ k: "Obrigatórios", v: req.slice(0, 14).join(", ") + (req.length > 14 ? "…" : "") });
  if (opt.length) facts.push({ k: "Opcionais", v: opt.slice(0, 14).join(", ") + (opt.length > 14 ? "…" : "") });
  return facts;
}

/** Itens "Por dentro" com uma linha por campo validado. */
export function ruleSummaryItems(rules, file, line, depth = 0) {
  return rules.slice(0, 48).map((r) => {
    const when = (r.when || []).filter(Boolean);
    const cond = when.length ? ` — **quando** ${when.join(" e ")}` : "";
    return {
      text: `${code(r.field)}: ${r.words.join("; ") || "sem regra explícita"}${cond}`,
      line,
      depth,
      tone: "neutral",
      file,
      kind: "rule",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Chamadas genéricas e resolvidas                                     */
/* ------------------------------------------------------------------ */

function callTarget(chain) {
  const { head, calls } = chain;
  const last = calls[calls.length - 1];
  if (!last) return { name: head.name, recv: "" };
  const idxAt = chain.text.lastIndexOf(last.op + last.name);
  const recv = chain.text.slice(0, idxAt).trim();
  return { name: last.name, recv };
}

function describeGenericCall(chain, ctx, opt = {}) {
  const { head } = chain;
  const { name, recv } = callTarget(chain);
  const last = chain.calls[chain.calls.length - 1];
  const args = last ? last.args || [] : head.args || [];
  const isNew = head.kind === "new" && !chain.calls.length;
  const callee = !isNew && ctx.resolver ? ctx.resolver.resolve(chain, ctx) : null;
  const h = humanizeName(name);
  const title = h.verb ? h.title : callee && callee.className ? `Chama ${callee.className}::${name}()` : `Chama ${name}`;
  const target = isNew
    ? `cria uma nova instância de ${code(head.name)}`
    : recv
    ? `chama o método ${code(name)} de ${code(trunc(recv, 40))}`
    : `chama a função ${code(name)}`;
  let story = cap(target);
  if (args.length) story += `, passando ${args.map((a) => describeExpr(a, ctx)).join("; ")}`;
  if (opt.varName) story += ` — e guarda o resultado em ${code(opt.varName)}`;
  story += ".";
  const short = story;
  if (callee) {
    story += ` A implementação está em ${code(`${callee.file}:${callee.line}`)}${callee.className ? `, na classe ${code(callee.className)}` : ""} — veja **“Por dentro de ${name}”** nos detalhes.`;
  }
  const facts = [];
  if (callee && callee.params.length) {
    callee.params.forEach((p, i) => {
      if (args[i] !== undefined) facts.push({ k: `Parâmetro ${code(p)}`, v: describeExpr(args[i], ctx) });
    });
    for (const u of callee.usesFields || []) facts.push({ k: `Campos de ${code(u.param)} usados`, v: u.fields.map(code).join(", ") });
  } else if (args.length) {
    args.forEach((a, i) => facts.push({ k: `Argumento ${i + 1}`, v: describeExpr(a, ctx) }));
  }
  const bareVerb = h.verb && !h.noun;
  return {
    nodeType: "function",
    title: isNew ? `Cria ${head.name.split("\\").pop()}` : bareVerb && recv ? `${title} (${trunc(recv, 24)})` : title,
    story,
    short,
    facts,
    tone: "neutral",
    callName: name,
    receiver: recv || null,
    callee,
    varName: opt.varName,
    mayThrow: Boolean(callee && callee.raises),
  };
}

/** `match (expr) { a => x, b => y, default => z }` → descrição em português (ou null). */
function describeMatch(rhs, ctx) {
  const m = /^match\s*\(/.exec(rhs);
  if (!m) return null;
  const open = rhs.indexOf("(", m.index);
  const close = matchClose(rhs, open);
  if (close < 0) return null;
  const bo = rhs.indexOf("{", close);
  if (bo < 0) return null;
  const bc = matchClose(rhs, bo);
  if (bc < 0) return null;
  const subj = rhs.slice(open + 1, close).trim();
  const arms = (splitTop(rhs.slice(bo + 1, bc), ",") || [rhs.slice(bo + 1, bc)]).map((a) => a.trim()).filter(Boolean);
  const labels = [];
  let throws = false;
  for (const a of arms) {
    const at = findTopOp(a, ["=>"]);
    if (!at) continue;
    const lhs = a.slice(0, at.i).trim();
    const body = a.slice(at.i + 2).trim();
    labels.push(/^default$/i.test(lhs) ? "nos demais casos" : `quando for ${describeExpr(lhs, ctx)}`);
    const t = /^throw\s+new\s+\\?([\w\\]+)/.exec(body);
    if (t) throws = throws === false ? t[1].split("\\").pop() : true;
    else if (/^throw\b/.test(body) && !throws) throws = true;
  }
  const shown = labels.slice(0, 4).join("; ");
  return { subject: describeExpr(subj, ctx), cases: labels.length ? `${shown}${labels.length > 4 ? `; e mais ${labels.length - 4} caso(s)` : ""}.` : "vários casos.", throws };
}

/** Registra o tipo de uma variável local (para resolver `$order->save()` etc.). */
function recordLocal(varName, cls, ctx) {
  if (!cls || !/^\$\w+$/.test(varName) || !ctx.locals) return;
  ctx.locals.set(varName, ctx.project ? ctx.project.qualify(cls, ctx.file) : cls);
}

function describeAssignOf(target, rhs, ctx, opName) {
  const r = rhs.trim();
  const varName = target.trim();
  const rr = requestRead(r, ctx);
  if (rr) {
    const d = describeRequestRead(rr);
    const lead = rr.kind === "validated" && !rr.name ? "Lê os dados já validados" : rr.kind === "user" ? "Obtém o usuário autenticado" : "Lê da requisição";
    return {
      nodeType: "assignment",
      title: `${lead}`,
      story: `Pega ${d} e guarda na variável ${code(varName)}.`,
      short: `Pega ${d} e guarda em ${code(varName)}.`,
      facts: [],
      tone: "neutral",
      varName,
    };
  }
  const mt = describeMatch(r, ctx);
  if (mt) {
    return { nodeType: "assignment", title: `Define ${varName} conforme ${mt.subject}`, story: `${code(varName)} recebe um valor que **depende de** ${mt.subject}: ${mt.cases}${mt.throws ? " Em um dos casos o código **lança uma exceção**" + (mt.throws === true ? "" : ` (${code(mt.throws)})`) + "." : ""}`, short: `${code(varName)} depende de ${mt.subject}.`, facts: [], tone: "neutral", varName };
  }
  const ch = parseChain(r);
  if (ch) {
    const g = describeGuard(ch, ctx, { varName });
    if (g) return { ...g, varName };
    const f = describeFramework(ch, ctx, { varName });
    if (f) return { ...f, varName };
    const e = describeEloquent(ch, ctx, { varName });
    if (e) {
      recordLocal(varName, e.single ? e.modelClass : null, ctx);
      return { ...e, varName };
    }
    const callable = (ch.head.kind === "call" && !/^(count|collect|route|config|env|now|today|__|trans|request|auth|tap|optional|data_get|array_\w+|str_\w+|in_array|implode|explode|json_\w+|round|floor|ceil|abs|max|min|sprintf|number_format|time|date|strtotime|intval|floatval|strval|trim|strtolower|strtoupper|ucfirst|md5|sha1|uniqid|bin2hex|random_int|rand|mt_rand|Str|Arr|sum|compact|is_\w+|isset|empty|asset|url|collect)$/.test(ch.head.name)) || (ch.head.kind === "new") || ((ch.head.kind === "static" || ch.head.kind === "var") && ch.calls.some((c) => !c.prop));
    const pure = ch.head.kind === "static" && /^(Str|Arr|Carbon|CarbonImmutable|Config|Number|Date)$/.test(ch.head.name.split("\\").pop());
    if (callable && !pure) {
      const resolvable = ctx.resolver && ctx.resolver.resolve(ch, ctx);
      const hasMethod = ch.calls.some((c) => !c.prop) || ch.head.kind === "new";
      if (resolvable || hasMethod) {
        const d = describeGenericCall(ch, ctx, { varName });
        recordLocal(varName, ch.head.kind === "new" && !ch.calls.length ? ch.head.name : d.callee && d.callee.returnClass, ctx);
        return d;
      }
    }
  }
  if (isConditionLike(r)) {
    const c = describeCondition(r, ctx);
    return { nodeType: "assignment", title: `Define ${varName}`, story: `A variável ${code(varName)} passa a valer **verdadeiro** quando ${c.pos}; caso contrário, **falso**.`, short: `${code(varName)} = verdadeiro quando ${c.pos}.`, facts: [], tone: "neutral", varName };
  }
  const op = opName === "." ? "acrescenta ao texto" : null;
  void op;
  return {
    nodeType: "assignment",
    title: `Define ${varName}`,
    story: `${code(varName)} recebe ${describeExpr(r, ctx)}.`,
    short: `${code(varName)} recebe ${describeExpr(r, ctx)}.`,
    facts: [],
    tone: "neutral",
    varName,
  };
}

/**
 * Descreve uma instrução simples PHP.
 * @returns {{ nodeType: string, title: string, story: string, short?: string, facts: {k:string,v:string}[], tone: string, outcome?: object, guard?: object, callName?: string, varName?: string, callee?: object }}
 */
export function describeStatement(text, ctx = {}) {
  const t = String(text).trim().replace(/;+\s*$/, "").trim();

  if (/^return\s+DB::transaction\s*\(/.test(t)) {
    const tch = parseChain(t.replace(/^return\s+/, ""));
    const tf = tch && describeFramework(tch, ctx);
    if (tf) return tf;
  }
  if (/^return\b/.test(t)) return describeReturn(t.replace(/^return\s*/, ""), ctx);
  if (/^throw\b/.test(t)) return describeThrow(t.replace(/^throw\s*/, ""), ctx);

  // `$a = $b = x` não é tratado; `$x = ...`, `$x .= ...`, `$x[] = ...`, `$this->p = ...`, `[$a, $b] = ...`
  let m = /^(\[[^\]]*\]|list\([^)]*\))\s*=(?!=)\s*([\s\S]+)$/.exec(t);
  if (m) {
    const names = m[1].replace(/^list\(|\)$|[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    return { nodeType: "assignment", title: "Separa valores", story: `Separa ${describeExpr(m[2], ctx)} em ${names.map(code).join(", ")}.`, short: `Separa valores em ${names.map(code).join(", ")}.`, facts: [], tone: "neutral", varName: names.join(", ") };
  }
  m = /^([\w$>\-\[\]"'\\:]+?)\s*(\.|\+|-|\*|\/|\?\?)=(?!=)\s*([\s\S]+)$/.exec(t);
  if (m) {
    const [, tgt, op, rhs] = m;
    const r = describeExpr(rhs, ctx);
    const story = { ".": `Acrescenta ${r} ao texto de ${code(tgt)}.`, "+": `Soma ${r} ao valor de ${code(tgt)}.`, "-": `Subtrai ${r} do valor de ${code(tgt)}.`, "*": `Multiplica ${code(tgt)} por ${r}.`, "/": `Divide ${code(tgt)} por ${r}.`, "??": `Define ${code(tgt)} como ${r} apenas se ainda não tiver valor.` }[op];
    return { nodeType: "assignment", title: `Atualiza ${tgt}`, story, short: story, facts: [], tone: "neutral", varName: tgt };
  }
  m = /^(\$[\w]+(?:->\w+|\[[^\]]*\])*)(\+\+|--)$/.exec(t);
  if (m) {
    const story = `${m[2] === "++" ? "Soma 1 a" : "Subtrai 1 de"} ${code(m[1])}.`;
    return { nodeType: "assignment", title: `Atualiza ${m[1]}`, story, short: story, facts: [], tone: "neutral", varName: m[1] };
  }
  m = /^((?:\$[\w]+|\$this)(?:->\w+|\[[^\]]*\])*)\s*=(?!=|>)\s*([\s\S]+)$/.exec(t);
  if (m) return describeAssignOf(m[1], m[2], ctx);
  m = /^(static::\$\w+|self::\$\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(t);
  if (m) return describeAssignOf(m[1], m[2], ctx);

  const ch = parseChain(t);
  if (ch) {
    const g = describeGuard(ch, ctx);
    if (g) return g;
    const f = describeFramework(ch, ctx);
    if (f) return f;
    const e = describeEloquent(ch, ctx);
    if (e) return e;
    return describeGenericCall(ch, ctx);
  }
  if (/^(?:unset|echo|print|exit|die)\b/.test(t)) {
    return { nodeType: "unknown", title: "Executa uma instrução", story: `Executa ${code(trunc(t, 100))}.`, facts: [], tone: "neutral" };
  }
  return { nodeType: "unknown", title: "Executa uma instrução", story: `Executa ${code(trunc(t, 100))}.`, facts: [], tone: "neutral" };
}

/** Título/história de um `foreach`/`for`/`while`. */
export function describeLoop(s, ctx = {}) {
  if (s.loopKind === "foreach") {
    const m = /^([\s\S]+?)\s+as\s+(\$\w+)(?:\s*=>\s*(\$\w+))?$/.exec(s.head);
    if (m) {
      const item = m[3] || m[2];
      return {
        title: `Para cada ${item.replace("$", "")} em ${trunc(m[1], 30)}`,
        story: `Repete os passos seguintes **para cada** ${code(item)} de ${describeExpr(m[1], ctx)}. Cada volta trabalha com um item diferente.`,
      };
    }
  }
  if (s.loopKind === "while" || s.loopKind === "do") {
    const c = describeCondition(s.head || "true", ctx);
    return { title: `Enquanto ${trunc(c.pos, 40)}`, story: `Repete os passos seguintes **enquanto** ${c.pos}.` };
  }
  return { title: "Repete um bloco (for)", story: `Repete os passos seguintes de acordo com ${code(trunc(s.head, 60))}.` };
}

/* ------------------------------------------------------------------ */
/* Dados de entrada da requisição                                      */
/* ------------------------------------------------------------------ */

/** Procura leituras da requisição em um corpo de método: `[{ where, name }]`. */
export function findRequestInputs(body, extraVars = []) {
  const seen = new Set();
  const out = [];
  const add = (where, name) => {
    const k = `${where}:${name}`;
    if (name && !seen.has(k)) {
      seen.add(k);
      out.push({ where, name });
    }
  };
  const vars = ["request", "req", ...extraVars.map((v) => v.replace(/^\$/, ""))].map((v) => v.replace(/[^\w]/g, ""));
  const V = `\\$(?:${vars.join("|")})`;
  const kind = (fn) => ({ query: "query", header: "headers", headers: "headers", cookie: "cookies", file: "files", route: "params" }[fn] || "input");
  for (const m of body.matchAll(new RegExp(`${V}\\s*->\\s*(input|get|post|string|str|integer|float|boolean|date|collect|enum|query|header|cookie|file|route|has|filled|missing|hasFile|validated)\\s*\\(\\s*(['"])([^'"]+)\\2`, "g"))) {
    if (m[1] === "route") add("params", m[3]);
    else if (m[1] === "has" || m[1] === "filled" || m[1] === "missing") add("input", m[3]);
    else if (m[1] === "hasFile") add("files", m[3]);
    else add(kind(m[1]), m[3]);
  }
  for (const m of body.matchAll(new RegExp(`${V}\\s*->\\s*(only|except)\\s*\\(\\s*(\\[[^\\]]*\\])`, "g"))) {
    if (m[1] === "only") for (const n of listStrings(m[2])) add("input", n);
  }
  for (const m of body.matchAll(new RegExp(`${V}\\s*->\\s*([A-Za-z_]\\w*)\\b(?!\\s*\\()`, "g"))) add("input", m[1]);
  for (const m of body.matchAll(new RegExp(`${V}\\s*\\[\\s*(['"])([^'"]+)\\1\\s*\\]`, "g"))) add("input", m[2]);
  for (const m of body.matchAll(/\brequest\(\s*(['"])([^'"]+)\1/g)) add("input", m[2]);
  // propriedades que não são campos
  return out.filter((i) => !(i.where === "input" && /^(user|all|query|input|session|route|headers|cookies|files|server|method|ip|url|path|json|validated|safe|merge|has|filled|only|except|file|header|cookie|bearerToken|isMethod|fullUrl|expectsJson|wantsJson|ajax|validate|boolean|string|integer|date|collect|get|post)$/.test(i.name)));
}

const WHERE_PT = {
  input: "campos da requisição",
  body: "corpo (body)",
  query: "query string",
  params: "parâmetros da URL",
  headers: "cabeçalhos",
  cookies: "cookies",
  files: "arquivos enviados",
};

export function describeInputs(inputs) {
  const groups = new Map();
  for (const i of inputs) {
    if (!groups.has(i.where)) groups.set(i.where, []);
    groups.get(i.where).push(i.name);
  }
  return [...groups.entries()].map(([where, names]) => ({
    k: cap(WHERE_PT[where] || where),
    v: names.map(code).join(", "),
  }));
}

export { splitArgs, stringLiteral, classConst };
