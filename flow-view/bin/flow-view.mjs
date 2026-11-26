#!/usr/bin/env node
/**
 * Flow View — CLI: rota → flow.json + HTML nomeado pelo endpoint
 *
 * Segurança: análise 100% estática (o código analisado nunca é executado),
 * leitura restrita à raiz informada, saída sem dependências de rede.
 */

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve, parse as parsePath } from "node:path";
import { spawn } from "node:child_process";

import { findRouteHandler, listLaravelRoutes } from "../src/scanner.mjs";
import { traceRoute } from "../src/tracer.mjs";
import { buildFlowJson } from "../src/builder.mjs";
import { renderHtml, renderBundleHtml } from "../src/renderer.mjs";
import { MAX_FLOW_BYTES, HTTP_METHODS, readFileIfSmall } from "../src/security.mjs";
import { redactDeep } from "../src/redact.mjs";
import { VERSION } from "../src/version.mjs";
import { expandUserPath, htmlFileName, runName, bundleRunName, bundleHtmlFileName } from "../src/output.mjs";
import {
  buildBundle,
  bundleSummary,
  defaultBundleTitle,
  isBundle,
  parseRouteSpec,
  parseRoutesFile,
  MAX_FLOWS_PER_BUNDLE,
} from "../src/bundle.mjs";
import { promptBundleRoutes } from "../src/prompt.mjs";

const METHODS = HTTP_METHODS;

class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "--root",
  "--method",
  "--path",
  "--out",
  "--depth",
  "--render-only",
  "--title",
  "--routes-file",
  "--route",
]);
const BOOL_FLAGS = new Set([
  "--no-open",
  "--open",
  "--json",
  "--list-routes",
  "--bundle",
  "-h",
  "--help",
  "-v",
  "--version",
]);

