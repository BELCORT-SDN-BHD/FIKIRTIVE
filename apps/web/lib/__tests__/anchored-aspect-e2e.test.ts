/**
 * #775 判官 r5 P1 —— **跨层端到端探针**。
 *
 * 判官对这一轮的病根说得很准:「两条测试各证一段、没人串起来」。
 *   · core 那一组证的是:锚定请求带 16:9 会被 schema 拒;
 *   · web 这一组证的是:归一化会给视频落一个默认形状。
 * 两段各自都绿,可中间那条缝谁都没走过 —— schema **允许比例缺席**,而归一化把缺席
 * 默认成 **16:9**,于是「官方句式 + 合法 clip + 不传 aspect」一路走到 GenJob 与 provider,
 * 正好落进官方陷阱(先收下、事后异步失败),商家批准之后石沉大海。
 *
 * 所以这个文件**只做一件事**:把两层串起来跑一遍 —— 请求进 `genRequest`,出来的那份
 * 再进 `normalizeFactoryMaterial`,断言**最后真的写进 GenJob 的那个值**。
 * 这是唯一能逮住「每层都对、接缝不对」的形状。
 */
import { describe, expect, it } from "vitest";
import { genRequest, VIDEO_ASPECT_ADAPTIVE, VIDEO_EDIT_OPENING, VIDEO_EXTEND_OPENING } from "@fikirtive/core";
import { normalizeFactoryMaterial } from "../batch-idempotency";

const EDIT_PROMPT = `${VIDEO_EDIT_OPENING} the shirt to deep red.`;
const EXTEND_PROMPT = `${VIDEO_EXTEND_OPENING} forward, he walks out and waves.`;
const PLAIN_PROMPT = "a jar of sambal turns slowly on a marble counter";

/** 一条视频付费请求的最小形状。`aspectRatio` 刻意可缺席 —— 这正是被探的那条缝。 */
function videoRequest(over: Record<string, unknown> = {}) {
  return {
    projectId: "proj_1",
    prompt: PLAIN_PROMPT,
    count: 1,
    kind: "video" as const,
    model: "seedance-2-mini",
    idempotencyKey: "canvas:probe",
    ...over,
  };
}

/**
 * 真链路:`genRequest` 收下的那一份 → `normalizeFactoryMaterial` 解析 →
 * **落 GenJob / 预扣 / 送 provider 的那个 aspect**。
 * 中间不手工补任何值 —— 补了就等于把要探的那条缝自己填上。
 */
function aspectThatReachesTheEngine(raw: Record<string, unknown>):
  | { rejected: true }
  | { rejected: false; aspectRatio: string | null } {
  const parsed = genRequest.safeParse(raw);
  if (!parsed.success) return { rejected: true };
  const d = parsed.data;
  const material = normalizeFactoryMaterial({
    prompt: d.prompt,
    model: d.model,
    kind: d.kind,
    count: d.count,
    entityIds: d.entityIds,
    variantSel: d.variantSel,
    sourceGenerationId: d.sourceGenerationId,
    tailGenerationId: d.tailGenerationId,
    referenceVideoGenerationId: d.referenceVideoGenerationId,
    shotId: d.shotId,
    durationSeconds: d.durationSeconds,
    resolution: d.resolution,
    aspectRatio: d.aspectRatio,
    fps: d.fps,
    audio: d.audio,
  });
  return { rejected: false, aspectRatio: material.videoOptions?.aspectRatio ?? null };
}

