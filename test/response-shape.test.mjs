import test from "node:test";
import assert from "node:assert/strict";
import { createPhpProject } from "../flow-view/src/php/project.mjs";
import { exprToJsonTree, jsonFromReturnExpression } from "../flow-view/src/php/response-shape.mjs";

test("response: array aninhado success (padrão do projeto)", () => {
  const expr = `[
    'success' => [
      'message' => 'Disparo processado.',
      'data' => [
        'resourceStatus' => 200,
        'idempotencyKey' => 'lote-001',
        'template' => 'payment-account-addendum',
        'data' => ['status' => 'Sent', 'summary' => ['total' => 1, 'accepted' => 1]],
      ],
    ],
  ]`;
  const { value } = exprToJsonTree(expr, new Map(), null, {});
  assert.deepEqual(value, {
    success: {
      message: "Disparo processado.",
      data: {
        resourceStatus: 200,
        idempotencyKey: "lote-001",
        template: "payment-account-addendum",
        data: { status: "Sent", summary: { total: 1, accepted: 1 } },
      },
    },
  });
});

test("response: response()->success com config (macro ausente)", () => {
  const root = "/tmp";
  const project = {
    root,
    config: (k) => ({ "api.msg": "Benefício encontrado.", "api.code": "200" }[k] ?? null),
    _responseMacros: new Map(),
  };
  const expr = "return response()->success(config('api.msg'), config('api.code'), ['ok' => true])";
  const parsed = { kind: "json", status: 200, body: "['ok' => true]" };
  const r = jsonFromReturnExpression(expr.replace(/^return\s+/, ""), project, {}, parsed);
  assert.ok(r.json.success);
  assert.equal(r.json.success.message, "Benefício encontrado.");
  assert.equal(r.json.success.data.resourceStatus, 200);
  assert.equal(r.json.success.data.ok, true);
});