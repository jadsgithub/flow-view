# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.1.0] - 2026-11-07

Primeira versão pública.

### Adicionado

- CLI `flow-view` (`--root`, `--method`, `--path`, `--out`, `--no-open`, `--render-only`, `--version`, `--help`).
- Scanner de rotas: Express, Fastify, Hono, Next.js (App Router), FastAPI, Flask e Gin.
- Rastreio e narração em português de handlers JavaScript/TypeScript: condições, `else`, `switch`,
  loops, `try/catch/finally`, atribuições, chamadas externas e respostas; chamadas a funções e métodos
  do mesmo arquivo ou de imports relativos são resolvidas e resumidas (até 2 níveis).
- Builder do IR (`flow.json`) com "quando chega aqui", tom das setas e desfechos possíveis; schema JSON em
  `flow-view/schemas/flow.schema.json`.
- Viewer HTML standalone: cards com detalhes inline, modo Negócio/Técnico, ocultar/mostrar ramos,
  destaque do caminho até cada desfecho, efeito de fluxo (Live/Still), zoom/pan, tema claro/escuro.
- Skill para agentes (`SKILL.md`, `install.sh`, `.cursor-plugin`).
- App de exemplo em `examples/sample-app`.
- `meta.generator` no `flow.json` e `<meta name="generator">` no HTML com a versão da ferramenta.

### Segurança

- Análise 100% estática: o código analisado nunca é executado.
- Leitura restrita à `--root` (validação por `realpath`; imports `../` e symlinks fora da raiz são recusados;
  a varredura não segue symlinks).
- Limites de entrada: 1,5 MB por arquivo, 20 mil arquivos, profundidade 24; padrões de rota escapados antes de
  virarem expressão regular.
- Redação automática de segredos (chaves AWS/GitHub/GitLab/Slack/Google/Stripe/npm/SendGrid, JWT, chaves privadas,
  URLs com senha, atribuições como `password = "…"`) em `flow.json` e `index.html`.
- HTML gerado com Content-Security-Policy restritiva (`default-src 'none'`, script por hash SHA-256,
  `connect-src 'none'`) e sem recursos externos.
- Corrigido XSS no banner de desfecho do viewer (texto era reinserido como HTML) e reforçado o escape de atributos.
- Validação estrita dos argumentos do CLI e do IR em `--render-only`; navegador aberto sem shell.
- Zero dependências de runtime; Actions fixadas por SHA; CodeQL, Scorecard, Dependabot e Dependency Review.

[Unreleased]: https://github.com/jadsgithub/flow-view/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jadsgithub/flow-view/releases/tag/v0.1.0
