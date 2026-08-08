/**
 * #741 判官 r5 [P1]③ —— Otto 不许有第二张嘴。
 *
 * 判官点名的是 list-meta-pages,但穷尽审计发现同一个形状在 **6 个**技能里各写了一遍:
 *   `if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };`
 * 一个 `||` 就把「从没连过」和「连着但授权过期」并成同一句话。商家的 Meta 明明连着,
 * 连接页写着 Reconnect needed,Otto 却说「你还没连 Meta」。
 *
 * 单个修好还会再长出来 —— 这条围栏扫全部技能,把那个形状本身挡掉。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 把「连着但用不了」并进别的分支的自然写法(两个方向都认)。 */
const MERGED_CONNECTION_STATES =
  /"(notConnected|needsReconnect)"\s+in\s+\w+\s*\|\|\s*"(notConnected|needsReconnect)"\s+in\s+\w+/;

const files = readdirSync(HERE)
  .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
  .map((f) => ({ rel: `src/skills/${f}`, code: readFileSync(join(HERE, f), "utf8") }));

describe("Otto 的连接状态口径", () => {
  it("围栏认得出它要抓的形状(不是一条永远为真的断言)", () => {
    expect(
      MERGED_CONNECTION_STATES.test('if ("notConnected" in res || "needsReconnect" in res) return x;'),
    ).toBe(true);
    expect(
      MERGED_CONNECTION_STATES.test('if ("needsReconnect" in r || "notConnected" in r) return x;'),
    ).toBe(true);
    // 反例:单独判一个状态是正当的。
    expect(MERGED_CONNECTION_STATES.test('if ("notConnected" in res) return x;')).toBe(false);
    // 扫描面必须真的覆盖到技能目录。
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.rel === "src/skills/list-meta-pages.ts")).toBe(true);
  });

  it("没有技能把「从没连过」和「连着但用不了」并成一句话", () => {
    const offenders = files.filter((f) => MERGED_CONNECTION_STATES.test(f.code)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("凡是会说「还没连 Meta」的技能,都必须先问过共享权威", () => {
    // 反面断言做成行为要求:一个技能只要写得出 not-connected 那句话,就必须先经过
    // isConnectionBlocked —— 否则它没有能力把「授权过期」和「没连过」分开。
    const offenders = files
      .filter((f) => /isn't connected yet|Meta isn't connected/.test(f.code))
      .filter((f) => !f.code.includes("isConnectionBlocked"))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
