/**
 * Monta o IR final (flow.json): completa a narrativa (quando o fluxo é chega aqui, tons das setas,
 * desfechos possíveis, texto de abertura) a partir do grafo produzido pelo tracer.
 */

import { explainNode } from "./explain.mjs";
import { statusText } from "./narrate.mjs";
import { redactDeep } from "./redact.mjs";
import { VERSION, NAME } from "./version.mjs";

const code = (s) => "`" + s + "`";

/** Ordem topológica (Kahn). Nós em ciclo ficam ao final. */
function topoOrder(nodes, edges) {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const outs = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!indeg.has(e.to) || !outs.has(e.from)) continue;
    indeg.set(e.to, indeg.get(e.to) + 1);
    outs.get(e.from).push(e.to);
  }
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const t of outs.get(id)) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  for (const n of nodes) if (!order.includes(n.id)) order.push(n.id);
  return order;
}

/** Suposição (texto + chave) que a aresta carrega, ou null. */
function edgeAssumption(from, edge) {
  const lab = edge.label || "";
  if (from.type === "condition" && from.meta) {
    if (lab === "sim" && from.meta.pos) return { key: `${from.id}:sim`, text: from.meta.pos };
    if (lab === "não" && from.meta.neg) return { key: `${from.id}:nao`, text: from.meta.neg };
  }
  if (lab === "erro") return { key: `${from.id}:erro`, text: "ocorrer um erro durante a execução" };
  if (from.type === "switch") {
    if (lab === "outro caso" || lab === "padrão") {
      return { key: `${from.id}:${lab}`, text: "nenhum dos outros casos combinar" };
    }
    if (lab.startsWith("caso ")) return { key: `${from.id}:${lab}`, text: `o valor conferido cair no ${lab}` };
  }
  return null;
}

function computeReachedWhen(nodes, edges, entryId, order) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (incoming.has(e.to)) incoming.get(e.to).push(e);

  /** id → Map(key → text) */
  const result = new Map();
  for (const id of order) {
    if (id === entryId) {
      result.set(id, new Map());
      continue;
    }
    let acc = null;
    for (const e of incoming.get(id) || []) {
      const fromSet = result.get(e.from);
      if (!fromSet) continue; // predecessor ainda não processado (ciclo)
      const s = new Map(fromSet);
      const a = edgeAssumption(byId.get(e.from), e);
      if (a) s.set(a.key, a.text);
      if (acc === null) acc = s;
      else for (const k of [...acc.keys()]) if (!s.has(k)) acc.delete(k);
    }
    result.set(id, acc || new Map());
  }
  return result;
}

function reachability(nodes, edges, outcomes) {
  const outs = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) if (outs.has(e.from)) outs.get(e.from).push(e.to);
  const okSeed = new Set(outcomes.filter((o) => o.tone === "ok").map((o) => o.nodeId));
  const errSeed = new Set(outcomes.filter((o) => o.tone === "error").map((o) => o.nodeId));
  const memo = (seed) => {
    const cache = new Map();
    const visit = (id, stack) => {
      if (cache.has(id)) return cache.get(id);
      if (seed.has(id)) {
        cache.set(id, true);
        return true;
      }
      if (stack.has(id)) return false;
      stack.add(id);
      const r = (outs.get(id) || []).some((t) => visit(t, stack));
      stack.delete(id);
      cache.set(id, r);
      return r;
    };
    return (id) => visit(id, new Set());
  };
  return { reachOk: memo(okSeed), reachErr: memo(errSeed) };
}

/**
 * @param {{ nodes: any[], edges: any[], entry: string, scan: object, trace: { handlerBody?: string } }} data
 */
