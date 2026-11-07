# Guia de releases e proteção do repositório (mantenedores)

Este guia garante um **controle de versão preciso** e um repositório público **blindado**.

## 1. Versionamento (SemVer 2.0.0)

`MAJOR.MINOR.PATCH`

- **MAJOR**: muda flag do CLI, formato de saída incompatível (`flow.json`), remove suporte;
- **MINOR**: nova funcionalidade compatível (novo framework, nova opção);
- **PATCH**: correção de bug ou de segurança.
- Pré-lançamentos: `0.2.0-rc.1` (a release é marcada como *pre-release* automaticamente).

Fonte única da versão: `package.json`. O `npm run check` falha se `package.json`, `.cursor-plugin/plugin.json`,
o topo do `CHANGELOG.md` e a tag divergirem.

## 2. Passo a passo de uma release

```bash
# 0. main atualizada e verde
git switch main && git pull --ff-only
npm run verify

# 1. branch de release
git switch -c release/v0.2.0

# 2. atualize a versão nos 3 lugares
#    - package.json                  ("version")
#    - .cursor-plugin/plugin.json    ("version")
#    - CHANGELOG.md                  (renomeie [Unreleased] → [0.2.0] - AAAA-MM-DD, crie um novo [Unreleased],
#                                     e atualize os links de comparação no rodapé)
npm run verify

# 3. PR → revisão → merge na main (CI verde, commits assinados)

# 4. tag ASSINADA no commit da main
git switch main && git pull --ff-only
git tag -s v0.2.0 -m "Flow View v0.2.0"
git push origin v0.2.0
```

O workflow `release.yml` então: confirma que a tag está na `main`, confere tag == versões == CHANGELOG, roda os
testes, gera `flow-view-X.Y.Z.tgz` e `SHA256SUMS`, **atesta a proveniência (SLSA)** e cria a GitHub Release
com as notas extraídas do CHANGELOG.

### Verificação por quem baixa

```bash
gh attestation verify flow-view-0.2.0.tgz --repo jadsgithub/flow-view
sha256sum -c SHA256SUMS
```

### Publicar no npm (opcional)

O `package.json` já tem `publishConfig.provenance`. Para publicar, use um token **granular** (somente esse
pacote, com 2FA obrigatório) ou *Trusted Publishing*, e faça-o por um workflow dedicado, nunca da sua máquina.

## 3. Configuração do repositório no GitHub (faça uma vez)

### 3.1 Conta

- 2FA obrigatório (de preferência chaves de segurança/passkeys).
- Commits **assinados** (GPG ou SSH) com o selo *Verified*.

### 3.2 Rulesets

Em **Settings → Rules → Rulesets → New ruleset → Import a ruleset**, importe:

- [`.github/rulesets/protect-main.json`](../.github/rulesets/protect-main.json): `main` exige PR, status checks,
  histórico linear, assinatura de commits; bloqueia force-push e exclusão.
- [`.github/rulesets/protect-tags.json`](../.github/rulesets/protect-tags.json): tags `v*` imutáveis e assinadas.

> Com apenas um mantenedor, `required_approving_review_count` está em `0` (o PR e o CI são obrigatórios, mas você
> consegue mesclar o seu próprio PR). Ao entrar mais mantenedores, suba para `1` e ative
> `require_code_owner_review`.

### 3.3 Segurança (Settings → Code security)

Ative: **Private vulnerability reporting**, **Dependency graph**, **Dependabot alerts** e **security updates**,
**Secret scanning** com **Push protection**, **Code scanning** (o CodeQL já está no workflow).

### 3.4 Actions (Settings → Actions → General)

- *Workflow permissions*: **Read repository contents** (padrão somente leitura);
- Desmarque *Allow GitHub Actions to create and approve pull requests*;
- *Fork pull request workflows*: exigir aprovação para colaboradores externos;
- *Allowed actions*: "Allow actions created by GitHub" + as explicitamente fixadas por SHA nos workflows.

### 3.5 Tópicos e descrição

Descrição: *Transforma uma rota/endpoint em uma história interativa (HTML). Análise estática, zero dependências.*
Tópicos sugeridos: `static-analysis`, `documentation`, `express`, `fastify`, `nextjs`, `diagram`, `agent-skill`.

## 4. Primeira publicação

```bash
git init -b main
git add -A && git status        # confira: sem flow-view-output/, .env, chaves...
git commit -S -m "feat: primeira versão pública do Flow View"
git remote add origin git@github.com:jadsgithub/flow-view.git
git push -u origin main
# configure os itens da seção 3, depois:
git tag -s v0.1.0 -m "Flow View v0.1.0" && git push origin v0.1.0
```
