import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function read() {
  try {
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Versão (SemVer) do Flow View — fonte única: `package.json`. */
export const VERSION = read();
export const NAME = "flow-view";
