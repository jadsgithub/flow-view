import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(REPO, "flow-view", "bin", "flow-view.mjs");
export const SAMPLE = join(REPO, "examples", "sample-app");

export function tmp(prefix = "fv-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function write(root, rel, content) {
  const f = join(root, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content, "utf8");
  return f;
}

export function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

/** Executa o CLI (sempre com --no-open) e devolve { status, stdout, stderr }. */
export function runCli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, "--no-open", ...args], { encoding: "utf8", timeout: 30_000, ...opts });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Caminho do único HTML gerado na pasta de saída. */
export function htmlPath(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
  if (files.length !== 1) {
    throw new Error(`esperado 1 arquivo .html em ${dir}, achei: ${files.join(", ") || "(nenhum)"}`);
  }
  return join(dir, files[0]);
}
