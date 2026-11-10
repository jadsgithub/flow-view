import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { SAMPLE, REPO, tmp, cleanup, runCli, htmlPath } from "./helpers.mjs";
import { htmlFileName, runName, slugPath } from "../flow-view/src/output.mjs";

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));

const ROUTES = [
  ["POST", "/api/orders"],
  ["GET", "/api/hello"],
  ["GET", "/api/complex"],
];

for (const [method, path] of ROUTES) {
  test(`gera flow.json e HTML nomeado pelo endpoint para ${method} ${path}`, () => {
    const out = tmp();
    try {
      const r = runCli(["--root", SAMPLE, "--method", method, "--path", path, "--out", out]);
      assert.equal(r.status, 0, r.stderr);

      const flow = JSON.parse(readFileSync(join(out, "flow.json"), "utf8"));
      assert.equal(flow.meta.route.method, method);
      assert.equal(flow.meta.route.path, path);
      assert.deepEqual(flow.meta.generator, { name: "flow-view", version: pkg.version });
      assert.ok(flow.nodes.length >= 2, "esperava ao menos 2 nós");
      const ids = new Set(flow.nodes.map((n) => n.id));
      assert.ok(ids.has(flow.entry), "entry deve ser um nó existente");
      for (const e of flow.edges) assert.ok(ids.has(e.from) && ids.has(e.to), "aresta aponta para nó inexistente");
      assert.ok(flow.meta.outcomes.length >= 1, "esperava ao menos um desfecho");

      const html = readFileSync(htmlPath(out), "utf8");
      assert.ok(!html.includes("__FLOW_JSON__") && !html.includes("__CSP__") && !html.includes("__GENERATOR__"));
      assert.match(html, new RegExp(`<meta name="generator" content="flow-view ${pkg.version.replace(/\./g, "\\.")}"`));
    } finally {
      cleanup(out);
    }
  });
}

test("o HTML tem CSP restritiva e o hash do script confere", () => {
  const out = tmp();
  try {
    assert.equal(runCli(["--root", SAMPLE, "--method", "POST", "--path", "/api/orders", "--out", out]).status, 0);
    const html = readFileSync(htmlPath(out), "utf8");
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "script-src não pode permitir 'unsafe-inline'");
    const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const hash = createHash("sha256").update(code, "utf8").digest("base64");
    assert.ok(csp.includes(`'sha256-${hash}'`), "hash do script não confere com a CSP");
    // sem recursos externos
    assert.ok(!/(src|href)=["']https?:/i.test(html), "o HTML não deve carregar recursos externos");
  } finally {
    cleanup(out);
  }
});

test("--version imprime a versão do package.json", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test("--help funciona e termina com 0", () => {
  const r = runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--render-only/);
});

test("rejeita opção desconhecida, método inválido e valor ausente", () => {
  assert.equal(runCli(["--bogus"]).status, 1);
  assert.equal(runCli(["--method", "HACK", "--path", "/x"]).status, 1);
  assert.equal(runCli(["--path"]).status, 1);
  assert.equal(runCli(["--depth", "abc", "--path", "/x"]).status, 1);
});

test("rota inexistente termina com código 2 e mensagem clara", () => {
  const out = tmp();
  try {
    const r = runCli(["--root", SAMPLE, "--method", "GET", "--path", "/nao/existe", "--out", out]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Nenhum handler encontrado/);
  } finally {
    cleanup(out);
  }
});

test("--render-only valida o IR antes de renderizar", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = tmp();
  try {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));
    const r = runCli(["--render-only", bad, "--out", join(dir, "out")]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /flow\.json inválido/);
  } finally {
    cleanup(dir);
  }
});

test("runName segue o slug do endpoint e o carimbo UTC", () => {
  const n = runName("POST", "/api/orders/{order}", new Date("2026-11-07T18:15:08.000Z"));
  assert.equal(slugPath("/api/orders/{order}"), "api-orders-order");
  assert.equal(n, "post-api-orders-order-20261107-181508");
  assert.equal(htmlFileName(n), "post-api-orders-order-20261107-181508.html");
});

test("HTML usa o nome amigável do endpoint; --out grava fora do projeto", () => {
  const dest = tmp();
  try {
    const r = runCli(["--root", SAMPLE, "--method", "POST", "--path", "/api/orders", "--out", dest, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(r.stdout);
    assert.equal(rec.ok, true);
    assert.equal(rec.outDir, dest);
    assert.match(basename(rec.files.html), /^post-api-orders-\d{8}-\d{6}\.html$/);
    assert.ok(existsSync(rec.files.html) && existsSync(rec.files.json));
    assert.ok(!existsSync(join(dest, "index.html")));
  } finally {
    cleanup(dest);
  }
});

test("expande ~ em --out", () => {
  const home = tmp("fv-home-");
  try {
    const r = runCli(["--root", SAMPLE, "--method", "POST", "--path", "/api/orders", "--out", "~/fluxos", "--json"], {
      env: { ...process.env, HOME: home },
    });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(r.stdout);
    assert.equal(rec.ok, true);
    assert.ok(rec.outDir === join(home, "fluxos") || rec.files.html.startsWith(home));
    assert.ok(existsSync(rec.files.html));
  } finally {
    cleanup(home);
  }
});
