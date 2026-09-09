/**
 * 围栏:除了共享动作 `createProduct`,仓库里没有第二个地方能建一条 `BrandRecord(kind='product')`。
 *
 * 规格 docs/specs/brand-product-identity.md §4 把这条写成了本规格的第二风险:
 * 「四个写入口只要有一处绕过共享动作,两套真相就回潮」。所以这是一条**源码扫描**测试 ——
 * 它不问「今天的四个入口对不对」,它问「明天有人新写一个入口时会不会红」。
 *
 * 数据库那一半的围栏是 CHECK `BrandRecord_product_needs_entity`(迁移
 * 20260910120000_brand_product_identity):就算绕过这条扫描,没有 entityId 的 product 行也
 * 进不了库。两道一起才叫 fail closed。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ROOTS = ["apps/web", "apps/worker", "packages"];
const SKIP_DIRS = new Set([
  "node_modules", "dist", "generated", ".next", ".git", "coverage", "playwright-report", "test-results",
]);

/** 共享动作自己 —— 唯一允许写这一句的文件。 */
const ALLOWED = "packages/db/src/create-product.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue; }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `prisma.brandRecord.create` / `tx.brandRecord.createMany` / `.upsert` —— 任何接收者。 */
const WRITE_CALL = /\bbrandRecord\s*\.\s*(create|createMany|upsert)\s*\(/;

describe("PRODID 围栏:brandRecord.create(kind=product)", () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));

  it("finds the repository source tree it is meant to scan", () => {
    // 扫不到文件的扫描器是永远绿的假闸 —— 先证明它真的在看东西。
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => relative(REPO, f) === ALLOWED)).toBe(true);
  });

  it("PRODID-A1 除 createProduct 外,没有第二处能建 BrandRecord(kind='product')", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO, file);
      if (rel === ALLOWED) continue;
      if (/(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel)) continue; // 测试可以造脏数据
      const text = readFileSync(file, "utf8");
      if (!WRITE_CALL.test(text)) continue;
      // 写 BrandRecord 的地方还多得很(segment / offer),红线只在 product 这一种上。
      if (/kind:\s*["']product["']/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
