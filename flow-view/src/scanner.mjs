/**
 * Localiza o handler de uma rota HTTP no código-fonte (heurística por regex).
 * Suporta: Express, Fastify, Hono, Next.js App Router, FastAPI, Flask, Gin.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { MAX_FILE_BYTES, MAX_FILES, MAX_DEPTH, escapeRegExp } from "./security.mjs";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "venv",
  "__pycache__",
  ".venv",
]);

const EXT = /\.(tsx?|jsx?|mjs|cjs|py|go)$/i;

function normPath(p) {
  if (!p) return "/";
  let x = p.trim();
  if (!x.startsWith("/")) x = "/" + x;
  if (x.length > 1 && x.endsWith("/")) x = x.slice(0, -1);
  return x;
}

function normMethod(m) {
  const u = String(m || "GET").toUpperCase();
  return u === "ANY" ? "ANY" : u;
}

function pathMatches(pattern, target) {
  const pa = normPath(pattern);
  const tb = normPath(target);
  if (pa === tb) return true;
  // segment wildcards :id -> aceita um segmento. Todo o resto é literal
  // (o padrão vem do código analisado e não pode virar regex arbitrária).
  const prep = pa
    .split("/")
    .map((seg) => (/^:[^/]+$/.test(seg) ? "[^/]+" : escapeRegExp(seg)))
    .join("/");
  try {
    return new RegExp("^" + prep + "$").test(tb);
  } catch {
    return false;
  }
}

async function walkFiles(dir, root, out = [], depth = 0) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    // Symlinks não são seguidos (isDirectory/isFile são falsos para links).
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      await walkFiles(full, root, out, depth + 1);
    } else if (e.isFile() && EXT.test(e.name)) {
      out.push({ full, rel: relative(root, full) });
    }
  }
  return out;
}

/** @param {string} content */
function lineOfIndex(content, index) {
  if (index < 0) return 1;
  return content.slice(0, index).split("\n").length;
}

/**
 * Express / Router: app.get('path', ...) router.post(...
 */
function scanExpressLike(content, rel, method, path) {
  const methods = method === "ANY" ? "(get|post|put|patch|delete|use|all)" : method.toLowerCase();
  const re = new RegExp(
    `\\.(?:${methods})\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`,
    "gi"
  );
  let m;
  while ((m = re.exec(content)) !== null) {
    const routePath = m[1];
    if (!pathMatches(routePath, path)) continue;
    const start = m.index;
    const line = lineOfIndex(content, start);
    return {
      file: rel,
      line,
      framework: "express-like",
      match: m[0],
      routePath,
    };
  }
  return null;
}

