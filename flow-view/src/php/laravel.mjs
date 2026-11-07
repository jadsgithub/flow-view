/**
 * Monta o fluxo de uma rota Laravel, na ordem em que o framework executa:
 *   middlewares → route-model binding (404) → FormRequest (prepare → authorize → rules) → corpo do controller.
 * Tudo por leitura estática: nenhum código PHP é executado.
 */

import path from "node:path";
import { createPhpProject, parseParams, primaryType } from "./project.mjs";
import { createPhpResolver } from "./callee.mjs";
import { buildPhpCfg } from "./cfg.mjs";
import { parseArrayLiteral, parseChain, matchClose, lineNoAt, stringLiteral, classConst, splitArgs, parseStatements } from "./parse.mjs";
import { parseRules, ruleSummaryItems, findRequestInputs, describeInputs, describeCondition, statusText, code, trunc } from "./narrate.mjs";

const FORM_REQUEST = ["Illuminate\\Foundation\\Http\\FormRequest", "FormRequest"];
const MODEL = ["Illuminate\\Database\\Eloquent\\Model", "Model", "Authenticatable", "Pivot"];
const emptySym = (extra = {}) => ({ functionName: null, className: null, variables: [], params: [], returnType: null, ...extra });
const str = (e) => {
  const t = String(e ?? "").trim();
  const lit = stringLiteral(t);
  if (lit != null) return lit;
  return classConst(t);
};
const norm = (s) => String(s).replace(/^\$/, "").replace(/_/g, "").toLowerCase();

/** Middlewares que existem no Laravel e que não mudam o desfecho (ignorados na história). */
const NEUTRAL_MW = new Set(["web", "api", "bindings", "cors", "json", "cache.headers", "precognitive", "auth.session", "encrypt", "csrf", "verify_csrf", "shareErrors", "substitute"]);

const BUILTIN_CLASS = {
  Authenticate: "auth", AuthenticateWithBasicAuth: "auth.basic", RedirectIfAuthenticated: "guest", EnsureEmailIsVerified: "verified",
  ThrottleRequests: "throttle", ThrottleRequestsWithRedis: "throttle", Authorize: "can", ValidateSignature: "signed",
  RequirePassword: "password.confirm", CheckAbilities: "abilities", CheckForAnyAbility: "ability", RoleMiddleware: "role",
  PermissionMiddleware: "permission", RoleOrPermissionMiddleware: "role_or_permission", SubstituteBindings: "bindings",
  VerifyCsrfToken: "csrf", ValidateCsrfToken: "csrf", EncryptCookies: "encrypt", ShareErrorsFromSession: "shareErrors", StartSession: "session",
  AddQueuedCookiesToResponse: "cookies", EnsureFrontendRequestsAreStateful: "stateful", HandleCors: "cors", TrimStrings: "trim", ConvertEmptyStringsToNull: "trim",
};

