import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, cpSync, symlinkSync, lstatSync } from "node:fs";
import { join, basename } from "node:path";
import { REPO, tmp, cleanup, write, runCli, htmlPath } from "./helpers.mjs";
import { stripPhpComments, parseStatements, parseChain } from "../flow-view/src/php/parse.mjs";
import { createPhpProject } from "../flow-view/src/php/project.mjs";
import { loadLaravelRoutes, matchRoutes } from "../flow-view/src/php/routes.mjs";

const LARAVEL = join(REPO, "examples", "laravel-app");

function flowFor(method, path, root = LARAVEL) {
  const out = tmp();
  const r = runCli(["--root", root, "--method", method, "--path", path, "--out", out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const flow = JSON.parse(readFileSync(join(out, "flow.json"), "utf8"));
  return { flow, out, html: readFileSync(htmlPath(out), "utf8") };
}

const statuses = (flow) => flow.meta.outcomes.map((o) => o.status).sort((a, b) => a - b);
const byType = (flow, type) => flow.nodes.filter((n) => n.type === type);

// --------------------------------------------------------------------------
// Parser
// --------------------------------------------------------------------------

test("php: remove comentários e atributos sem mexer em strings nem em posições", () => {
  const src = `<?php
// comentário
$a = 'http://exemplo.com/x'; # outro
/* bloco
   multi */ $b = "a // b";
#[Route('/x')]
function f() {}
`;
  const out = stripPhpComments(src);
  assert.equal(out.length, src.length, "o tamanho (offsets) deve ser preservado");
  assert.equal(out.split("\n").length, src.split("\n").length, "as linhas devem ser preservadas");
  assert.ok(out.includes("'http://exemplo.com/x'"));
  assert.ok(out.includes('"a // b"'));
  assert.ok(!out.includes("comentário") && !out.includes("multi") && !out.includes("outro"));
});

test("php: parseStatements entende if/elseif/else, try/catch tipado e foreach", () => {
  const src = stripPhpComments(`
if ($a) { x(); } elseif ($b) { y(); } else { z(); }
try { w(); } catch (A | B $e) { q(); } finally { r(); }
foreach ($items as $item) { s($item); }
return 1;
`);
  const st = parseStatements(src, 0);
  const kinds = st.map((s) => s.kind);
  assert.deepEqual(kinds, ["if", "try", "loop", "simple"]);
  assert.equal(st[0].else[0].kind, "if", "elseif vira if aninhado no else");
  assert.deepEqual(st[1].catches[0].types, ["A", "B"]);
});

test("php: parseChain separa cabeça, chamadas e propriedades", () => {
  const ch = parseChain("$this->orders->place($customer, $data['items'])");
  assert.equal(ch.head.kind, "var");
  assert.equal(ch.head.name, "$this");
  assert.deepEqual(ch.calls.map((c) => [c.name, Boolean(c.prop)]), [["orders", true], ["place", false]]);
  const st = parseChain("Order::query()->where('a', 1)->first()");
  assert.equal(st.head.kind, "static");
  assert.deepEqual(st.calls.map((c) => c.name), ["query", "where", "first"]);
});

// --------------------------------------------------------------------------
// Rotas
// --------------------------------------------------------------------------

test("laravel: lê routes/*.php com grupos, prefixos, resources e middlewares", () => {
  const routes = loadLaravelRoutes(createPhpProject(LARAVEL));
  const find = (m, u) => routes.find((r) => r.methods.includes(m) && r.uri === u);

  const store = find("POST", "/api/orders");
  assert.ok(store, "POST /api/orders (apiResource)");
  assert.equal(store.name, "orders.store");
  assert.deepEqual(store.middleware.slice(-2), ["auth:sanctum", "throttle:60,1"]);
  assert.equal(store.action.method, "store");

  assert.ok(find("GET", "/api/orders/{order}"), "show do apiResource");
  assert.ok(find("DELETE", "/api/orders/{order}"), "destroy do apiResource");
  assert.ok(!routes.some((r) => r.uri === "/api/orders/create"), "apiResource não gera create/edit");

  const cancel = find("POST", "/api/orders/{order}/cancel");
  assert.ok(cancel.middleware.includes("can:cancel,order"));

  const sales = find("GET", "/api/admin/reports/sales");
  assert.ok(sales, "grupo aninhado com prefix");
  assert.deepEqual(sales.middleware.slice(-2), ["active", "role:admin"]);

  assert.equal(find("GET", "/api/health").action.kind, "closure");
  assert.equal(find("GET", "/").action.kind, "view");
});

test("laravel: matchRoutes aceita URL real e padrão da rota", () => {
  const routes = loadLaravelRoutes(createPhpProject(LARAVEL));
  assert.equal(matchRoutes(routes, "GET", "/api/orders/42")[0].uri, "/api/orders/{order}");
  assert.equal(matchRoutes(routes, "GET", "/api/orders/{id}")[0].uri, "/api/orders/{order}");
  assert.equal(matchRoutes(routes, "POST", "/api/orders").length, 1);
  assert.equal(matchRoutes(routes, "GET", "/nao/existe").length, 0);
});

// --------------------------------------------------------------------------
// Fluxo completo
// --------------------------------------------------------------------------

test("laravel: POST /api/orders percorre middlewares, FormRequest, controller e service", () => {
  const { flow, out, html } = flowFor("POST", "/api/orders");
  try {
    assert.equal(flow.meta.entry.framework, "laravel");
    assert.equal(flow.meta.entry.handler.name, "OrderController::store");
    assert.equal(flow.meta.entry.route.routeName, "orders.store");

    // todos os desfechos esperados, cada um uma vez
    assert.deepEqual(statuses(flow), [201, 401, 402, 403, 404, 409, 422, 422, 429]);
    assert.equal(flow.meta.outcomes.filter((o) => o.tone !== "error").length, 1);

    // ordem do Laravel: middlewares → FormRequest → controller
    const order = flow.nodes.map((n) => n.type);
    assert.equal(order[0], "route_entry");
    assert.equal(order[1], "middleware");
    assert.ok(order.indexOf("middleware") < order.indexOf("validation"));
    assert.ok(order.indexOf("validation") < order.indexOf("database"));

    // FormRequest: regras por campo
    const rules = flow.nodes.find((n) => n.type === "validation" && n.meta.callee && n.meta.callee.name === "rules");
    assert.ok(rules, "nó de validação do FormRequest");
    assert.equal(rules.meta.callee.summary.length, 6);
    assert.match(rules.meta.callee.summary[0].text, /customer_id.*obrigatório/);

    // try/catch com setas tipadas por exceção
    const labels = flow.edges.map((e) => e.label);
    assert.ok(labels.includes("erro · InsufficientStockException"));
    assert.ok(labels.includes("erro · PaymentDeclinedException"));

    // o service injetado no construtor foi resolvido (por dentro de…)
    const call = flow.nodes.find((n) => n.meta.callee && n.meta.callee.name === "place");
    assert.equal(call.meta.callee.className, "OrderService");
    assert.ok(call.meta.callee.summary.some((s) => /transação/.test(s.text)));
    assert.ok(call.meta.callee.summary.some((s) => /PaymentDeclinedException/.test(s.text)));

    // "só chega aqui quando" acumula as condições anteriores
    const created = flow.meta.outcomes.find((o) => o.status === 201);
    assert.ok(created.reachedWhen.length >= 6);

    // integridade do grafo
    const ids = new Set(flow.nodes.map((n) => n.id));
    for (const e of flow.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `aresta ${e.from}->${e.to}`);
    assert.ok(!html.includes("__FLOW_JSON__"));
  } finally {
    cleanup(out);
  }
});

test("laravel: route model binding, Policy e abort_if viram decisões com desfecho", () => {
  const { flow, out } = flowFor("PUT", "/api/orders/7");
  try {
    assert.ok(statuses(flow).includes(404), "binding de {order} → 404");
    assert.ok(statuses(flow).includes(409), "abort_if(...,409)");
    assert.ok(statuses(flow).includes(422), "FormRequest → 422");
    const decisions = flow.nodes.filter((n) => n.meta.pos && n.meta.neg);
    assert.ok(decisions.length >= 4);
  } finally {
    cleanup(out);
  }
});

test("laravel: middleware próprio, role e policy aparecem na ordem do pipeline", () => {
  const { flow, out } = flowFor("GET", "/api/admin/reports/sales");
  try {
    const mw = byType(flow, "middleware").map((n) => n.label);
    assert.ok(mw.some((l) => /autenticado/.test(l)));
    assert.ok(mw.some((l) => /EnsureAccountIsActive/.test(l)), "corpo do middleware próprio foi lido");
    assert.ok(mw.some((l) => /papel/.test(l)), "role:admin");
    assert.ok(statuses(flow).includes(403));
  } finally {
    cleanup(out);
  }
});

test("laravel: rotas web (closure, view, redirect de login) funcionam", () => {
  const web = flowFor("GET", "/orders/1/receipt");
  const view = flowFor("GET", "/");
  try {
    assert.ok(statuses(web.flow).includes(302), "auth em rota web redireciona para o login");
    assert.ok(statuses(web.flow).includes(404));
    assert.ok(statuses(view.flow).includes(200));
  } finally {
    cleanup(web.out, view.out);
  }
});

test("laravel: todas as rotas do exemplo geram um fluxo íntegro", () => {
  const routes = loadLaravelRoutes(createPhpProject(LARAVEL)).filter((r) => !r.fallback);
  assert.ok(routes.length >= 11);
  for (const r of routes) {
    const method = r.methods.find((m) => m !== "HEAD");
    const { flow, out } = flowFor(method, r.uri);
    try {
      assert.ok(flow.nodes.length >= 2, `${method} ${r.uri}`);
      assert.ok(flow.meta.outcomes.length >= 1, `${method} ${r.uri}: sem desfecho`);
      const ids = new Set(flow.nodes.map((n) => n.id));
      assert.ok(ids.has(flow.entry));
      for (const e of flow.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${method} ${r.uri}: aresta quebrada`);
    } finally {
      cleanup(out);
    }
  }
});

// --------------------------------------------------------------------------
// CLI para agentes (skill)
// --------------------------------------------------------------------------

test("cli: --list-routes --json lista as rotas do Laravel", () => {
  const r = runCli(["--root", LARAVEL, "--list-routes", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.framework, "laravel");
  assert.ok(j.routes.some((x) => x.method === "POST" && x.path === "/api/orders" && x.handler === "OrderController@store"));
});

test("cli: --json imprime só o recibo e grava em .flow-view/<método>-<rota>-<data>/", () => {
  const root = tmp();
  try {
    cpSync(LARAVEL, root, { recursive: true });
    const r = runCli(["--root", root, "--method", "POST", "--path", "/api/orders", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(r.stdout); // stdout inteiro precisa ser JSON válido
    assert.equal(rec.ok, true);
    assert.equal(rec.framework, "laravel");
    assert.equal(rec.entry.handler, "OrderController::store");
    assert.equal(rec.summary.outcomes, 9);
    assert.equal(rec.opened, false);
    assert.match(rec.outDir, /\.flow-view[\\/]post-api-orders-\d{8}-\d{6}$/);
    assert.ok(rec.outDir.startsWith(root) || rec.outDir.includes(root.replace(/^\/private/, "")));
    assert.equal(basename(rec.files.html, ".html"), basename(rec.outDir));
    assert.ok(existsSync(rec.files.html) && existsSync(rec.files.json));
  } finally {
    cleanup(root);
  }
});

test("cli: --json com rota inexistente devolve ok:false, sugere rotas e sai com código 2", () => {
  const r = runCli(["--root", LARAVEL, "--method", "GET", "--path", "/api/orders-inexistente", "--json"]);
  assert.equal(r.status, 2);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.match(j.error, /\/api\/orders/);
});

// --------------------------------------------------------------------------
// Segurança
// --------------------------------------------------------------------------

function miniLaravel(extra = {}) {
  const root = tmp("fv-laravel-");
  write(root, "artisan", "#!/usr/bin/env php\n");
  write(root, "composer.json", JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }));
  write(
    root,
    "routes/api.php",
    `<?php
use App\\Http\\Controllers\\ThingController;
use Illuminate\\Support\\Facades\\Route;
Route::post('/things', [ThingController::class, 'store']);
`
  );
  write(
    root,
    "app/Http/Controllers/ThingController.php",
    extra.controller ||
      `<?php
namespace App\\Http\\Controllers;
class ThingController {
  public function store($request) {
    return response()->json(['ok' => true], 201);
  }
}
`
  );
  return root;
}

test("segurança (php): segredos em strings do código não vazam para flow.json nem index.html", () => {
  // Concatenado em runtime para o GitHub Push Protection não tratar o literal como chave Stripe.
  const secret = ["sk_live_", "abcdefghijklmnopqrstuvwx"].join("");
  const root = miniLaravel({
    controller: `<?php
namespace App\\Http\\Controllers;
class ThingController {
  public function store($request) {
    $key = '${secret}';
    Http::withToken($key)->post('https://api.example.com/charge', ['token' => '${secret}']);
    return response()->json(['ok' => '${secret}'], 201);
  }
}
`,
  });
  const out = tmp();
  try {
    assert.equal(runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]).status, 0);
    for (const f of [join(out, "flow.json"), htmlPath(out)]) {
      assert.ok(!readFileSync(f, "utf8").includes(secret), `${f} vazou o segredo`);
    }
  } finally {
    cleanup(root, out);
  }
});

test("segurança (php): conteúdo malicioso no código não vira HTML executável", () => {
  const root = miniLaravel({
    controller: `<?php
namespace App\\Http\\Controllers;
class ThingController {
  public function store($request) {
    abort_if($request->x === '<img src=x onerror=alert(1)>', 422, '<script>alert(2)</script>');
    return response()->json(['msg' => '</script><script>alert(3)</script>'], 201);
  }
}
`,
  });
  const out = tmp();
  try {
    assert.equal(runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]).status, 0);
    const html = readFileSync(htmlPath(out), "utf8");
    assert.equal((html.match(/<script>/g) || []).length, 1, "só o script do viewer pode existir");
    assert.ok(!html.includes("<img src=x"), "tag do código analisado não pode aparecer crua");
    assert.ok(!html.includes("alert(3)</script>"));
  } finally {
    cleanup(root, out);
  }
});

test("segurança (php): vendor/ não é lido e o código analisado não é executado", () => {
  const marker = join(tmp("fv-marker-"), "executado.txt");
  const root = miniLaravel({
    controller: `<?php
namespace App\\Http\\Controllers;
class ThingController {
  public function store($request) {
    file_put_contents('${marker.replace(/\\/g, "/")}', 'pwned');
    system('touch ${marker.replace(/\\/g, "/")}');
    return response()->json(['ok' => true], 201);
  }
}
`,
  });
  // uma "classe" maliciosa em vendor/ com o mesmo nome não pode sobrescrever a do app
  write(root, "vendor/evil/ThingController.php", `<?php\nnamespace App\\Http\\Controllers;\nclass ThingController { public function store() { return response()->json(['evil' => 'VENDOR_LIDO'], 200); } }\n`);
  const out = tmp();
  try {
    assert.equal(runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]).status, 0);
    assert.ok(!existsSync(marker), "o código do projeto foi executado!");
    assert.ok(!readFileSync(join(out, "flow.json"), "utf8").includes("VENDOR_LIDO"), "vendor/ foi lido");
  } finally {
    cleanup(root, out);
  }
});

test("segurança (php): symlink para fora da raiz não é seguido", { skip: process.platform === "win32" }, () => {
  const outside = tmp("fv-outside-");
  write(outside, "Leaked.php", `<?php\nnamespace App\\Http\\Controllers;\nclass ThingController { public function store() { return response()->json(['leak' => 'FORA_DA_RAIZ'], 200); } }\n`);
  const root = tmp("fv-laravel-sym-");
  write(root, "artisan", "x");
  write(root, "composer.json", JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }));
  write(root, "routes/api.php", `<?php\nuse App\\Http\\Controllers\\ThingController;\nRoute::post('/things', [ThingController::class, 'store']);\n`);
  write(root, "app/placeholder.txt", "x");
  symlinkSync(join(outside, "Leaked.php"), join(root, "app", "ThingController.php"));
  assert.ok(lstatSync(join(root, "app", "ThingController.php")).isSymbolicLink());
  const out = tmp();
  try {
    runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]);
    const f = join(out, "flow.json");
    if (existsSync(f)) assert.ok(!readFileSync(f, "utf8").includes("FORA_DA_RAIZ"), "seguiu symlink para fora da raiz");
  } finally {
    cleanup(root, out, outside);
  }
});

test("segurança (php): arquivo PHP gigante é ignorado sem travar", () => {
  const root = miniLaravel();
  write(root, "app/Http/Controllers/Big.php", "<?php\n// " + "x".repeat(2 * 1024 * 1024) + "\n");
  const out = tmp();
  try {
    assert.equal(runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]).status, 0);
  } finally {
    cleanup(root, out);
  }
});

// --------------------------------------------------------------------------
// Robustez contra entradas patológicas
// --------------------------------------------------------------------------

function controllerWith(body) {
  return `<?php\nnamespace App\\Http\\Controllers;\nclass ThingController {\n  public function store($request) {\n${body}\n    return response()->json(['ok' => true], 201);\n  }\n}\n`;
}

test("robustez (php): aninhamento absurdo de parênteses/blocos é ignorado rápido, sem travar", () => {
  const root = miniLaravel({ controller: controllerWith(`$a = ${"(".repeat(50_000)}1${")".repeat(50_000)};`) });
  const root2 = miniLaravel({ controller: controllerWith(`${"if ($a) { ".repeat(2_000)}$b = 1;${" }".repeat(2_000)}`) });
  const out = tmp();
  try {
    for (const r of [root, root2]) {
      const t = Date.now();
      const res = runCli(["--root", r, "--method", "POST", "--path", "/api/things", "--out", out, "--json"]);
      assert.ok(Date.now() - t < 10_000, "demorou demais");
      assert.ok([0, 1].includes(res.status), res.stderr);
      assert.doesNotThrow(() => JSON.parse(res.stdout), "com --json, stdout deve ser sempre JSON válido");
    }
  } finally {
    cleanup(root, root2, out);
  }
});

test("robustez (php): fluxo com passos demais é interrompido com erro claro (limite de segurança)", () => {
  const body = Array.from({ length: 2_500 }, (_, i) => `$a${i} = $request->input(${i});`).join("\n");
  const root = miniLaravel({ controller: controllerWith(body) });
  try {
    const res = runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--json"]);
    assert.equal(res.status, 1);
    const j = JSON.parse(res.stdout);
    assert.equal(j.ok, false);
    assert.match(j.error, /limite de segurança/);
  } finally {
    cleanup(root);
  }
});

test("robustez (php): arquivo de rotas enorme não degrada para tempo quadrático", () => {
  const root = miniLaravel();
  const routes = Array.from({ length: 15_000 }, (_, i) => `Route::get('/r${i}', [App\\Http\\Controllers\\ThingController::class, 'store']);`).join("\n");
  write(root, "routes/api.php", `<?php\nRoute::post('/things', [App\\Http\\Controllers\\ThingController::class, 'store']);\n${routes}\n`);
  const out = tmp();
  try {
    const t = Date.now();
    const res = runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(Date.now() - t < 10_000, `levou ${Date.now() - t}ms`);
  } finally {
    cleanup(root, out);
  }
});

test("php: match() vira uma descrição legível (com aviso de exceção)", () => {
  const root = miniLaravel({
    controller: controllerWith(`$r = match ($request->kind) { 'a' => 1, 'b' => throw new \\DomainException('x'), default => null };`),
  });
  const out = tmp();
  try {
    assert.equal(runCli(["--root", root, "--method", "POST", "--path", "/api/things", "--out", out]).status, 0);
    const flow = JSON.parse(readFileSync(join(out, "flow.json"), "utf8"));
    const n = flow.nodes.find((x) => /conforme/.test(x.label));
    assert.ok(n, "nó do match");
    assert.match(n.explanation, /depende de/);
    assert.match(n.explanation, /DomainException/);
  } finally {
    cleanup(root, out);
  }
});

// --------------------------------------------------------------------------
// Auth por escopos, FormRequest ramificado, config() e layout
// --------------------------------------------------------------------------

function scopedLaravel() {
  const root = miniLaravel();
  write(
    root,
    "bootstrap/app.php",
    `<?php
use App\\Http\\Middleware\\CheckClientCredentialsOrFixedToken;
use Illuminate\\Foundation\\Application;
use Illuminate\\Foundation\\Configuration\\Middleware;
return Application::configure(basePath: dirname(__DIR__))
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'integration.access' => CheckClientCredentialsOrFixedToken::class,
        ]);
    })->create();
`
  );
  write(
    root,
    "routes/integration/inss.php",
    `<?php
use App\\Http\\Controllers\\ConsultController;
use Illuminate\\Support\\Facades\\Route;
Route::prefix('api-inss-consig')->middleware(['integration.access:scope-a,scope-b'])->group(function () {
    Route::post('consult-benefit', [ConsultController::class, 'consultBenefit']);
});
`
  );
  write(
    root,
    "app/Http/Middleware/CheckClientCredentialsOrFixedToken.php",
    `<?php
namespace App\\Http\\Middleware;
use Closure;
use Illuminate\\Http\\Request;
use Symfony\\Component\\HttpFoundation\\Response;
class CheckClientCredentialsOrFixedToken {
  public function handle(Request $request, Closure $next, ...$scopes): Response {
    if ($this->isBackToBack($request)) {
      return $next($request);
    }
    if ($this->isPassportBearer($request)) {
      return $this->checkClientCredentials->handle($request, function ($request) use ($next, $scopes) {
        if (! empty($scopes)) {
          return $this->checkTokenScope->handle($request, $next, ...$scopes);
        }
        return $next($request);
      });
    }
    return response()->json(['message' => 'Credenciais inválidas'], Response::HTTP_UNAUTHORIZED);
  }
  private function isPassportBearer($request) { return true; }
  private function isBackToBack($request) { return false; }
}
`
  );
  write(
    root,
    "app/Traits/SellerRules.php",
    `<?php
namespace App\\Traits;
trait SellerRules {
  protected function integratorPlatformSellerRules(): array {
    if (! $this->credentialType()->isIntegratorPlatform()) return [];
    return [
      'seller_cpf' => ['required', 'string'],
      'entity_id' => ['nullable', 'integer'],
    ];
  }
}
`
  );
  write(
    root,
    "app/Http/Requests/ConsultBenefitRequest.php",
    `<?php
namespace App\\Http\\Requests;
use App\\Traits\\SellerRules;
use Illuminate\\Foundation\\Http\\FormRequest;
class ConsultBenefitRequest extends FormRequest {
  use SellerRules;
  public function authorize(): bool { return true; }
  public function rules(): array {
    $base = [
      'client_cpf' => ['required', 'string'],
      'benefit' => ['required', 'string'],
      'cellphone' => ['required', 'string'],
    ];
    if ($this->credentialType()->isParceiro()) {
      if (! $this->filled('seller_cpf')) return $base;
      return array_merge($base, [
        'seller_cpf' => ['required', 'string'],
        'typist_cpf' => ['nullable', 'string'],
      ]);
    }
    if ($this->credentialType()->isIntegratorPlatform()) {
      return array_merge($base, $this->integratorPlatformSellerRules(), [
        'typist_cpf' => ['nullable', 'string'],
      ]);
    }
    return array_merge($base, [
      'seller_cpf' => ['required', 'string'],
      'typist_cpf' => ['nullable', 'string'],
      'entity_id' => ['required', 'integer'],
    ]);
  }
}
`
  );
  write(
    root,
    "app/Http/Controllers/ConsultController.php",
    `<?php
namespace App\\Http\\Controllers;
use App\\Http\\Requests\\ConsultBenefitRequest;
class ConsultController {
  public function consultBenefit(ConsultBenefitRequest $request) {
    if (!$request->ok) {
      return response()->error(config('api.api-inss-consig.access-denied'), config('api.http-status-code.access-denied'));
    }
    return response()->success(config('api.api-inss-consig.ok'), config('api.http-status-code.success'), ['ok' => true]);
  }
}
`
  );
  write(
    root,
    "config/api.php",
    `<?php
return [
  'http-status-code' => [
    'success' => '200',
    'access-denied' => '403',
  ],
  'api-inss-consig' => [
    'access-denied' => 'Acesso negado ao benefício.',
    'ok' => 'Benefício encontrado.',
  ],
];
`
  );
  return root;
}

test("laravel: Passport que envolve $next continua a pipeline e exige os escopos da rota", () => {
  const root = scopedLaravel();
  try {
    const { flow, out, html } = flowFor("POST", "/api-inss-consig/consult-benefit", root);
    try {
      const st = statuses(flow);
      assert.ok(st.includes(401), "token Passport inválido → 401");
      assert.ok(st.includes(403), "escopo faltando → 403");
      assert.ok(st.includes(422), "FormRequest em routes/integration → 422 (não 302)");
      assert.ok(!st.includes(302), "não deve tratar API de integração como form web");

      const passportEnd = flow.nodes.find((n) => n.meta && n.meta.outcome && n.meta.outcome.status === 200 && /checkClientCredentials/.test(n.technical || ""));
      assert.equal(passportEnd, undefined, "o wrap do Passport não pode ser um 200 final");

      const rules = flow.nodes.find((n) => n.type === "validation" && n.meta.callee && n.meta.callee.name === "rules");
      assert.ok(rules, "FormRequest rules");
      const texts = (rules.meta.callee.summary || []).map((s) => s.text).join("\n");
      assert.match(texts, /seller_cpf/);
      assert.match(texts, /typist_cpf/);
      assert.match(texts, /entity_id/);
      assert.match(texts, /quando/i);
      assert.ok((rules.meta.facts || []).some((f) => /Conforme o caso/.test(f.k) && /seller_cpf/.test(f.v)));

      const inputs = ((flow.nodes[0] && flow.nodes[0].meta && flow.nodes[0].meta.inputs) || []).map((i) => i.name);
      assert.ok(inputs.includes("seller_cpf"));
      assert.ok(inputs.includes("entity_id"));

      const denied = flow.nodes.find((n) => n.meta && n.meta.outcome && n.meta.outcome.status === 403 && /Acesso negado/.test(JSON.stringify(n.meta)));
      const viaStatus = flow.meta.outcomes.some((o) => o.status === 403);
      assert.ok(viaStatus, "config('...access-denied') deve virar HTTP 403");

      const ok = flow.meta.outcomes.some((o) => o.status === 200);
      assert.ok(ok, "success + config success → 200");

      assert.match(html, /--card-w:\s*560px/);
      assert.match(html, /overflow-wrap:\s*anywhere/);
    } finally {
      cleanup(out);
    }
  } finally {
    cleanup(root);
  }
});

test("php: project.config lê config/arquivo.php aninhado", () => {
  const root = scopedLaravel();
  try {
    const p = createPhpProject(root);
    assert.equal(p.config("api.http-status-code.access-denied"), "403");
    assert.equal(p.config("api.api-inss-consig.access-denied"), "Acesso negado ao benefício.");
    assert.equal(p.config("api.missing.key"), null);
  } finally {
    cleanup(root);
  }
});
