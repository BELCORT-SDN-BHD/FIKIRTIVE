import { describe, it, expect, vi } from "vitest";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core";
import { executeImportMedia, importMediaSkill } from "./import-media.js";
import type { OttoContext } from "../context.js";

// W-B3-B (parity debts 14,15,78,79,80,81,82 / E1-17): importMedia routes through the injected
// ctx.mediaImport port — a server-side SSRF-guarded fetch → storage → the SAME finalize authority
// the human upload lands through. The CALL spends nothing (a startGen spy that throws proves it) —
// but MONEY-A9 (spec §7.3) bills the merchant for reading whatever it leaves behind, so the
// description has to disclose that price before the model reaches for this tool.

type ImportPort = NonNullable<OttoContext["mediaImport"]>;

function makeCtx(mediaImport?: ImportPort): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: () => {
      throw new Error("$0 skill must never call startGen");
    },
    ...(mediaImport ? { mediaImport } : {}),
  } as unknown as OttoContext;
}

describe("importMedia registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`importMedia\`");
  });
});

describe("importMedia gate", () => {
  it("free/write/internal → needsApproval false (this call spends nothing, same as the human upload)", () => {
    // `cost` 是**审批路由**,答的是「这一次调用花不花商家的 credits」—— 不花。规格 §7.3 对
    // URL 导入要的是**披露**,不是审批弹窗;改成 "spend" 会给人手上传的同一个能力凭空加一道
    // 人手上传从来没有的确认,还会要一把这次调用根本没有扣费可对应的 idempotencyKey。
    expect(importMediaSkill.cost).toBe("free");
    expect(importMediaSkill.effect).toBe("write");
    expect(importMediaSkill.reach).toBe("internal");
    expect(importMediaSkill.needsApproval).toBe(false);
  });

  // ── MONEY-A9 §7.3:动作前报价(无 UI 面,披露只能长在描述里)─────────────────
  it("描述里逐条报出三格理解价,而且是现算的(测试自己算期望值,不手抄)", () => {
    const d = importMediaSkill.description;
    expect(d).toContain(`${displayCredits(pricedUnderstandingCredits("image-caption"))} credits`);
    expect(d).toContain(`${displayCredits(pricedUnderstandingCredits("video-qa"))} credits`);
    expect(d).toContain(`${displayCredits(pricedUnderstandingCredits("doc-extract"))} credits`);
    // 四则①:报的是**扫描器建理解行**那一刻锁的价,不是跑的时候现算的 —— 也不是「落地那一刻」。
    // 跨厂复审 2026-09-02 唯一 P1:旧措辞把排队说成瞬时,而排队期间调价,后面的文件按新价建行。
    expect(d).toContain("at the price in effect when it is queued for");
    expect(d, "只说「排队时」不说排队可能要等,读起来还是「落地即锁价」").toContain("backlog");
    for (const lie of ["locked in the moment", "the moment it lands", "moment you upload"]) {
      expect(d, `又出现了「${lie}」—— 那是产品做不到的承诺`).not.toContain(lie);
    }
  });

  it("旧的「$0 —— 永不消耗 credits」已从描述里清掉(2026-09-01 起那是假话)", () => {
    const d = importMediaSkill.description;
    expect(d).not.toContain("$0");
    expect(d).not.toContain("never generates media or spends credits");
    // 后果说清楚:这一次调用不花钱,落下的东西要计费
    expect(d).toMatch(/costs nothing to run, but what it leaves behind is billed/i);
  });

  it("要求模型**先报价再调用** —— 这是商家被扣费之前唯一可能听见的一句", () => {
    expect(importMediaSkill.description).toContain(
      "TELL THE USER THAT PRICE AND GET THEIR GO-AHEAD BEFORE CALLING THIS",
    );
  });

  it("源码里没有手抄的钱数 —— 数值只能来自 pricedUnderstandingCredits", async () => {
    // 同 understanding-disclosure.test.ts 的第②条纪律:手抄的那一刻,报价就变成了陷阱 ——
    // 成本钉点一动,模型会拿着一个旧数字去跟商家报价。
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./import-media.ts", import.meta.url), "utf8");
    const copy = src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .filter((line) => /\d[\d,.]*\s*credits?\b/i.test(line));
    expect(copy, "描述里出现了手抄的钱数").toEqual([]);
    expect(src).toContain("pricedUnderstandingCredits");
  });
  it("declares url as a required field (the model asks before calling)", () => {
    expect(importMediaSkill.requires.some((r) => r.field === "url")).toBe(true);
  });
});

describe("executeImportMedia — port required", () => {
  it("degrades gracefully when ctx.mediaImport is not injected", async () => {
    const res = await executeImportMedia({ url: "https://cdn.example.com/x.png" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "Importing media isn't available right now." });
  });
});

describe("fromUrl routing", () => {
  it("returns the new generation id on success", async () => {
    const fromUrl = vi.fn(async () => ({ ok: true as const, generationId: "gen-9" }));
    const res = await executeImportMedia({ url: "https://cdn.example.com/x.png" }, { context: makeCtx({ fromUrl }) });
    expect(res).toEqual({ ok: true, generationId: "gen-9" });
    expect(fromUrl).toHaveBeenCalledWith("https://cdn.example.com/x.png", {});
  });
  it("threads promptText + entityIds to the port", async () => {
    const fromUrl = vi.fn(async () => ({ ok: true as const, generationId: "gen-1" }));
    await executeImportMedia(
      { url: "https://cdn.example.com/x.jpg", promptText: "hero ref", entityIds: ["e1", "e2"] },
      { context: makeCtx({ fromUrl }) },
    );
    expect(fromUrl).toHaveBeenCalledWith("https://cdn.example.com/x.jpg", { promptText: "hero ref", entityIds: ["e1", "e2"] });
  });
  it("surfaces an SSRF / fetch refusal honestly", async () => {
    const fromUrl = vi.fn(async () => ({ error: "That URL isn't a reachable public http(s) address." }));
    const res = (await executeImportMedia({ url: "http://169.254.169.254/latest" }, { context: makeCtx({ fromUrl }) })) as {
      ok: boolean; error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("public http(s)");
  });
  it("surfaces an unsupported-type refusal", async () => {
    const fromUrl = vi.fn(async () => ({ error: "Couldn't tell what kind of file that URL is (need a png/jpg/webp/gif/avif/mp4/mov/webm)." }));
    const res = (await executeImportMedia({ url: "https://cdn.example.com/doc.pdf" }, { context: makeCtx({ fromUrl }) })) as {
      ok: boolean; error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("kind of file");
  });
});
