/**
 * #775 判官 r3 P1-1 —— 批准的内容必须绑到**付费执行边界**上。
 *
 * 判官的两个探针都发生在**执行时**,不是铸卡时:
 *   ① 执行时把提示词换成 `Strictly edit …`(手上没有片子)—— r3 之前照样收费;
 *   ② 一张 adaptive 的卡,执行时把比例覆盖成 16:9 —— r3 之前 safeParse 照样放行。
 *
 * 与 #882 的 `approvedEntities` 同一类病:**执行只许认持久化卡**。所以这一轮把同一句话
 * 钉在两层上 —— 卡→请求的构造器(卡优先),以及付费 schema 本身(结构闸)。
 */
import { describe, it, expect } from "vitest";
import { genRequest, VIDEO_ASPECT_ADAPTIVE } from "./gen.js";
import { buildGenRequestFromCard } from "./gen-from-card.js";
import { VIDEO_EDIT_OPENING, VIDEO_EXTEND_OPENING } from "./video-actions.js";

const EDIT_PROMPT = `${VIDEO_EDIT_OPENING} the shirt to deep red.`;
const EXTEND_PROMPT = `${VIDEO_EXTEND_OPENING} forward, he walks out and waves.`;
const PLAIN_PROMPT = "a jar of sambal turns slowly on a marble counter";

const baseReq = (over: Record<string, unknown> = {}) => ({
  projectId: "proj_1",
  prompt: PLAIN_PROMPT,
  count: 1,
  kind: "video" as const,
  model: "seedance-2-mini",
  idempotencyKey: "cowork:card_1",
  ...over,
});

// ---------------------------------------------------------------------------
// 付费 schema 的结构闸 —— 任何一条路造出来的请求都得过这一关
// ---------------------------------------------------------------------------

describe("付费 schema:锚在片子上的提示词,必须真的带着那条片子", () => {
  it("探针①:`Strictly edit` 的提示词、没有参考视频 ⇒ 拒(付费前)", () => {
    const r = genRequest.safeParse(baseReq({ prompt: EDIT_PROMPT }));
    expect(r.success).toBe(false);
  });

  it("续写同样", () => {
    expect(genRequest.safeParse(baseReq({ prompt: EXTEND_PROMPT })).success).toBe(false);
  });

  it("带着片子就放行(比例是 adaptive)", () => {
    const r = genRequest.safeParse(
      baseReq({ prompt: EDIT_PROMPT, referenceVideoGenerationId: "gen_vid", aspectRatio: VIDEO_ASPECT_ADAPTIVE }),
    );
    expect(r.success).toBe(true);
  });

  it("普通提示词一个字都不受影响 —— 收紧只针对官方句式那两档", () => {
    expect(genRequest.safeParse(baseReq({ prompt: PLAIN_PROMPT })).success).toBe(true);
    expect(genRequest.safeParse(baseReq({ prompt: PLAIN_PROMPT, aspectRatio: "16:9" })).success).toBe(true);
    // 照着做一条新的:带片子、比例是商家选的 —— 合法,不许被这道闸误伤
    expect(
      genRequest.safeParse(baseReq({ prompt: PLAIN_PROMPT, referenceVideoGenerationId: "gen_vid", aspectRatio: "16:9" })).success,
    ).toBe(true);
  });
});

