# Exemplo `laravel-app`

Esqueleto de um app **Laravel** (sem `vendor/`, sem banco) escrito só para exercitar o Flow View: rotas com grupos e `apiResource`, middlewares, `FormRequest`, controller, services injetados, Eloquent, exceções com `render()`, Policy, API Resource, evento em fila e rotas web.

> Não é um app executável: o Flow View faz **análise estática** e nunca roda o código. Por isso o exemplo não precisa de `composer install`.

## Rotas

Liste com `node flow-view/bin/flow-view.mjs --root examples/laravel-app --list-routes`.

| Rota | O que exercita |
|------|----------------|
| `POST /api/orders` | `auth:sanctum` (401) + `throttle` (429) → `StoreOrderRequest` (`prepareForValidation`, `authorize` 403, `rules` 422) → `Customer::findOrFail` (404) → `if` com 422 → `try/catch` tipado em volta de `OrderService::place` (transação, estoque, cupom, limite de crédito, gateway de pagamento, evento em fila) → 409 / 402 / 201 |
| `GET /api/orders` | consulta Eloquent encadeada (`with`, `where`, `latest`, `paginate`) + API Resource em coleção |
| `GET /api/orders/{order}` | route model binding (404) + carga de relações + API Resource |
| `PUT\|PATCH /api/orders/{order}` | binding + `UpdateOrderRequest` + `abort_if` (409) + `update` |
| `DELETE /api/orders/{order}` | binding + `$this->authorize('delete', …)` (Policy, 403) + remoção (204) |
| `POST /api/orders/{order}/cancel` | middleware `can:cancel,order` (403) + `DB::transaction` + service |
| `GET /api/admin/reports/sales` | grupo aninhado (`prefix('admin')`), middleware próprio `EnsureAccountIsActive` (o `handle()` é narrado), `role:admin`, agregações |
| `GET /api/ping` | controller invocável (`__invoke`) |
| `GET /api/health` | closure com *arrow function* |
| `GET /orders/{order}/receipt` | rota **web**: `auth` redireciona para o login (302), binding e `abort(404)` |
| `GET /` | `Route::view` |

## Gerar o diagrama

```bash
# a partir da raiz do repositório flow-view
node flow-view/bin/flow-view.mjs --root examples/laravel-app --method POST --path /api/orders
node flow-view/bin/flow-view.mjs --root examples/laravel-app --method POST --path /api/orders/42/cancel
node flow-view/bin/flow-view.mjs --root examples/laravel-app --method GET  --path /api/admin/reports/sales
```

`--path` aceita a URL real (`/api/orders/42`) ou o padrão (`/api/orders/{order}`). A saída vai para `examples/laravel-app/.flow-view/<método>-<rota>-<data>/` (ignorada pelo git); use `--out` para escolher outra pasta.

Como skill de agente: *"Use o Flow View e mostre o fluxo de `POST /api/orders`."*
