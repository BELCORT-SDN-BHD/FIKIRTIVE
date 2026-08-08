/**
 * #741 判官 r5 [P1]③ —— Otto 不许有第二张嘴。
 *
 * 判官点名的是 list-meta-pages,但穷尽审计发现同一个形状在 **6 个**技能里各写了一遍:
 *   `if ("notConnected" in res || "needsReconnect" in res) return { message: NOT_CONNECTED };`
 * 一个 `||` 就把「从没连过」和「连着但授权过期」并成同一句话。商家的 Meta 明明连着,
 * 连接页写着 Reconnect needed,Otto 却说「你还没连 Meta」。
 *
 * 单个修好还会再长出来 —— 这条围栏扫全部技能,把那个形状本身挡掉。
 *
 * **威胁模型边界(如实声明,不虚标能力 —— #621 教训)**:
 * 下面前两条是**词法**检查,不是数据流分析。它们能抓住「以 `||` 把 notConnected 与另一个
 * 连接判断并进同一句」的自然写法(含拆成变量的两步写法)。它们抓不到:
 *   ① 把两种状态在**上游**就映射成同一个值,再在技能里只判那个值;
 *   ② 用 switch/三元/提前 return 换一种控制流表达同一个合并;
 *   ③ 措辞换一种说法(例如「你还没接上 Meta」)而不出现 "isn't connected yet"。
 * 这三类靠的是第三条**行为**断言:它把每个会读 Meta 的技能真的跑一遍 needsReconnect,
 * 检查回答里带的是 blocked 而不是「从没连过」的措辞 —— 那才是真正承重的一条。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 把「连着但用不了」并进「从没连过」的自然写法。收紧到**语义等价形状**(判官 r5 [P2]):
 * 不再只认「两个 `"… in res"` 直接相邻」,而是认「同一个条件里,notConnected 与另一个连接
 * 状态判断被 || 连起来」——`const blocked = isConnectionBlocked(res); if ("notConnected" in res || blocked)`
 * 这种拆成两步的写法也会响。
 */
const MERGED_CONNECTION_STATES =
  /"notConnected"\s+in\s+\w+\s*\|\|[^)\n]*|[^(\n]*\|\|\s*"notConnected"\s+in\s+\w+/;

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

  // ── 承重的那一条:行为断言,不是词法 ────────────────────────────────────────
  //
  // 把每个会读 Meta 的技能真的跑一遍 `needsReconnect`,断言它回答的是「连着但过期」而不是
  // 「你从没连过」。控制流怎么写、措辞怎么改,都逃不过这一条。
  //
  // #767:两个 proposal 技能(propose-ad-build / propose-meta-action)同样处理
  // `notConnected` / `needsReconnect`,却一直不在这张矩阵里 —— 它们各自的测试只断言文本
  // 含 `connect`,而错误的 "Meta isn't connected yet" 也含 `connect`,照样绿。
  it.each([
    ["list-meta-pages", "metaPages", (list: () => unknown) => ({ metaPages: { list } })],
    ["meta-list-objects", "metaAds", (list: () => unknown) => ({ metaAds: { list } })],
    ["meta-insights", "metaInsights", (get: () => unknown) => ({ metaInsights: { get } })],
    ["meta-ad-performance", "metaPerformance", (getAds: () => unknown) => ({ metaPerformance: { getAds } })],
    ["meta-expert", "metaPerformance", (getAds: () => unknown) => ({ metaPerformance: { getAds } })],
    ["propose-ad-build", "metaBuild", (propose: () => unknown) => ({ metaBuild: { propose } })],
    ["propose-meta-action", "metaPropose", (metaPropose: () => unknown) => ({ metaPropose })],
  ])("%s:needsReconnect 的回答是「连着但过期」,不是「从没连过」", async (name, _port, makeCtx) => {
    const mod: Record<string, unknown> = await import(`./${name}.js`);
    const execute = Object.entries(mod).find(([k]) => k.startsWith("execute"))?.[1] as
      | ((input: unknown, rc: { context: unknown }) => Promise<unknown>)
      | undefined;
    expect(execute, `${name} 没有导出 execute*`).toBeTruthy();

    const ctx = makeCtx(async () => ({ needsReconnect: true }));
    const res = (await execute!({ datePreset: "last_30d" }, { context: ctx })) as Record<string, unknown>;
    const text = JSON.stringify(res);
    expect(res.blocked, `${name} 应当把它归为 blocked`).toBe("needs_reconnect");
    expect(text, `${name} 不许说「还没连过」`).not.toMatch(/isn't connected yet|not connected yet|have not connected/i);
    // 不只是「没说错」:必须说的就是共享权威那句 —— 与连接页同一组词(#767)。
    expect(text, `${name} 必须用共享的连接状态文案`).toContain(
      CONNECTION_BLOCKER_COPY.needs_reconnect.status,
    );
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
