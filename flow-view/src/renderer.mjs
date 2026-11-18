import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactDeep } from "./redact.mjs";
import { VERSION, NAME } from "./version.mjs";
import { assertHtmlFileName, htmlFileName, runName, bundleHtmlFileName, bundleRunName } from "./output.mjs";
import { assertFlowShape } from "./flow-shape.mjs";
import { assertBundleShape, isBundle } from "./bundle.mjs";

export { assertFlowShape } from "./flow-shape.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function embedFlowJson(html, payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");
  html = html.replace("__FLOW_JSON__", () => json);
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
  return html.replace("__CSP__", () => csp).replace("__GENERATOR__", () => `${NAME} ${VERSION}`);
}

/**
 * Gera o HTML standalone: template + dados (JSON) + Content-Security-Policy.
 *
 * O arquivo se chama como o pedido (`post-api-orders-…html`), não `index.html`,
 * para continuar reconhecível fora da pasta. Sem rede: a CSP bloqueia conexões,
 * frames, imagens e formulários e só permite o script inline do viewer (hash SHA-256).
 *
 * @param {{ flow: object, outDir: string, fileName?: string }} opts
 */
export async function renderHtml(opts) {
  const { outDir } = opts;
  assertFlowShape(opts.flow);
  const flow = redactDeep(opts.flow);
  const fileName = assertHtmlFileName(
    opts.fileName || htmlFileName(runName(flow.meta.route.method, flow.meta.route.path))
  );

  const templatePath = join(__dirname, "..", "templates", "viewer.html");
  let html = embedFlowJson(await readFile(templatePath, "utf8"), flow);

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, fileName);
  await writeFile(outFile, html, "utf8");
  return outFile;
}

/**
 * HTML com vários fluxos e índice lateral (mesmo template; JSON é um bundle).
 *
 * @param {{ bundle: object, outDir: string, fileName?: string }} opts
 */
export async function renderBundleHtml(opts) {
  const { outDir } = opts;
  assertBundleShape(opts.bundle);
  const bundle = redactDeep(opts.bundle);
  const name = bundle.meta.title || "fluxos";
  const fileName = assertHtmlFileName(
    opts.fileName || bundleHtmlFileName(bundleRunName(name))
  );

  const templatePath = join(__dirname, "..", "templates", "viewer.html");
  let html = embedFlowJson(await readFile(templatePath, "utf8"), bundle);

  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, fileName);
  await writeFile(outFile, html, "utf8");
  return outFile;
}

/** Escolhe renderização conforme o IR (flow único ou bundle). */
export async function renderFromDocument(doc, outDir, fileName) {
  if (isBundle(doc)) return renderBundleHtml({ bundle: doc, outDir, fileName });
  return renderHtml({ flow: doc, outDir, fileName });
}