/** Fastify: fastify.route({ method: 'GET', url: '/x' */
function scanFastifyRoute(content, rel, method, path) {
  const re =
    /\.route\s*\(\s*\{[\s\S]*?method\s*:\s*['"]([^'"]+)['"][\s\S]*?url\s*:\s*['"]([^'"]+)['"]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const meth = m[1].toUpperCase();
    const url = m[2];
    if (method !== "ANY" && meth !== method && meth !== "GET") continue;
    if (!pathMatches(url, path)) continue;
    return {
      file: rel,
      line: lineOfIndex(content, m.index),
      framework: "fastify",
      match: m[0].slice(0, 120),
      routePath: url,
    };
  }
  // fastify.get('/path'
  return scanExpressLike(content, rel, method, path);
}

/** Hono: app.get('/path' same as express */
function scanHono(content, rel, method, path) {
  return scanExpressLike(content, rel, method, path);
}

/** Next.js App Router: export async function GET */
function scanNextAppRoute(content, rel, method, path) {
  if (!rel.includes("app") || !rel.includes("route.")) return null;
  // Infer path from file: app/api/foo/bar/route.ts -> /api/foo/bar
  const routeFileMatch = rel.match(/^(?:.*?\/)?app(\/.+)\/route\.(tsx?|jsx?)$/i);
  if (!routeFileMatch) return null;
  const inferred = normPath(routeFileMatch[1].replace(/\\/g, "/"));
  if (!pathMatches(inferred, path)) return null;
  const exportName = method === "ANY" ? "GET" : method;
  const fnRe = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${exportName}\\b`
  );
  const m = content.match(fnRe);
  if (!m) return null;
  const idx = content.indexOf(m[0]);
  return {
    file: rel,
    line: lineOfIndex(content, idx),
    framework: "next-app-router",
    handlerExport: exportName,
    routePath: inferred,
  };
}

/** FastAPI: @app.get("/path") @router.post */
function scanFastAPI(content, rel, method, path) {
  const decorators = method === "ANY" ? "get|post|put|patch|delete" : method.toLowerCase();
  const re = new RegExp(
    `@(?:app|router)\\.(${decorators})\\s*\\(\\s*["']([^"']+)["']`,
    "gi"
  );
  let m;
  while ((m = re.exec(content)) !== null) {
    const meth = m[1].toUpperCase();
    const p = m[2];
    if (method !== "ANY" && meth !== method) continue;
    if (!pathMatches(p, path)) continue;
    const after = content.slice(m.index + m[0].length);
    const fnMatch = after.match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(/);
    return {
      file: rel,
      line: lineOfIndex(content, m.index),
      framework: "fastapi",
      handlerName: fnMatch ? fnMatch[1] : null,
      routePath: p,
    };
  }
  return null;
}

/** Flask: @app.route('/x', methods=['POST']) */
function scanFlask(content, rel, method, path) {
  const re = /@\w+\.route\s*\(\s*['"]([^'"]+)['"]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const p = m[1];
    if (!pathMatches(p, path)) continue;
    const blockStart = m.index;
    const rest = content.slice(blockStart, blockStart + 400);
    const methodsMatch = rest.match(/methods\s*=\s*\[([^\]]+)\]/i);
    let ok = method === "ANY";
    if (methodsMatch && !ok) {
      const ms = methodsMatch[1].toUpperCase();
      ok = ms.includes(`'${method}'`) || ms.includes(`"${method}"`);
    }
    if (!ok && !methodsMatch && method === "GET") ok = true;
    if (!ok) continue;
    const after = content.slice(m.index + m[0].length);
    const defMatch = after.match(/\s*def\s+(\w+)\s*\(/);
    return {
      file: rel,
      line: lineOfIndex(content, m.index),
      framework: "flask",
      handlerName: defMatch ? defMatch[1] : null,
      routePath: p,
    };
  }
  return null;
}

/** Gin: r.GET("/x", ...) router.POST */
function scanGin(content, rel, method, path) {
  const map = { GET: "GET", POST: "POST", PUT: "PUT", PATCH: "PATCH", DELETE: "DELETE" };
  const ginMethod = method === "ANY" ? "[A-Z]+" : map[method] || method;
  const re = new RegExp(`\\b\\w+\\.(${ginMethod})\\s*\\(\\s*["']([^"']+)["']`, "g");
  let m;
  while ((m = re.exec(content)) !== null) {
    const p = m[2];
    if (!pathMatches(p, path)) continue;
    return {
      file: rel,
      line: lineOfIndex(content, m.index),
      framework: "gin",
      routePath: p,
      match: m[0],
    };
  }
  return null;
}

/**
 * @param {{ root: string, method: string, path: string }} opts
 */
export async function findRouteHandler(opts) {
  const root = opts.root;
  const method = normMethod(opts.method);
  const path = normPath(opts.path);
  const files = await walkFiles(root, root);
  const hits = [];

  for (const { full, rel } of files) {
    let content;
    try {
      if ((await stat(full)).size > MAX_FILE_BYTES) continue;
      content = await readFile(full, "utf8");
    } catch {
      continue;
    }

    const byExt = rel.toLowerCase();
    let hit = null;

    if (/\.(tsx?|jsx?|mjs|cjs)$/i.test(byExt)) {
      hit = scanNextAppRoute(content, rel, method, path);
      if (!hit) hit = scanFastifyRoute(content, rel, method, path);
      if (!hit) hit = scanHono(content, rel, method, path);
      if (!hit) hit = scanExpressLike(content, rel, method, path);
    } else if (/\.py$/i.test(byExt)) {
      hit = scanFastAPI(content, rel, method, path);
      if (!hit) hit = scanFlask(content, rel, method, path);
    } else if (/\.go$/i.test(byExt)) {
      hit = scanGin(content, rel, method, path);
    }

    if (hit) {
      hits.push({ ...hit, absFile: join(root, hit.file) });
    }
  }

  if (hits.length === 0) {
    return {
      ok: false,
      error: `Nenhum handler encontrado para ${method} ${path}`,
      candidates: [],
    };
  }

  // Preferência: Next route exato, depois primeiro match
  hits.sort((a, b) => {
    const score = (h) =>
      h.framework === "next-app-router" ? 0 : h.framework === "fastapi" ? 1 : 2;
    return score(a) - score(b);
  });

  const best = hits[0];
  return {
    ok: true,
    ...best,
    alternates: hits.slice(1),
  };
}
