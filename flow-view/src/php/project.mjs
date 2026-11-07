/**
 * Índice estático de um projeto PHP/Laravel: lê arquivos (somente dentro da raiz), extrai
 * namespace, `use`, classes, métodos, propriedades e resolve nomes de classe via PSR-4
 * (`composer.json`). Nada é executado e `vendor/` nunca é lido.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { isInside, isReadableSource, MAX_FILES, MAX_DEPTH, MAX_NESTING, maxNesting } from "../security.mjs";
import { stripPhpComments, matchClose, skipString, startsWithKw, splitArgs, lineNoAt, parseArrayLiteral, stringLiteral } from "./parse.mjs";

const SKIP_DIRS = new Set(["vendor", "node_modules", ".git", "storage", "bootstrap/cache", "public", "tests", "database", "resources", "dist", "build", ".idea", ".vscode"]);
const INDEX_DIRS = ["app", "src", "domain", "Domain", "modules", "Modules", "app-modules", "packages", "lib"];

const BUILTIN_TYPES = new Set([
  "int", "float", "string", "bool", "array", "mixed", "void", "null", "callable", "iterable", "object", "self", "static", "parent",
  "never", "false", "true", "closure", "integer", "boolean",
]);

export function isBuiltinType(t) {
  return BUILTIN_TYPES.has(String(t || "").toLowerCase().replace(/^\\/, ""));
}

/** Pega o primeiro tipo "de classe" de uma anotação (`?Foo`, `Foo|null`, `A&B`). */
export function primaryType(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .replace(/^\?/, "")
    .split(/[|&]/)
    .map((p) => p.trim().replace(/^\?/, ""))
    .filter(Boolean);
  const hit = parts.find((p) => !isBuiltinType(p));
  return hit || null;
}

export function parseParams(inner) {
  return splitArgs(inner).map((raw) => {
    const m =
      /^((?:(?:public|protected|private|readonly)\s+)*)(?:(\??[A-Za-z_\\][\w\\]*(?:\s*[|&]\s*\??[A-Za-z_\\][\w\\]*)*)\s+)?(&\s*)?(\.\.\.\s*)?(\$[A-Za-z_]\w*)(?:\s*=\s*([\s\S]+))?$/.exec(
        raw.trim()
      );
    if (!m) return { name: raw.trim(), type: null, promoted: false, visibility: null, default: null };
    return {
      name: m[5],
      type: m[2] ? m[2].replace(/\s+/g, "") : null,
      promoted: /\b(public|protected|private|readonly)\b/.test(m[1] || ""),
      visibility: (m[1] || "").match(/\b(public|protected|private)\b/)?.[1] || null,
      default: m[6] ? m[6].trim() : null,
      variadic: Boolean(m[4]),
    };
  });
}

/** Troca o interior de `{...}` por espaços (mantém quebras de linha) para análise do "topo" da classe. */
function maskBlocks(s) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const end = skipString(s, i);
      out += depth > 0 ? s.slice(i, end).replace(/[^\n]/g, " ") : s.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "{") {
      out += depth === 0 ? "{" : " ";
      depth++;
    } else if (c === "}") {
      depth--;
      out += depth === 0 ? "}" : " ";
    } else out += depth > 0 && c !== "\n" ? " " : c;
  }
  return out;
}

