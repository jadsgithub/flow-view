/**
 * Resolve chamadas PHP (`$this->service->metodo()`, `Classe::metodo()`, `app(Foo::class)->x()`) para a
 * definição no projeto e resume, em português, o que o método faz por dentro (recursivo, com limite).
 */

import { parseStatements, parseChain, classConst, lineNoAt, matchClose, ws, parseArrayLiteral, stringLiteral } from "./parse.mjs";
import { describeStatement, describeCondition, describeLoop, code, trunc, excStatus, statusFromExpr } from "./narrate.mjs";
import { primaryType, isBuiltinType } from "./project.mjs";

const IGNORED_FIELDS = new Set(["length", "count", "id"]);
const LIMIT = 40;

/** Intervalo `{bodyOpen, bodyClose}` (relativo ao texto) do closure de `DB::transaction(function () { ... })`. */
export function transactionClosure(text) {
  const m = /\bDB::transaction\s*\(\s*(?:static\s+)?function\s*&?\s*\(/.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchClose(text, open);
  if (close < 0) return null;
  let k = ws(text, close + 1);
  if (/^use\b/.test(text.slice(k, k + 4))) {
    const u = ws(text, k + 3);
    const uc = matchClose(text, u);
    k = ws(text, uc < 0 ? u : uc + 1);
  }
  if (text[k] === ":") {
    const rm = /^:\s*\??[\w\\|]+/.exec(text.slice(k));
    if (rm) k = ws(text, k + rm[0].length);
  }
  if (text[k] !== "{") return null;
  const bc = matchClose(text, k);
  return bc < 0 ? null : { bodyOpen: k, bodyClose: bc };
}

export function createPhpResolver(project, opt = {}) {
  const maxDepth = opt.maxDepth ?? 3;
  const stack = [];
  const cache = new Map();

  /** Tipos locais de um método: parâmetros tipados. */
  function localsOf(method) {
    const m = new Map();
    for (const p of method.params || []) {
      const t = primaryType(p.type);
      if (t) m.set(p.name, project.qualify(t, method.cls.file));
    }
    return m;
  }

  function ctxFor(method, extra = {}) {
    const cls = method.cls;
    return {
      project,
      file: cls.file,
      cls,
      method,
      locals: localsOf(method),
      resolver: api,
      deep: true,
      handler: false,
      requestSelf: project.isKindOf(cls, ["Illuminate\\Foundation\\Http\\FormRequest", "FormRequest"]),
      ...extra,
    };
  }

  function propType(cls, name, depth = 0) {
    if (!cls || depth > 4) return null;
    const t = cls.props.get(name);
    if (t) return primaryType(t) ? project.qualify(primaryType(t), cls.file) : null;
    const p = project.parentOf(cls);
    return p ? propType(p, name, depth + 1) : null;
  }

  /** Descobre a classe-alvo e o nome do método de uma cadeia de chamadas. */
  function target(chain, ctx) {
    const { head, calls } = chain;
    if (!calls.length) return null;
    const firstCall = calls[0];
    let clsRef = null;
    let cls = null;
    let name = null;

    if (head.kind === "var" && head.name === "$this") {
      if (!firstCall.prop) {
        cls = ctx.cls;
        name = firstCall.name;
      } else if (calls.length >= 2 && !calls[1].prop) {
        clsRef = propType(ctx.cls, firstCall.name.replace(/^\$/, ""));
        name = calls[1].name;
      }
    } else if (head.kind === "var") {
      const lt = ctx.locals && ctx.locals.get(head.name);
      if (lt && !firstCall.prop) {
        clsRef = lt;
        name = firstCall.name;
      } else if (lt && firstCall.prop && calls.length >= 2 && !calls[1].prop) {
        // $order->customer->metodo(): sem tipo da propriedade → ignora
        return null;
      }
    } else if (head.kind === "static") {
      clsRef = head.name;
      name = firstCall.name;
      if (/^(self|static)$/i.test(head.name)) {
        cls = ctx.cls;
        clsRef = null;
      } else if (/^parent$/i.test(head.name)) {
        cls = project.parentOf(ctx.cls);
        clsRef = null;
      }
    } else if (head.kind === "call" && /^(app|resolve)$/.test(head.name) && head.args[0]) {
      const cc = classConst(head.args[0]);
      if (cc) {
        clsRef = cc;
        name = firstCall.name;
      }
    } else if (head.kind === "new" && !firstCall.prop) {
      clsRef = head.name;
      name = firstCall.name;
    }
    if (!name) return null;
    if (!cls && clsRef) cls = project.resolveClass(clsRef, ctx.file, ctx.cls);
    if (!cls) return null;
    return { cls, name };
  }

  function findDef(chain, ctx) {
    const t = target(chain, ctx);
    if (!t) {
      // função/closure local do próprio arquivo? (`helper($x)`) — ignorado
      return null;
    }
    const m = project.findMethod(t.cls, t.name);
    if (!m || m.bodyOpen < 0) return null;
    return m;
  }

  function summarize(method) {
    const file = method.cls.file;
    const items = [];
    const ctx = ctxFor(method);
    const stmts = parseStatements(file.src, method.bodyOpen + 1);
    walk(stmts, 0, items, ctx, file);
    for (const it of items) if (!it.file) it.file = file.rel;
    return items;
  }

  function walk(stmts, depth, out, ctx, file) {
    const lineOf = (i) => lineNoAt(file.src, i);
    for (const s of stmts) {
      if (out.length >= LIMIT) return;
      switch (s.kind) {
        case "simple": {
          const d = describeStatement(s.text, ctx);
          out.push({ text: d.short || d.story, line: lineOf(s.idx), depth, tone: d.tone, kind: d.nodeType });
          if (d.transaction) {
            const tc = transactionClosure(s.text);
            if (tc) walk(parseStatements(file.src, s.idx + tc.bodyOpen + 1), depth + 1, out, ctx, file);
          }
          if (d.callee && d.callee.summary && d.callee.summary.length) {
            out.push({ text: `Dentro de ${code(d.callee.name)} (${code(`${d.callee.file}:${d.callee.line}`)}):`, line: d.callee.line, file: d.callee.file, depth: depth + 1, kind: "enter" });
            for (const it of d.callee.summary) {
              if (out.length >= LIMIT) return;
              out.push({ ...it, depth: it.depth + depth + 2 });
            }
          }
          break;
        }
        case "if": {
          const c = describeCondition(s.cond, ctx);
          out.push({ text: `Se ${c.pos}:`, line: lineOf(s.idx), depth, kind: "if" });
          walk(s.then, depth + 1, out, ctx, file);
          if (s.else && s.else.length) {
            if (s.else.length === 1 && s.else[0].kind === "if") {
              const c2 = describeCondition(s.else[0].cond, ctx);
              out.push({ text: `Senão, se ${c2.pos}:`, line: lineOf(s.else[0].idx), depth, kind: "else" });
              walk(s.else[0].then, depth + 1, out, ctx, file);
              if (s.else[0].else && s.else[0].else.length) {
                out.push({ text: "Caso contrário:", line: lineOf(s.else[0].idx), depth, kind: "else" });
                walk(s.else[0].else, depth + 1, out, ctx, file);
              }
            } else {
              out.push({ text: `Caso contrário (${c.neg}):`, line: lineOf(s.idx), depth, kind: "else" });
              walk(s.else, depth + 1, out, ctx, file);
            }
          }
          break;
        }
        case "loop": {
          const l = describeLoop(s, ctx);
          out.push({ text: `${l.title}:`, line: lineOf(s.idx), depth, kind: "loop" });
          walk(s.body, depth + 1, out, ctx, file);
          break;
        }
        case "try":
          out.push({ text: "Tenta executar (protegido por tratamento de erro):", line: lineOf(s.idx), depth, kind: "try" });
          walk(s.body, depth + 1, out, ctx, file);
          for (const c of s.catches || []) {
            out.push({ text: `Se der erro${c.types.length ? ` (${c.types.map((t) => code(t.split("\\").pop())).join(" ou ")})` : ""}:`, line: lineOf(c.idx), depth, kind: "catch" });
            walk(c.body, depth + 1, out, ctx, file);
          }
          if (s.finally) {
            out.push({ text: "Sempre, ao final (`finally`):", line: lineOf(s.finallyIdx), depth, kind: "finally" });
            walk(s.finally, depth + 1, out, ctx, file);
          }
          break;
        case "switch":
          out.push({ text: `Conforme o valor de ${code(trunc(s.disc, 40))}:`, line: lineOf(s.idx), depth, kind: "switch" });
          for (const c of s.cases) {
            out.push({ text: c.test ? `Se for ${code(trunc(c.test, 40))}:` : "Em qualquer outro caso:", line: lineOf(c.idx), depth: depth + 1, kind: "case" });
            walk(c.body, depth + 2, out, ctx, file);
          }
          break;
        case "block":
          walk(s.body, depth, out, ctx, file);
          break;
        default:
          break;
      }
    }
  }

  function usesFields(method) {
    const body = project.methodBody(method);
    const out = [];
    for (const p of method.params) {
      const v = p.name.replace(/\$/g, "\\$");
      const set = new Set();
      for (const m of body.matchAll(new RegExp(`${v}\\s*\\[\\s*['"]([\\w-]+)['"]\\s*\\]`, "g"))) set.add(m[1]);
      for (const m of body.matchAll(new RegExp(`${v}\\s*\\??->\\s*([A-Za-z_]\\w*)\\b(?!\\s*\\()`, "g"))) if (!IGNORED_FIELDS.has(m[1])) set.add(m[1]);
      if (set.size) out.push({ param: p.name, fields: [...set].slice(0, 12) });
    }
    return out;
  }

  /** Informações da definição + resumo do que acontece dentro dela. */
  function info(method, { withSummary = true } = {}) {
    const file = method.cls.file;
    const key = `${file.abs}#${method.cls.name}.${method.name}@${method.bodyOpen}`;
    if (cache.has(key) && (cache.get(key).summary.length || !withSummary)) return cache.get(key);
    const res = {
      name: method.name,
      file: file.rel,
      line: method.line,
      className: method.cls.name,
      params: method.params.map((p) => p.name),
      usesFields: usesFields(method),
      returnClass: (() => {
        const t = primaryType(method.returnType);
        return t && !isBuiltinType(t) ? project.qualify(t, file) : null;
      })(),
      summary: [],
      raises: false,
    };
    if (!withSummary || stack.includes(key) || stack.length >= maxDepth) return res;
    stack.push(key);
    try {
      res.summary = summarize(method);
      res.raises = res.summary.some((it) => it.kind === "throw" || it.kind === "validation" || /aborta|Lança|lança/.test(it.text || ""));
    } finally {
      stack.pop();
    }
    cache.set(key, res);
    return res;
  }

  const api = {
    /** `chain`: resultado de `parseChain`; `ctx`: contexto do trecho que chama. */
    resolve(chain, ctx) {
      const def = findDef(chain, ctx);
      return def ? info(def) : null;
    },
    info,
    summarizeMethod: (method) => summarize(method),
    ctxFor,
    walk,

    /** Chaves do `toArray()` de um API Resource. */
    resourceFields(name, ctx) {
      if (!name) return null;
      const cls = project.resolveClass(name, ctx && ctx.file, ctx && ctx.cls);
      if (!cls) return null;
      const m = project.findMethod(cls, "toArray");
      if (!m || m.bodyOpen < 0) return null;
      const body = project.methodBody(m);
      const r = /return\s*(?:\[|array\s*\()/.exec(body);
      if (!r) return null;
      const open = body.indexOf(r[0].endsWith("(") ? "(" : "[", r.index);
      const close = matchClose(body, open);
      if (close < 0) return null;
      const arr = parseArrayLiteral(body.slice(open, close + 1));
      if (!arr) return null;
      return arr.filter((it) => it.key).map((it) => stringLiteral(it.key) ?? it.key);
    },

    /** Status HTTP de uma exceção própria do projeto (herança ou `render()`). */
    exceptionStatus(clsName, ctx) {
      let cls = project.resolveClass(clsName, ctx && ctx.file, ctx && ctx.cls);
      for (let i = 0; i < 6 && cls; i++) {
        const own = excStatus(cls.name);
        if (own) return own;
        const render = cls.methods.get("render");
        if (render && render.bodyOpen >= 0) {
          const body = project.methodBody(render);
          const m = /(?:json|make|setStatusCode)\s*\([^;]*?,\s*([\w:]+)\s*[,)]/.exec(body) || /setStatusCode\(\s*([\w:]+)\s*\)/.exec(body);
          if (m) {
            const st = statusFromExpr(m[1]);
            if (st) return st;
          }
        }
        const ext = cls.extends[0];
        if (!ext) break;
        const short = ext.split("\\").pop();
        if (excStatus(short)) return excStatus(short);
        cls = project.findClass(project.qualify(ext, cls.file));
      }
      return null;
    },

    /** Método da Policy correspondente a `authorize('ability', $modelo)`. */
    policyFor(ability, argExpr, ctx) {
      if (!ability || !argExpr) return null;
      const t = argExpr.trim();
      let model = classConst(t);
      if (!model && /^\$\w+$/.test(t) && ctx && ctx.locals) {
        const lt = ctx.locals.get(t);
        if (lt) model = lt.split("\\").pop();
      }
      if (!model) return null;
      const short = model.split("\\").pop();
      for (const abs of project.shortIndex().get(`${short}Policy`) || []) {
        const fi = project.parseFile(abs);
        const cls = fi && fi.classes.find((c) => c.name === `${short}Policy`);
        const m = cls && project.findMethod(cls, ability);
        if (m && m.bodyOpen >= 0) return info(m);
      }
      return null;
    },
  };
  return api;
}

export { parseChain };
