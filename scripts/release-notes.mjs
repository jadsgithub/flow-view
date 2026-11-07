#!/usr/bin/env node
/**
 * Imprime as notas de uma versão a partir do CHANGELOG.md.
 * Uso: node scripts/release-notes.mjs 0.1.0
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Uso: node scripts/release-notes.mjs <versão>");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n");
const header = `## [${version}]`;
const start = lines.findIndex((l) => l.startsWith(header));
if (start < 0) {
  console.error(`Versão ${version} não encontrada no CHANGELOG.md`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || /^\[[^\]]+\]: /.test(l)));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
console.log(body || `Release ${version}`);
