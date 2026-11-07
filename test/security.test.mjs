import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmp, write, cleanup, runCli } from "./helpers.mjs";
import { isInside, escapeRegExp, MAX_FILE_BYTES } from "../flow-view/src/security.mjs";

test("isInside: aceita dentro da raiz e recusa ../ e irmãos de nome parecido", () => {
  const base = tmp();
  try {
    write(base, "app/a.js", "x");
    write(base, "app-evil/b.js", "x");
    write(base, "outside.js", "x");
    assert.equal(isInside(join(base, "app"), join(base, "app/a.js")), true);
    assert.equal(isInside(join(base, "app"), join(base, "app/../outside.js")), false);
    assert.equal(isInside(join(base, "app"), join(base, "app-evil/b.js")), false);
    assert.equal(isInside(join(base, "app"), join(base, "nao-existe.js")), false);
  } finally {
    cleanup(base);
  }
});

test("isInside: symlink que aponta para fora da raiz é recusado", () => {
  const base = tmp();
  try {
    write(base, "outside/secret.js", "export const s = 1;");
    write(base, "app/ok.js", "x");
    symlinkSync(join(base, "outside/secret.js"), join(base, "app/link.js"));
    assert.equal(isInside(join(base, "app"), join(base, "app/ok.js")), true);
    assert.equal(isInside(join(base, "app"), join(base, "app/link.js")), false);
  } finally {
    cleanup(base);
  }
});

test("escapeRegExp neutraliza metacaracteres", () => {
  const re = new RegExp("^" + escapeRegExp("/a(.*)+$") + "$");
  assert.ok(re.test("/a(.*)+$"));
  assert.ok(!re.test("/aXYZ"));
});

test("não lê arquivos fora da raiz via import relativo (path traversal)", () => {
  const base = tmp();
  try {
    write(base, "outside/leak.mjs", `export function leak() { const MARCADOR_FORA_DA_RAIZ = 1; return MARCADOR_FORA_DA_RAIZ; }`);
    write(base, "proj/server.mjs", [
      `import { leak } from "../outside/leak.mjs";`,
      `app.get("/x", (req, res) => {`,
      `  const v = leak();`,
      `  return res.json({ v });`,
      `});`,
    ].join("\n"));
    const out = join(base, "out");
    const r = runCli(["--root", join(base, "proj"), "--method", "GET", "--path", "/x", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const all = readFileSync(join(out, "flow.json"), "utf8") + readFileSync(join(out, "index.html"), "utf8");
    assert.ok(!all.includes("MARCADOR_FORA_DA_RAIZ"), "conteúdo de arquivo fora da raiz vazou para a saída");
  } finally {
    cleanup(base);
  }
});

test("ignora arquivos acima do limite de tamanho", () => {
  const base = tmp();
  try {
    const big = `app.get("/big", (req, res) => res.json({ ok: true }));\n` + "// x\n".repeat(Math.ceil(MAX_FILE_BYTES / 5) + 10);
    write(base, "server.mjs", big);
    const r = runCli(["--root", base, "--method", "GET", "--path", "/big", "--out", join(base, "out")]);
    assert.equal(r.status, 2, "arquivo grande demais não deve ser analisado");
  } finally {
    cleanup(base);
  }
});

test("não segue symlinks na busca de arquivos", () => {
  const base = tmp();
  try {
    write(base, "outside/server.mjs", `app.get("/via-link", (req, res) => res.json({ ok: true }));`);
    write(base, "proj/readme.txt", "x");
    symlinkSync(join(base, "outside"), join(base, "proj/linked"));
    const r = runCli(["--root", join(base, "proj"), "--method", "GET", "--path", "/via-link", "--out", join(base, "out")]);
    assert.equal(r.status, 2, "symlink não deve ser seguido");
  } finally {
    cleanup(base);
  }
});

const PAYLOADS = [
  `</script><img src=x onerror=alert(1)>`,
  `"><svg onload=alert(1)>`,
  `'+alert(1)+'`,
  `\u2028\u2029`,
];

test("conteúdo malicioso no código analisado não vira HTML executável", () => {
  const base = tmp();
  try {
    const p = PAYLOADS[0];
    write(base, "server.mjs", [
      `app.post("/evil", (req, res) => {`,
      `  if (req.body.name === ${JSON.stringify(p)}) {`,
      `    return res.status(400).json({ error: ${JSON.stringify(p)} });`,
      `  }`,
      `  const x = "${PAYLOADS[1].replace(/"/g, '\\"')}";`,
      `  return res.json({ ok: ${JSON.stringify(PAYLOADS[2])} });`,
      `});`,
    ].join("\n"));
    const out = join(base, "out");
    const r = runCli(["--root", base, "--method", "POST", "--path", "/evil", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(out, "index.html"), "utf8");
    // 1) o bloco de dados não pode ser fechado por conteúdo do código
    assert.equal((html.match(/<\/script>/g) || []).length, 2, "esperava exatamente 2 </script> (dados + viewer)");
    assert.ok(!html.includes("</script><img"), "payload fechou o <script>");
    // 2) a CSP continua presente e sem unsafe-inline para scripts
    assert.match(html, /script-src 'sha256-/);
  } finally {
    cleanup(base);
  }
});
