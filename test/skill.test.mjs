import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, tmp, cleanup } from "./helpers.mjs";

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const skill = readFileSync(join(REPO, "SKILL.md"), "utf8");

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, "SKILL.md precisa começar com frontmatter YAML");
  return m[1];
}

test("SKILL.md tem frontmatter válido (name, description) e a versão confere com o package.json", () => {
  const fm = frontmatter(skill);
  assert.match(fm, /^name: flow-view$/m);
  const desc = /^description: "(.*)"$/m.exec(fm);
  assert.ok(desc && desc[1].length > 100 && desc[1].length < 1500, "description presente e com tamanho razoável");
  assert.match(desc[1], /Laravel/, "a descrição deve destacar PHP/Laravel (gatilho da skill)");
  const v = /^\s+version: "([^"]+)"$/m.exec(fm);
  assert.ok(v, "metadata.version presente");
  assert.equal(v[1], pkg.version, "metadata.version do SKILL.md difere do package.json");
});

test("SKILL.md documenta os fluxos principais do agente", () => {
  for (const needle of ["--list-routes", "--json", ".flow-view/", "prompt injection", "PHP"]) {
    if (needle === "prompt injection") assert.match(skill, /dados, nunca como instruções/);
    else assert.ok(skill.includes(needle), `SKILL.md deveria mencionar ${needle}`);
  }
});

test("install.sh instala um pacote autocontido que funciona e desinstala sem sobras", { skip: process.platform === "win32" }, () => {
  const home = tmp("fv-home-");
  try {
    const env = { ...process.env, HOME: home };
    const run = (...args) => spawnSync("bash", [join(REPO, "install.sh"), ...args], { encoding: "utf8", env });

    let r = run("all");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const base = join(home, ".agents", "skills", "flow-view");
    assert.ok(existsSync(join(base, "SKILL.md")));
    assert.ok(existsSync(join(base, "flow-view", "bin", "flow-view.mjs")));
    assert.ok(!existsSync(join(base, "test")), "testes não fazem parte do pacote instalado");
    for (const link of [".cursor/skills/flow-view", ".claude/skills/flow-view", ".config/opencode/skills/flow-view"]) {
      assert.ok(lstatSync(join(home, link)).isSymbolicLink(), `${link} deveria ser um atalho`);
      assert.ok(existsSync(join(home, link, "SKILL.md")));
    }

    // o CLI instalado roda sozinho, a partir de outra pasta
    const cli = join(base, "flow-view", "bin", "flow-view.mjs");
    const laravel = join(REPO, "examples", "laravel-app");
    const lr = spawnSync(process.execPath, [cli, "--root", laravel, "--list-routes", "--json"], { encoding: "utf8", cwd: home, env });
    assert.equal(lr.status, 0, lr.stderr);
    assert.equal(JSON.parse(lr.stdout).framework, "laravel");

    // reinstalar por cima funciona
    assert.equal(run().status, 0);

    r = run("uninstall");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(base));
    assert.ok(!existsSync(join(home, ".cursor", "skills", "flow-view")));
  } finally {
    cleanup(home);
  }
});

test("install.sh recusa alvos desconhecidos", { skip: process.platform === "win32" }, () => {
  const r = spawnSync("bash", [join(REPO, "install.sh"), "../../etc"], { encoding: "utf8", env: { ...process.env, HOME: tmp("fv-home-") } });
  assert.notEqual(r.status, 0);
});
