/**
 * 围栏:除了共享动作 `createProduct`,仓库里没有第二个地方能建一条 `BrandRecord(kind='product')`。
 *
 * 规格 docs/specs/brand-product-identity.md §4 把这条写成了本规格的第二风险:
 * 「四个写入口只要有一处绕过共享动作,两套真相就回潮」。所以这是一条**源码扫描**测试 ——
 * 它不问「今天的四个入口对不对」,它问「明天有人新写一个入口时会不会红」。
 *
 * 判官第 3 轮 P2-a(PR #1337):上一版的判据是**整份文件**里同时出现 `brandRecord.create(`
 * 和 `kind: "product"` —— 于是两处通用写入口(`brand-record-actions.ts`、`_brand-record.ts`
 * 里写 segment / offer 的那几句)对它完全无效,而它们旁边就有 `kind: "product"` 的分支,
 * 只是刚好没写在同一个调用里。判据因此改成**按调用**:每一句 `brandRecord.create/createMany/
 * upsert` 的参数块单独看,里面出现 `kind: "product"` 才算越界。扫描器本身抽成纯函数,
 * 下面用**造出来的越界源码**证明它真的会红 —— 一条永远绿的扫描器是假闸,不是围栏。
 *
 * 数据库那一半的围栏是 CHECK `BrandRecord_product_needs_entity`(迁移
 * 20260910120000_brand_product_identity):就算绕过这条扫描,没有 entityId 的 product 行也
 * 进不了库(在 `apps/web/lib/__tests__/brand-product-identity.test.ts` 的 PRODID-A9 里钉住)。
 * 两道一起才叫 fail closed。
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
const WRITE_CALL = /\bbrandRecord\s*\.\s*(?:create|createMany|upsert)\s*\(/g;
const PRODUCT_KIND = /\bkind\s*:\s*["']product["']/;

/**
 * 从 `brandRecord.create(` 的左括号开始按括号配对切出**这一个调用**的参数块。
 * 按调用切而不是按文件切,是这一版围栏与上一版的全部区别。
 */
function callArgs(text: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return text.slice(openParen + 1, i); }
  }
  return text.slice(openParen + 1); // 括号没配上(不该发生):整段都当参数,宁可误报
}

/** 越界的文件列表。纯函数 —— 所以下面能拿造出来的源码证明它真的会红。 */
export function scanProductWrites(sources: { rel: string; text: string }[]): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of sources) {
    if (rel === ALLOWED) continue;
    if (/(^|\/)__tests__\//.test(rel) || /\.test\.tsx?$/.test(rel)) continue; // 测试可以造脏数据
    WRITE_CALL.lastIndex = 0;
    for (let m = WRITE_CALL.exec(text); m; m = WRITE_CALL.exec(text)) {
      const open = m.index + m[0].length - 1;
      if (PRODUCT_KIND.test(callArgs(text, open))) { offenders.push(rel); break; }
    }
  }
  return offenders;
}

describe("PRODID 围栏:brandRecord.create(kind=product)", () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)));
  const sources = files.map((f) => ({ rel: relative(REPO, f), text: readFileSync(f, "utf8") }));

  it("finds the repository source tree it is meant to scan", () => {
    // 扫不到文件的扫描器是永远绿的假闸 —— 先证明它真的在看东西。
    expect(files.length).toBeGreaterThan(500);
    expect(sources.some((s) => s.rel === ALLOWED)).toBe(true);
  });

  it("PRODID-A1 除 createProduct 外,没有第二处能建 BrandRecord(kind='product')", () => {
    expect(scanProductWrites(sources)).toEqual([]);
  });

  it("PRODID-A1 负例:在别处造出一条 product 行,围栏当场变红", () => {
    // 越界的那一句(通用写入口旁边最容易长出来的形状)。
    const offending = `
      export async function saveSomething(tx: Tx, ownerId: string) {
        await tx.brandRecord.create({
          data: { id: newId(), ownerId, kind: "product", nameKey: "x", data: {} },
        });
      }
    `;
    expect(scanProductWrites([{ rel: "apps/web/lib/rogue-entry.ts", text: offending }])).toEqual([
      "apps/web/lib/rogue-entry.ts",
    ]);
    // 同一个文件里写 segment / offer 不该红 —— 红线只在 product 这一种上。
    const innocent = offending.replace(`kind: "product"`, `kind: "segment"`);
    expect(scanProductWrites([{ rel: "apps/web/lib/rogue-entry.ts", text: innocent }])).toEqual([]);
    // 判官第 3 轮 P2-a 的正主:通用入口里 `kind` 来自变量、而**同一个文件**别处有
    // `kind: "product"` 字面量。上一版按文件判,这种形状照样标红(误报);这一版按调用判,
    // 只有真的在这一句里写死 product 才算越界。
    const generic = `
      const kind: RecordKind = input.kind;   // kind: "product" 只出现在注释与别的分支里
      if (kind === "product") { await createProduct({ ownerId, data }, tx); return; }
      await tx.brandRecord.create({ data: { id: newId(), ownerId, kind, nameKey, data } });
    `;
    expect(scanProductWrites([{ rel: "apps/web/lib/generic-entry.ts", text: generic }])).toEqual([]);
    // 允许的那一个文件即使写死 product 也不红 —— 它就是唯一的出生地。
    expect(scanProductWrites([{ rel: ALLOWED, text: offending }])).toEqual([]);
  });
});