function loadAliases(project) {
  const aliases = new Map(); // alias → { classRef, file }
  const groups = new Map(); // grupo → [nomes]
  const addArray = (text, file, into) => {
    const arr = parseArrayLiteral(text);
    if (!arr) return;
    for (const it of arr) {
      const k = it.key && stringLiteral(it.key);
      if (!k) continue;
      const v = str(it.value);
      if (v) into.set(k, { classRef: v, file });
    }
  };
  const kernelAbs = path.join(project.root, "app", "Http", "Kernel.php");
  const kernel = project.parseFile(kernelAbs);
  if (kernel) {
    for (const m of kernel.src.matchAll(/\$(?:middlewareAliases|routeMiddleware)\s*=\s*(\[|array\s*\()/g)) {
      const open = kernel.src.indexOf(m[1].endsWith("(") ? "(" : "[", m.index + m[0].length - m[1].length);
      const close = matchClose(kernel.src, open);
      if (close > 0) addArray(kernel.src.slice(open, close + 1), kernel, aliases);
    }
    const g = /\$middlewareGroups\s*=\s*(\[)/.exec(kernel.src);
    if (g) {
      const open = kernel.src.indexOf("[", g.index);
      const close = matchClose(kernel.src, open);
      const arr = close > 0 ? parseArrayLiteral(kernel.src.slice(open, close + 1)) : null;
      for (const it of arr || []) {
        const k = it.key && stringLiteral(it.key);
        const members = parseArrayLiteral(it.value);
        if (k && members) groups.set(k, members.map((x) => str(x.value)).filter(Boolean));
      }
    }
  }
  const boot = project.parseFile(path.join(project.root, "bootstrap", "app.php"));
  if (boot) {
    for (const m of boot.src.matchAll(/->\s*alias\s*\(\s*(\[)/g)) {
      const open = boot.src.indexOf("[", m.index);
      const close = matchClose(boot.src, open);
      if (close > 0) addArray(boot.src.slice(open, close + 1), boot, aliases);
    }
    for (const m of boot.src.matchAll(/->\s*group\s*\(\s*(['"])([\w.-]+)\1\s*,\s*(\[)/g)) {
      const open = boot.src.indexOf("[", m.index + m[0].length - 1);
      const close = matchClose(boot.src, open);
      const arr = close > 0 ? parseArrayLiteral(boot.src.slice(open, close + 1)) : null;
      if (arr) groups.set(m[2], arr.map((x) => str(x.value)).filter(Boolean));
    }
  }
  return { aliases, groups };
}

/** Descrição de um middleware embutido do Laravel (ou de pacotes comuns). `null` = não reconhecido. */
function builtinMiddleware(base, args, isApi) {
  const guards = args.filter(Boolean);
  const guardTxt = guards.length ? ` (guard ${guards.map(code).join(", ")})` : "";
  switch (base) {
    case "auth":
    case "auth.session":
      return {
        label: "O usuário está autenticado?",
        story: `Middleware **${base}**: exige um usuário autenticado${guardTxt}. Se não houver, a requisição é recusada antes de chegar ao controller.`,
        pos: `o usuário estiver autenticado${guardTxt}`,
        neg: "o usuário não estiver autenticado",
        outcome: isApi
          ? { status: 401, statusText: "Não autenticado", tone: "error", detail: "Unauthenticated." }
          : { status: 302, statusText: "Redireciona para o login", tone: "error", detail: "vai para /login" },
        facts: [{ k: "Middleware", v: code(base + (guards.length ? ":" + guards.join(",") : "")) }],
      };
    case "auth.basic":
      return {
        label: "Credenciais HTTP Basic corretas?",
        story: "Middleware **auth.basic**: exige usuário e senha via HTTP Basic.",
        pos: "as credenciais HTTP Basic forem válidas",
        neg: "as credenciais HTTP Basic faltarem ou forem inválidas",
        outcome: { status: 401, statusText: "Não autenticado", tone: "error", detail: "Invalid credentials." },
        facts: [],
      };
    case "guest":
      return {
        label: "O usuário é visitante (não logado)?",
        story: "Middleware **guest**: só deixa passar quem ainda **não** está autenticado; quem já está logado é redirecionado.",
        pos: "o usuário não estiver autenticado",
        neg: "o usuário já estiver autenticado",
        outcome: { status: 302, statusText: "Redireciona (já logado)", tone: "error", detail: "vai para a home" },
        facts: [],
      };
    case "verified":
      return {
        label: "O e-mail do usuário foi verificado?",
        story: "Middleware **verified**: só deixa passar quem confirmou o e-mail.",
        pos: "o e-mail do usuário estiver verificado",
        neg: "o e-mail do usuário não estiver verificado",
        outcome: isApi
          ? { status: 403, statusText: "Proibido", tone: "error", detail: "e-mail não verificado" }
          : { status: 302, statusText: "Redireciona para verificar o e-mail", tone: "error", detail: "verification.notice" },
        facts: [],
      };
    case "throttle": {
      const a0 = args[0];
      const limit = /^\d+$/.test(a0 || "") ? `${a0} requisições por ${args[1] && args[1] !== "1" ? args[1] + " minutos" : "minuto"}` : a0 ? `limitador ${code(a0)}` : "o limite padrão";
      return {
        label: "Dentro do limite de requisições?",
        story: `Middleware **throttle**: limita a quantidade de chamadas (${limit}) por usuário/IP. Passou do limite, a resposta é 429.`,
        pos: `o limite de requisições (${limit}) não tiver sido atingido`,
        neg: `o limite de requisições (${limit}) tiver sido atingido`,
        outcome: { status: 429, statusText: "Muitas requisições", tone: "error", detail: limit },
        facts: [{ k: "Limite", v: limit }],
      };
    }
    case "can": {
      const ab = args[0] ? code(args[0]) : "a permissão";
      const on = args[1] ? ` em ${code(args[1])}` : "";
      return {
        label: `O usuário pode ${args[0] || "executar"}${args[1] ? " neste registro" : ""}?`,
        story: `Middleware **can**: consulta a Gate/Policy para saber se o usuário pode ${ab}${on}. Se não puder, responde 403.`,
        pos: `o usuário tiver permissão para ${ab}${on}`,
        neg: `o usuário não tiver permissão para ${ab}${on}`,
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "sem permissão" },
        facts: [{ k: "Permissão", v: ab }],
      };
    }
    case "signed":
      return {
        label: "A URL tem assinatura válida?",
        story: "Middleware **signed**: só aceita links com assinatura válida (e não expirada).",
        pos: "a assinatura da URL for válida",
        neg: "a assinatura da URL for inválida ou expirada",
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "assinatura inválida" },
        facts: [],
      };
    case "password.confirm":
      return {
        label: "A senha foi confirmada recentemente?",
        story: "Middleware **password.confirm**: pede a senha de novo para ações sensíveis.",
        pos: "o usuário tiver confirmado a senha recentemente",
        neg: "o usuário não tiver confirmado a senha recentemente",
        outcome: { status: 302, statusText: "Redireciona para confirmar a senha", tone: "error", detail: "password.confirm" },
        facts: [],
      };
    case "role":
    case "permission":
    case "role_or_permission": {
      const what = base === "role" ? "o papel (role)" : base === "permission" ? "a permissão" : "o papel ou a permissão";
      const list = args.join(", ");
      return {
        label: `O usuário tem ${what.replace(/^o /, "").replace(/^a /, "")} ${list}?`,
        story: `Middleware **${base}** (pacote de permissões): exige ${what} ${code(list)}. Sem isso, responde 403.`,
        pos: `o usuário tiver ${what} ${code(list)}`,
        neg: `o usuário não tiver ${what} ${code(list)}`,
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "sem permissão" },
        facts: [{ k: base === "role" ? "Papel exigido" : "Permissão exigida", v: code(list) }],
      };
    }
    case "abilities":
    case "ability": {
      const list = args.join(", ");
      return {
        label: `O token tem ${base === "abilities" ? "todas as" : "alguma das"} habilidades ${list}?`,
        story: `Middleware **${base}** (Sanctum): confere as habilidades do token de API (${code(list)}).`,
        pos: `o token tiver ${base === "abilities" ? "todas as" : "alguma das"} habilidades ${code(list)}`,
        neg: `o token não tiver as habilidades ${code(list)}`,
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "token sem habilidade" },
        facts: [],
      };
    }
    default:
      return null;
  }
}

/** Extrai as regras de `rules()` percorrendo `if`s, `array_merge` e `$this->…Rules()`. */
function extractRules(project, rulesMethod, ctx) {
  const seenFn = new Set();
  const variants = [];
  const locals = new Map();
  const baseFields = new Set();

  function push(rules, when) {
    const w = (when || []).filter(Boolean);
    for (const r of rules || []) variants.push({ ...r, when: w });
  }

  function collect(expr, owner) {
    const e = String(expr || "").trim().replace(/;+$/, "");
    if (!e) return [];
    if (/^(\[|array\s*\()/.test(e)) return parseRules(e);
    if (/^array_merge\s*\(/.test(e)) {
      const open = e.indexOf("(");
      const close = matchClose(e, open);
      if (close < 0) return [];
      return splitArgs(e.slice(open + 1, close)).flatMap((a) => collect(a, owner));
    }
    const ch = parseChain(e);
    if (ch && ch.head.kind === "var" && ch.head.name === "$this" && ch.calls.length === 1 && !ch.calls[0].prop) {
      const name = ch.calls[0].name;
      const key = `${owner.fqcn || owner.name}::${name}`;
      const m = project.findMethod(owner, name);
      if (!m || m.bodyOpen < 0 || seenFn.has(key)) return [];
      seenFn.add(key);
      const before = variants.length;
      walkMethod(m, []);
      const got = variants.splice(before);
      seenFn.delete(key);
      return got.map((r) => ({ field: r.field, words: r.words, required: r.required, optional: r.optional }));
    }
    if (ch && ch.head.kind === "var" && !ch.calls.length && locals.has(ch.head.name)) {
      return locals.get(ch.head.name);
    }
    return [];
  }

  function fromExpr(expr, when, owner) {
    const e = String(expr || "").trim().replace(/;+$/, "");
    if (!e) return;
    if (/^array_merge\s*\(/.test(e)) {
      const open = e.indexOf("(");
      const close = matchClose(e, open);
      if (close > 0) for (const a of splitArgs(e.slice(open + 1, close))) fromExpr(a, when, owner);
      return;
    }
    const ch = parseChain(e);
    if (ch && ch.head.kind === "var" && ch.head.name === "$this" && ch.calls.length === 1 && !ch.calls[0].prop) {
      const name = ch.calls[0].name;
      const key = `${owner.fqcn || owner.name}::${name}`;
      const m = project.findMethod(owner, name);
      if (m && m.bodyOpen >= 0 && !seenFn.has(key)) {
        seenFn.add(key);
        walkMethod(m, when);
        seenFn.delete(key);
      }
      return;
    }
    push(collect(e, owner), when);
  }

  function walkStmts(stmts, when, owner) {
    for (const s of stmts) {
      if (s.kind === "if") {
        const d = describeCondition(s.cond, ctx || {});
        walkStmts(s.then || [], [...when, d.pos], owner);
        walkStmts(s.else || [], [...when, d.neg], owner);
      } else if (s.kind === "block") {
        walkStmts(s.body || [], when, owner);
      } else if (s.kind === "simple") {
        const t = s.text;
        const ret = /^return\s+([\s\S]+)$/.exec(t);
        if (ret) {
          fromExpr(ret[1], when, owner);
          continue;
        }
        const asg = /^(\$\w+)\s*=\s*([\s\S]+)$/.exec(t);
        if (asg) {
          const got = collect(asg[2], owner);
          locals.set(asg[1], got);
          if (!when.length) for (const r of got) baseFields.add(r.field);
          continue;
        }
        for (const am of t.matchAll(/\$\w+\s*\[\s*(['"])([\w.*-]+)\1\s*\]\s*=\s*([^;]+)/g)) {
          const r = parseRules(`[${JSON.stringify(am[2])} => ${am[3]}]`)[0];
          if (r) push([r], when);
        }
      }
    }
  }

  function walkMethod(method, when) {
    if (!method || method.bodyOpen < 0) return;
    walkStmts(parseStatements(method.cls.file.src, method.bodyOpen + 1), when, method.cls);
  }

  walkMethod(rulesMethod, []);

  const out = [];
  const idx = new Map();
  for (const r of variants) {
    const when = [...(r.when || [])].filter(Boolean);
    const key = `${r.field}|${r.required ? 1 : 0}|${(r.words || []).join(";")}|${when.join("|")}`;
    if (idx.has(key)) continue;
    const copy = { ...r, when };
    idx.set(key, copy);
    out.push(copy);
  }
  // Campos do array-base (sempre presentes) não precisam se repetir em cada ramo.
  const always = new Set(
    out.filter((r) => !r.when.length && baseFields.has(r.field)).map((r) => `${r.field}|${r.required ? 1 : 0}|${(r.words || []).join(";")}`)
  );
  return out.filter((r) => !r.when.length || !always.has(`${r.field}|${r.required ? 1 : 0}|${(r.words || []).join(";")}`));
}

/** O `authorize()` é só `return true;`? */
function trivialAuthorize(body) {
  const t = body.replace(/\s+/g, " ").trim();
  return /^return true;?$/.test(t) || t === "";
}

function ctorMiddleware(project, cls, methodName) {
  const out = [];
  const ctor = cls && cls.methods.get("__construct");
  if (ctor && ctor.bodyOpen >= 0) {
    const body = project.methodBody(ctor);
    for (const m of body.matchAll(/\$this->middleware\s*\(([^;]*?)\)\s*((?:->\s*(?:only|except)\s*\([^;]*?\)\s*)*);/g)) {
      const names = splitArgs(m[1]).map(str).filter(Boolean);
      const only = /->\s*only\s*\(([^)]*)\)/.exec(m[2]);
      const except = /->\s*except\s*\(([^)]*)\)/.exec(m[2]);
      const list = (x) => [...x.matchAll(/['"]([\w]+)['"]/g)].map((y) => y[1]);
      if (only && !list(only[1]).includes(methodName)) continue;
      if (except && list(except[1]).includes(methodName)) continue;
      out.push(...names);
    }
  }
  const mm = cls && cls.methods.get("middleware");
  if (mm && mm.bodyOpen >= 0 && mm.isStatic) {
    const body = project.methodBody(mm);
    const r = /return\s*(\[)/.exec(body);
    if (r) {
      const open = body.indexOf("[", r.index);
      const close = matchClose(body, open);
      const arr = close > 0 ? parseArrayLiteral(body.slice(open, close + 1)) : null;
      for (const it of arr || []) {
        const s = str(it.value);
        if (s) out.push(s);
        else {
          const ch = parseChain(it.value);
          if (ch && ch.head.kind === "new" && /Middleware$/.test(ch.head.name)) {
            const n = str(ch.head.args[0]);
            const onlyArg = ch.head.args.find((a) => /^only\s*:/.test(a));
            if (n && (!onlyArg || [...onlyArg.matchAll(/['"](\w+)['"]/g)].some((y) => y[1] === methodName))) out.push(n);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Preenche `nodes/edges` (via `pushNode`/`edges`) com o fluxo da rota.
 * @returns {{ handlerBody: string, handler: {file:string,line:number,name:string}|null, meta: object }}
 */
export function buildLaravelFlow({ scan, root, pushNode, edges, entryId, entryNode }) {
  const route = scan.route;
  const project = createPhpProject(root);
  const resolver = createPhpResolver(project);
  const routeFile = project.parseFile(route.file);
  const isApi = Boolean(route.isApi);

  /* ---------------- ação da rota ---------------- */
  const action = route.action;
  let cls = null;
  let method = null;
  let handlerName = null;

  const syntheticCls = (file) => ({ kind: "class", name: "(closure)", fqcn: "", extends: [], implements: [], traits: [], methods: new Map(), props: new Map(), file, idx: 0, line: 1 });

  if (action.kind === "controller") {
    const fi = project.parseFile(action.routeFile);
    const tries = [project.qualify(action.classRef, fi)];
    if (action.namespace) tries.push(`App\\Http\\Controllers\\${action.namespace}\\${action.classRef}`);
    tries.push(`App\\Http\\Controllers\\${action.classRef}`, action.classRef);
    for (const t of tries) {
      cls = project.findClass(t);
      if (cls) break;
    }
    if (cls) {
      method = project.findMethod(cls, action.method) || (action.method !== "__invoke" ? null : cls.methods.get("__invoke")) || null;
      if (!method && action.method === "__invoke") method = cls.methods.get("__invoke") || null;
    }
    handlerName = `${String(action.classRef).split("\\").pop()}@${action.method}`;
  } else if (action.kind === "closure") {
    const params = parseParams(routeFile.src.slice(action.paramsOpen + 1, action.paramsClose));
    cls = syntheticCls(routeFile);
    const block = action.shape === "block";
    method = {
      name: "(closure)", visibility: "public", isStatic: false, params, returnType: null, idx: action.paramsOpen,
      bodyOpen: block ? action.bodyOpen : -1, bodyClose: block ? action.bodyClose : -1,
      line: action.line, cls,
    };
    handlerName = "Closure";
  }

  /* ---------------- contexto de narração ---------------- */
  const requestVars = new Set();
  const formRequests = [];
  const modelParams = [];
  const routeParams = [...route.uri.matchAll(/\{([^/{}?:]+)(?::[^/{}?]+)?\??\}/g)].map((m) => m[1]);

  if (method) {
    for (const p of method.params) {
      const t = primaryType(p.type);
      if (!t) continue;
      const q = project.qualify(t, method.cls.file);
      const c = project.findClass(q);
      const short = t.split("\\").pop();
      if (/^Request$/.test(short)) requestVars.add(p.name);
      if (c && project.isKindOf(c, FORM_REQUEST)) {
        requestVars.add(p.name);
        formRequests.push({ param: p, cls: c });
      } else if (c && project.isKindOf(c, MODEL) && routeParams.some((rp) => norm(rp) === norm(p.name))) {
        modelParams.push({ param: p, cls: c, routeParam: routeParams.find((rp) => norm(rp) === norm(p.name)) });
      }
    }
  }
  const ctx = method ? resolver.ctxFor(method, { handler: true, requestVars }) : { project, file: routeFile, cls: null, locals: new Map(), resolver, handler: true };

  /* ---------------- helpers de nós ---------------- */
  const link = (from, to, label = "segue") => edges.push({ from, to, label });
  let incoming = [{ from: entryId, label: "segue" }];
  const connect = (toId) => {
    for (const l of incoming) link(l.from, toId, l.label);
  };

  function failNode(outcome, file, line) {
    const st = outcome.status;
    return pushNode({
      type: "return",
      label: `Responde ${st} · ${outcome.statusText || statusText(st)}`,
      technical: `HTTP ${st}`,
      snippet: "",
      line,
      file,
      explanation:
        `Encerra a requisição respondendo **${st} (${outcome.statusText || statusText(st)})**${outcome.detail ? ` — ${String(outcome.detail).replace(/[.\s]+$/, "")}` : ""}. ` +
        "É um caminho de **recusa/erro**: o processamento para aqui.",
      symbol: emptySym(),
      meta: { tone: "error", facts: [{ k: "Status HTTP", v: `${st} · ${outcome.statusText || statusText(st)}` }], outcome },
    });
  }

  function guardNode({ type, label, story, pos, neg, outcome, facts, file, line, technical, callee, snippet, symbol }) {
    const id = pushNode({
      type,
      label,
      technical: technical || label,
      snippet: snippet || "",
      line,
      file,
      explanation: story,
      symbol: symbol || emptySym(),
      meta: { pos, neg, question: label, tone: "neutral", facts: facts || [], ...(callee ? { callee } : {}) },
    });
    connect(id);
    link(id, failNode(outcome, file, line), "não");
    incoming = [{ from: id, label: "sim" }];
    return id;
  }

  const skipped = [];
  const routeRel = route.rel;
  const routeLine = route.line;

  /* ---------------- 1) middlewares ---------------- */
  const { aliases, groups } = loadAliases(project);
  const effective = [];
  const expand = (n, depth = 0) => {
    if (depth > 4) return;
    if (groups.has(n) && !NEUTRAL_MW.has(n)) {
      for (const m of groups.get(n)) expand(m, depth + 1);
      return;
    }
    effective.push(n);
  };
  for (const n of route.middleware) expand(n);
  if (cls && method) for (const n of ctorMiddleware(project, cls, action.method)) expand(n);
  const without = new Set(route.without || []);
  const seenMw = new Set();

  for (const raw of effective) {
    if (seenMw.has(raw)) continue;
    seenMw.add(raw);
    const short = raw.split("\\").pop();
    if (without.has(raw) || without.has(short)) continue;
    const [nameRaw, ...argParts] = raw.split(":");
    let base = nameRaw.includes("\\") || /^[A-Z]/.test(nameRaw) ? BUILTIN_CLASS[nameRaw.split("\\").pop()] || nameRaw : nameRaw;
    const args = argParts.join(":").split(",").map((x) => x.trim()).filter(Boolean);
    if (NEUTRAL_MW.has(base)) {
      skipped.push(raw);
      continue;
    }

    // alias do projeto (Kernel / bootstrap/app.php) → classe
    const al = aliases.get(base);
    let mwCls = null;
    if (al) {
      const bc = BUILTIN_CLASS[String(al.classRef).split("\\").pop()];
      if (bc) base = bc;
      else mwCls = project.findClass(project.qualify(al.classRef, al.file)) || project.resolveClass(al.classRef, al.file);
    } else if (/^[A-Z]/.test(nameRaw) || nameRaw.includes("\\")) {
      mwCls = project.resolveClass(nameRaw, routeFile);
      if (mwCls && BUILTIN_CLASS[mwCls.name]) {
        base = BUILTIN_CLASS[mwCls.name];
        mwCls = null;
      }
    }

    const b = mwCls ? null : builtinMiddleware(base, args, isApi);
    if (b) {
      if (NEUTRAL_MW.has(base)) continue;
      guardNode({ type: "middleware", label: b.label, story: b.story, pos: b.pos, neg: b.neg, outcome: b.outcome, facts: b.facts, file: routeRel, line: routeLine, technical: `middleware('${raw}')` });
      continue;
    }

    const handle = mwCls ? project.findMethod(mwCls, "handle") : null;
    if (mwCls && handle && handle.bodyOpen >= 0) {
      const mctx = resolver.ctxFor(handle, { handler: true, middlewareArgs: args, isApi });
      const gid = pushNode({
        type: "middleware",
        label: `Middleware ${mwCls.name}`,
        technical: `middleware('${raw}')`,
        snippet: "",
        line: handle.line,
        file: mwCls.file.rel,
        explanation: `A rota passa pelo middleware ${code(mwCls.name)} (${code(`${mwCls.file.rel}:${handle.line}`)}) antes de chegar ao controller. Ele pode recusar a requisição ou deixá-la seguir.`,
        symbol: emptySym({ className: mwCls.name, functionName: "handle" }),
        meta: { tone: "neutral", facts: [{ k: "Middleware", v: code(raw) }, { k: "Classe", v: code(mwCls.name) }] },
      });
      connect(gid);
      incoming = [{ from: gid, label: "segue" }];
      const exits = buildPhpCfg({ file: mwCls.file, from: handle.bodyOpen + 1, pushNode, edges, ctx: mctx, incoming, passThrough: true });
      incoming = exits.length ? [...exits] : [];
      if (!incoming.length) incoming = [{ from: gid, label: "segue" }]; // todos os caminhos recusam: mantém o fluxo ligado
      continue;
    }
    skipped.push(raw);
  }

  /* ---------------- 2) route-model binding ---------------- */
  for (const mp of modelParams) {
    const rp = mp.routeParam;
    const key = (route.uri.match(new RegExp(`\\{${rp}:([^/{}?]+)\\??\\}`)) || [])[1];
    guardNode({
      type: "database",
      label: `Carrega ${mp.cls.name} da URL (404 se não existir)`,
      story:
        `O parâmetro ${code(`{${rp}}`)} da URL é convertido automaticamente no modelo ${code(mp.cls.name)} (**route-model binding**)` +
        `${key ? ` buscando pelo campo ${code(key)}` : " buscando pela chave primária"}. Se **não existir** registro, o Laravel responde **404 (Não encontrado)** sem nem chamar o controller.`,
      pos: `o ${mp.cls.name} informado na URL existir`,
      neg: `o ${mp.cls.name} informado na URL não existir`,
      outcome: { status: 404, statusText: "Não encontrado", tone: "error", detail: `${mp.cls.name} inexistente` },
      facts: [{ k: "Modelo", v: code(mp.cls.name) }, { k: "Parâmetro da URL", v: code(`{${rp}}`) }, { k: "Variável no controller", v: code(mp.param.name) }],
      file: method.cls.file.rel,
      line: method.line,
      technical: `${mp.cls.name} ${mp.param.name}`,
    });
  }

  /* ---------------- 3) FormRequest ---------------- */
  const validatedFields = [];
  for (const fr of formRequests) {
    const frFile = fr.cls.file;
    const prep = project.findMethod(fr.cls, "prepareForValidation");
    if (prep && prep.bodyOpen >= 0 && project.methodBody(prep).trim()) {
      const items = resolver.summarizeMethod(prep);
      const id = pushNode({
        type: "function",
        label: `Prepara os dados antes de validar (${fr.cls.name})`,
        technical: `${fr.cls.name}::prepareForValidation()`,
        snippet: "",
        line: prep.line,
        file: frFile.rel,
        explanation: `Antes de validar, o ${code(fr.cls.name)} ajusta os dados recebidos (por exemplo, normalizando campos). Isso acontece em ${code("prepareForValidation()")}.`,
        symbol: emptySym({ className: fr.cls.name, functionName: "prepareForValidation" }),
        meta: { tone: "neutral", facts: [], callee: { name: "prepareForValidation", file: frFile.rel, line: prep.line, className: fr.cls.name, params: [], summary: items } },
      });
      connect(id);
      incoming = [{ from: id, label: "segue" }];
    }

    const auth = project.findMethod(fr.cls, "authorize");
    if (auth && auth.bodyOpen >= 0 && !trivialAuthorize(project.methodBody(auth))) {
      const items = resolver.summarizeMethod(auth);
      const body = project.methodBody(auth).replace(/\s+/g, " ").trim();
      const alwaysFalse = /^return false;?$/.test(body);
      guardNode({
        type: "validation",
        label: `Usuário autorizado? (${fr.cls.name}::authorize)`,
        story:
          `Antes de validar os campos, o ${code(fr.cls.name)} executa ${code("authorize()")} para decidir se **este usuário pode fazer esta ação**. ` +
          `Se devolver falso, o Laravel lança \`AuthorizationException\` e responde **403 (Proibido)**.` +
          (alwaysFalse ? " Aqui o método sempre devolve falso." : ""),
        pos: "o authorize() do FormRequest devolver verdadeiro (usuário autorizado)",
        neg: "o authorize() do FormRequest devolver falso (usuário sem permissão)",
        outcome: { status: 403, statusText: "Proibido", tone: "error", detail: "This action is unauthorized." },
        facts: [{ k: "Classe", v: code(fr.cls.name) }],
        file: frFile.rel,
        line: auth.line,
        technical: `${fr.cls.name}::authorize()`,
        callee: { name: "authorize", file: frFile.rel, line: auth.line, className: fr.cls.name, params: [], summary: items },
      });
    }

    const rulesM = project.findMethod(fr.cls, "rules");
    const frCtx = rulesM ? resolver.ctxFor(rulesM, { requestSelf: true }) : { project, requestSelf: true, file: fr.cls.file, cls: fr.cls };
    const rules = rulesM && rulesM.bodyOpen >= 0 ? extractRules(project, rulesM, frCtx) : [];
    validatedFields.push(...rules);
    const messages = project.findMethod(fr.cls, "messages");
    const hasMsgs = Boolean(messages && messages.bodyOpen >= 0 && project.methodBody(messages).trim());
    const uniq = (xs) => [...new Set(xs)];
    const req = uniq(rules.filter((r) => r.required).map((r) => r.field)).map(code);
    const opt = uniq(rules.filter((r) => !r.required).map((r) => r.field)).map(code);
    const cond = uniq(rules.filter((r) => (r.when || []).length).map((r) => r.field)).map(code);
    const facts = [{ k: "Classe", v: code(fr.cls.name) }];
    if (rules.length) facts.push({ k: "Campos validados", v: String(uniq(rules.map((r) => r.field)).length) });
    if (req.length) facts.push({ k: "Obrigatórios", v: req.slice(0, 16).join(", ") + (req.length > 16 ? "…" : "") });
    if (opt.length) facts.push({ k: "Opcionais", v: opt.slice(0, 16).join(", ") + (opt.length > 16 ? "…" : "") });
    if (cond.length) facts.push({ k: "Conforme o caso", v: cond.slice(0, 16).join(", ") + (cond.length > 16 ? "…" : "") });
    if (hasMsgs) facts.push({ k: "Mensagens", v: "personalizadas (`messages()`)" });
    const failOutcome = isApi
      ? { status: 422, statusText: "Dados inválidos", tone: "error", detail: "errors por campo" }
      : { status: 302, statusText: "Volta ao formulário com os erros", tone: "error", detail: "422 se a chamada for JSON" };
    guardNode({
      type: "validation",
      label: `Valida os dados (${fr.cls.name})`,
      story:
        `O ${code(fr.cls.name)} (FormRequest) valida os dados **antes** de o controller rodar` +
        `${rules.length ? `: ${uniq(rules.map((r) => r.field)).length} campo(s) com regras (veja “Por dentro de rules” nos detalhes; campos opcionais em um caso podem ser obrigatórios em outro)` : ""}. ` +
        (isApi
          ? "Se **algum campo for inválido**, o Laravel interrompe e responde **422 (Dados inválidos)** com a lista de erros por campo."
          : "Se **algum campo for inválido**, o Laravel volta ao formulário com os erros (ou responde 422 se a chamada pedir JSON).") +
        " O controller só executa se tudo estiver certo.",
      pos: "todos os campos enviados forem válidos",
      neg: "algum campo enviado for inválido",
      outcome: failOutcome,
      facts,
      file: frFile.rel,
      line: rulesM ? rulesM.line : fr.cls.line,
      technical: `${fr.cls.name}::rules()`,
      callee: rules.length ? { name: "rules", file: frFile.rel, line: rulesM.line, className: fr.cls.name, params: [], summary: ruleSummaryItems(rules, frFile.rel, rulesM.line) } : undefined,
      symbol: emptySym({ className: fr.cls.name, functionName: "rules" }),
    });
  }

  /* ---------------- 4) corpo do handler ---------------- */
  let handlerBody = "";
  let handler = null;

  if (action.kind === "view") {
    const id = pushNode({
      type: "return", label: "Responde 200 · OK (página)", technical: `view ${action.view}`, snippet: "", line: routeLine, file: routeRel,
      explanation: `Rota do tipo ${code("Route::view")}: renderiza direto a view ${code(action.view || "?")}, sem controller.`,
      symbol: emptySym(),
      meta: { tone: "ok", facts: [{ k: "Status HTTP", v: "200 · OK" }, { k: "Página (view)", v: code(action.view || "?") }], outcome: { status: 200, statusText: "OK", tone: "ok", detail: `view ${action.view}` } },
    });
    connect(id);
    incoming = [];
  } else if (action.kind === "redirect") {
    const id = pushNode({
      type: "return", label: `Redireciona (${action.status})`, technical: `redirect ${action.to}`, snippet: "", line: routeLine, file: routeRel,
      explanation: `Rota do tipo ${code("Route::redirect")}: devolve um redirecionamento **${action.status}** para ${code(action.to || "?")}.`,
      symbol: emptySym(),
      meta: { tone: "ok", facts: [{ k: "Status HTTP", v: `${action.status} · ${statusText(action.status)}` }, { k: "Destino", v: code(action.to || "?") }], outcome: { status: action.status, statusText: statusText(action.status), tone: "ok", detail: "redireciona" } },
    });
    connect(id);
    incoming = [];
  } else if (action.kind === "closure" && action.shape === "block") {
    handler = { file: routeRel, line: action.line, name: "Closure" };
    handlerBody = routeFile.src.slice(action.bodyOpen + 1, action.bodyClose);
    buildPhpCfg({ file: routeFile, from: action.bodyOpen + 1, pushNode, edges, ctx, incoming, endLabel: "Fim do fluxo", to: action.bodyClose });
  } else if (action.kind === "closure" && action.shape === "arrow") {
    // fn () => expr
    const expr = routeFile.src.slice(action.exprStart, action.exprEnd);
    const syn = { ...routeFile, src: routeFile.src.slice(0, action.exprStart) + " return " + expr + ";" };
    handler = { file: routeRel, line: action.line, name: "Closure" };
    handlerBody = expr;
    buildPhpCfg({ file: syn, from: action.exprStart, pushNode, edges, ctx, incoming, endLabel: "Fim do fluxo" });
  } else if (method && method.bodyOpen >= 0) {
    handler = { file: method.cls.file.rel, line: method.line, name: `${method.cls.name}::${method.name}` };
    handlerBody = project.methodBody(method);
    buildPhpCfg({ file: method.cls.file, from: method.bodyOpen + 1, pushNode, edges, ctx, incoming, endLabel: "Fim do fluxo", to: method.bodyClose });
  } else {
    const id = pushNode({
      type: "unknown", label: "Handler não encontrado", technical: handlerName || "", snippet: "", line: routeLine, file: routeRel,
      explanation:
        `A rota aponta para ${code(handlerName || "?")}, mas a classe/método não foi encontrado no projeto (verifique o namespace, o ${code("use")} do arquivo de rotas e o ${code("composer.json")}).`,
      symbol: emptySym(),
      meta: { tone: "neutral", facts: [] },
    });
    connect(id);
  }

  /* ---------------- entrada: dados recebidos ---------------- */
  const inputs = [];
  for (const rp of routeParams) inputs.push({ where: "params", name: rp });
  const topFields = [...new Set(validatedFields.map((r) => r.field.split(".")[0]))];
  for (const f of topFields) inputs.push({ where: "input", name: f });
  for (const i of findRequestInputs(handlerBody, [...requestVars])) {
    if (!inputs.some((x) => x.where === i.where && x.name === i.name) && !(i.where === "input" && topFields.includes(i.name))) inputs.push(i);
  }
  const facts = describeInputs(inputs);
  const condIn = [...new Set(validatedFields.filter((r) => (r.when || []).length).map((r) => r.field))];
  if (condIn.length) facts.push({ k: "Conforme o caso", v: condIn.map(code).join(", ") });
  const eff = effective.filter((n) => !NEUTRAL_MW.has(n));
  if (eff.length) facts.push({ k: "Middlewares da rota", v: eff.map(code).join(", ") });
  if (route.name) facts.push({ k: "Nome da rota", v: code(route.name) });
  if (handler) facts.push({ k: "Handler", v: code(handler.name) });
  entryNode.meta = { ...entryNode.meta, inputs, facts, handlerName: handler ? handler.name : handlerName, method: route.methods.filter((m) => m !== "HEAD").join("|"), routePath: route.uri };

  return { handlerBody, handler, meta: { framework: "laravel", routeName: route.name || null, middleware: eff, isApi } };
}

export { lineNoAt, parseStatements };
