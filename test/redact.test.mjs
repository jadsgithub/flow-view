import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactString, redactDeep, REDACTED } from "../flow-view/src/redact.mjs";
import { tmp, write, cleanup, runCli } from "./helpers.mjs";

const SECRETS = {
  aws: "AKIAIOSFODNN7EXAMPLE",
  github: "ghp_" + "a".repeat(36),
  slack: "xoxb-1234567890-abcdefghij",
  google: "AIza" + "B".repeat(35),
  stripe: "sk_live_" + "c".repeat(24),
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----",
  dburl: "postgres://admin:s3nh4Forte@db.interno:5432/app",
};

for (const [name, secret] of Object.entries(SECRETS)) {
  test(`redige ${name}`, () => {
    const out = redactString(`const x = ${secret}; // fim`);
    assert.ok(!out.includes(secret.slice(0, 20)), `vazou: ${out}`);
    assert.ok(out.includes(REDACTED));
  });
}

test("redige atribuição com nome sugestivo, preservando a chave", () => {
  const out = redactString(`const config = { password: "SuperSenha123", api_key: 'abcd1234efgh' };`);
  assert.ok(out.includes('password: "' + REDACTED + '"'));
  assert.ok(out.includes("api_key: '" + REDACTED + "'"));
  assert.ok(!out.includes("SuperSenha123"));
});

test("redige Bearer token", () => {
  assert.ok(!redactString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123").includes("abcdefghijkl"));
});

test("NÃO altera texto comum nem mensagens de erro legítimas", () => {
  const txt = [
    'return res.status(401).json({ error: "token inválido" });',
    'const password = req.body.password;',
    'if (!user.passwordHash) return res.status(400).json({ error: "senha ausente" });',
    "Responde 422 · Dados inválidos",
    "Chama o método `create` de `orderService`, passando `customer`; o campo `items` do corpo (body)",
  ].join("\n");
  assert.equal(redactString(txt), txt);
});

test("redactDeep percorre objetos e arrays sem tocar nas chaves", () => {
  const out = redactDeep({ a: [{ b: `k=${SECRETS.aws}` }], password: 123, n: null });
  assert.ok(!JSON.stringify(out).includes("AKIAIOSFODNN7EXAMPLE"));
  assert.equal(out.password, 123);
  assert.equal(out.n, null);
});

test("fim a fim: segredo no código não aparece em flow.json nem em index.html", () => {
  const base = tmp();
  try {
    write(base, "server.mjs", [
      `app.get("/pay", (req, res) => {`,
      `  const stripeKey = "${SECRETS.stripe}";`,
      `  const password = "SuperSenha123";`,
      `  if (!req.query.id) return res.status(400).json({ error: "id obrigatório" });`,
      `  return res.json({ ok: true });`,
      `});`,
    ].join("\n"));
    const out = join(base, "out");
    const r = runCli(["--root", base, "--method", "GET", "--path", "/pay", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    for (const f of ["flow.json", "index.html"]) {
      const txt = readFileSync(join(out, f), "utf8");
      assert.ok(!txt.includes("sk_live_ccccc"), `${f} contém a chave`);
      assert.ok(!txt.includes("SuperSenha123"), `${f} contém a senha`);
    }
  } finally {
    cleanup(base);
  }
});
