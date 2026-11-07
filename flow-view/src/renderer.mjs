import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactDeep } from "./redact.mjs";
import { VERSION, NAME } from "./version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Valida o mínimo estrutural do IR antes de renderizar (entrada pode vir de `--render-only`). */
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

/**
 * Gera o index.html: template + dados (JSON) + Content-Security-Policy.
 *
 * O HTML final é um arquivo estático, sem rede: a CSP bloqueia tudo (conexões, frames,
 * imagens, formulários) e só permite o script inline do viewer, identificado por hash SHA-256.
 *
 * @param {{ flow: object, outDir: string }} opts
 */
export async function renderHtml(opts) {
  const { outDir } = opts;
  assertFlowShape(opts.flow);
  const flow = redactDeep(opts.flow);

  const templatePath = join(__dirname, "..", "templates", "viewer.html");
  let html = await readFile(templatePath, "utf8");

  // `<` escapado para não fechar o <script>; função de replace evita interpretar `$&` etc.
  const json = JSON.stringify(flow).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");
  html = html.replace("__FLOW_JSON__", () => json);

  // Hash do único <script> executável (o viewer). O bloco de dados é application/json.
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Template inválido: script do viewer não encontrado.");
  const hash = createHash("sha256").update(m[1], "utf8").digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "img-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  html = html.replace("__CSP__", () => csp).replace("__GENERATOR__", () => `${NAME} ${VERSION}`);

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "index.html");
  await writeFile(outFile, html, "utf8");
  return outFile;
}
