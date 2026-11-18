/**
 * IR agregado: vários fluxos (FlowViewIR) no mesmo documento HTML.
 */

import { redactDeep } from "./redact.mjs";
import { assertFlowShape } from "./flow-shape.mjs";
import { VERSION, NAME } from "./version.mjs";
import { slugPath } from "./output.mjs";

export const MAX_FLOWS_PER_BUNDLE = 20;
export const BUNDLE_IR_VERSION = "1";

export function isBundle(doc) {
  return doc && typeof doc === "object" && doc.meta && doc.meta.kind === "bundle";
}

export function assertBundleShape(bundle) {
  const ok =
    bundle &&
    typeof bundle === "object" &&
    bundle.meta &&
    bundle.meta.kind === "bundle" &&
    Array.isArray(bundle.flows) &&
    bundle.flows.length >= 1 &&
    bundle.flows.length <= MAX_FLOWS_PER_BUNDLE;
  if (!ok) {
    throw new Error(
      `flows.json inválido: esperado bundle com 1–${MAX_FLOWS_PER_BUNDLE} fluxo(s) (meta.kind === "bundle").`
    );
  }
  for (let i = 0; i < bundle.flows.length; i++) {
    try {
      assertFlowShape(bundle.flows[i]);
    } catch (err) {
      throw new Error(`flows[${i}]: ${err.message}`);
    }
  }
}

/** @param {{ method: string, path: string } | string} entry — ou `POST:/api/x` */
export function parseRouteSpec(entry) {
  if (typeof entry === "string") {
    const i = entry.indexOf(":");
    if (i < 1) throw new Error(`Rota inválida "${entry}": use METHOD:/caminho (ex.: POST:/api/orders).`);
    const method = entry.slice(0, i).trim().toUpperCase();
    const path = entry.slice(i + 1).trim();
    if (!path.startsWith("/")) throw new Error(`Caminho inválido em "${entry}": deve começar com /.`);
    return { method, path };
  }
  if (entry && typeof entry === "object") {
    const method = String(entry.method || "").toUpperCase();
    const path = String(entry.path || "");
    if (!method || !path) throw new Error("Cada rota precisa de method e path.");
    return { method, path };
  }
  throw new Error("Formato de rota desconhecido.");
}

/** Lê um arquivo JSON com lista de rotas `[{ method, path }, …]`. */
export function parseRoutesFile(data) {
  const raw = typeof data === "string" ? JSON.parse(data) : data;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("O arquivo de rotas deve ser um array não vazio.");
  return raw.map((r, i) => {
    try {
      return parseRouteSpec(r);
    } catch (err) {
      throw new Error(`rotas[${i}]: ${err.message}`);
    }
  });
}

export function defaultBundleTitle(flows) {
  if (!flows.length) return "Fluxos";
  if (flows.length === 1) {
    const r = flows[0].meta.route;
    return `${r.method} ${r.path}`;
  }
  const paths = flows.map((f) => f.meta.route.path);
  const common = paths[0].split("/").filter((_, i) => paths.every((p) => p.split("/")[i] === paths[0].split("/")[i]));
  if (common.length >= 2) return common.join("/");
  return `${flows.length} rotas`;
}

export function buildBundle({ title, flows, createdAt = new Date().toISOString() }) {
  if (!Array.isArray(flows) || flows.length === 0) throw new Error("Um bundle precisa de ao menos um fluxo.");
  if (flows.length > MAX_FLOWS_PER_BUNDLE) {
    throw new Error(`Máximo de ${MAX_FLOWS_PER_BUNDLE} rotas por documento.`);
  }
  for (const f of flows) assertFlowShape(f);
  const bundle = {
    meta: {
      version: BUNDLE_IR_VERSION,
      kind: "bundle",
      title: String(title || defaultBundleTitle(flows)).slice(0, 200),
      generator: { name: NAME, version: VERSION },
      createdAt,
    },
    flows: flows.map((f) => redactDeep(f)),
  };
  return redactDeep(bundle);
}

export function bundleSummary(flows) {
  return flows.map((flow) => {
    const r = flow.meta.route;
    const decisions = flow.nodes.filter((n) => n.meta && n.meta.pos && n.meta.neg).length;
    return {
      method: r.method,
      path: r.path,
      steps: flow.nodes.length,
      decisions,
      outcomes: (flow.meta.outcomes || []).length,
    };
  });
}