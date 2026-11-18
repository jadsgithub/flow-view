/**
 * Questionário interativo no terminal para montar um bundle de rotas (só com TTY).
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseRouteSpec } from "./bundle.mjs";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

async function ask(rl, q, def = "") {
  const suffix = def ? ` [${def}]` : "";
  const ans = (await rl.question(`${q}${suffix}: `)).trim();
  return ans || def;
}

/** @returns {Promise<{ title: string, routes: { method: string, path: string }[] }>} */
export async function promptBundleRoutes() {
  const rl = createInterface({ input, output });
  try {
    console.log("\nFlow View — documento com várias rotas\n");
    const title = await ask(rl, "Título do documento (opcional)", "");
    const routes = [];

    for (;;) {
      let method = (await ask(rl, `Método HTTP (${METHODS.join(", ")})`, "GET")).toUpperCase();
      if (!METHODS.includes(method)) method = "GET";
      const path = await ask(rl, "Caminho da rota", "/");
      routes.push(parseRouteSpec({ method, path }));
      const more = (await ask(rl, "Adicionar outra rota? (s/n)", "n")).toLowerCase();
      if (more !== "s" && more !== "sim" && more !== "y" && more !== "yes") break;
    }

    if (routes.length === 0) throw new Error("Nenhuma rota informada.");
    return { title, routes };
  } finally {
    rl.close();
  }
}