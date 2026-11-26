import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createPhpProject } from "../flow-view/src/php/project.mjs";
import { buildResourceJsonFromSource } from "../flow-view/src/php/static-json.mjs";
import { REPO } from "./helpers.mjs";

const LARAVEL = path.join(REPO, "examples", "laravel-app");

test("resource: OrderResource toArray com data e items", () => {
  const project = createPhpProject(LARAVEL);
  const file = project.parseFile(path.join(LARAVEL, "app/Http/Controllers/OrderController.php"));
  assert.ok(file);
  const cls = file.classes.find((c) => c.name === "OrderController");
  const store = project.findMethod(cls, "store");
  const ctx = {
    project,
    file,
    cls,
    validatedFields: [
      { field: "items.*.product_id", words: ["obrigatório", "inteiro"], required: true },
      { field: "items.*.quantity", words: ["obrigatório", "inteiro"], required: true },
    ],
  };
  const sample = buildResourceJsonFromSource(
    "(new OrderResource($order))->response()->setStatusCode(201)",
    "App\\Http\\Resources\\OrderResource",
    project,
    { ...ctx, handlerMethod: store, orderVar: "order" }
  );
  assert.ok(sample.json.data);
  assert.equal(sample.json.data.status, "paid");
  assert.deepEqual(sample.json.data.items, [{ product_id: null, quantity: null, unit_price: null }]);
});