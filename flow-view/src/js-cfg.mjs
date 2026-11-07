/**
 * CFG narrado para corpo de handler JS/TS: if/else (com ou sem chaves), switch, loops,
 * try/catch/finally, return/throw e instruções simples (atribuição, chamada, resposta HTTP).
 */

import { stripJsComments, lineNoAt } from "./jsparse.mjs";
import { parseStatements } from "./jsast.mjs";
import {
  describeStatement,
  describeDecision,
  describeCondition,
  describeExpr,
  de,
  code,
  trunc,
} from "./narrate.mjs";

export { stripJsComments };

const VALIDATION_NAME = /valid|verify|ensure|assert|check|authenticate|authorize|sanitiz/i;

const emptySym = (extra = {}) => ({
  functionName: null,
  className: null,
  variables: [],
  params: [],
  returnType: null,
  ...extra,
});

/**
 * @param {{ fullBody: string, baseLine: number, entryId: string, pushNode: Function, edges: any[], ctx?: object }} opt
 *   `fullBody` é o interior do `{` do handler; a 1ª linha do texto é a linha de `baseLine`.
 */
export function buildJsCfg(opt) {
  const { fullBody, baseLine, entryId, pushNode, edges, ctx = {} } = opt;
  const src = stripJsComments(fullBody);
  const lineAt = (idx) => baseLine + lineNoAt(src, idx) - 1;

  const connect = (links, toId) => {
    for (const L of links) edges.push({ from: L.from, to: toId, label: L.label || "segue" });
  };

  function simple(s, incoming, catchId) {
    const d = describeStatement(s.text, ctx);
    const meta = { facts: d.facts || [], tone: d.tone || "neutral" };
    if (d.outcome) meta.outcome = d.outcome;
    if (d.varName) meta.varName = d.varName;
    if (d.callee) {
      meta.callee = {
        name: d.callee.name,
        file: d.callee.file,
        line: d.callee.line,
        className: d.callee.className,
        params: d.callee.params,
        summary: d.callee.summary,
      };
    }
    let type = d.nodeType;
    if (type === "function" && d.callName && VALIDATION_NAME.test(d.callName)) type = "validation";
    const id = pushNode({
      type,
      label: d.title,
      technical: trunc(s.text, 200),
      snippet: s.text.slice(0, 600),
      line: lineAt(s.idx),
      explanation: d.story,
      symbol: emptySym({
        functionName: d.callName || null,
        className: d.callee ? d.callee.className : null,
        variables: d.varName ? d.varName.split(/,\s*/) : [],
        params: d.callee ? d.callee.params : [],
      }),
      meta,
    });
    connect(incoming, id);
    if (d.nodeType === "return") return [];
    if (d.nodeType === "throw") {
      if (catchId) edges.push({ from: id, to: catchId, label: "erro" });
      return [];
    }
    return [{ from: id, label: "segue" }];
  }

  /** Texto curto com o que o bloco `finally` faz (usado no nó `try`). */
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

  function walk(stmts, incoming, catchId) {
    let exits = incoming;
    for (const s of stmts) {
      if (!exits.length) break;
      if (s.kind === "jump") break;
      exits = one(s, exits, catchId);
    }
    return exits;
  }

  function one(s, incoming, catchId) {
    switch (s.kind) {
      case "simple":
        return simple(s, incoming, catchId);

      case "block":
        return walk(s.body, incoming, catchId);

      case "if": {
        const d = describeDecision(s.cond);
        const id = pushNode({
          type: "condition",
          label: d.title,
          technical: `if (${trunc(s.cond, 160)})`,
          snippet: `if (${s.cond})`,
          line: lineAt(s.condIdx),
          explanation: d.story,
          symbol: emptySym(),
          meta: { pos: d.pos, neg: d.neg, question: d.q, tone: "neutral" },
        });
        connect(incoming, id);
        const yes = [{ from: id, label: "sim" }];
        const no = [{ from: id, label: "não" }];
        const thenExits = s.then.length ? walk(s.then, yes, catchId) : yes;
        const elseExits = s.else && s.else.length ? walk(s.else, no, catchId) : no;
        return thenExits.concat(elseExits);
      }

      case "loop": {
        let title;
        let story;
        const m = s.head.match(/^(?:const|let|var)\s+(.+?)\s+(of|in)\s+([\s\S]+)$/);
        if (s.loopKind === "for" && m) {
          title = `Para cada ${trunc(m[1], 24)} em ${trunc(m[3], 30)}`;
          story =
            `Repete os passos seguintes **para cada** ${code(m[1])} ${m[2] === "of" ? "de" : "em"} ${describeExpr(m[3])}. ` +
            `Cada volta trabalha com um item diferente.`;
        } else if (s.loopKind === "while" || s.loopKind === "do") {
          const c = describeCondition(s.head || "true");
          title = `Enquanto ${trunc(c.pos, 40)}`;
          story = `Repete os passos seguintes **enquanto** ${c.pos}.`;
        } else {
          title = "Repete um bloco (for)";
          story = `Repete os passos seguintes de acordo com ${code(trunc(s.head, 60))}.`;
        }
        const id = pushNode({
          type: "loop",
          label: title,
          technical: `${s.loopKind} (${trunc(s.head, 140)})`,
          snippet: `${s.loopKind} (${s.head})`,
          line: lineAt(s.idx),
          explanation: story,
          symbol: emptySym(),
          meta: { tone: "neutral" },
        });
        connect(incoming, id);
        const bodyExits = s.body.length ? walk(s.body, [{ from: id, label: "repete" }], catchId) : [];
        return [{ from: id, label: "fim" }, ...bodyExits];
      }

      case "switch": {
        const id = pushNode({
          type: "switch",
          label: `Confere o valor de ${trunc(s.disc, 36)}`,
          technical: `switch (${trunc(s.disc, 140)})`,
          snippet: `switch (${s.disc})`,
          line: lineAt(s.idx),
          explanation:
            `O fluxo se divide conforme o valor ${de(describeExpr(s.disc))}: cada **caso** abaixo leva a um caminho diferente. ` +
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
          exits = exits.concat(real.length ? walk(c.body, link, catchId) : link);
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
          explanation:
            (s.catch
              ? "Começa um bloco **protegido**: os passos seguintes são executados normalmente, mas se algum deles falhar (ou lançar um erro), o fluxo desvia para o tratamento de erro."
              : "Começa um bloco protegido por `try`.") + finallyNote(s),
          symbol: emptySym(),
          meta: { tone: "neutral" },
        });
        connect(incoming, tryId);
        let catchId = null;
        if (s.catch) {
          catchId = pushNode({
            type: "catch",
            label: "Se ocorrer um erro",
            technical: s.catch.param ? `catch (${s.catch.param})` : "catch",
            snippet: s.catch.param ? `catch (${s.catch.param})` : "catch",
            line: lineAt(s.catch.idx),
            branch: "catch",
            explanation:
              `Quando algum passo do bloco protegido falha, o fluxo chega aqui` +
              (s.catch.param ? `, e a variável ${code(s.catch.param)} guarda o erro ocorrido` : "") +
              `. É onde o sistema decide o que responder diante da falha.`,
            symbol: emptySym({ variables: s.catch.param ? [s.catch.param] : [] }),
            meta: { tone: "error" },
          });
          edges.push({ from: tryId, to: catchId, label: "erro" });
        }
        const tryExits = walk(s.body, [{ from: tryId, label: "segue" }], catchId || undefined);
        let exits = tryExits;
        if (s.catch) {
          const catchExits = s.catch.body.length ? walk(s.catch.body, [{ from: catchId, label: "segue" }], undefined) : [{ from: catchId, label: "segue" }];
          exits = tryExits.concat(catchExits);
        }
        if (s.finally && exits.length) {
          const fid = pushNode({
            type: "group",
            label: "Sempre executa (finally)",
            technical: "finally { … }",
            snippet: "finally { … }",
            line: lineAt(s.finallyIdx),
            explanation: "Estes passos rodam **sempre** ao final, tenha dado certo ou errado — normalmente para limpar recursos.",
            symbol: emptySym(),
            meta: { tone: "neutral" },
          });
          connect(exits, fid);
          exits = walk(s.finally, [{ from: fid, label: "segue" }], catchId || undefined);
        }
        return exits;
      }

      default:
        return incoming;
    }
  }

  const stmts = parseStatements(src, 0);
  const exits = walk(stmts, [{ from: entryId, label: "segue" }], undefined);
  if (exits.length) {
    const endId = pushNode({
      type: "return",
      label: "Fim do fluxo",
      technical: "}",
      snippet: "",
      line: baseLine + lineNoAt(src, src.length) - 1,
      explanation:
        "Aqui o handler termina sem uma resposta explícita neste caminho. Em frameworks como Express, a requisição pode ficar sem resposta se nada mais enviar o retorno.",
      symbol: emptySym(),
      meta: { tone: "neutral" },
    });
    connect(exits, endId);
  }
}
