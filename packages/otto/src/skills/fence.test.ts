import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ESM idiom (the package is "type": "module"; existing otto tests use import.meta.url).
const HERE = dirname(fileURLToPath(import.meta.url)); // packages/otto/src/skills
const ROOT = join(HERE, "..", "..", "..", ".."); // repo root
const BAD = join("packages/otto/src/skills", "__fence_probe__.ts");

describe("check-skill-imports fence", () => {
  it("hard-fails when a skill imports reserveCredits", () => {
    writeFileSync(join(ROOT, BAD), `import { reserveCredits } from "@fikirtive/db";\nexport const x = reserveCredits;\n`);
    try {
      let failed = false;
      try {
        execFileSync("bash", ["scripts/check-skill-imports.sh"], { cwd: ROOT });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(join(ROOT, BAD));
    }
  });

  it("hard-fails when a skill imports the fal provider (@fikirtive/generation)", () => {
    writeFileSync(join(ROOT, BAD), `import { generateImage } from "@fikirtive/generation";\nexport const y = generateImage;\n`);
    try {
      let failed = false;
      try {
        execFileSync("bash", ["scripts/check-skill-imports.sh"], { cwd: ROOT });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(join(ROOT, BAD));
    }
  });
});
