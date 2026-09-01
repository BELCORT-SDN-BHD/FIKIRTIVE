/**
 * MONEY-A13 —— 平台吸收的引擎成本:**报警里说的钱,必须就是账上记的钱**。
 *
 * 这条分支(redelivery 已经退过款 ⇒ 产出丢弃、平台自付一次引擎调用)是竞态的正确结局,不是
 * 缺陷 —— 但它是真金白银,要进人工台账(`docs/ops/manual-money-ledger.md`)。台账对账靠的是
 * 两个数:落在 `spentUsd` 上的那个,和报警里 `absorbedUsd` 报的那个。它们**必须**同源。
 *
 * 用例分两层:
 *   ① 纯函数层 —— 参数构造器逐字来自作业行,套上成本函数得到的就是落库的那个数。
 *   ② 结构层   —— 两个调用点确实用的是同一个构造器(而不是各抄一份,漂了没人发现),
 *                 并且报警被包在 try 里:一个被拒的 promise 不许改变这条分支的去向。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { genSpentUsd, refgenSpentUsd } from "@fikirtive/core";
import { genSpendArgsOf } from "./gen.js";
import { refgenSpendArgsOf } from "./refgen.js";

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("MONEY-A13:吸收成本的金额与落库的 spentUsd 同源", () => {
  it("gen:参数构造器逐字来自作业行,报警金额 = 落库金额", () => {
    const job = {
      kind: "VIDEO" as const,
      model: "seedance-2-mini",
      count: 1,
      referenceVideoGenerationId: null,
      videoOptions: { seconds: 5, resolution: "720p", audio: false },
    };

    expect(genSpendArgsOf(job)).toEqual({
      kind: "VIDEO",
      model: "seedance-2-mini",
      count: 1,
      referenceVideoGenerationId: null,
      videoOptions: { seconds: 5, resolution: "720p", audio: false },
    });
    // 同一个函数、同一批参数 ⇒ 台账两侧的数字在结构上不可能不一致。
    const usd = genSpentUsd(genSpendArgsOf(job));
    expect(usd).toBeGreaterThan(0);
    expect(usd).toBe(
      genSpentUsd({ kind: "VIDEO", model: "seedance-2-mini", count: 1, referenceVideoGenerationId: null, videoOptions: { seconds: 5, resolution: "720p", audio: false } }),
    );
  });

  it("gen:参考视频那一档也走同一条路(它的成本基准是另一条,更不能各抄一份)", () => {
    const job = { kind: "VIDEO" as const, model: "seedance-2-mini", count: 1, referenceVideoGenerationId: "gen_ref_1", videoOptions: null };
    expect(genSpentUsd(genSpendArgsOf(job))).toBe(genSpentUsd({ ...job }));
  });

  it("refgen:同上", () => {
    const job = { model: "seedream-4-0", count: 3 };
    expect(refgenSpendArgsOf(job)).toEqual({ model: "seedream-4-0", count: 3 });
    expect(refgenSpentUsd(refgenSpendArgsOf(job))).toBe(refgenSpentUsd({ model: "seedream-4-0", count: 3 }));
  });

  it("gen.ts:落 spentUsd 的每一处与 absorbedUsd 用的是同一个构造器(没有第二份手抄参数)", () => {
    const src = source("./gen.ts");
    // 手抄的那一版长这样:`genSpentUsd({ kind: job.kind, ...`。它一个都不许再出现。
    expect(src).not.toMatch(/genSpentUsd\(\{\s*kind:/);
    expect(src.match(/genSpentUsd\(genSpendArgsOf\(job\)\)/g)?.length).toBe(4);
    expect(src).toContain("absorbedUsd: genSpentUsd(genSpendArgsOf(job))");
  });

  it("refgen.ts:同上", () => {
    const src = source("./refgen.ts");
    expect(src).not.toMatch(/refgenSpentUsd\(\{\s*model:/);
    expect(src.match(/refgenSpentUsd\(refgenSpendArgsOf\(job\)\)/g)?.length).toBe(4);
    expect(src).toContain("absorbedUsd: refgenSpentUsd(refgenSpendArgsOf(job))");
  });
});

describe("MONEY-A13:报警失败不许改变分支的去向", () => {
  it("worker 的 founderAlert 自己永不抛 —— 派发炸了也只返回空", async () => {
    vi.resetModules();
    vi.doMock("@fikirtive/core/founder-alert", () => ({
      createFounderAlertChannels: () => ({}),
      dispatchFounderAlert: () => {
        throw new Error("every channel exploded");
      },
    }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { founderAlert } = await import("../alerting.js");

    await expect(founderAlert({ key: "k", title: "t", action: "a", context: {} })).resolves.toEqual([]);

    err.mockRestore();
    vi.doUnmock("@fikirtive/core/founder-alert");
    vi.resetModules();
  });

  it("两条丢弃分支都把报警包在 try 里 —— 不依赖别的模块守自己的承诺", () => {
    // `await` 一个被拒的 promise 会跳过下面那个 `return`,把一个「已经退过款、正确丢弃」的
    // 作业摔进外层 catch 去终态化。上面那条用例证明今天不会,这一条保证明天改坏了会红。
    for (const file of ["./gen.ts", "./refgen.ts"] as const) {
      const src = source(file);
      const branch = src.slice(src.indexOf("founder_absorbed_engine_cost"));
      const alertAt = branch.indexOf("await founderAlert({");
      expect(alertAt, `${file}: 找不到吸收成本报警`).toBeGreaterThan(-1);
      expect(branch.slice(0, alertAt), `${file}: 吸收成本报警没有被 try 包住`).toMatch(/try \{\s*$/);
      expect(branch.slice(alertAt)).toMatch(/\} catch \(alertErr\) \{/);
    }
  });
});
