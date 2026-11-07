/**
 * Exemplo mínimo estilo Express (sem dependências) para testar o scanner.
 *
 * Rotas de demo:
 *   POST /api/orders  — validação, busca de cliente, regra de negócio em outra classe/arquivo, try/catch
 *   GET  /api/hello   — try/catch, auth, fetch, if simples
 *   GET  /api/complex — if/else, return cedo, if aninhado
 *
 * Gerar HTML:
 *   node flow-view/bin/flow-view.mjs --root examples/sample-app --method POST --path /api/orders --out flow-view-output --no-open
 */

import { OrderService } from "./order-service.mjs";

const db = {
  insert: async (_table, row) => ({ id: 1, ...row }),
};

const customers = {
  c1: { id: "c1", name: "Ana", blocked: false, creditLimit: 500 },
  c2: { id: "c2", name: "Bruno", blocked: true, creditLimit: 0 },
};

const orderService = new OrderService(db);

function checkAuth(req) {
  return Boolean(req && req.headers && req.headers.authorization);
}

async function loadUser(id) {
  return { id, name: "demo" };
}

/** Regras de validação do corpo do pedido: devolve a lista de problemas encontrados. */
function validateOrder(body) {
  const errors = [];
  if (!body.customerId) errors.push("customerId é obrigatório");
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("items deve ter ao menos 1 item");
  }
  if (body.coupon && typeof body.coupon !== "string") errors.push("coupon deve ser texto");
  return errors;
}

const app = {
  get: (_path, _handler) => {
    /* register — omitido */
  },
  post: (_path, _handler) => {
    /* register — omitido */
  },
};

app.post("/api/orders", async (req, res) => {
  const errors = validateOrder(req.body);
  if (errors.length > 0) {
    return res.status(422).json({ errors });
  }

  const customer = customers[req.body.customerId];
  if (!customer) return res.status(404).json({ error: "cliente não encontrado" });
  if (customer.blocked) return res.status(403).json({ error: "cliente bloqueado" });

  try {
    const order = await orderService.create(customer, req.body.items, req.body.coupon);
    return res.status(201).json({ order });
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }
});

app.get("/api/hello", async (req, res) => {
  try {
    if (!checkAuth(req)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const user = await loadUser(req.query?.id || "1");
    const data = await fetch("https://api.example.com/ping");
    if (!data.ok) {
      throw new Error("upstream");
    }
    return res.json({ ok: true, user });
  } catch (e) {
    return res.status(500).json({ error: "fail" });
  }
});

/** Rota de demonstração: if/else, return antecipado e if aninhado. */
app.get("/api/complex", async (req, res) => {
  const tier = String(req.query?.tier || "free");
  const flag = req.query?.flag === "1";

  if (tier === "blocked") {
    return res.status(403).json({ error: "blocked" });
  }

  if (tier === "pro") {
    if (flag) {
      return res.json({ plan: "pro", feature: "full" });
    } else {
      return res.json({ plan: "pro", feature: "partial" });
    }
  }

  return res.json({ plan: "free" });
});