describe("付费 schema:锚在片子上的请求,比例只能跟着那条片子", () => {
  it("探针②:adaptive 被覆盖成 16:9 ⇒ 拒(付费前)", () => {
    const r = genRequest.safeParse(
      baseReq({ prompt: EDIT_PROMPT, referenceVideoGenerationId: "gen_vid", aspectRatio: "16:9" }),
    );
    expect(r.success).toBe(false);
  });

  it("续写同样", () => {
    expect(
      genRequest.safeParse(baseReq({ prompt: EXTEND_PROMPT, referenceVideoGenerationId: "gen_vid", aspectRatio: "9:16" }))
        .success,
    ).toBe(false);
  });

  it("adaptive 放行;比例缺席也放行(引擎自己跟着输入走)", () => {
    for (const aspectRatio of [VIDEO_ASPECT_ADAPTIVE, undefined]) {
      const r = genRequest.safeParse(
        baseReq({ prompt: EDIT_PROMPT, referenceVideoGenerationId: "gen_vid", ...(aspectRatio ? { aspectRatio } : {}) }),
      );
      expect(r.success, `aspectRatio=${String(aspectRatio)}`).toBe(true);
    }
  });

  it("图片请求不受影响", () => {
    const r = genRequest.safeParse({
      projectId: "proj_1", prompt: EDIT_PROMPT, count: 1, kind: "image", model: "seedream", idempotencyKey: "k",
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 卡 → 请求:客户端送来的那份一律不作数
// ---------------------------------------------------------------------------

const anchoredCard = (over: Record<string, unknown> = {}) => ({
  kind: "video",
  structuredPrompt: EDIT_PROMPT,
  model: "seedance-2-mini",
  referenceVideoGenerationId: "gen_vid",
  params: { durationSeconds: 5, resolution: "720p", aspectRatio: VIDEO_ASPECT_ADAPTIVE, audio: true },
  ...over,
});

const BASE = { projectId: "p", threadId: "t", cardId: "c", entityIds: [], variantSel: {} };

describe("执行只认持久化卡(与 #882 approvedEntities 同一条口径)", () => {
  it("探针①:客户端把提示词换成别的,付费请求带走的仍是**卡上**那一段", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: anchoredCard({ structuredPrompt: PLAIN_PROMPT }),
      prompt: EDIT_PROMPT, // 客户端伪造:把一张普通卡说成严格编辑
    });
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.prompt).toBe(PLAIN_PROMPT);
  });

  it("反向也一样:客户端想把严格编辑换成普通提示词,也换不掉", () => {
    const built = buildGenRequestFromCard({ ...BASE, cardPayload: anchoredCard(), prompt: PLAIN_PROMPT });
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.prompt).toBe(EDIT_PROMPT);
  });

  it("探针②:锚在片子上的卡,客户端的比例覆盖不作数 —— 卡上的 adaptive 说了算", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: anchoredCard(),
      prompt: EDIT_PROMPT,
      overrides: { aspectRatio: "16:9" },
    });
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.aspectRatio).toBe(VIDEO_ASPECT_ADAPTIVE);
  });

  it("构造出来的请求本身过得了付费 schema(两层说同一句话)", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: anchoredCard(),
      prompt: EDIT_PROMPT,
      overrides: { aspectRatio: "16:9" },
    });
    if (!built.ok) throw new Error("unreachable");
    expect(genRequest.safeParse({ ...built.req, idempotencyKey: "cowork:c" }).success).toBe(true);
  });

  it("**非**锚定的视频卡:比例覆盖照旧生效(canvas / 照着做一条新的,语义一格没动)", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: anchoredCard({ structuredPrompt: PLAIN_PROMPT, params: { durationSeconds: 5, aspectRatio: "1:1" } }),
      prompt: PLAIN_PROMPT,
      overrides: { aspectRatio: "16:9" },
    });
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.aspectRatio).toBe("16:9");
  });

  it("图片卡的比例覆盖照旧生效", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: { kind: "image", structuredPrompt: PLAIN_PROMPT, model: "seedream", params: { count: 1, aspectRatio: "1:1" } },
      prompt: PLAIN_PROMPT,
      overrides: { aspectRatio: "4:5" },
    });
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.aspectRatio).toBe("4:5");
  });
});

describe("增强指令(directive)仍然接得上,但它只能加在**卡上那段**后面", () => {
  it("directive 追加在卡的提示词之后,而不是客户端那段之后", () => {
    const built = buildGenRequestFromCard({
      ...BASE,
      cardPayload: anchoredCard({ structuredPrompt: PLAIN_PROMPT }),
      prompt: EDIT_PROMPT, // 伪造的那一段
      directive: "Shoot it like a documentary.",
    });
    if (!built.ok) throw new Error("unreachable");
    expect(built.req.prompt).toContain(PLAIN_PROMPT);
    expect(built.req.prompt).toContain("Shoot it like a documentary.");
    expect(built.req.prompt).not.toContain("Strictly edit");
  });
});
