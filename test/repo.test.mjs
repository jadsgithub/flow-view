import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers.mjs";

test("scripts/check.mjs passa (sintaxe, versões consistentes, sem placeholders)", () => {
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "check.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("arquivos de governança de um projeto open source existem", () => {
  for (const f of ["LICENSE", "README.md", "README.en.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", ".github/CODEOWNERS", ".github/dependabot.yml"]) {
    assert.ok(existsSync(join(REPO, f)), `faltando: ${f}`);
  }
});

test("o projeto não tem dependências de runtime (superfície de supply chain mínima)", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.postinstall, undefined);
  assert.equal(pkg.scripts.preinstall, undefined);
  assert.equal(pkg.scripts.install, undefined);
});

test("workflows do GitHub fixam Actions por SHA de commit", () => {
  const dir = join(REPO, ".github", "workflows");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const txt = readFileSync(join(dir, f), "utf8");
    for (const m of txt.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      const ref = m[1];
      if (ref.startsWith("./")) continue;
      assert.match(ref, /@[0-9a-f]{40}$/, `${f}: "${ref}" não está fixada por SHA`);
    }
    assert.match(txt, /^permissions:/m, `${f}: falta 'permissions:' no nível do workflow`);
  }
});