export function createPhpProject(root) {
  const files = new Map(); // abs -> FileInfo | null
  const fqcnCache = new Map();
  let psr4 = null;
  let shortIndex = null; // basename -> abs[]
  let bindings = null;

  const rel = (abs) => path.relative(root, abs) || path.basename(abs);

  function readRaw(abs) {
    if (!abs || !isInside(root, abs) || !isReadableSource(abs)) return null;
    try {
      const text = readFileSync(abs, "utf8");
      // arquivo patológico (milhares de parênteses/blocos aninhados): ignora em vez de arriscar travar o parser
      return maxNesting(text) > MAX_NESTING ? null : text;
    } catch {
      return null;
    }
  }

  /** Lê e indexa um arquivo `.php`. */
  function parseFile(abs) {
    if (files.has(abs)) return files.get(abs);
    const raw = readRaw(abs);
    if (raw == null) {
      files.set(abs, null);
      return null;
    }
    const src = stripPhpComments(raw);
    const info = { abs, rel: rel(abs), raw, src, namespace: "", uses: new Map(), classes: [] };
    files.set(abs, info);

    const ns = /(?:^|[\s;])namespace\s+([\w\\]+)\s*[;{]/.exec(src);
    if (ns) info.namespace = ns[1];

    // `use A\B\C;`, `use A\B\C as D;`, `use A\B\{C, D as E};` (apenas no topo do arquivo, antes da 1ª classe)
    const firstClass = src.search(/\b(?:class|interface|trait|enum)\s+[A-Za-z_]/);
    const head = firstClass < 0 ? src : src.slice(0, firstClass);
    for (const m of head.matchAll(/\buse\s+(?!function\b|const\b)([\w\\]+?)(?:\\\{([^}]*)\})?(?:\s+as\s+(\w+))?\s*;/g)) {
      if (m[2]) {
        for (const part of m[2].split(",")) {
          const pm = /^\s*([\w\\]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
          if (pm) info.uses.set(pm[2] || pm[1].split("\\").pop(), `${m[1]}\\${pm[1]}`);
        }
      } else info.uses.set(m[3] || m[1].split("\\").pop(), m[1].replace(/^\\/, ""));
    }

    const declRe = /(?<![:>\w$\\])(class|interface|trait|enum)\s+([A-Za-z_]\w*)/g;
    let m;
    while ((m = declRe.exec(src))) {
      if (/^(extends|implements)$/.test(m[2])) continue;
      const open = src.indexOf("{", m.index);
      if (open < 0) break;
      const header = src.slice(m.index + m[0].length, open);
      const close = matchClose(src, open);
      if (close < 0) break;
      const ext = /\bextends\s+([\w\\,\s]+?)(?=\bimplements\b|$)/.exec(header);
      const impl = /\bimplements\s+([\w\\,\s]+)$/.exec(header);
      const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
      const cls = {
        kind: m[1],
        name: m[2],
        fqcn: info.namespace ? `${info.namespace}\\${m[2]}` : m[2],
        extends: list(ext && ext[1]),
        implements: list(impl && impl[1]),
        traits: [],
        methods: new Map(),
        props: new Map(),
        file: info,
        idx: m.index,
        line: lineNoAt(src, m.index),
        open,
        close,
      };
      parseMembers(info, cls);
      info.classes.push(cls);
      declRe.lastIndex = close + 1;
    }
    return info;
  }

  function parseMembers(info, cls) {
    const { src } = info;
    const body = src.slice(cls.open + 1, cls.close);
    const base = cls.open + 1;

    // `use TraitA, TraitB;` no topo da classe
    const masked = maskBlocks(body);
    for (const m of masked.matchAll(/(?:^|[;{}\s])use\s+([\w\\,\s]+?)\s*(?:;|\{)/g)) {
      for (const t of m[1].split(",")) if (t.trim()) cls.traits.push(t.trim());
    }
    for (const m of masked.matchAll(/(?:public|protected|private|var)\s+(?:static\s+)?(?:readonly\s+)?(?:(\??[A-Za-z_\\][\w\\|&]*)\s+)?\$([A-Za-z_]\w*)/g)) {
      if (m[1] && /^(function|const)$/.test(m[1])) continue;
      cls.props.set(m[2], m[1] || null);
    }

    let depth = 0;
    let boundary = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"' || c === "'") {
        i = skipString(body, i) - 1;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) boundary = i + 1;
      } else if (depth === 0 && c === ";") boundary = i + 1;
      else if (depth === 0 && c === "f" && startsWithKw(body, i, "function")) {
        const mods = body.slice(boundary, i);
        let j = i + 8;
        while (/\s/.test(body[j] || "")) j++;
        if (body[j] === "&") j++;
        const nm = /^[A-Za-z_]\w*/.exec(body.slice(j));
        if (!nm) continue;
        j += nm[0].length;
        while (/\s/.test(body[j] || "")) j++;
        if (body[j] !== "(") continue;
        const pClose = matchClose(body, j);
        if (pClose < 0) continue;
        const params = parseParams(body.slice(j + 1, pClose));
        let k = pClose + 1;
        while (/\s/.test(body[k] || "")) k++;
        let returnType = null;
        if (body[k] === ":") {
          const rm = /^:\s*(\??[A-Za-z_\\][\w\\|&?]*)/.exec(body.slice(k));
          if (rm) {
            returnType = rm[1];
            k += rm[0].length;
          }
          while (/\s/.test(body[k] || "")) k++;
        }
        let bodyOpen = -1;
        let bodyClose = -1;
        if (body[k] === "{") {
          bodyOpen = base + k;
          const cl = matchClose(body, k);
          bodyClose = cl < 0 ? base + body.length : base + cl;
        }
        const method = {
          name: nm[0],
          visibility: /\b(private|protected)\b/.exec(mods)?.[1] || "public",
          isStatic: /\bstatic\b/.test(mods),
          isAbstract: /\babstract\b/.test(mods),
          params,
          returnType,
          idx: base + i,
          bodyOpen,
          bodyClose,
          line: lineNoAt(src, base + i),
          cls,
        };
        cls.methods.set(method.name, method);
        if (method.name === "__construct") {
          for (const p of params) if (p.promoted) cls.props.set(p.name.slice(1), p.type);
        }
        i = bodyClose >= 0 ? bodyClose - base : i + 8;
        if (bodyClose >= 0) boundary = i + 1;
      }
    }
  }

  /* ---------------------------- resolução de nomes ---------------------------- */

  function loadPsr4() {
    if (psr4) return psr4;
    psr4 = [];
    const cj = path.join(root, "composer.json");
    try {
      if (existsSync(cj) && isReadableSource(cj)) {
        const j = JSON.parse(readFileSync(cj, "utf8"));
        for (const sec of [j.autoload, j["autoload-dev"]]) {
          const map = sec && sec["psr-4"];
          if (!map || typeof map !== "object") continue;
          for (const [prefix, dirs] of Object.entries(map)) {
            for (const d of Array.isArray(dirs) ? dirs : [dirs]) {
              if (typeof d === "string") psr4.push({ prefix, dir: d });
            }
          }
        }
      }
    } catch {
      /* composer.json inválido: usa o padrão */
    }
    if (!psr4.some((p) => p.prefix === "App\\")) psr4.push({ prefix: "App\\", dir: "app/" });
    psr4.sort((a, b) => b.prefix.length - a.prefix.length);
    return psr4;
  }

  function buildShortIndex() {
    if (shortIndex) return shortIndex;
    shortIndex = new Map();
    let count = 0;
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH || count >= MAX_FILES) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1);
        } else if (e.isFile() && e.name.endsWith(".php")) {
          count++;
          const base = e.name.slice(0, -4);
          if (!shortIndex.has(base)) shortIndex.set(base, []);
          shortIndex.get(base).push(full);
        }
      }
    };
    for (const d of INDEX_DIRS) walk(path.join(root, d), 0);
    return shortIndex;
  }

  /** Resolve `Foo\Bar` (já totalmente qualificado) para uma ClassInfo do projeto. */
  function findClass(fqcn) {
    const key = String(fqcn || "").replace(/^\\/, "");
    if (!key) return null;
    if (fqcnCache.has(key)) return fqcnCache.get(key);
    let found = null;
    for (const { prefix, dir } of loadPsr4()) {
      if (!key.startsWith(prefix)) continue;
      const restPath = key.slice(prefix.length).split("\\").join("/") + ".php";
      const abs = path.resolve(root, dir, restPath);
      const fi = parseFile(abs);
      const c = fi && fi.classes.find((x) => x.fqcn === key || x.name === key.split("\\").pop());
      if (c) {
        found = c;
        break;
      }
    }
    if (!found) {
      const base = key.split("\\").pop();
      const cands = buildShortIndex().get(base) || [];
      for (const abs of cands) {
        const fi = parseFile(abs);
        const c = fi && fi.classes.find((x) => x.fqcn === key);
        if (c) {
          found = c;
          break;
        }
      }
      if (!found && cands.length === 1) {
        const fi = parseFile(cands[0]);
        found = (fi && fi.classes.find((x) => x.name === base)) || null;
      }
    }
    fqcnCache.set(key, found);
    return found;
  }

  /** Nome (como escrito no código) → FQCN, considerando `use` e o namespace do arquivo. */
  function qualify(name, fromFile) {
    if (!name) return null;
    let n = String(name).trim();
    if (n.startsWith("\\")) return n.slice(1);
    const first = n.split("\\")[0];
    if (fromFile && fromFile.uses.has(first)) {
      const rest = n.slice(first.length);
      return fromFile.uses.get(first) + rest;
    }
    if (fromFile && fromFile.namespace) return `${fromFile.namespace}\\${n}`;
    return n;
  }

  /** Resolve um nome de classe do código para ClassInfo (tenta FQCN e, depois, o nome curto). */
  function resolveClass(name, fromFile, fromClass) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    if ((lower === "self" || lower === "static") && fromClass) return fromClass;
    if (lower === "parent" && fromClass) return parentOf(fromClass);
    let c = findClass(qualify(name, fromFile));
    if (!c && fromFile && !name.includes("\\")) {
      const same = fromFile.classes.find((x) => x.name === name);
      if (same) c = same;
    }
    if (c && (c.kind === "interface" || (c.methods.size && [...c.methods.values()].every((m) => m.isAbstract)))) {
      return implementationOf(c) || c;
    }
    return c;
  }

  function parentOf(cls) {
    const p = cls.extends[0];
    return p ? findClass(qualify(p, cls.file)) : null;
  }

  function loadBindings() {
    if (bindings) return bindings;
    bindings = new Map();
    const cands = [];
    const provDir = path.join(root, "app", "Providers");
    try {
      for (const e of readdirSync(provDir, { withFileTypes: true })) if (e.isFile() && e.name.endsWith(".php")) cands.push(path.join(provDir, e.name));
    } catch {
      /* sem providers */
    }
    for (const abs of cands) {
      const fi = parseFile(abs);
      if (!fi) continue;
      for (const m of fi.src.matchAll(/->\s*(?:bind|singleton|scoped|instance)\s*\(\s*\\?([\w\\]+)::class\s*,\s*(?:\\?([\w\\]+)::class)/g)) {
        bindings.set(qualify(m[1], fi), qualify(m[2], fi));
      }
    }
    return bindings;
  }

  function implementationOf(iface) {
    const b = loadBindings().get(iface.fqcn);
    if (b) {
      const c = findClass(b);
      if (c) return c;
    }
    const base = iface.name.replace(/(Interface|Contract)$/, "");
    for (const cand of [base, `Eloquent${base}`, `Default${base}`]) {
      if (cand === iface.name) continue;
      for (const abs of buildShortIndex().get(cand) || []) {
        const fi = parseFile(abs);
        const c = fi && fi.classes.find((x) => x.name === cand && x.kind === "class");
        if (c) return c;
      }
    }
    return null;
  }

  /** Procura um método na classe, nas traits e na cadeia de `extends` (limitada). */
  function findMethod(cls, name, depth = 0) {
    if (!cls || depth > 5) return null;
    const m = cls.methods.get(name);
    if (m && m.bodyOpen >= 0) return m;
    for (const t of cls.traits) {
      const tc = findClass(qualify(t, cls.file));
      const hit = tc && findMethod(tc, name, depth + 1);
      if (hit) return hit;
    }
    const p = parentOf(cls);
    return p ? findMethod(p, name, depth + 1) : m || null;
  }

  /** A classe (ou algum ancestral) estende/implementa algum dos nomes (curtos ou FQCN)? */
  function isKindOf(cls, names, depth = 0) {
    if (!cls || depth > 6) return false;
    const want = new Set(names.map((n) => n.replace(/^\\/, "")));
    const short = new Set([...want].map((n) => n.split("\\").pop()));
    const parents = [...cls.extends, ...cls.implements];
    for (const p of parents) {
      const q = qualify(p, cls.file);
      if (want.has(q) || short.has(q.split("\\").pop()) || short.has(String(p).split("\\").pop())) return true;
    }
    const p = parentOf(cls);
    return p ? isKindOf(p, names, depth + 1) : false;
  }

  /** Texto do corpo (entre as chaves) do método. */
  const methodBody = (m) => (m && m.bodyOpen >= 0 ? m.cls.file.src.slice(m.bodyOpen + 1, m.bodyClose) : "");

  const configCache = new Map();
  /** Lê `config('arquivo.chave.aninhada')` no `config/arquivo.php` (estático; `vendor/` não entra). */
  function config(key) {
    const k = String(key || "").trim();
    if (!k) return null;
    if (configCache.has(k)) return configCache.get(k);
    const parts = k.split(".");
    const file = parseFile(path.join(root, "config", `${parts[0]}.php`));
    if (!file) {
      configCache.set(k, null);
      return null;
    }
    const m = /return\s*(\[)/.exec(file.src);
    if (!m) {
      configCache.set(k, null);
      return null;
    }
    const open = file.src.indexOf("[", m.index);
    const close = matchClose(file.src, open);
    let cur = close > 0 ? parseArrayLiteral(file.src.slice(open, close + 1)) : null;
    let val = null;
    for (const p of parts.slice(1)) {
      if (!Array.isArray(cur)) {
        val = null;
        break;
      }
      const it = cur.find((x) => stringLiteral(x.key) === p);
      if (!it) {
        val = null;
        break;
      }
      const lit = stringLiteral(it.value);
      if (lit != null) {
        val = lit;
        cur = lit;
        continue;
      }
      const inner = parseArrayLiteral(it.value);
      if (inner) {
        cur = inner;
        val = null;
        continue;
      }
      val = it.value;
      cur = it.value;
    }
    configCache.set(k, val);
    return val;
  }

  return {
    root,
    rel,
    readRaw,
    parseFile,
    findClass,
    qualify,
    resolveClass,
    findMethod,
    isKindOf,
    parentOf,
    methodBody,
    config,
    shortIndex: buildShortIndex,
  };
}

export function isLaravelProject(root) {
  try {
    if (existsSync(path.join(root, "artisan"))) return true;
    const routes = path.join(root, "routes");
    if (existsSync(routes) && readdirSync(routes).some((f) => /^(web|api)\.php$/.test(f))) return true;
  } catch {
    /* ignore */
  }
  return false;
}