export function buildFlowJson(data) {
  const { nodes, edges, entry, scan } = data;
  const route = {
    method: (scan.requestMethod || scan.method || "GET").toUpperCase(),
    path: scan.requestPath || scan.routePath || "/",
  };

  const order = topoOrder(nodes, edges);
  const rank = new Map(order.map((id, i) => [id, i]));
  const outDegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);

  const reached = computeReachedWhen(nodes, edges, entry, order);

  const enriched = nodes.map((n) => {
    const symbol = {
      functionName: n.symbol?.functionName ?? null,
      className: n.symbol?.className ?? null,
      variables: n.symbol?.variables ?? [],
      params: n.symbol?.params ?? [],
      returnType: n.symbol?.returnType ?? null,
    };
    const meta = n.meta && typeof n.meta === "object" ? { ...n.meta } : {};
    const rw = [...(reached.get(n.id) || new Map()).values()];
    if (rw.length) meta.reachedWhen = rw;
    meta.order = rank.get(n.id);
    return {
      ...n,
      explanation: n.explanation || explainNode({ ...n, symbol }),
      symbol,
      meta,
    };
  });

  // entrada narrada
  const entryNode = enriched.find((n) => n.id === entry);
  if (entryNode) {
    const handler = entryNode.meta.handlerName;
    const inputs = entryNode.meta.facts || [];
    entryNode.label = `${route.method} ${route.path}`;
    entryNode.technical = `${route.method} ${route.path}`;
    entryNode.explanation =
      `O endpoint **${route.method} ${route.path}** é chamado.` +
      (inputs.length
        ? ` Ele recebe dados da requisição (veja abaixo) e começa a processá-los`
        : ` Ele não lê dados específicos da requisição e começa o processamento`) +
      (handler ? ` na função ${code(handler)}` : ` no handler da rota`) +
      ` (${code(`${scan.file}:${scan.line}`)}).` +
      ` Os próximos passos contam, na ordem, o que acontece até a resposta.`;
    entryNode.meta.tone = "neutral";
  }

  // desfechos
  const outcomes = [];
  for (const n of enriched) {
    const rw = n.meta.reachedWhen || [];
    if (n.meta.outcome) {
      outcomes.push({ nodeId: n.id, ...n.meta.outcome, reachedWhen: rw });
    } else if (n.type === "throw" && !outDegree.get(n.id)) {
      outcomes.push({ nodeId: n.id, status: 500, statusText: statusText(500) + " (erro não tratado)", tone: "error", reachedWhen: rw });
    } else if (n.type === "return" && !n.meta.outcome && n.id !== entry) {
      outcomes.push({
        nodeId: n.id,
        status: null,
        statusText: n.label === "Fim do fluxo" ? "Sem resposta explícita" : "Retorno ao cliente",
        tone: "neutral",
        reachedWhen: rw,
      });
    }
  }

  const { reachOk, reachErr } = reachability(enriched, edges, outcomes);
  const nodeById = new Map(enriched.map((n) => [n.id, n]));

  const outEdges = edges.map((e) => {
    const from = nodeById.get(e.from);
    const a = from ? edgeAssumption(from, e) : null;
    let tone = "neutral";
    if (e.label === "erro") tone = "error";
    else if (reachOk(e.to)) tone = "ok";
    else if (reachErr(e.to)) tone = "error";
    return { ...e, tone, ...(a ? { when: a.text } : {}) };
  });

  for (const n of enriched) {
    if (!n.meta.tone || n.meta.tone === "neutral") {
      if (n.type === "throw" || n.type === "catch") n.meta.tone = "error";
    }
  }

  const decisions = enriched.filter((n) => n.type === "condition").length;
  const okCount = outcomes.filter((o) => o.tone === "ok").length;
  const errCount = outcomes.filter((o) => o.tone === "error").length;
  const intro =
    `O endpoint **${route.method} ${route.path}** percorre ${enriched.length - 1} passos` +
    (decisions ? `, com ${decisions} ${decisions === 1 ? "ponto de decisão" : "pontos de decisão"}` : "") +
    ` e pode terminar de ${outcomes.length} ${outcomes.length === 1 ? "forma" : "formas"}` +
    (outcomes.length ? ` (${okCount} de sucesso, ${errCount} de erro/recusa)` : "") +
    `. Siga as setas do início ao fim; clique em um passo para ler a explicação completa.`;

  const flow = {
    meta: {
      version: "0.2.0",
      generator: { name: NAME, version: VERSION },
      route,
      entry: {
        file: scan.file,
        line: scan.line,
        framework: scan.framework || "unknown",
      },
      summary: intro.replace(/\*\*/g, ""),
      intro,
      inputs: entryNode?.meta.inputs || [],
      outcomes,
    },
    entry,
    nodes: enriched,
    edges: outEdges,
  };
  // Rede de proteção: nenhum segredo "chumbado" no código vai para o flow.json/HTML.
  return redactDeep(flow);
}
