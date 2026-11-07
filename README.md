<div align="center">

<img src="./docs/assets/banner.svg" alt="Flow View — veja o que uma rota realmente faz, como uma história" width="100%">

<br>

[![CI](https://github.com/jadsgithub/flow-view/actions/workflows/ci.yml/badge.svg)](https://github.com/jadsgithub/flow-view/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jadsgithub/flow-view/actions/workflows/codeql.yml/badge.svg)](https://github.com/jadsgithub/flow-view/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jadsgithub/flow-view/badge)](https://scorecard.dev/viewer/?uri=github.com/jadsgithub/flow-view)
[![Release](https://img.shields.io/github/v/release/jadsgithub/flow-view?include_prereleases&sort=semver&label=vers%C3%A3o&color=22d3ee)](https://github.com/jadsgithub/flow-view/releases)
[![Licença: MIT](https://img.shields.io/github/license/jadsgithub/flow-view?color=34d399)](./LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%E2%89%A5%2018-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero dependências](https://img.shields.io/badge/depend%C3%AAncias-0-34d399)](./package.json)
[![SemVer](https://img.shields.io/badge/semver-2.0.0-blue)](https://semver.org/lang/pt-BR/)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org/pt-br/)
[![PRs welcome](https://img.shields.io/badge/PRs-bem--vindos-brightgreen)](./CONTRIBUTING.md)

**🇧🇷 Português** · [🇺🇸 English](./README.en.md)

</div>

---

**Flow View** transforma **uma rota/endpoint** do seu projeto em uma **história interativa em HTML**: o que ele recebe, quais regras e validações aplica, quais funções chama (e o que cada uma faz por dentro) e de quantas formas a requisição pode terminar.

Foi pensado para quem programa **e** para quem não programa: o mesmo diagrama tem um **modo Negócio** (linguagem simples) e um **modo Técnico** (funções, classes, variáveis, arquivo e linha).

> *"O endpoint `POST /api/orders` é chamado, recebe `customerId`, `items` e `coupon`, valida o pedido em `validateOrder`… se o cliente estiver bloqueado, responde 403; senão cria o pedido em `OrderService.create` e responde 201."*
> Isso, mas desenhado, clicável e gerado **a partir do código real**, sem IA e sem enviar nada para lugar nenhum.

## Sumário

- [Veja em ação](#veja-em-ação)
- [Por que usar](#por-que-usar)
- [Início rápido](#início-rápido)
- [Como funciona](#como-funciona)
- [Usando o diagrama](#usando-o-diagrama)
- [Referência do CLI](#referência-do-cli)
- [Suporte de linguagens e frameworks](#suporte-de-linguagens-e-frameworks)
- [Skill para agentes (Cursor, Claude Code, Codex)](#skill-para-agentes-cursor-claude-code-codex)
- [🔐 Segurança](#-segurança)
- [Versionamento e releases](#versionamento-e-releases)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Desenvolvimento](#desenvolvimento)
- [Roadmap](#roadmap)
- [Contribuindo](#contribuindo)
- [Licença](#licença)

## Veja em ação

<p align="center">
  <img src="./docs/assets/preview-overview.png" alt="Visão geral: resumo do endpoint, entradas, desfechos possíveis e os primeiros passos" width="49%">
  <img src="./docs/assets/preview-highlight.png" alt="Ao clicar em um desfecho, o caminho até ele é destacado e o texto explica quando ele acontece" width="49%">
</p>

<sub>À esquerda: o resumo do endpoint, o que ele recebe e como pode terminar. À direita: ao clicar em um desfecho (aqui, <b>201 Criado</b>), o caminho até ele é destacado e o banner explica <i>quando</i> isso acontece. Gerado de <code>examples/sample-app</code>.</sub>

## Por que usar

| Para quem | O que ganha |
| --------- | ----------- |
| 👩‍💻 **Devs** | Entendem uma rota desconhecida em minutos: ramos, validações, chamadas e retornos, com arquivo e linha de cada passo |
| 🧪 **QA** | Enxergam **todos os desfechos** de um endpoint e *quando* cada um acontece, a base para casos de teste |
| 🧑‍💼 **Produto / Negócio** | Leem e validam **regras de negócio** sem ler código |
| 🧭 **Quem chega ao projeto** | Onboarding visual: "o que acontece quando chamo este endpoint?" |
| 🤖 **Agentes de IA** | Um mapa confiável e determinístico do fluxo, em vez de adivinhar lendo dezenas de arquivos |

**Princípios**

- **Local e privado**: roda na sua máquina; nada de rede, nada de telemetria.
- **Estático e seguro**: o código analisado **nunca é executado**.
- **Determinístico**: sem LLM; a mesma entrada gera a mesma saída (ótimo para revisar em PRs).
- **Zero dependências**: só Node.js. Nada de `npm install`, nada de supply chain para vigiar.
- **Saída portátil**: um único `index.html` autocontido (e um `flow.json` tipado).

## Início rápido

**Requisitos:** [Node.js](https://nodejs.org) 18 ou superior. Funciona em macOS e Linux (testados no CI); no Windows deve funcionar, mas ainda não é testado no CI.

```bash
# 1. clone a versão que você quer usar (recomendado: uma tag)
git clone --branch v0.1.0 https://github.com/jadsgithub/flow-view.git
cd flow-view

# 2. gere o diagrama de uma rota do app de exemplo
node flow-view/bin/flow-view.mjs \
  --root examples/sample-app --method POST --path /api/orders
```

O navegador abre `flow-view-output/index.html`. Para analisar **o seu projeto**, aponte `--root` para ele:

```bash
node /caminho/para/flow-view/flow-view/bin/flow-view.mjs \
  --root ~/meu-projeto --method POST --path /api/checkout
```

<details>
<summary><b>Quer o comando <code>flow-view</code> disponível em qualquer pasta?</b></summary>

```bash
# dentro da pasta do repositório clonado
npm link          # cria o link global (sem baixar nada)
flow-view --version
flow-view --root . --method GET --path /api/users
```

</details>

## Como funciona

```mermaid
flowchart LR
  A["📁 Seu código<br/>(Express, Fastify,<br/>Hono, Next.js…)"] --> B["1 · Scanner<br/>acha o handler<br/>da rota"]
  B --> C["2 · Tracer + Narrador<br/>lê o handler como grafo<br/>e conta cada passo em português"]
  C --> D["3 · Builder<br/>'quando chega aqui',<br/>tom das setas, desfechos"]
  D --> E["🔒 Redação de segredos"]
  E --> F["flow.json<br/>(IR tipado)"]
  E --> G["4 · Renderer + CSP<br/>index.html standalone"]
```

1. **Scanner** localiza o handler da rota (Express, Fastify, Hono, Next.js App Router, FastAPI, Flask, Gin).
2. **Tracer + Narrador** leem o handler como um **grafo de decisões** (`if/else` com ou sem chaves, `switch`, loops, `try/catch/finally`, `return`/`throw`) e **narram cada passo em português**: dados lidos da requisição, regras de cada condição, atribuições, chamadas externas e respostas (status + corpo). Chamadas a funções e métodos do mesmo arquivo ou de **imports relativos são resolvidas** e resumidas ("por dentro de `validateOrder`…", até 2 níveis).
3. **Builder** calcula, para cada passo, *quando* ele é alcançado, o tom de cada seta (sucesso / erro / neutra), os **desfechos possíveis** e o texto de abertura.
4. **Renderer** grava um `index.html` autocontido, com **Content-Security-Policy** restritiva, e o `flow.json`.

Tudo é regra e análise estática: **sem LLM, sem rede, sem execução do seu código**.

## Usando o diagrama

| Recurso | Como usar |
| ------- | --------- |
| **Cards com detalhes inline** | Clique no cabeçalho de um card para expandir/recolher a explicação *daquele* passo |
| **Negócio / Técnico** | Alterna entre linguagem de negócio e símbolos/código (funções, classes, variáveis, trecho do código) |
| **Ramos de decisão** | Cada decisão tem botões *ocultar/mostrar sim/não*; ótimo para focar em um caminho |
| **Desfechos ("Pode terminar em")** | Clique num chip (✓ sucesso, ✕ erro) para destacar o caminho até ele e ver *quando* acontece |
| **Por dentro da função** | Resumo (até 2 níveis) do que a função chamada faz, linha a linha, com arquivo e linha |
| **Live / Still** | Liga/desliga o efeito de fluxo nas setas |
| **Zoom, ajuste e arrastar** | Botões `−` `Ajustar` `+`; `Ctrl/⌘ + rolagem` para zoom; arraste para navegar |
| **Tema claro/escuro** | Botão *Tema*; as preferências ficam salvas no navegador (localStorage) |
| **Expandir tudo** | Abre todos os cards de uma vez |

**Cores:** 🟦 entrada · 🟨 decisão · 🟧 validação · 🟪 serviço externo · ⬜ ação/dado · 🟩 sucesso · 🟥 erro/recusa. Seta verde = caminho que leva a sucesso; vermelha tracejada = erro/recusa.

## Referência do CLI

```text
flow-view --root <dir> --method <VERBO> --path <rota> [opções]
```

| Opção | Descrição | Padrão |
| ----- | --------- | ------ |
| `--root <dir>` | Raiz do projeto analisado. **Nada fora dela é lido.** | `.` |
| `--method <VERBO>` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` ou `ANY` | `GET` |
| `--path <rota>` | Caminho da rota (ex.: `/api/orders`) | *(obrigatório)* |
| `--out <dir>` | Pasta de saída (`flow.json` + `index.html`) | `flow-view-output` |
| `--no-open` | Não abre o navegador ao terminar | — |
| `--render-only <arq>` | Só gera o `index.html` a partir de um `flow.json` existente | — |
| `-v`, `--version` | Mostra a versão (SemVer) | — |
| `-h`, `--help` | Ajuda | — |

**Códigos de saída:** `0` sucesso · `1` uso inválido/erro · `2` rota não encontrada.

**Saídas**

- `flow-view-output/index.html`: o diagrama interativo (um arquivo só, sem dependências de rede).
- `flow-view-output/flow.json`: representação intermediária (IR) tipada, com schema em [`flow-view/schemas/flow.schema.json`](./flow-view/schemas/flow.schema.json). Registra também `meta.generator` (nome e versão da ferramenta).

Exemplos do app de exemplo (`examples/sample-app`):

```bash
# validação + regra de negócio em outra classe/arquivo + try/catch
node flow-view/bin/flow-view.mjs --root examples/sample-app --method POST --path /api/orders --no-open
# autenticação, chamada externa, try/catch
node flow-view/bin/flow-view.mjs --root examples/sample-app --method GET  --path /api/hello  --no-open
# if/else, retorno antecipado, if aninhado
node flow-view/bin/flow-view.mjs --root examples/sample-app --method GET  --path /api/complex --no-open
```

Mais detalhes em [`examples/sample-app/README.md`](./examples/sample-app/README.md).

## Suporte de linguagens e frameworks

| Linguagem / Framework | Localiza a rota | Narrativa passo a passo |
| --------------------- | :-------------: | ----------------------- |
| **JavaScript / TypeScript**: Express, Fastify, Hono, Next.js (App Router) | ✅ | ✅ **Completa**: condições, `else`, `switch`, loops, `try/catch/finally`, atribuições, chamadas resolvidas (mesmo arquivo e imports relativos) |
| **Python**: FastAPI, Flask | ✅ | 🟡 Básica (sem narrativa nem resolução de funções) |
| **Go**: Gin | ✅ | 🟡 Básica (sem narrativa nem resolução de funções) |
| **PHP / Laravel** (ex.: `FormRequest`) | ❌ | ❌ ainda não suportado (veja o [Roadmap](#roadmap)) |

> A análise é **heurística** (sem compilar nem executar). Construções muito dinâmicas podem gerar um diagrama simplificado; nesses casos, abra uma issue com um trecho mínimo.
> Hoje a narrativa do diagrama é gerada em **português do Brasil**.

## Skill para agentes (Cursor, Claude Code, Codex)

O repositório inclui uma **skill** ([`SKILL.md`](./SKILL.md)) para que um agente de IA gere o diagrama quando você pedir em linguagem natural: *"Use o Flow View: gere o diagrama para `POST /api/checkout` neste repositório."*

```bash
# a partir do clone local (depois de revisar o conteúdo)
bash install.sh cursor      # ~/.cursor/skills/flow-view/
bash install.sh claude      # ~/.claude/skills/flow-view/
bash install.sh codex       # ~/.agents/skills/flow-view/
bash install.sh opencode    # ~/.config/opencode/skills/flow-view/
```

O `install.sh` **só copia** o `SKILL.md`: não usa rede, não baixa nada e não executa código do repositório. Por segurança, **evite `curl | bash`**: clone, confira a tag e rode localmente.

## 🔐 Segurança

O Flow View lê código que pode ser de terceiros e gera um arquivo que você vai compartilhar, então a segurança é parte do projeto, não um detalhe. **Mesmo sendo público, ele foi desenhado para ser seguro por padrão:**

| Risco | Como tratamos |
| ----- | ------------- |
| Código analisado tentando executar algo | **Análise 100% estática**: o código analisado nunca é executado (sem `eval`, sem `import()` do alvo) |
| Ler arquivos fora do projeto (`../`, symlinks) | Toda leitura é validada com `realpath` e **restrita à `--root`**; symlinks não são seguidos |
| Entradas patológicas (arquivo gigante, regex catastrófica) | Limites de tamanho/quantidade/profundidade; padrões de rota **escapados** antes de virar regex |
| Código malicioso virando HTML (XSS) | Todo texto é **escapado**; dados embutidos como JSON seguro; classes por lista permitida |
| Defesa em profundidade contra XSS | **CSP** no HTML: `default-src 'none'`, script apenas por **hash SHA-256**, `connect-src 'none'`, sem recursos externos |
| Segredo "chumbado" no código vazando para o HTML | **Redação automática** de chaves (AWS, GitHub, Slack, Google, Stripe…), JWT, chaves privadas, URLs com senha e `password = "…"` |
| Dependência maliciosa (supply chain) | **Zero dependências**; sem scripts de instalação; Actions fixadas por **SHA**; Dependabot; CodeQL; OpenSSF Scorecard |
| Release adulterada | Releases só de commits da `main`, com **proveniência SLSA** e `SHA256SUMS` |
| *Prompt injection* em agentes de IA | A skill orienta o agente a tratar o conteúdo do código como **dados**, não instruções |

> ⚠️ **Antes de compartilhar o HTML:** ele contém **trechos do seu código**. A redação de segredos é uma rede de proteção heurística, não uma garantia. Revise o arquivo e nunca versione segredos.

**Encontrou uma vulnerabilidade?** Não abra issue pública: use o [relato privado](https://github.com/jadsgithub/flow-view/security/advisories/new). Veja a [Política de Segurança](./SECURITY.md) (prazos, escopo) e o [Modelo de ameaças](./docs/threat-model.md).

**Verifique uma release baixada:**

```bash
gh attestation verify flow-view-X.Y.Z.tgz --repo jadsgithub/flow-view   # proveniência (SLSA)
sha256sum -c SHA256SUMS                                                 # integridade
```

## Versionamento e releases

- **[SemVer 2.0.0](https://semver.org/lang/pt-BR/)**: `MAJOR.MINOR.PATCH`. Enquanto estiver em `0.x`, mudanças incompatíveis podem ocorrer em versões *minor* (sempre registradas no changelog).
- **[Conventional Commits](https://www.conventionalcommits.org/pt-br/)**: o tipo do commit (`fix:`, `feat:`, `feat!:`…) determina o tipo da versão.
- **[CHANGELOG.md](./CHANGELOG.md)**: histórico legível por humanos ([Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)).
- **Fonte única da versão**: `package.json`. O CI falha se `package.json`, `.cursor-plugin/plugin.json`, o `CHANGELOG.md` e a **tag** divergirem.
- **Tags assinadas** `vX.Y.Z` e imutáveis; cada tag gera uma **GitHub Release** com `flow-view-X.Y.Z.tgz`, `SHA256SUMS` e atestado de proveniência.
- **Rastreabilidade na saída**: todo `flow.json` registra `meta.generator` e todo `index.html` traz `<meta name="generator" content="flow-view X.Y.Z">` (e o rodapé "Gerado por flow-view vX.Y.Z"), assim você sabe qual versão gerou cada diagrama.
- A branch `main` é **protegida** (PR obrigatório, CI verde, commits assinados, histórico linear, sem force-push).

```bash
flow-view --version        # → 0.1.0
```

Processo completo (para mantenedores): [docs/releasing.md](./docs/releasing.md).

## Estrutura do repositório

```text
flow-view/
├── flow-view/
│   ├── bin/flow-view.mjs        # CLI (validação estrita de argumentos)
│   ├── src/
│   │   ├── scanner.mjs          # acha o handler da rota
│   │   ├── tracer.mjs           # grafo de passos do handler
│   │   ├── jsparse.mjs · jsast.mjs · js-cfg.mjs   # parser leve, AST de statements, fluxo de controle
│   │   ├── callee.mjs           # resolve chamadas (mesmo arquivo + imports relativos)
│   │   ├── narrate.mjs          # narrativa em português
│   │   ├── builder.mjs          # monta o IR (flow.json)
│   │   ├── redact.mjs           # redação de segredos
│   │   ├── security.mjs         # limites e validação de caminhos
│   │   └── renderer.mjs         # gera o HTML + CSP
│   ├── templates/viewer.html    # o viewer (HTML/CSS/JS, sem dependências)
│   └── schemas/flow.schema.json # schema do IR
├── examples/sample-app/         # app de exemplo para testar
├── test/                        # testes (node:test)
├── scripts/                     # check.mjs (higiene), release-notes.mjs
├── docs/                        # threat-model.md, releasing.md, assets/
├── .github/                     # CI, CodeQL, Scorecard, release, Dependabot, rulesets, templates
├── SKILL.md · install.sh        # skill para agentes
├── SECURITY.md · CONTRIBUTING.md · CODE_OF_CONDUCT.md · CHANGELOG.md · LICENSE
└── package.json
```

## Desenvolvimento

Sem dependências: basta ter o Node.js 18+.

```bash
npm run verify    # check (sintaxe, versões, placeholders) + testes
npm test          # só os testes (node:test)
npm run check     # só as verificações de higiene
npm run demo      # gera o diagrama do app de exemplo
```

Os testes cobrem, entre outros, geração de `flow.json`/HTML, CSP e hash do script, redação de segredos (inclusive falsos positivos), *path traversal*, symlinks, limites de tamanho, conteúdo malicioso no código analisado e a consistência das versões.

## Roadmap

- [ ] Suporte a **PHP/Laravel** (rotas e `FormRequest`), NestJS e Koa
- [ ] Narrativa completa para **Python** e **Go**
- [ ] Narrativa em **inglês** (e outros idiomas)
- [ ] Exportar o diagrama como **SVG/PNG/PDF**
- [ ] Publicação no **npm** com *provenance*
- [ ] CI no **Windows**
- [ ] Mais padrões de detecção de segredos

Sugestões são bem-vindas: abra uma [issue](https://github.com/jadsgithub/flow-view/issues/new/choose).

## Contribuindo

Contribuições são muito bem-vindas! Leia o [CONTRIBUTING.md](./CONTRIBUTING.md) (ambiente, Conventional Commits, commits assinados, regras de segurança) e o [Código de Conduta](./CODE_OF_CONDUCT.md).

Bons pontos de partida: novo framework no scanner (com testes e exemplo), melhorias na narrativa, novos padrões de segredos e acessibilidade do viewer.

## Licença

Distribuído sob a licença **MIT**. Veja [LICENSE](./LICENSE).

<div align="center">
<sub>Feito para que qualquer pessoa, programando ou não, entenda o que o código realmente faz.</sub>
</div>
