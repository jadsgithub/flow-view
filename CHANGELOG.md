# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto adota
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [0.3.0] - 2026-11-10

HTML nomeado pelo endpoint e pasta de saída escolhível; fluxo Laravel mais fiel e diagrama mais legível.

### Adicionado

- O HTML gerado usa o **mesmo nome da pasta do pedido** (`post-api-orders-20261107-181508.html` em vez de `index.html`), para o arquivo continuar reconhecível fora da pasta.
- Destino da saída: `--out` pode ser qualquer pasta (inclusive fora do projeto; `~/Desktop` é expandido). A skill pergunta uma vez onde gravar; o padrão continua `<projeto>/.flow-view/`.

### Corrigido

- Middleware Laravel que **encaminha** `$next` (ex.: Passport `CheckToken` envolvendo a pipeline) deixa de virar um
  desfecho **200**. O fluxo segue para o FormRequest/controller; token inválido → **401** e, se a rota declara escopos,
  falta de escopo → **403**.
- `FormRequest::rules()` agora percorre `if`/`array_merge`/`$this->…Rules()` (traits inclusive). Campos opcionais em um
  caso e obrigatórios em outro (ex.: `seller_cpf` conforme o tipo de credencial) aparecem no card e no “Por dentro”,
  com a cláusula **quando**.
- `response()->error()` / `response()->success()` e `config('arquivo.chave')` passam a definir o status HTTP real
  (403/422/503 em vez de 200).
- Rotas em `routes/integration/` (e `routes/api/`) são tratadas como API: validação inválida responde **422**, não 302.
- Card aberto deixa de espremer o texto: largura maior, quebra de linha e colunas do tabuleiro acompanham o card.
- Setas de fluxo e de decisão não compartilham mais o mesmo trilho: cada cruzamento ganha um canal próprio (horizontal e vertical), com rótulos SIM/NÃO afastados.
- Header: chips de campos não quebram no meio do identificador. Card: nome de classe longo quebra dentro do card, sem vazar.

## [0.2.0] - 2026-11-07

Suporte de primeira classe a **PHP / Laravel** e uso como **skill de agente** (ao estilo do Archify).

### Adicionado

- **PHP / Laravel** (stack principal): scanner de `routes/*.php` (grupos, `prefix`, `name`, `apiResource`/`resource`,
  `Route::view`/`redirect`, closures, controllers invocáveis, middlewares, `where`), com a ordem de execução real do
  Laravel: middlewares (rota, grupo e construtor do controller; `auth`, `throttle`, `can`, `verified`, `role`/`permission`
  e middlewares próprios com o `handle()` narrado) → route model binding (404) → **FormRequest**
  (`prepareForValidation` → `authorize` 403 → `rules` 422, com resumo por campo) → controller.
- Narração do controller e dos services: `if/elseif/else`, `switch`, loops, `try/catch/finally` (setas tipadas por
  exceção), `abort_if/abort_unless`, `$this->authorize()` + Policies, `$request->validate()`, `findOrFail`,
  `DB::transaction`, Eloquent, `Http::`, `Cache::`, `Log::`, `Mail`/`Notification`, eventos e filas, API Resources e
  mapeamento de exceções para HTTP (`render()` customizado). Services injetados no construtor são resolvidos por PSR-4
  (até 3 níveis, com as exceções que lançam).
- Novos tipos de nó no IR: `middleware`, `database`, `queue`, `notify`; rótulos de seta `erro · <Exceção>`.
- CLI para agentes: `--list-routes`, `--json` (recibo JSON em stdout, sem abrir o navegador), `--open`; saída padrão
  por pedido em `<root>/.flow-view/<método>-<rota>-<AAAAMMDD-HHMMSS>/`.
- `SKILL.md` reescrito como skill de agente (frontmatter, passo a passo, recibo JSON) e `install.sh` que instala o
  pacote autocontido em `~/.agents/skills/flow-view` com atalhos para Cursor, Claude Code e OpenCode (`--link`, `uninstall`).
- Exemplo `examples/laravel-app` e novos testes (parser PHP, rotas, fluxo completo, skill/instalador e segurança).

### Alterado

- Em projetos Laravel o scanner tenta o Laravel primeiro; Express/Fastify/Hono/Next.js/FastAPI/Flask/Gin seguem iguais.
- O viewer mostra botões de ramo (ocultar/mostrar) em qualquer passo que se divide, não só em `if`.

### Segurança

- O parser PHP é próprio e estático: nada é executado (`php`, `artisan`, `composer` nunca são chamados); `vendor/` é ignorado;
  leitura continua confinada à raiz, sem seguir symlinks para fora; segredos em strings PHP são redigidos.
- Novos limites contra entradas patológicas: arquivo PHP com mais de 120 níveis de aninhamento é ignorado, índice de
  linhas em cache (sem tempo quadrático) e no máximo 2.000 passos por diagrama (erro claro acima disso).

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

[Unreleased]: https://github.com/jadsgithub/flow-view/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jadsgithub/flow-view/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jadsgithub/flow-view/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jadsgithub/flow-view/releases/tag/v0.1.0
