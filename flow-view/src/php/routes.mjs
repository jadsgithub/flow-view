/**
 * Leitura estática das rotas do Laravel (`routes/*.php`, `bootstrap/app.php`, `RouteServiceProvider`):
 * verbos, `match/any`, grupos (`prefix`, `middleware`, `name`, `controller`, `namespace`, `domain`),
 * `resource/apiResource/singleton`, `view/redirect`, closures e includes (`require`, `->group(base_path(...))`).
 * O arquivo de rotas NUNCA é executado: é só texto analisado.
 */

import path from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { parseStatements, parseChain, stringLiteral, classConst, parseArrayLiteral, matchClose, lineNoAt, ws, splitArgs } from "./parse.mjs";
import { escapeRegExp } from "../security.mjs";

const VERBS = new Set(["get", "post", "put", "patch", "delete", "options", "any", "match"]);
const MAX_INCLUDE_DEPTH = 8;
const MAX_ROUTES = 5000;

const IRREGULAR = { people: "person", children: "child", men: "man", women: "woman", mice: "mouse", geese: "goose", feet: "foot", teeth: "tooth" };

export function singular(w) {
  const s = String(w);
  if (IRREGULAR[s]) return IRREGULAR[s];
  if (/ies$/.test(s)) return s.replace(/ies$/, "y");
  if (/(ss|x|z|ch|sh)es$/.test(s)) return s.replace(/es$/, "");
  if (/ses$/.test(s)) return s.replace(/es$/, "");
  if (/(ss|us|is)$/.test(s)) return s;
  if (/s$/.test(s)) return s.slice(0, -1);
  return s;
}

const paramFor = (seg, overrides) => (overrides && overrides[seg]) || singular(seg).replace(/-/g, "_");

export function joinUri(...parts) {
  const segs = parts
    .map((p) => String(p || "").trim())
    .flatMap((p) => p.split("/"))
    .filter(Boolean);
  return "/" + segs.join("/");
}