function parseArgs(argv) {
  const out = {
    root: ".",
    method: "GET",
    path: "",
    outDir: null,
    noOpen: false,
    open: false,
    json: false,
    listRoutes: false,
    renderOnly: null,
    help: false,
    version: false,
    bundle: false,
    title: "",
    routes: [],
    routesFile: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[++i];
      if (v === undefined || (v.startsWith("--") && a !== "--path")) {
        throw new UsageError(`A opção ${a} precisa de um valor.`);
      }
      if (a === "--root") out.root = expandUserPath(v);
      else if (a === "--method") out.method = v;
      else if (a === "--path") out.path = v;
      else if (a === "--out") out.outDir = expandUserPath(v);
      else if (a === "--render-only") out.renderOnly = v;
      else if (a === "--title") out.title = v;
      else if (a === "--routes-file") out.routesFile = expandUserPath(v);
      else if (a === "--route") {
        out.bundle = true;
        out.routes.push(parseRouteSpec(v));
      } else if (a === "--depth") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 20) throw new UsageError("--depth deve ser um inteiro entre 1 e 20.");
        // reservado: aceito por compatibilidade, ainda sem efeito
      }
    } else if (BOOL_FLAGS.has(a)) {
      if (a === "--no-open") out.noOpen = true;
      else if (a === "--open") out.open = true;
      else if (a === "--json") out.json = true;
      else if (a === "--list-routes") out.listRoutes = true;
      else if (a === "--bundle") out.bundle = true;
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
  flow-view --root . --list-routes            # lista as rotas (Laravel)
  flow-view --root . --bundle --route POST:/api/orders --route GET:/api/hello
  flow-view --root . --bundle                 # questionário interativo (TTY)

Opções:
  --root <dir>          Raiz do projeto analisado (default: .). Nada fora dela é lido.
  --method <VERBO>      GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS ou ANY (default: GET)
  --path <rota>         Caminho da rota, ex: /api/orders
  --bundle              Documento com várias rotas (flows.json + HTML com índice)
  --route <VERBO>:<path>  Rota no bundle (repetível), ex.: POST:/api/orders
  --routes-file <json>  Lista JSON [{ "method", "path" }, …]
  --title <texto>       Título do bundle (opcional)
  --out <dir>           Pasta de saída; pode ser fora do projeto (ex.: ~/Desktop).
                        Default: <root>/.flow-view/<método>-<rota>-<data>/
                        O HTML se chama <método>-<rota>-<data>.html
  --list-routes         Lista as rotas encontradas (Laravel) e sai
  --json                Imprime só um recibo JSON (para agentes/scripts); não abre o navegador
  --open / --no-open    Força abrir / não abrir o navegador (default: abre, exceto com --json)
  --render-only <arq>   Só gera o HTML a partir de um flow.json ou flows.json existente
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

async function buildFlowForRoute(root, route) {
  const scan = await findRouteHandler({ root, method: route.method, path: route.path });
  if (!scan.ok) {
    return { ok: false, route, error: scan.error || "Rota não encontrada" };
  }
  const trace = await traceRoute({ scan, rootDir: root });
  const scanWithReq = { ...scan, requestMethod: route.method, requestPath: route.path };
  const flow = buildFlowJson({
    nodes: trace.nodes,
    edges: trace.edges,
    entry: trace.entry,
    scan: scanWithReq,
    trace,
  });
  return { ok: true, route, flow, scan };
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
  const shouldOpen = args.open || (!args.noOpen && !args.json);
  const say = (...m) => {
    if (!args.json) console.log(...m);
  };
  const fail = (code, message, extra = {}) => {
    if (args.json) console.log(JSON.stringify({ ok: false, version: VERSION, error: message, ...extra }, null, 2));
    else console.error(message);
    process.exit(code);
  };

  if (args.listRoutes) {
    const rootStat0 = await stat(root).catch(() => null);
    if (!rootStat0 || !rootStat0.isDirectory()) throw new UsageError(`--root não é um diretório: ${root}`);
    const list = listLaravelRoutes(root);
    if (list === null) {
      return fail(2, "Listagem de rotas disponível apenas para projetos Laravel. Informe --method e --path diretamente.", { routes: [] });
    }
    if (args.json) console.log(JSON.stringify({ ok: true, version: VERSION, framework: "laravel", routes: list }, null, 2));
    else {
      console.log(`${list.length} rota(s) em ${root}:\n`);
      for (const r of list) console.log(`  ${String(r.method).padEnd(14)} ${r.path.padEnd(42)} ${r.handler}${r.name ? `  [${r.name}]` : ""}`);
    }
    return;
  }

  const resolveOut = (name) => {
    const dir = args.outDir ? resolve(args.outDir) : join(root, ".flow-view", name);
    if (dir === parsePath(dir).root) throw new UsageError("--out não pode ser a raiz do sistema de arquivos.");
    return dir;
  };

  if (args.renderOnly) {
    const flowPath = resolve(expandUserPath(args.renderOnly));
    const raw = await readFileIfSmall(flowPath, MAX_FLOW_BYTES);
    if (raw == null) throw new UsageError("flow.json/flows.json inexistente ou grande demais.");
    const doc = JSON.parse(raw);
    let name;
    let htmlPath;
    const outBase = isBundle(doc)
      ? bundleRunName(doc.meta?.title || "fluxos")
      : runName(doc.meta?.route?.method || args.method, doc.meta?.route?.path || args.path);
    const outDir = resolveOut(outBase);
    await mkdir(outDir, { recursive: true });
    if (isBundle(doc)) {
      name = bundleHtmlFileName(outBase);
      htmlPath = await renderBundleHtml({ bundle: doc, outDir, fileName: name });
    } else {
      name = htmlFileName(outBase);
      htmlPath = await renderHtml({ flow: doc, outDir, fileName: name });
    }
    console.log("Renderizado:", htmlPath);
    if (!args.noOpen) await openBrowser(htmlPath);
    return;
  }

  if (args.bundle) {
    const rootStatB = await stat(root).catch(() => null);
    if (!rootStatB || !rootStatB.isDirectory()) throw new UsageError(`--root não é um diretório: ${root}`);

    let routeSpecs = [...args.routes];
    if (args.routesFile) {
      const raw = await readFile(resolve(args.routesFile), "utf8");
      routeSpecs = routeSpecs.concat(parseRoutesFile(raw));
    }
    let bundleTitle = args.title;
    if (routeSpecs.length === 0) {
      if (args.json || !process.stdin.isTTY) {
        throw new UsageError("Informe rotas com --route METHOD:/path, --routes-file ou rode sem --json em um terminal interativo.");
      }
      const prompted = await promptBundleRoutes();
      routeSpecs = prompted.routes;
      if (!bundleTitle) bundleTitle = prompted.title;
    }
    if (routeSpecs.length > MAX_FLOWS_PER_BUNDLE) {
      throw new UsageError(`Máximo de ${MAX_FLOWS_PER_BUNDLE} rotas por documento.`);
    }

    const flows = [];
    const errors = [];
    for (const route of routeSpecs) {
      const built = await buildFlowForRoute(root, route);
      if (!built.ok) {
        errors.push({ method: route.method, path: route.path, error: built.error });
        continue;
      }
      flows.push(built.flow);
    }
    if (errors.length) {
      return fail(2, "Algumas rotas não puderam ser analisadas.", {
        failed: errors,
        succeeded: flows.map((f) => f.meta.route),
      });
    }
    if (!flows.length) return fail(2, "Nenhum fluxo gerado.");

    const bundle = buildBundle({ title: bundleTitle || defaultBundleTitle(flows), flows });
    const folderName = bundleRunName(bundle.meta.title);
    const outDir = resolveOut(folderName);
    await mkdir(outDir, { recursive: true });
    const jsonPath = join(outDir, "flows.json");
    await writeFile(jsonPath, JSON.stringify(bundle, null, 2), "utf8");
    say("IR salvo:", jsonPath);

    const htmlName = bundleHtmlFileName(folderName);
    const htmlPath = await renderBundleHtml({ bundle, outDir, fileName: htmlName });
    say("HTML:", htmlPath);

    let opened = false;
    if (shouldOpen) opened = await openBrowser(htmlPath);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            version: VERSION,
            bundle: {
              title: bundle.meta.title,
              routes: bundleSummary(flows),
              totalSteps: flows.reduce((n, f) => n + f.nodes.length, 0),
            },
            outDir,
            files: { html: htmlPath, json: jsonPath },
            opened,
          },
          null,
          2
        )
      );
    }
    return;
  }

  if (!args.path) throw new UsageError("Falta --path /rota (ou use --bundle para várias rotas)");

  const rootStat = await stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) throw new UsageError(`--root não é um diretório: ${root}`);

  const scan = await findRouteHandler({ root, method: args.method, path: args.path });
  if (!scan.ok) {
    return fail(2, scan.error || "Rota não encontrada", { route: { method: args.method, path: args.path } });
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

  const name = runName(args.method, args.path);
  const outDir = resolveOut(name);
  await mkdir(outDir, { recursive: true });
  const flowPath = join(outDir, "flow.json");
  await writeFile(flowPath, JSON.stringify(redactDeep(flow), null, 2), "utf8");
  say("IR salvo:", flowPath);

  const htmlPath = await renderHtml({ flow, outDir, fileName: htmlFileName(name) });
  say("HTML:", htmlPath);

  let opened = false;
  if (shouldOpen) opened = await openBrowser(htmlPath);

  if (args.json) {
    const decisions = flow.nodes.filter((n) => n.meta && n.meta.pos && n.meta.neg).length;
    console.log(
      JSON.stringify(
        {
          ok: true,
          version: VERSION,
          route: { method: args.method, path: args.path, matched: scan.routePath || null, name: flow.meta.entry?.route?.routeName || null, middleware: flow.meta.entry?.route?.middleware || [] },
          framework: flow.meta.entry?.framework || scan.framework || null,
          entry: { file: flow.meta.entry?.file || scan.file, line: flow.meta.entry?.line || scan.line, handler: flow.meta.entry?.handler?.name || scan.handlerName || null },
          summary: { steps: flow.nodes.length, decisions, outcomes: flow.meta.outcomes.length, success: flow.meta.outcomes.filter((o) => o.tone !== "error").length },
          outDir,
          files: { html: htmlPath, json: flowPath },
          opened,
        },
        null,
        2
      )
    );
  }
}

main().catch((err) => {
  if (process.argv.includes("--json")) {
    const message = err && err.message ? String(err.message) : "Erro inesperado";
    console.log(JSON.stringify({ ok: false, version: VERSION, error: message, usage: err instanceof UsageError }, null, 2));
    process.exit(1);
  }
  if (err instanceof UsageError) {
    console.error(`Erro: ${err.message}\nUse --help para ver as opções.`);
    process.exit(1);
  }
  console.error(err && err.message ? `Erro: ${err.message}` : err);
  process.exit(1);
});