describe("锚定请求:从 schema 到 GenJob,形状全程跟着商家那条片子", () => {
  for (const [name, prompt] of [["剪辑", EDIT_PROMPT], ["续写", EXTEND_PROMPT]] as const) {
    it(`${name}:**不传 aspect**(判官 r5 的那条缝)⇒ 最终落到引擎的绝不是 16:9`, () => {
      const out = aspectThatReachesTheEngine(
        videoRequest({ prompt, referenceVideoGenerationId: "gen_vid" }),
      );
      // 两种收法都算修好:要么 schema 当场拒,要么归一化落 adaptive。
      // 唯独不许出现的是「悄悄落 16:9 然后照常扣钱」。
      if (!out.rejected) expect(out.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
      expect(out).not.toMatchObject({ rejected: false, aspectRatio: "16:9" });
    });

    it(`${name}:显式 adaptive ⇒ 全程 adaptive`, () => {
      const out = aspectThatReachesTheEngine(
        videoRequest({ prompt, referenceVideoGenerationId: "gen_vid", aspectRatio: VIDEO_ASPECT_ADAPTIVE }),
      );
      expect(out).toEqual({ rejected: false, aspectRatio: VIDEO_ASPECT_ADAPTIVE });
    });

    it(`${name}:显式 16:9 ⇒ schema 当场拒,归一化根本轮不到`, () => {
      expect(
        aspectThatReachesTheEngine(videoRequest({ prompt, referenceVideoGenerationId: "gen_vid", aspectRatio: "16:9" })),
      ).toEqual({ rejected: true });
    });

    it(`${name}:没有 clip ⇒ schema 当场拒`, () => {
      expect(aspectThatReachesTheEngine(videoRequest({ prompt }))).toEqual({ rejected: true });
    });
  }
});

describe("误伤检查:非官方句式的每一档,形状语义一格没动", () => {
  it("纯文生视频不传 aspect ⇒ 照旧落模型默认(16:9),这是既有行为", () => {
    const out = aspectThatReachesTheEngine(videoRequest({ prompt: PLAIN_PROMPT }));
    expect(out).toEqual({ rejected: false, aspectRatio: "16:9" });
  });

  it("纯文生视频传 16:9 ⇒ 照旧 16:9", () => {
    expect(aspectThatReachesTheEngine(videoRequest({ prompt: PLAIN_PROMPT, aspectRatio: "16:9" }))).toEqual({
      rejected: false,
      aspectRatio: "16:9",
    });
  });

  it("首帧那一档不传 aspect ⇒ 照旧 adaptive(#645 T4 的既有行为,跟着首帧走)", () => {
    expect(
      aspectThatReachesTheEngine(videoRequest({ prompt: PLAIN_PROMPT, sourceGenerationId: "gen_img" })),
    ).toEqual({ rejected: false, aspectRatio: VIDEO_ASPECT_ADAPTIVE });
  });

  it("「照着这条做一条新的」(带 clip、但不是官方句式)⇒ 商家选的形状照旧送出去", () => {
    expect(
      aspectThatReachesTheEngine(
        videoRequest({ prompt: PLAIN_PROMPT, referenceVideoGenerationId: "gen_vid", aspectRatio: "9:16" }),
      ),
    ).toEqual({ rejected: false, aspectRatio: "9:16" });
  });
});

describe("归一化自己也守得住 —— 它在工厂那条路上跑在 schema **之前**", () => {
  it("锚定句式 + clip + 缺席 aspect,直接喂归一化 ⇒ adaptive,不是 16:9", () => {
    const material = normalizeFactoryMaterial({
      prompt: EDIT_PROMPT,
      model: "seedance-2-mini",
      kind: "video",
      count: 1,
      referenceVideoGenerationId: "gen_vid",
    });
    expect(material.videoOptions?.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
  });

  it("锚定句式但没有 clip ⇒ 不动既有默认(那种请求过不了 schema,这里不替它发明语义)", () => {
    const material = normalizeFactoryMaterial({
      prompt: EDIT_PROMPT, model: "seedance-2-mini", kind: "video", count: 1,
    });
    expect(material.videoOptions?.aspectRatio).toBe("16:9");
  });

  it("非锚定句式 + clip ⇒ 既有默认一格没动", () => {
    const material = normalizeFactoryMaterial({
      prompt: PLAIN_PROMPT, model: "seedance-2-mini", kind: "video", count: 1,
      referenceVideoGenerationId: "gen_vid",
    });
    expect(material.videoOptions?.aspectRatio).toBe("16:9");
  });
});
