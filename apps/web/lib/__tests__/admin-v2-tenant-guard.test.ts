import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../admin-v2.ts", import.meta.url), "utf8");

function findManyBlocks(model: "genJob" | "refGenJob" | "renderJob"): string[] {
  const marker = `prisma.${model}.findMany({`;
  const blocks: string[] = [];
  let offset = 0;
  while (true) {
    const start = source.indexOf(marker, offset);
    if (start === -1) return blocks;
    const brace = source.indexOf("{", start);
    let depth = 0;
    for (let i = brace; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(start, i + 1));
        offset = i + 1;
        break;
      }
    }
  }
}

describe("admin-v2 tenant guard conformance", () => {
  it("keeps guarded job findMany queries explicitly owner-scoped", () => {
    const blocks = [
      ...findManyBlocks("genJob"),
      ...findManyBlocks("refGenJob"),
      ...findManyBlocks("renderJob"),
    ];

    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      expect(block).toContain('ownerId: { not: "" }');
    }
  });
});
