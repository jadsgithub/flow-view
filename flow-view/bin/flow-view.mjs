#!/usr/bin/env node
/**
 * Flow View — CLI: rota → flow.json + index.html
 *
 * Segurança: análise 100% estática (o código analisado nunca é executado),
 * leitura restrita à raiz informada, saída sem dependências de rede.
 */

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve, parse as parsePath } from "node:path";
import { spawn } from "node:child_process";

import { findRouteHandler } from "../src/scanner.mjs";
import { traceRoute } from "../src/tracer.mjs";
import { buildFlowJson } from "../src/builder.mjs";
import { renderHtml } from "../src/renderer.mjs";
import { MAX_FLOW_BYTES } from "../src/security.mjs";
import { redactDeep } from "../src/redact.mjs";
import { VERSION } from "../src/version.mjs";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]);

class UsageError extends Error {}

const VALUE_FLAGS = new Set(["--root", "--method", "--path", "--out", "--depth", "--render-only"]);
const BOOL_FLAGS = new Set(["--no-open", "-h", "--help", "-v", "--version"]);

function parseArgs(argv) {
  const out = {
    root: ".",
    method: "GET",
    path: "",
    outDir: "flow-view-output",
    noOpen: false,
    renderOnly: null,
    help: false,
    version: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (v === undefined || (v.startsWith("--") && a !== "--path")) {
        throw new UsageError(`A opção ${a} precisa de um valor.`);
      }
      if (a === "--root") out.root = v;
      else if (a === "--method") out.method = v;
      else if (a === "--path") out.path = v;
      else if (a === "--out") out.outDir = v;
      else if (a === "--render-only") out.renderOnly = v;
      else if (a === "--depth") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 20) throw new UsageError("--depth deve ser um inteiro entre 1 e 20.");
        // reservado: aceito por compatibilidade, ainda sem efeito
      }
    } else if (BOOL_FLAGS.has(a)) {
      if (a === "--no-open") out.noOpen = true;
      else if (a === "-h" || a === "--help") out.help = true;
      else out.version = true;
    } else {
      throw new UsageError(`Opção desconhecida: ${a}`);
    }
  }
  out.method = String(out.method).toUpperCase();
  if (!METHODS.has(out.method)) {
    throw new UsageError(`Método inválido: ${out.method}. Use um de: ${[...METHODS].join(", ")}.`);
  }
  if (out.path && (out.path.length > 500 || /[\u0000-\u001f]/.test(out.path))) {
    throw new UsageError("--path inválido (muito longo ou com caracteres de controle).");
  }
  return out;
}

function printHelp() {
  console.log(`
flow-view v${VERSION} — diagrama de fluxo por rota

Uso:
  flow-view --root . --method POST --path /api/checkout

Opções:
  --root <dir>          Raiz do projeto analisado (default: .). Nada fora dela é lido.
  --method <VERBO>      GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS ou ANY (default: GET)
  --path <rota>         Caminho da rota, ex: /api/orders
  --out <dir>           Pasta de saída (default: flow-view-output)
  --no-open             Não abre o navegador ao terminar
  --render-only <arq>   Só gera o index.html a partir de um flow.json existente
  -v, --version         Mostra a versão
  -h, --help            Mostra esta ajuda

Segurança: o código analisado NUNCA é executado; segredos óbvios são removidos
da saída; o HTML gerado não faz nenhuma requisição de rede (CSP restritiva).
`);
}

/** Abre o arquivo no navegador padrão, sem passar por um shell. */
function openBrowser(file) {
  return new Promise((res) => {
    let cmd;
    let args;
    if (process.platform === "win32") {
      cmd = "rundll32";
      args = ["url.dll,FileProtocolHandler", file];
    } else if (process.platform === "darwin") {
      cmd = "open";
      args = [file];
    } else {
      cmd = "xdg-open";
      args = [file];
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: false });
      child.on("error", () => res(false));
      child.unref();
      res(true);
    } catch {
      res(false);
    }
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (args.help || process.argv.length < 3) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const root = resolve(args.root);
  const outDir = resolve(args.outDir);
  if (outDir === parsePath(outDir).root) throw new UsageError("--out não pode ser a raiz do sistema de arquivos.");

  if (args.renderOnly) {
    const flowPath = resolve(args.renderOnly);
    const st = await stat(flowPath);
    if (!st.isFile() || st.size > MAX_FLOW_BYTES) throw new UsageError("flow.json inexistente ou grande demais.");
    const flow = JSON.parse(await readFile(flowPath, "utf8"));
    await mkdir(outDir, { recursive: true });
    const htmlPath = await renderHtml({ flow, outDir });
    console.log("Renderizado:", htmlPath);
    if (!args.noOpen) await openBrowser(htmlPath);
    return;
  }

  if (!args.path) throw new UsageError("Falta --path /rota");

  const rootStat = await stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) throw new UsageError(`--root não é um diretório: ${root}`);

  const scan = await findRouteHandler({ root, method: args.method, path: args.path });
  if (!scan.ok) {
    console.error(scan.error || "Rota não encontrada");
    process.exit(2);
  }

  const trace = await traceRoute({ scan, rootDir: root });
  const scanWithReq = { ...scan, requestMethod: args.method, requestPath: args.path };

  const flow = buildFlowJson({
    nodes: trace.nodes,
    edges: trace.edges,
    entry: trace.entry,
    scan: scanWithReq,
    trace,
  });

  await mkdir(outDir, { recursive: true });
  const flowPath = join(outDir, "flow.json");
  await writeFile(flowPath, JSON.stringify(redactDeep(flow), null, 2), "utf8");
  console.log("IR salvo:", flowPath);

  const htmlPath = await renderHtml({ flow, outDir });
  console.log("HTML:", htmlPath);

  if (!args.noOpen) await openBrowser(htmlPath);
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error(`Erro: ${err.message}\nUse --help para ver as opções.`);
    process.exit(1);
  }
  console.error(err && err.message ? `Erro: ${err.message}` : err);
  process.exit(1);
});