/** Valor textual de um argumento: string literal, `Foo::class` ou concatenação simples de literais. */
function strArg(a) {
  if (a == null) return null;
  const t = a.trim();
  const lit = stringLiteral(t);
  if (lit != null) return lit.replace(/\\(['"\\])/g, "$1");
  const cc = classConst(t);
  if (cc) return cc;
  if (/^(['"]).*\1\s*\.\s*(['"]).*\2$/s.test(t)) {
    const parts = t.split(/(?<=['"])\s*\.\s*(?=['"])/);
    const lits = parts.map((p) => stringLiteral(p.trim()));
    if (lits.every((x) => x != null)) return lits.join("");
  }
  return null;
}

/** Lista de strings de um argumento (string, array de strings/`Foo::class`). */
function namesArg(a) {
  if (a == null) return [];
  const s = strArg(a);
  if (s != null) return [s];
  const arr = parseArrayLiteral(a);
  if (arr) return arr.flatMap((it) => namesArg(it.value));
  return [];
}

function parseWhere(args, into) {
  if (!args.length) return;
  const arr = parseArrayLiteral(args[0]);
  if (arr) {
    for (const it of arr) {
      const k = strArg(it.key || "");
      const v = strArg(it.value);
      if (k && v) into[k] = v;
    }
    return;
  }
  const k = strArg(args[0]);
  const v = strArg(args[1]);
  if (k && v) into[k] = v;
}

const WHERE_SHORT = {
  whereNumber: "[0-9]+",
  whereAlpha: "[a-zA-Z]+",
  whereAlphaNumeric: "[a-zA-Z0-9]+",
  whereUuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
  whereUlid: "[0-7][0-9A-HJKMNP-TV-Z]{25}",
};

/** Intervalo (índices absolutos) de um closure/arrow function a partir do texto de um argumento. */
function closureRange(src, absStart, argText) {
  const t = argText;
  let m = /^(?:static\s+)?function\s*&?\s*\(/.exec(t);
  if (m) {
    const open = absStart + m[0].length - 1;
    const close = matchClose(src, open);
    if (close < 0) return null;
    let k = ws(src, close + 1);
    if (/^use\b/.test(src.slice(k, k + 4))) {
      const u = ws(src, k + 3);
      const uc = matchClose(src, u);
      k = ws(src, uc < 0 ? u : uc + 1);
    }
    if (src[k] === ":") {
      const rm = /^:\s*\??[\w\\|]+/.exec(src.slice(k));
      if (rm) k = ws(src, k + rm[0].length);
    }
    if (src[k] !== "{") return null;
    const bc = matchClose(src, k);
    if (bc < 0) return null;
    return { shape: "block", bodyOpen: k, bodyClose: bc, paramsOpen: open, paramsClose: close };
  }
  m = /^(?:static\s+)?fn\s*&?\s*\(/.exec(t);
  if (m) {
    const open = absStart + m[0].length - 1;
    const close = matchClose(src, open);
    if (close < 0) return null;
    const arrow = src.indexOf("=>", close);
    if (arrow < 0) return null;
    return { shape: "arrow", exprStart: arrow + 2, exprEnd: absStart + t.length, paramsOpen: open, paramsClose: close };
  }
  return null;
}

const isClosureText = (t) => /^(?:static\s+)?(?:function|fn)\s*&?\s*\(/.test(t.trim());

export function loadLaravelRoutes(project) {
  const { root } = project;
  const routes = [];
  const visited = new Set();

  const baseCtx = () => ({ prefix: "", middleware: [], without: [], name: "", controller: null, namespace: "", domain: null, where: {} });
  const cloneCtx = (c) => ({ ...c, middleware: [...c.middleware], without: [...c.without], where: { ...c.where } });

  function pushRoute(r) {
    if (routes.length < MAX_ROUTES) routes.push(r);
  }

  /** Resolve o caminho de um arquivo incluído (`base_path('routes/x.php')`, `__DIR__.'/x.php'`). */
  function includePath(argText, fromAbs) {
    const t = argText.trim();
    let m = /^base_path\(\s*(['"])([^'"]+)\1\s*\)$/.exec(t);
    if (m) return path.resolve(root, m[2]);
    m = /^__DIR__\s*\.\s*(['"])([^'"]+)\1$/.exec(t);
    if (m) return path.resolve(path.dirname(fromAbs), "." + (m[2].startsWith("/") ? m[2] : "/" + m[2]));
    m = /^(?:app_path|base_path)\(\s*(['"])([^'"]+)\1\s*\)$/.exec(t);
    if (m) return path.resolve(root, m[2]);
    return null;
  }

  function parseRouteFile(abs, ctx, depth = 0) {
    if (depth > MAX_INCLUDE_DEPTH) return;
    const key = `${abs}::${ctx.prefix}::${ctx.middleware.join(",")}`;
    if (visited.has(key)) return;
    visited.add(key);
    const file = project.parseFile(abs);
    if (!file) return;
    parseRange(file, 0, ctx, depth);
  }

  function parseRange(file, from, ctx, depth) {
    const stmts = parseStatements(file.src, from);
    walkStatements(file, stmts, ctx, depth);
  }

  function walkStatements(file, stmts, ctx, depth) {
    for (const s of stmts) {
      if (s.kind === "simple") handleStatement(file, s, ctx, depth);
      else if (s.kind === "block") walkStatements(file, s.body, ctx, depth);
      else if (s.kind === "if") {
        walkStatements(file, s.then, ctx, depth);
        if (s.else) walkStatements(file, s.else, ctx, depth);
      } else if (s.kind === "loop") walkStatements(file, s.body, ctx, depth);
    }
  }

  function handleStatement(file, s, ctx, depth) {
    const text = s.text;
    const inc = /^(?:require|require_once|include|include_once)\s*\(?\s*([\s\S]+?)\)?$/.exec(text);
    if (inc && !/^Route\b/.test(text)) {
      const p = includePath(inc[1].replace(/\)$/, ""), file.abs);
      if (p) parseRouteFile(p, ctx, depth + 1);
      return;
    }
    if (!/^(?:\\?Route::|\$(?:router|route|r)\s*->|\\?Illuminate\\Support\\Facades\\Route::)/.test(text)) return;
    const chain = parseChain(text);
    if (!chain) return;
    processChain(file, s, chain, ctx, depth);
  }

  function processChain(file, stmt, chain, ctx0, depth) {
    const mods = cloneCtx(ctx0);
    const calls = chain.calls;
    const text = chain.text;
    const absOf = (argText, fromIdx) => {
      const at = text.indexOf(argText, fromIdx);
      return at < 0 ? null : stmt.idx + at;
    };
    let cursor = 0;
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      const n = c.name;
      const args = c.args || [];
      cursor = Math.max(cursor, text.indexOf(n, cursor));
      if (n === "middleware") mods.middleware.push(...args.flatMap(namesArg));
      else if (n === "withoutMiddleware" || n === "excludedMiddleware") mods.without.push(...args.flatMap(namesArg));
      else if (n === "prefix") mods.prefix = joinUri(mods.prefix, strArg(args[0]) || "");
      else if (n === "name" || n === "as") mods.name += strArg(args[0]) || "";
      else if (n === "controller") mods.controller = strArg(args[0]);
      else if (n === "namespace") mods.namespace = [mods.namespace, strArg(args[0]) || ""].filter(Boolean).join("\\");
      else if (n === "domain") mods.domain = strArg(args[0]);
      else if (n === "where") parseWhere(args, mods.where);
      else if (WHERE_SHORT[n]) for (const p of namesArg(args[0])) mods.where[p] = WHERE_SHORT[n];
      else if (n === "scopeBindings" || n === "withoutScopedBindings") continue;
      else if (n === "group") {
        const g = args[args.length - 1] || "";
        // Route::group([attrs], closure)
        if (chain.head.kind === "static" && args.length === 2) {
          const attrs = parseArrayLiteral(args[0]) || [];
          for (const it of attrs) {
            const k = strArg(it.key || "");
            if (k === "prefix") mods.prefix = joinUri(mods.prefix, strArg(it.value) || "");
            else if (k === "middleware") mods.middleware.push(...namesArg(it.value));
            else if (k === "as") mods.name += strArg(it.value) || "";
            else if (k === "namespace") mods.namespace = [mods.namespace, strArg(it.value) || ""].filter(Boolean).join("\\");
            else if (k === "controller") mods.controller = strArg(it.value);
            else if (k === "domain") mods.domain = strArg(it.value);
          }
        }
        if (isClosureText(g)) {
          const at = absOf(g, cursor);
          const rng = at != null ? closureRange(file.src, at, g) : null;
          if (rng && rng.shape === "block") {
            walkStatements(file, parseStatements(file.src, rng.bodyOpen + 1), mods, depth);
          }
        } else {
          const p = includePath(g, file.abs);
          if (p) parseRouteFile(p, mods, depth + 1);
        }
        return;
      } else if (VERBS.has(n) || ["view", "redirect", "permanentRedirect", "fallback", "resource", "apiResource", "resources", "apiResources", "singleton", "apiSingleton"].includes(n)) {
        const post = calls.slice(i + 1);
        terminal(file, stmt, text, c, post, mods, cursor);
        return;
      }
    }
  }

  /** Aplica modificadores que vêm depois do verbo (`->middleware()`, `->name()`, `->where()`...). */
  function applyPost(routesOut, post) {
    for (const p of post) {
      const args = p.args || [];
      for (const r of routesOut) {
        if (p.name === "middleware") r.middleware.push(...args.flatMap(namesArg));
        else if (p.name === "withoutMiddleware" || p.name === "excludedMiddleware") r.without.push(...args.flatMap(namesArg));
        else if (p.name === "name") r.name = (r.name || "") + (strArg(args[0]) || "");
        else if (p.name === "where") parseWhere(args, r.where);
        else if (WHERE_SHORT[p.name]) for (const x of namesArg(args[0])) r.where[x] = WHERE_SHORT[p.name];
        else if (p.name === "can") r.middleware.push("can:" + args.map((a) => strArg(a) || a.trim()).join(","));
      }
    }
  }

  function terminal(file, stmt, text, call, post, mods, cursor) {
    const n = call.name;
    const args = call.args || [];
    const line = lineNoAt(file.src, stmt.idx);
    const isApiFile =
      /(^|[\\/])api\.php$/.test(file.abs) ||
      /(^|[\\/])routes[\\/]integration([\\/]|$)/.test(file.abs) ||
      /(^|[\\/])routes[\\/]api[\\/]/.test(file.abs);
    const mk = (methods, uri, action) => ({
      methods,
      uri: joinUri(mods.prefix, uri),
      rawUri: uri,
      name: mods.name || null,
      action,
      middleware: [...mods.middleware],
      without: [...mods.without],
      where: { ...mods.where },
      domain: mods.domain,
      file: file.abs,
      rel: file.rel,
      line,
      isApi: isApiFile || mods.middleware.includes("api") || /^\/api(\/|$)/.test(joinUri(mods.prefix)),
    });

    const parseAction = (a) => {
      if (a == null) return { kind: "unknown" };
      const t = a.trim();
      const startAbs = (() => {
        const at = text.indexOf(t, cursor);
        return at < 0 ? null : stmt.idx + at;
      })();
      if (isClosureText(t)) {
        const rng = startAbs != null ? closureRange(file.src, startAbs, t) : null;
        return rng ? { kind: "closure", file: file.abs, ...rng, line: lineNoAt(file.src, startAbs) } : { kind: "unknown" };
      }
      const arr = parseArrayLiteral(t);
      if (arr) {
        const uses = arr.find((it) => it.key && strArg(it.key) === "uses");
        if (uses) return parseAction(uses.value);
        if (arr.length >= 2 && !arr[0].key) {
          const cls = strArg(arr[0].value);
          const method = strArg(arr[1].value);
          if (cls && method) return { kind: "controller", classRef: cls, method, namespace: mods.namespace, routeFile: file.abs };
        }
        if (arr.length === 1 && !arr[0].key) {
          const cls = strArg(arr[0].value);
          if (cls) return { kind: "controller", classRef: cls, method: "__invoke", namespace: mods.namespace, routeFile: file.abs };
        }
        return { kind: "unknown" };
      }
      const s = strArg(t);
      if (s != null) {
        if (s.includes("@")) {
          const [cls, method] = s.split("@");
          return { kind: "controller", classRef: cls, method, namespace: mods.namespace, routeFile: file.abs, legacy: true };
        }
        if (mods.controller) return { kind: "controller", classRef: mods.controller, method: s, namespace: mods.namespace, routeFile: file.abs };
        if (classConst(t)) return { kind: "controller", classRef: s, method: "__invoke", namespace: mods.namespace, routeFile: file.abs };
        return { kind: "controller", classRef: s, method: "__invoke", namespace: mods.namespace, routeFile: file.abs, legacy: true };
      }
      return { kind: "unknown" };
    };

    if (VERBS.has(n)) {
      let methods;
      let uriArg;
      let actionArg;
      if (n === "match") {
        methods = namesArg(args[0]).map((m) => m.toUpperCase());
        uriArg = args[1];
        actionArg = args[2];
      } else if (n === "any") {
        methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
        uriArg = args[0];
        actionArg = args[1];
      } else {
        methods = n === "get" ? ["GET", "HEAD"] : [n.toUpperCase()];
        uriArg = args[0];
        actionArg = args[1];
      }
      const uri = strArg(uriArg);
      if (uri == null) return;
      const route = mk(methods, uri, actionArg == null && mods.controller ? { kind: "unknown" } : parseAction(actionArg));
      applyPost([route], post);
      pushRoute(route);
      return;
    }

    if (n === "view") {
      const uri = strArg(args[0]);
      if (uri == null) return;
      const r = mk(["GET", "HEAD"], uri, { kind: "view", view: strArg(args[1]) || "" });
      applyPost([r], post);
      pushRoute(r);
      return;
    }
    if (n === "redirect" || n === "permanentRedirect") {
      const uri = strArg(args[0]);
      if (uri == null) return;
      const status = n === "permanentRedirect" ? 301 : Number(args[2]) || 302;
      const r = mk(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], uri, { kind: "redirect", to: strArg(args[1]) || "", status });
      applyPost([r], post);
      pushRoute(r);
      return;
    }
    if (n === "fallback") {
      const r = mk(["GET", "HEAD"], "{fallbackPlaceholder}", parseAction(args[0]));
      r.fallback = true;
      pushRoute(r);
      return;
    }

    // resource / apiResource / singleton
    const isApi = n === "apiResource" || n === "apiResources" || n === "apiSingleton";
    const isSingleton = n === "singleton" || n === "apiSingleton";
    const defs = [];
    if (n === "resources" || n === "apiResources") {
      for (const it of parseArrayLiteral(args[0]) || []) {
        const nm = strArg(it.key || "");
        const ctl = strArg(it.value);
        if (nm && ctl) defs.push({ name: nm, ctl });
      }
    } else {
      const nm = strArg(args[0]);
      const ctl = strArg(args[1]) ?? mods.controller;
      if (nm && ctl) defs.push({ name: nm, ctl });
    }
    let only = null;
    let except = null;
    const parameters = {};
    let shallow = false;
    const extra = [];
    for (const p of post) {
      const pa = p.args || [];
      if (p.name === "only") only = pa.flatMap(namesArg);
      else if (p.name === "except") except = pa.flatMap(namesArg);
      else if (p.name === "shallow") shallow = true;
      else if (p.name === "parameters" || p.name === "parameter") {
        const arr = parseArrayLiteral(pa[0]);
        if (arr) for (const it of arr) {
          const k = strArg(it.key || "");
          const v = strArg(it.value);
          if (k && v) parameters[k] = v;
        }
        else if (pa.length >= 2) {
          const k = strArg(pa[0]);
          const v = strArg(pa[1]);
          if (k && v) parameters[k] = v;
        }
      } else extra.push(p);
    }
    for (const d of defs) {
      const made = expandResource(d.name, d.ctl, { isApi, isSingleton, only, except, parameters, shallow }, mods, mk);
      for (const r of made) r.action = { kind: "controller", classRef: d.ctl, method: r.action.method, namespace: mods.namespace, routeFile: file.abs };
      applyPost(made, extra);
      for (const r of made) pushRoute(r);
    }
  }

  /* ------------------------------ descoberta ------------------------------ */

  const ctx0 = baseCtx();
  const registered = new Set();
  const reg = (abs, ctx) => {
    registered.add(path.resolve(abs));
    parseRouteFile(abs, ctx);
  };

  const bootstrapFile = path.join(root, "bootstrap", "app.php");
  const boot = existsSync(bootstrapFile) ? project.parseFile(bootstrapFile) : null;
  if (boot) {
    const pick = (k) => {
      const m = new RegExp(`\\b${k}\\s*:\\s*__DIR__\\s*\\.\\s*(['"])([^'"]+)\\1`).exec(boot.src);
      return m ? path.resolve(path.dirname(bootstrapFile), "." + (m[2].startsWith("/") ? m[2] : "/" + m[2])) : null;
    };
    const prefixM = /\bapiPrefix\s*:\s*(['"])([^'"]*)\1/.exec(boot.src);
    const apiPrefix = prefixM ? prefixM[2] : "api";
    const web = pick("web");
    const api = pick("api");
    if (web) reg(web, { ...cloneCtx(ctx0), middleware: ["web"] });
    if (api) reg(api, { ...cloneCtx(ctx0), prefix: apiPrefix ? joinUri(apiPrefix) : "", middleware: ["api"] });
    const then = /\bthen\s*:\s*(?:static\s+)?function\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{/.exec(boot.src);
    if (then) {
      const open = then.index + then[0].length - 1;
      const close = matchClose(boot.src, open);
      if (close > 0) walkStatements(boot, parseStatements(boot.src, open + 1), cloneCtx(ctx0), 0);
    }
  }

  const rsp = path.join(root, "app", "Providers", "RouteServiceProvider.php");
  const rspFile = existsSync(rsp) ? project.parseFile(rsp) : null;
  if (rspFile) {
    const m = /\$this->routes\s*\(\s*(?:static\s+)?function\s*\([^)]*\)\s*\{/.exec(rspFile.src);
    if (m) {
      const open = m.index + m[0].length - 1;
      if (matchClose(rspFile.src, open) > 0) walkStatements(rspFile, parseStatements(rspFile.src, open + 1), cloneCtx(ctx0), 0);
    }
  }

  // arquivos de rotas não registrados acima: padrões do Laravel
  const routesDir = path.join(root, "routes");
  const listPhp = (dir, depth = 0) => {
    const out = [];
    if (depth > 3) return out;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...listPhp(full, depth + 1));
      else if (e.isFile() && e.name.endsWith(".php")) out.push(full);
    }
    return out;
  };
  const alreadyParsed = (abs) => [...visited].some((k) => k.startsWith(path.resolve(abs) + "::"));
  for (const abs of listPhp(routesDir).sort()) {
    const base = path.basename(abs);
    if (/^(console|channels)\.php$/.test(base) || alreadyParsed(abs)) continue;
    if (base === "api.php") reg(abs, { ...cloneCtx(ctx0), prefix: "/api", middleware: ["api"] });
    else if (base === "web.php") reg(abs, { ...cloneCtx(ctx0), middleware: ["web"] });
    else reg(abs, cloneCtx(ctx0));
  }

  return routes;
}

/** Gera as rotas de `resource`/`apiResource`/`singleton`. */
function expandResource(name, ctl, opt, mods, mk) {
  const segs = name.split(".").filter(Boolean);
  if (!segs.length) return [];
  const last = segs[segs.length - 1];
  const parentUri = segs
    .slice(0, -1)
    .map((s) => `${s}/{${paramFor(s, opt.parameters)}}`)
    .join("/");
  const param = paramFor(last, opt.parameters);
  const nested = segs.length > 1;
  const baseUri = [parentUri, last].filter(Boolean).join("/");
  const shallowBase = nested && opt.shallow ? last : baseUri;

  let table;
  if (opt.isSingleton) {
    table = [
      ["show", ["GET", "HEAD"], baseUri],
      ...(opt.isApi ? [] : [["edit", ["GET", "HEAD"], `${baseUri}/edit`]]),
      ["update", ["PUT", "PATCH"], baseUri],
      ["destroy", ["DELETE"], baseUri],
    ];
  } else {
    table = [
      ["index", ["GET", "HEAD"], baseUri],
      ...(opt.isApi ? [] : [["create", ["GET", "HEAD"], `${baseUri}/create`]]),
      ["store", ["POST"], baseUri],
      ["show", ["GET", "HEAD"], `${shallowBase}/{${param}}`],
      ...(opt.isApi ? [] : [["edit", ["GET", "HEAD"], `${shallowBase}/{${param}}/edit`]]),
      ["update", ["PUT", "PATCH"], `${shallowBase}/{${param}}`],
      ["destroy", ["DELETE"], `${shallowBase}/{${param}}`],
    ];
  }
  const wanted = (a) => (!opt.only || opt.only.includes(a)) && (!opt.except || !opt.except.includes(a));
  const out = [];
  for (const [action, methods, uri] of table) {
    if (!wanted(action)) continue;
    const r = mk(methods, uri, { kind: "controller", method: action });
    r.name = `${mods.name}${name}.${action}`;
    out.push(r);
  }
  return out;
}

/* ------------------------------ correspondência ------------------------------ */

const PLACEHOLDER = /^(?:\{[^/{}]+\}|:[A-Za-z_]\w*|<[^/<>]+>)$/;
const SAFE_WHERE_MAX = 90;

function constraintOk(pattern, value) {
  if (!pattern || pattern.length > SAFE_WHERE_MAX || value.length > 200) return true;
  // padrões com quantificador aninhado são ignorados (evita backtracking catastrófico)
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return true;
  }
}

/** Compara `/api/orders/{order}` (rota) com um caminho de requisição (literal ou com `{id}`/`:id`). */
export function routeMatchesPath(route, reqPath) {
  const rs = route.uri.split("/").filter(Boolean);
  const qs = String(reqPath || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);
  const optional = (seg) => /^\{[^/{}?]+\?\}$/.test(seg);
  let qi = 0;
  for (let ri = 0; ri < rs.length; ri++) {
    const seg = rs[ri];
    if (qi >= qs.length) {
      if (optional(seg)) continue;
      return false;
    }
    const q = qs[qi];
    if (/\{[^/{}]+\}/.test(seg)) {
      const full = /^\{([^/{}?]+)\??\}$/.exec(seg);
      if (full) {
        if (!PLACEHOLDER.test(q) && !constraintOk(route.where[full[1]], q)) {
          if (optional(seg)) continue;
          return false;
        }
      } else {
        // segmento misto, ex.: `report-{id}.json`
        const re = new RegExp("^" + seg.split(/(\{[^/{}]+\})/).map((p) => (/^\{/.test(p) ? "[^/]+" : escapeRegExp(p))).join("") + "$");
        if (!PLACEHOLDER.test(q) && !re.test(q)) return false;
      }
    } else if (seg !== q) return false;
    qi++;
  }
  return qi === qs.length;
}

export function matchRoutes(routes, method, reqPath) {
  const m = String(method || "GET").toUpperCase();
  return routes.filter((r) => !r.fallback && (m === "ANY" || r.methods.includes(m)) && routeMatchesPath(r, reqPath));
}

/** Versão resumida para listar as rotas ao usuário/agente. */
export function summarizeRoutes(routes) {
  return routes
    .filter((r) => !r.fallback)
    .map((r) => {
      const a = r.action;
      const handler =
        a.kind === "controller"
          ? `${String(a.classRef || "").split("\\").pop()}@${a.method}`
          : a.kind === "closure"
          ? "Closure"
          : a.kind === "view"
          ? `view:${a.view}`
          : a.kind === "redirect"
          ? `redirect:${a.to}`
          : "?";
      const shown = r.methods.filter((m) => m !== "HEAD");
      return {
        method: shown.length > 3 ? "ANY" : shown.join("|"),
        path: r.uri,
        name: r.name,
        handler,
        middleware: r.middleware,
        file: `${r.rel}:${r.line}`,
      };
    });
}

export { splitArgs };
