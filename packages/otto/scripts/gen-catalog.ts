/** Writes skills/CATALOG.md from the registry. `--check` exits non-zero if stale. */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { skillCatalog } from "../src/registry.js";
import { renderCatalog } from "../src/catalog.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "skills", "CATALOG.md");
const next = renderCatalog(skillCatalog);

if (process.argv.includes("--check")) {
  const cur = readFileSync(out, "utf8");
  if (cur !== next) {
    console.error("CATALOG.md is stale. Run: pnpm --filter @fikirtive/otto run catalog");
    process.exit(1);
  }
  console.log("CATALOG.md is fresh.");
} else {
  writeFileSync(out, next);
  console.log("Wrote " + out);
}
