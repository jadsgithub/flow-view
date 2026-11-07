#!/usr/bin/env node
/**
 * Verificações de higiene do repositório (zero dependências):
 *   1. sintaxe de todos os .mjs (node --check)
 *   2. versão consistente: package.json == plugin.json == topo do CHANGELOG
 *      (e == tag, quando passada via --tag vX.Y.Z ou GITHUB_REF_NAME)
 *   3. SemVer válido
 *   4. nenhum marcador de placeholder esquecido nos arquivos públicos
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (m) => errors.push(m);
const read = (p) => readFileSync(join(root, p), "utf8");

const SKIP = new Set([".git", "node_modules", "flow-view-output", "flow-view-output-laravel", ".flow-view", ".DS_Store"]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(root);

// 1) sintaxe
for (const f of files.filter((f) => f.endsWith(".mjs"))) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) fail(`Erro de sintaxe em ${relative(root, f)}:\n${r.stderr}`);
}

// 2) e 3) versão
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const pkg = JSON.parse(read("package.json"));
const plugin = JSON.parse(read(".cursor-plugin/plugin.json"));
if (!SEMVER.test(pkg.version)) fail(`package.json: versão "${pkg.version}" não é SemVer válido.`);
if (plugin.version !== pkg.version) fail(`plugin.json (${plugin.version}) difere de package.json (${pkg.version}).`);

const changelog = read("CHANGELOG.md");
const top = changelog.match(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/m);
if (!top) fail("CHANGELOG.md: nenhuma seção '## [x.y.z]' encontrada.");
else if (top[1] !== pkg.version) fail(`CHANGELOG.md: seção mais recente é ${top[1]}, mas package.json é ${pkg.version}.`);
if (!new RegExp(`^\\[${pkg.version.replace(/[.+]/g, "\\$&")}\\]: `, "m").test(changelog)) {
  fail(`CHANGELOG.md: falta o link de comparação "[${pkg.version}]: ..." no rodapé.`);
}

const tagArg = process.argv.includes("--tag") ? process.argv[process.argv.indexOf("--tag") + 1] : null;
const tag = tagArg || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null);
if (tag && tag !== `v${pkg.version}`) fail(`A tag "${tag}" não corresponde à versão do package.json (v${pkg.version}).`);

// 4) placeholders
const PLACEHOLDER = /your-org|OWNER\/flow-view|<seu-usuario>|TODO: trocar|CHANGEME/;
for (const f of files) {
  if (!/\.(md|json|ya?ml|mjs|sh|html|svg)$/.test(f) || f.endsWith("check.mjs")) continue;
  if (relative(root, f).startsWith("test")) continue;
  const m = readFileSync(f, "utf8").match(PLACEHOLDER);
  if (m) fail(`Placeholder esquecido ("${m[0]}") em ${relative(root, f)}.`);
}

if (errors.length) {
  console.error("✖ Verificação falhou:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log(`✔ Verificação ok (v${pkg.version}, ${files.filter((f) => f.endsWith(".mjs")).length} módulos)`);
