import test from "node:test";
import assert from "node:assert/strict";
import { buildBodyFromRules, buildCurl, buildResponseSample, sampleValueForRule } from "../flow-view/src/samples.mjs";

test("samples: regras Laravel geram corpo com arrays aninhados", () => {
  const rules = [
    { field: "customer_id", words: ["obrigatório", "número inteiro"], required: true },
    { field: "items", words: ["obrigatório", "array"], required: true },
    { field: "items.*.product_id", words: ["obrigatório", "número inteiro"], required: true },
    { field: "items.*.quantity", words: ["obrigatório", "número inteiro"], required: true },
    { field: "coupon", words: ["opcional", "texto"], required: false },
  ];
  const body = buildBodyFromRules(rules);
  assert.equal(body.customer_id, 1);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items[0].product_id, 1);
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.coupon, "exemplo");
});

test("samples: cURL inclui auth e JSON em POST de API", () => {
  const rules = [{ field: "name", words: ["obrigatório", "texto"], required: true }];
  const curl = buildCurl({
    method: "POST",
    path: "/api/orders",
    inputs: [],
    rules,
    middleware: ["auth:sanctum", "api"],
    isApi: true,
  });
  assert.match(curl, /curl -X POST/);
  assert.match(curl, /Authorization: Bearer/);
  assert.match(curl, /Content-Type: application\/json/);
  assert.match(curl, /"name"/);
});

test("samples: resposta 422 modelo Laravel", () => {
  const j = buildResponseSample({
    status: 422,
    kind: "json",
    validationFields: [{ field: "email", words: ["obrigatório"], required: true }],
  });
  assert.equal(j.message, "The given data was invalid.");
  assert.ok(j.errors.email);
});

test("samples: email e integer por heurística de campo", () => {
  assert.equal(sampleValueForRule({ field: "customer_email", words: [] }), "usuario@exemplo.com");
  assert.equal(sampleValueForRule({ field: "qty", words: ["número inteiro"] }), 1);
});