/** Valida o mínimo estrutural do FlowViewIR antes de renderizar ou agregar em bundle. */
export function assertFlowShape(flow) {
  const ok =
    flow &&
    typeof flow === "object" &&
    flow.meta &&
    typeof flow.meta === "object" &&
    flow.meta.route &&
    typeof flow.meta.route.method === "string" &&
    typeof flow.meta.route.path === "string" &&
    typeof flow.entry === "string" &&
    Array.isArray(flow.nodes) &&
    Array.isArray(flow.edges) &&
    flow.nodes.every((n) => n && typeof n.id === "string" && n.meta && typeof n.meta === "object") &&
    flow.edges.every((e) => e && typeof e.from === "string" && typeof e.to === "string");
  if (!ok) throw new Error("flow.json inválido: estrutura inesperada (meta, entry, nodes, edges).");
}