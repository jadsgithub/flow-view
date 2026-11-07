/**
 * CFG narrado para código PHP: if/elseif/else, foreach/for/while, switch, try/catch (vários catch),
 * finally, `DB::transaction`, guardas (`abort_if`, `authorize`, `validate`, `findOrFail`),
 * return/throw e instruções simples. Reaproveitado pelo handler do controller e por middlewares.
 */

import { parseStatements, lineNoAt } from "./parse.mjs";
import { describeStatement, describeDecision, describeCondition, describeLoop, describeExpr, ruleSummaryItems, statusText, code, trunc, excStatus, de } from "./narrate.mjs";
import { transactionClosure } from "./callee.mjs";

const emptySym = (extra = {}) => ({ functionName: null, className: null, variables: [], params: [], returnType: null, ...extra });
const VALIDATION_NAME = /valid|verify|ensure|assert|check|authenticate|authorize|sanitiz/i;
const short = (n) => String(n || "").replace(/^\\/, "").split("\\").pop();

/**
 * @param {object} opt
 * @param {object} opt.file       FileInfo (src, rel)
 * @param {number} opt.from       índice (em file.src) onde começam as instruções
 * @param {Function} opt.pushNode
 * @param {any[]} opt.edges
 * @param {object} opt.ctx        contexto de narração (project, cls, locals, resolver, handler…)
 * @param {{from:string,label?:string}[]} opt.incoming
 * @param {boolean} [opt.passThrough]  `return $next($request)` vira "segue" (modo middleware)
 * @param {string} [opt.endLabel]      cria um nó final quando sobra caminho sem `return`
 */
