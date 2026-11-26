/**
 * Utilitários de segurança compartilhados.
 *
 * O Flow View lê código-fonte que pode não ser confiável (um repositório de
 * terceiros, por exemplo). Por isso ele:
 *   - NUNCA executa o código analisado (análise 100% estática);
 *   - só lê arquivos DENTRO da raiz informada (sem sair por `../` ou symlink);
 *   - recusa arquivos gigantes (evita travar com entradas patológicas);
 *   - escapa qualquer texto vindo do código antes de montar expressões regulares.
 */

import { realpathSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

/** Métodos HTTP aceitos pelo scanner e pelo CLI. */
export const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]);

/** Normaliza o verbo; valor desconhecido vira GET (nunca entra cru em `RegExp`). */
export function normHttpMethod(m) {
  const u = String(m || "GET").toUpperCase();
  return HTTP_METHODS.has(u) ? u : "GET";
}

/** Tamanho máximo (bytes) de um arquivo-fonte analisado. */
export const MAX_FILE_BYTES = 1_500_000;

/** Quantidade máxima de arquivos percorridos na busca pela rota. */
export const MAX_FILES = 20_000;

/** Profundidade máxima de diretórios percorridos. */
export const MAX_DEPTH = 24;

/** Quantidade máxima de passos (nós) de um diagrama; acima disso a geração é interrompida com erro claro. */
export const MAX_NODES = 2_000;

/** Aninhamento máximo de `()[]{}` aceito em um arquivo PHP (evita recursão/CPU explosivas). */
export const MAX_NESTING = 120;

/** Maior profundidade de aninhamento de `()[]{}` do texto (varredura linear, sem recursão). */
export function maxNesting(text) {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // ( [ {
    if (c === 40 || c === 91 || c === 123) {
      if (++depth > max) max = depth;
    } else if ((c === 41 || c === 93 || c === 125) && depth > 0) depth--;
  }
  return max;
}

/** Tamanho máximo (bytes) de um flow.json aceito por `--render-only`. */
export const MAX_FLOW_BYTES = 25_000_000;

/** Escapa metacaracteres para uso literal dentro de uma RegExp. */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `true` se `target` está dentro de `root` (ou é a própria raiz),
 * resolvendo symlinks nos dois lados.
 */
export function isInside(root, target) {
  try {
    const r = realpathSync(root);
    const t = realpathSync(target);
    const rel = path.relative(r, t);
    if (rel === "") return true;
    return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** `true` se o arquivo existe, é regular e não excede o limite. */
export function isReadableSource(abs, max = MAX_FILE_BYTES) {
  try {
    const st = statSync(abs);
    return st.isFile() && st.size <= max;
  } catch {
    return false;
  }
}

/**
 * Lê o arquivo se for regular e não exceder `max` bytes, no mesmo descritor
 * (stat + read) para não haver janela TOCTOU entre as duas operações.
 * @returns {Promise<string|null>}
 */
export async function readFileIfSmall(abs, max = MAX_FILE_BYTES) {
  let fh;
  try {
    fh = await open(abs, "r");
    const st = await fh.stat();
    if (!st.isFile() || st.size > max) return null;
    return await fh.readFile("utf8");
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}
