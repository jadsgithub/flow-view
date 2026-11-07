# Exemplo `sample-app`

Express mínimo (`server.mjs` + `order-service.mjs`) para testar o scanner, a narrativa e o viewer.

## Rotas

| Rota | O que exercita |
|------|----------------|
| `POST /api/orders` | Leitura do corpo, `validateOrder` (acumula problemas), `if` sem chaves, busca de cliente, `OrderService.create` (outro arquivo/classe, loop, cupom, limite de crédito) e `try/catch` |
| `GET /api/hello` | Auth, `loadUser`, `fetch`, `if (!data.ok)`, `throw` caindo no `catch` |
| `GET /api/complex` | Retorno antecipado, `if` aninhado, ramos then/else |

## Gerar o diagrama

```bash
# Da raiz do repositório flow-view
node flow-view/bin/flow-view.mjs --root examples/sample-app --method POST --path /api/orders --out flow-view-output --no-open
node flow-view/bin/flow-view.mjs --root examples/sample-app --method GET --path /api/hello --out flow-view-output --no-open
node flow-view/bin/flow-view.mjs --root examples/sample-app --method GET --path /api/complex --out flow-view-output --no-open
```

Abra `flow-view-output/index.html` e clique nos cards para ler a explicação de cada passo. Use os botões de ramo nas decisões para ocultar/mostrar caminhos e os chips "Pode terminar em" para destacar um resultado.
