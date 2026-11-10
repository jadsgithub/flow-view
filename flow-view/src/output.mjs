/**
 * Nomes de pasta/arquivo da saída e expansão de `~`.
 *
 * O HTML usa o mesmo identificador da pasta do pedido (`post-api-orders-20261107-181508.html`),
 * para o arquivo continuar reconhecível fora da pasta (Desktop, zip, anexo).
 */

import { homedir } from "node:os";
import { join } from "node:path";

const SLUG_MAX = 60;

/** Trecho estável do caminho da rota: `/api/orders/{order}` → `api-orders-order`. */
export function slugPath(path) {
  return (
    String(path)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX) || "root"
  );
}

export function stampUtc(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

/** Identificador de um pedido: `post-api-orders-20261107-181508`. */
export function runName(method, path, date = new Date()) {
  return `${String(method).toLowerCase()}-${slugPath(path)}-${stampUtc(date)}`;
}

export function htmlFileName(name) {
  return `${name}.html`;
}

/** Só o basename, sem barras; rejeita qualquer coisa que não pareça o nosso slug. */
export function assertHtmlFileName(name) {
  const base = String(name).replace(/^.*[/\\]/, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,120}\.html$/.test(base)) {
    throw new Error("nome de HTML inválido.");
  }
  return base;
}

/** Expande `~` / `~/…` para o home do usuário (útil em `--out ~/Desktop`). */
export function expandUserPath(p) {
  if (p == null) return p;
  const s = String(p);
  if (s === "~") return homedir();
  if (s.startsWith("~/")) return join(homedir(), s.slice(2));
  return s;
}