export function buildPhpCfg(opt) {
  const { file, pushNode, edges, ctx, passThrough = false } = opt;
  const { project } = ctx;
  const src = file.src;
  const lineAt = (idx) => lineNoAt(src, idx);
  const base = { file: file.rel };

  const connect = (links, toId) => {
    for (const L of links) edges.push({ from: L.from, to: toId, label: L.label || "segue" });
  };

  /* ---------------- exceções → catch ---------------- */

  function typeMatches(t, exc) {
    const ts = short(t);
    if (/^(Throwable|Exception)$/.test(ts)) return true;
    if (!exc) return false;
    const es = short(exc);
    if (ts === es) return true;
    if ((ts === "HttpException" || ts === "HttpExceptionInterface") && (excStatus(es) || /HttpException$/.test(es))) return true;
    if (ts === "RuntimeException" && /^(ModelNotFoundException|RecordsNotFoundException)$/.test(es)) return true;
    const cls = project ? project.resolveClass(exc, ctx.file, ctx.cls) : null;
    return Boolean(cls && project.isKindOf(cls, [t]));
  }

  /** Catch que pega a exceção (o primeiro que combina, do try mais interno para fora). */
  function catchFor(frames, exc) {
    for (let i = frames.length - 1; i >= 0; i--) {
      const hit = frames[i].catches.find((c) => c.types.length === 0 || c.types.some((t) => typeMatches(t, exc)));
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------- nós ---------------- */

  function wrapNextThenContinue(text, incoming, line) {
    let cur = incoming;
    const scopes = (ctx.middlewareArgs || []).filter(Boolean);
    const passport = /checkClientCredentials|CheckClientCredentials|CheckToken\b/i.test(text);
    const mentionsScope = /checkTokenScope|CheckTokenScope|CheckScopes|CheckTokenForAnyScope|CheckForAnyScope/i.test(text);
    if (passport) {
      const id = pushNode({
        type: "middleware",
        label: "Token Bearer do Passport é válido?",
        technical: trunc(text, 200),
        snippet: text.slice(0, 600),
        line,
        ...base,
        explanation:
          "A requisição veio com **Bearer (Passport)**. O middleware valida o token antes de seguir. " +
          "Se o token for **inválido ou expirado**, responde **401 (Não autorizado)** e a pipeline para aqui.",
        symbol: emptySym({ functionName: "handle" }),
        meta: {
          pos: "o token Bearer do Passport for válido",
          neg: "o token Bearer do Passport for inválido ou expirado",
          question: "Token Bearer do Passport é válido?",
          tone: "neutral",
          facts: [{ k: "Autenticação", v: "Passport (Bearer)" }],
        },
      });
      connect(cur, id);
      edges.push({
        from: id,
        to: outcomeNode({ status: 401, statusText: "Não autorizado", tone: "error", detail: "token Passport inválido ou expirado" }, { line }),
        label: "não",
      });
      cur = [{ from: id, label: "sim" }];
    }
    if (scopes.length && (mentionsScope || passport)) {
      const id = pushNode({
        type: "middleware",
        label: "Token tem os escopos exigidos pela rota?",
        technical: trunc(text, 200),
        snippet: text.slice(0, 600),
        line,
        ...base,
        explanation:
          `Além de o token ser válido, ele precisa ter **os escopos desta rota**: ${scopes.map(code).join(", ")}. ` +
          "Se faltar algum, responde **403 (Proibido)** e o controller não roda.",
        symbol: emptySym({ functionName: "handle" }),
        meta: {
          pos: `o token tiver os escopos ${scopes.map(code).join(", ")}`,
          neg: "o token não tiver os escopos exigidos pela rota",
          question: "Token tem os escopos exigidos pela rota?",
          tone: "neutral",
          facts: [{ k: "Escopos exigidos", v: scopes.map(code).join(", ") }],
        },
      });
      connect(cur, id);
      edges.push({
        from: id,
        to: outcomeNode({ status: 403, statusText: "Proibido", tone: "error", detail: `escopos: ${scopes.join(", ")}` }, { line }),
        label: "não",
      });
      cur = [{ from: id, label: "sim" }];
    }
    return cur;
  }

  function outcomeNode(outcome, why) {
    const st = outcome.status;
    const known = st != null;
    return pushNode({
      type: "return",
      label: known ? `Responde ${st} · ${outcome.statusText || statusText(st)}` : "Devolve a resposta ao cliente",
      technical: known ? `HTTP ${st}` : "resposta",
      snippet: "",
      line: why.line,
      ...base,
      explanation:
        `Encerra a requisição respondendo **${st} (${outcome.statusText || statusText(st)})**${outcome.detail ? ` — ${String(outcome.detail).replace(/[.\s]+$/, "")}` : ""}. ` +
        (outcome.tone === "error" ? "É um caminho de **recusa/erro**: o processamento para aqui." : "É um caminho de **sucesso**: o pedido foi atendido e o processamento termina aqui."),
      symbol: emptySym(),
      meta: { tone: outcome.tone || "error", facts: known ? [{ k: "Status HTTP", v: `${st} · ${outcome.statusText || statusText(st)}` }] : [], outcome },
    });
  }

  function simple(s, incoming, frames, closureDepth) {
    const text = s.text;
    if (passThrough) {
      if (/^return\s+\$next\s*\(\s*\$\w+\s*\)$/.test(text)) return incoming;
      if (/^(?:\$\w+\s*=\s*)?\$next\s*\(\s*\$\w+\s*\)$/.test(text)) return Object.assign([...incoming], { stop: true });
      // `return $this->checkClientCredentials->handle($request, function (...) { return $next(...) })`
      // encaminha a pipeline: não é um 200. Emite 401 (token) e, se a rota pede escopos, 403.
      if (/^return\b/.test(text) && /\$next\b/.test(text)) {
        return wrapNextThenContinue(text, incoming, lineAt(s.idx));
      }
    }
    const d = describeStatement(text, ctx);
    const line = lineAt(s.idx);
    const meta = { facts: d.facts || [], tone: d.tone || "neutral" };
    if (d.transaction) meta.transaction = true;
    if (d.outcome && !(closureDepth > 0 && d.nodeType === "return")) meta.outcome = d.outcome;
    if (d.varName) meta.varName = d.varName;

    let callee = d.callee;
    if (!callee && d.rules) callee = { name: "validate", file: file.rel, line, className: null, params: [], summary: ruleSummaryItems(d.rules, file.rel, line) };
    if (callee) meta.callee = { name: callee.name, file: callee.file, line: callee.line, className: callee.className, params: callee.params, summary: callee.summary };

    // ------ guardas: decisão + desfecho de falha
    if (d.guard) {
      const g = d.guard;
      meta.pos = g.pos;
      meta.neg = g.neg;
      meta.question = g.q;
      const id = pushNode({
        type: g.nodeType,
        label: d.title,
        technical: trunc(text, 200),
        snippet: text.slice(0, 600),
        line,
        ...base,
        explanation: d.story,
        symbol: emptySym({ functionName: d.callName || null, variables: d.varName ? [d.varName] : [] }),
        meta,
      });
      connect(incoming, id);
      const caught = g.exception ? catchFor(frames, g.exception) : null;
      if (caught) edges.push({ from: id, to: caught.id, label: g.failOn });
      else edges.push({ from: id, to: outcomeNode(g.outcome, { line }), label: g.failOn });
      return [{ from: id, label: g.failOn === "sim" ? "não" : "sim" }];
    }

    let type = d.nodeType;
    if (type === "function" && d.callName && VALIDATION_NAME.test(d.callName)) type = "validation";
    if (closureDepth > 0 && type === "return") type = "assignment";
    const id = pushNode({
      type,
      label: closureDepth > 0 && d.nodeType === "return" ? "Devolve o valor da transação" : d.title,
      technical: trunc(text, 200),
      snippet: text.slice(0, 600),
      line,
      ...base,
      explanation: closureDepth > 0 && d.nodeType === "return" ? `Devolve ${describeExpr(text.replace(/^return\s*/, ""), ctx)} como resultado do bloco (não encerra a requisição).` : d.story,
      symbol: emptySym({
        functionName: d.callName || null,
        className: callee ? callee.className : null,
        variables: d.varName ? d.varName.split(/,\s*/) : [],
        params: callee ? callee.params : [],
      }),
      meta,
    });
    connect(incoming, id);

    if (d.nodeType === "return" && closureDepth === 0) return [];

    if (d.nodeType === "throw") {
      const caught = catchFor(frames, d.exception || (d.abort ? "HttpException" : null));
      if (caught) {
        delete meta.outcome;
        edges.push({ from: id, to: caught.id, label: d.exception ? `erro · ${String(d.exception).split("\\").pop()}` : "erro" });
      }
      return [];
    }

    if (d.mayThrow && frames.length) {
      const inner = frames[frames.length - 1];
      const thrown = new Set((callee?.summary || []).map((it) => /Lança (?:(?:o erro|a exceção) )?`([^`]+)`/.exec(it.text || "")?.[1]).filter(Boolean));
      const targets = inner.catches.filter((c) => c.types.length === 0 || (thrown.size ? [...thrown].some((t) => c.types.some((ct) => typeMatches(ct, t))) : true));
      for (const c of targets) {
        const hit = [...thrown].find((t) => c.types.some((ct) => typeMatches(ct, t)));
        edges.push({ from: id, to: c.id, label: hit ? `erro · ${hit.split("\\").pop()}` : "erro" });
      }
    }

    if (d.transaction) {
      const tc = transactionClosure(text);
      if (tc) {
        const bodyStmts = parseStatements(src, s.idx + tc.bodyOpen + 1);
        const exits = walk(bodyStmts, [{ from: id, label: "segue" }], frames, closureDepth + 1);
        return exits.length ? exits : [{ from: id, label: "segue" }];
      }
    }
    return [{ from: id, label: "segue" }];
  }

  function finallyNote(s) {
    if (!s.finally) return "";
    const parts = s.finally
      .filter((x) => x.kind === "simple")
      .slice(0, 3)
      .map((x) => {
        const d = describeStatement(x.text, { ...ctx, deep: false });
        return (d.short || d.story).replace(/\.$/, "");
      });
    return parts.length
      ? ` Ao final — dando certo ou errado, mesmo depois de uma resposta — o bloco \`finally\` ainda executa: ${parts.join("; ")}.`
      : " Há também um bloco `finally`, que sempre executa ao final.";
  }

  function walk(stmts, incoming, frames, closureDepth) {
    let exits = incoming;
    for (const s of stmts) {
      if (!exits.length) break;
      if (exits.stop) break;
      if (s.kind === "jump") break;
      exits = one(s, exits, frames, closureDepth);
    }
    return exits;
  }

  function one(s, incoming, frames, closureDepth) {
    switch (s.kind) {
      case "simple":
        return simple(s, incoming, frames, closureDepth);

      case "block":
        return walk(s.body, incoming, frames, closureDepth);

      case "if": {
        const d = describeDecision(s.cond, ctx);
        const id = pushNode({
          type: "condition",
          label: d.title,
          technical: `if (${trunc(s.cond, 160)})`,
          snippet: `if (${s.cond})`,
          line: lineAt(s.condIdx),
          ...base,
          explanation: d.story,
          symbol: emptySym(),
          meta: { pos: d.pos, neg: d.neg, question: d.q, tone: "neutral" },
        });
        connect(incoming, id);
        const yes = [{ from: id, label: "sim" }];
        const no = [{ from: id, label: "não" }];
        const thenExits = s.then.length ? walk(s.then, yes, frames, closureDepth) : yes;
        const elseExits = s.else && s.else.length ? walk(s.else, no, frames, closureDepth) : no;
        const stopped = thenExits.stop && elseExits.stop;
        const merged = thenExits.concat(elseExits);
        return stopped ? Object.assign(merged, { stop: true }) : merged;
      }

      case "loop": {
        const l = describeLoop(s, ctx);
        const id = pushNode({
          type: "loop",
          label: l.title,
          technical: `${s.loopKind} (${trunc(s.head, 140)})`,
          snippet: `${s.loopKind} (${s.head})`,
          line: lineAt(s.idx),
          ...base,
          explanation: l.story,
          symbol: emptySym(),
          meta: { tone: "neutral" },
        });
        connect(incoming, id);
        const bodyExits = s.body.length ? walk(s.body, [{ from: id, label: "repete" }], frames, closureDepth) : [];
        return [{ from: id, label: "fim" }, ...bodyExits];
      }

      case "switch": {
        const id = pushNode({
          type: "switch",
          label: `Confere o valor de ${trunc(s.disc, 36)}`,
          technical: `switch (${trunc(s.disc, 140)})`,
          snippet: `switch (${s.disc})`,
          line: lineAt(s.idx),
          ...base,
          explanation:
            `O fluxo se divide conforme o valor ${de(describeExpr(s.disc, ctx))}: cada **caso** abaixo leva a um caminho diferente. ` +
            `Se nenhum caso combinar, vale o caminho "padrão" (quando existir).`,
          symbol: emptySym(),
          meta: { tone: "neutral" },
        });
        connect(incoming, id);
        let exits = [];
        let pending = [];
        let hasDefault = false;
        s.cases.forEach((c, i) => {
          pending.push(c.test === null ? "padrão" : trunc(c.test, 24));
          if (c.test === null) hasDefault = true;
          const real = c.body.filter((x) => x.kind !== "jump");
          if (!real.length && i < s.cases.length - 1) return;
          const label = `caso ${pending.join(" ou ")}`.replace("caso padrão", "padrão");
          pending = [];
          const link = [{ from: id, label }];
          exits = exits.concat(real.length ? walk(c.body, link, frames, closureDepth) : link);
        });
        if (!hasDefault) exits.push({ from: id, label: "outro caso" });
        return exits;
      }

      case "try": {
        const tryId = pushNode({
          type: "group",
          label: "Tenta executar (com proteção)",
          technical: "try { … }",
          snippet: "try { … }",
          line: lineAt(s.idx),
          ...base,
          explanation:
            (s.catches.length
              ? "Começa um bloco **protegido**: os passos seguintes são executados normalmente, mas se algum deles falhar (ou lançar uma exceção), o fluxo desvia para o `catch` que combina com o tipo do erro."
              : "Começa um bloco protegido por `try`.") + finallyNote(s),
          symbol: emptySym(),
          meta: { tone: "neutral" },
        });
        connect(incoming, tryId);
        const frame = { catches: [] };
        for (const c of s.catches) {
          const typed = c.types.length ? c.types.map(short).join(" ou ") : "";
          const status = c.types.map((t) => excStatus(short(t))).find(Boolean);
          const cid = pushNode({
            type: "catch",
            label: typed ? `Se ocorrer ${typed}` : "Se ocorrer um erro",
            technical: `catch (${c.types.join(" | ")}${c.param ? " " + c.param : ""})`,
            snippet: `catch (${c.types.join(" | ")}${c.param ? " " + c.param : ""})`,
            line: lineAt(c.idx),
            branch: "catch",
            ...base,
            explanation:
              `Quando algum passo do bloco protegido lança ${typed ? code(typed) : "uma exceção"}, o fluxo chega aqui` +
              (c.param ? `, e a variável ${code(c.param)} guarda o erro ocorrido` : "") +
              `. É onde o sistema decide o que responder diante da falha${status ? ` (esse tipo costuma virar ${status})` : ""}.`,
            symbol: emptySym({ variables: c.param ? [c.param] : [] }),
            meta: { tone: "error" },
          });
          frame.catches.push({ id: cid, types: c.types, node: c });
          edges.push({ from: tryId, to: cid, label: typed ? `erro · ${typed}` : "erro" });
        }
        const tryExits = walk(s.body, [{ from: tryId, label: "segue" }], [...frames, frame], closureDepth);
        // se um passo de dentro do bloco já aponta para o catch, a seta genérica do bloco é redundante
        for (let i = edges.length - 1; i >= 0; i--) {
          const e = edges[i];
          if (e.from === tryId && /^erro/.test(e.label || "") && edges.some((o) => o !== e && o.to === e.to && o.from !== tryId && /^erro/.test(o.label || ""))) edges.splice(i, 1);
        }
        let exits = tryExits;
        for (const fc of frame.catches) {
          const body = fc.node.body;
          const catchExits = body.length ? walk(body, [{ from: fc.id, label: "segue" }], frames, closureDepth) : [{ from: fc.id, label: "segue" }];
          exits = exits.concat(catchExits);
        }
        if (s.finally && exits.length) {
          const fid = pushNode({
            type: "group",
            label: "Sempre executa (finally)",
            technical: "finally { … }",
            snippet: "finally { … }",
            line: lineAt(s.finallyIdx),
            ...base,
            explanation: "Estes passos rodam **sempre** ao final, tenha dado certo ou errado — normalmente para limpar recursos.",
            symbol: emptySym(),
            meta: { tone: "neutral" },
          });
          connect(exits, fid);
          exits = walk(s.finally, [{ from: fid, label: "segue" }], frames, closureDepth);
        }
        return exits;
      }

      default:
        return incoming;
    }
  }

  const stmts = parseStatements(src, opt.from);
  const exits = walk(stmts, opt.incoming, [], 0);
  const result = [...exits];
  if (opt.endLabel && result.length && !exits.stop) {
    const endId = pushNode({
      type: "return",
      label: opt.endLabel,
      technical: "}",
      snippet: "",
      line: lineAt(opt.to ?? src.length),
      ...base,
      explanation: opt.endStory || "Aqui o método termina sem um `return` neste caminho. No Laravel, isso gera uma resposta **200 (OK)** vazia.",
      symbol: emptySym(),
      meta: { tone: "ok", outcome: opt.endOutcome || { status: 200, statusText: "OK", tone: "ok", detail: "sem corpo" }, facts: [{ k: "Status HTTP", v: "200 · OK" }] },
    });
    connect(result, endId);
    return [];
  }
  return exits.stop ? Object.assign(result, { stop: true }) : result;
}
