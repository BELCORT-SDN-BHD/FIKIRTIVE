/**
 * FC-2 / FC-4 —— staging 2026-09-14 Founder 自己的画布,两条「输入与说法对不上」的缺口。
 *
 * FC-2:对话里刚交付一张猫 + 杯子的图,商家接着说「now i wan @Xinyi hold the cat…」,
 *       铸出来的卡 `sourceGenerationId=null` —— 原图根本不是这一单的输入。
 * FC-4:商家明说「just use @<那张图> as the first frame」,卡上落 `role:"reference"`、
 *       `sourceGenerationId=null`,而 Otto 的文字仍说「using your image as the first
 *       frame」;那一单被拒、预扣 33 credits 退回。
 *
 * 证据:`docs/audits/founder-canvas-2026-09-14/backend-report.md`「原图、演员、首帧实际
 * 走向」3–5,以及同目录 `firstframe-status.md`「关键补核」seq30–32。
 *
 * 这一份用**真实的**铸卡路径(`executePropose` / `buildProposeCard`)与**真实的**
 * 卡→任务转换(`buildGenRequestFromCard`),只把数据库换成 mock:钱路、供应商一步都不跑。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGenRequestFromCard } from "@fikirtive/core";
import { buildProposeCard } from "./propose.helpers.js";
import { executePropose } from "./propose.js";
import { executeProposePack } from "./propose-pack.js";
import {
  decideImageContinuation,
  withContinuedImage,
} from "./image-continuation.js";
import { requestedVideoAttachmentRole, FIRST_FRAME_DOWNGRADE_NOTE } from "./video-intent.js";
import type { OttoContext, OttoMediaReference } from "../context.js";
import type { CardPayload } from "./propose.helpers.js";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: { findMany: vi.fn() },
    chatMessage: { findFirst: vi.fn(), create: vi.fn() },
    referenceImage: { count: vi.fn() },
    generation: { findMany: vi.fn() },
    genJob: { create: vi.fn() },
  },
}));

// ── 走查现场的真实身份(脱敏但同形)────────────────────────────────────────────
/** 对话里刚交付的那张猫 + 杯子图。 */
const CAT_MUG_ID = "01M2A3CX6K9AWV6ZV1PBED34JX";
/** 商家 @ 的演员。 */
const XINYI = { id: "01M265PRD50HWEKX2VFGBCF31Y", type: "CHARACTER" as const, name: "Xinyi" };
/** 商家后来点名要当首帧的那张修订图。 */
const REVISED_ID = "01M2F6XFRQ0YVS45ZJ8C8YFATH";

function receipt(generationId: string, label: string): OttoMediaReference {
  return {
    generationId,
    kind: "image",
    label,
    sourceProjectId: "canvas_dad82159",
    sourceProjectName: "Hi!",
    sameCanvas: true,
    previewUrl: `/files/${generationId}.png`,
  };
}

function makeCtx(overrides?: Partial<OttoContext>): OttoContext {
  return {
    orgId: "org-founder",
    userId: "org-founder",
    projectId: "canvas_dad82159",
    threadId: "thread_dad82159",
    disabledModels: [],
    sourceGenerationId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FC-2 ① 判据本身(纯函数)
// ---------------------------------------------------------------------------

describe("FC-2 · 「接着这张改」还是「重开一张」", () => {
  it("商家接着说下一步(走查原话)⇒ continue", () => {
    expect(
      decideImageContinuation({
        text: "now i wan @Xinyi hold the cat and pet it while the cat is drinking with the product",
        hasAttachedImage: false,
        hasCurrentImage: true,
      }),
    ).toBe("continue");
  });

  it("商家明说要一张全新的 ⇒ fresh(正对照)", () => {
    expect(
      decideImageContinuation({
        text: "make a brand new picture of a dog in a park",
        hasAttachedImage: false,
        hasCurrentImage: true,
      }),
    ).toBe("fresh");
  });

  it("两边同时命中 ⇒ 全新那一票否决(继承一张他刚说了不要的底图最贵)", () => {
    expect(
      decideImageContinuation({
        text: "now i want a brand new picture of the cat",
        hasAttachedImage: false,
        hasCurrentImage: true,
      }),
    ).toBe("fresh");
  });

  it("「现在给我做一张海报」不是接着这张图改 ⇒ fresh(信号只收指向已有东西的动词)", () => {
    expect(
      decideImageContinuation({
        text: "now make a poster for the raya sale",
        hasAttachedImage: false,
        hasCurrentImage: true,
      }),
    ).toBe("fresh");
  });

  it("一个信号都读不出来 ⇒ fresh(不预判商家,今天的行为逐字不动)", () => {
    expect(
      decideImageContinuation({
        text: "a cat drinking coffee, studio light",
        hasAttachedImage: false,
        hasCurrentImage: true,
      }),
    ).toBe("fresh");
  });

  it("他自己这一轮挂了图 ⇒ 以他挂的为准,不继承", () => {
    expect(
      decideImageContinuation({
        text: "now i want this picture with @Xinyi",
        hasAttachedImage: true,
        hasCurrentImage: true,
      }),
    ).toBe("fresh");
  });

  it("对话里没有正在做的图 ⇒ 无从继承", () => {
    expect(
      decideImageContinuation({
        text: "now i want this picture with @Xinyi",
        hasAttachedImage: false,
        hasCurrentImage: false,
      }),
    ).toBe("fresh");
  });

  it("视频提案一格不动(FC-2 是图片这一支的缺口)", () => {
    const ctx = makeCtx({
      currentImage: receipt(CAT_MUG_ID, "a cat drinking from the mug"),
      turnText: "now make this into a clip",
    });
    expect(withContinuedImage(ctx, { kind: "video" })).toBe(ctx);
  });
});

// ---------------------------------------------------------------------------
// FC-2 ② 复现:加入演员时,正在讨论的原图要一起进卡、进谱系
// ---------------------------------------------------------------------------

describe("FC-2 · 加入演员时原图与演员一起进卡与谱系", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    referenceImage: { count: ReturnType<typeof vi.fn> };
    generation: { findMany: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    mockPrisma.entity.findMany.mockResolvedValue([XINYI]);
    mockPrisma.chatMessage.findFirst.mockResolvedValue({ seq: 30 });
    mockPrisma.chatMessage.create.mockResolvedValue({});
    mockPrisma.referenceImage.count.mockResolvedValue(2);
    // 本站生成的资产读不到宽高 ⇒ 尺寸闸放行(与 propose.test.ts 同一档默认)。
    mockPrisma.generation.findMany.mockResolvedValue([]);
  });

  /** 落库的那张 GEN_CARD 的 payload。 */
  function persistedCard(): CardPayload & Record<string, unknown> {
    const call = mockPrisma.chatMessage.create.mock.calls.at(-1)?.[0] as {
      data: { payload: CardPayload & Record<string, unknown> };
    };
    return call.data.payload;
  }

  const CONTINUATION_TURN =
    "now i wan @Xinyi hold the cat and pet it while the cat is drinking with the product";

  it("续写同一张图:卡与任务同时带上原图(编辑底图)与演员", async () => {
    const ctx = makeCtx({
      currentImage: receipt(CAT_MUG_ID, "a cat drinking from the orange mug"),
      turnText: CONTINUATION_TURN,
      turnEntityIds: [XINYI.id],
    });

    const result = await executePropose(
      {
        kind: "image",
        structuredPrompt: "Xinyi holding and petting the cat while it drinks from the mug",
        entityIds: [XINYI.id],
        variantSel: {},
        goal: "an ad for the mug",
      },
      { context: ctx },
    );
    expect(result).not.toHaveProperty("error");
    // ⓪ 模型也读得到这件事 —— 绑定不说出口,它就可能写「I'll make you a fresh one」。
    expect(result).toMatchObject({ continuesCurrentImage: true });

    const card = persistedCard();
    // ① 原图是**被编辑的底图**,不是提示词里一句「same product」。
    expect(card.sourceGenerationId).toBe(CAT_MUG_ID);
    // ② 演员照旧在场 —— 两者一起,不是二选一。
    expect(card.entityIds).toContain(XINYI.id);
    expect(card.approvedEntities).toEqual([XINYI]);
    // ③ 商家在按下 Generate 之前,卡上逐项读得到「正在改的是这一张」。
    expect(card.mediaReferences).toEqual([
      expect.objectContaining({ generationId: CAT_MUG_ID, role: "baseImage" }),
    ]);

    // ④ 谱系:卡 → 付费任务这一步也带得走(与商家批准时走的是同一个函数)。
    const built = buildGenRequestFromCard({
      cardPayload: card,
      projectId: ctx.projectId,
      threadId: ctx.threadId,
      cardId: "card-1",
      entityIds: card.entityIds,
      variantSel: {},
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.req.sourceGenerationId).toBe(CAT_MUG_ID);
      expect(built.req.entityIds).toContain(XINYI.id);
    }
  });

  it("正对照:明说要一张全新的图 ⇒ 绝不继承上一张", async () => {
    const ctx = makeCtx({
      currentImage: receipt(CAT_MUG_ID, "a cat drinking from the orange mug"),
      turnText: "make a brand new picture of @Xinyi at the beach",
      turnEntityIds: [XINYI.id],
    });

    const result = await executePropose(
      {
        kind: "image",
        structuredPrompt: "Xinyi standing on a beach at golden hour",
        entityIds: [XINYI.id],
        variantSel: {},
        goal: "a fresh hero shot",
      },
      { context: ctx },
    );
    expect(result).not.toHaveProperty("error");

    expect(result).not.toHaveProperty("continuesCurrentImage");

    const card = persistedCard();
    expect(card.sourceGenerationId).toBeUndefined();
    expect(card.mediaReferences).toBeUndefined();
    expect(card.entityIds).toContain(XINYI.id);
  });

  it("商家自己挂了一张图 ⇒ 以他挂的那张为底图,不被历史那张顶掉", async () => {
    const ctx = makeCtx({
      currentImage: receipt(CAT_MUG_ID, "a cat drinking from the orange mug"),
      sourceGenerationId: REVISED_ID,
      sourceGenerationIds: [REVISED_ID],
      mediaReferences: [receipt(REVISED_ID, "Xinyi holding the cat")],
      turnText: "now change the background of this picture",
    });

    const result = await executePropose(
      { kind: "image", structuredPrompt: "Same scene, warmer background", entityIds: [], variantSel: {} },
      { context: ctx },
    );
    expect(result).not.toHaveProperty("error");
    expect(persistedCard().sourceGenerationId).toBe(REVISED_ID);
  });
});

// ---------------------------------------------------------------------------
// FC-4 —— 首帧意图 / 卡面角色 / 实际请求,三者必须一致
// ---------------------------------------------------------------------------

describe("FC-4 · 商家点名要首帧", () => {
  it("认得出走查那一句原话", () => {
    expect(requestedVideoAttachmentRole("just use @Add Xinyi to the image as the first frame")).toBe(
      "startFrame",
    );
    expect(requestedVideoAttachmentRole("guna gambar pertama ni")).toBe("startFrame");
    expect(requestedVideoAttachmentRole("用这张当第一帧")).toBe("startFrame");
  });

  it("没点名就是没点名 —— 不给参考图建信号表", () => {
    expect(requestedVideoAttachmentRole("make it 15 seconds with @Xinyi and the cat")).toBeNull();
    expect(requestedVideoAttachmentRole(undefined)).toBeNull();
  });
});

describe("FC-4 · 角色换掉时卡上必须说出来", () => {
  const videoInput = {
    kind: "video" as const,
    structuredPrompt: "Xinyi pets the cat while it drinks from the mug, handheld, 15 seconds",
    entityIds: [XINYI.id],
    variantSel: {},
    desiredDuration: 15,
  };

  it("要首帧、给的是参考图 ⇒ 卡标降级、卡面有一行诚实披露、角色如实落在回执上", () => {
    const ctx = makeCtx({
      sourceGenerationId: REVISED_ID,
      sourceGenerationIds: [REVISED_ID],
      mediaReferences: [receipt(REVISED_ID, "Xinyi holding the cat")],
      turnText: "just use @Add Xinyi to the image as the first frame",
      turnEntityIds: [XINYI.id],
    });

    const built = buildProposeCard(videoInput, ctx, [XINYI]);

    // 真正会发生的那件事(判据一格没改):挂图当参考图,不是首帧。
    expect(built.attachmentRole).toBe("reference");
    expect(built.attachmentRoleDowngraded).toBe(true);
    // 卡面:批准之前就说出来,而且给得出做得到的那条路。
    expect(built.cardPayload.downgraded).toBe(true);
    expect(built.cardPayload.downgradeNote).toContain(FIRST_FRAME_DOWNGRADE_NOTE);
    // 卡上的角色 = 实际请求里的角色,没有 sourceGenerationId 冒充首帧。
    expect(built.cardPayload.sourceGenerationId).toBeUndefined();
    expect(built.cardPayload.mediaReferences).toEqual([
      expect.objectContaining({ generationId: REVISED_ID, role: "reference" }),
    ]);
  });

  it("没点名要首帧 ⇒ 卡上不多一行噪音(既有行为逐字不动)", () => {
    const ctx = makeCtx({
      sourceGenerationId: REVISED_ID,
      sourceGenerationIds: [REVISED_ID],
      mediaReferences: [receipt(REVISED_ID, "Xinyi holding the cat")],
      turnText: "ok i want the video to be 15 seconds",
      turnEntityIds: [XINYI.id],
    });

    const built = buildProposeCard(videoInput, ctx, [XINYI]);
    expect(built.attachmentRole).toBe("reference");
    expect(built.attachmentRoleDowngraded).toBe(false);
    expect(built.cardPayload.downgraded).toBe(false);
    expect(built.cardPayload.downgradeNote).toBeUndefined();
  });

  it("要首帧、也真给得了首帧(零 @ 演员)⇒ 不是降级", () => {
    const ctx = makeCtx({
      sourceGenerationId: REVISED_ID,
      sourceGenerationIds: [REVISED_ID],
      mediaReferences: [receipt(REVISED_ID, "the cat and the mug")],
      turnText: "just use that picture as the first frame",
    });

    const built = buildProposeCard(
      { ...videoInput, entityIds: [] },
      ctx,
      [],
    );
    expect(built.attachmentRole).toBe("startFrame");
    expect(built.attachmentRoleDowngraded).toBe(false);
    expect(built.cardPayload.sourceGenerationId).toBe(REVISED_ID);
    expect(built.cardPayload.mediaReferences).toEqual([
      expect.objectContaining({ generationId: REVISED_ID, role: "startFrame" }),
    ]);
  });
});

describe("FC-4 · 模型拿得到卡上真正的那一格", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    referenceImage: { count: ReturnType<typeof vi.fn> };
    generation: { findMany: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    mockPrisma.entity.findMany.mockResolvedValue([XINYI]);
    mockPrisma.chatMessage.findFirst.mockResolvedValue({ seq: 30 });
    mockPrisma.chatMessage.create.mockResolvedValue({});
    mockPrisma.referenceImage.count.mockResolvedValue(2);
    mockPrisma.generation.findMany.mockResolvedValue([]);
  });

  it("propose 的返回值带着 effective role 与那一句披露 —— 叙述没有第二个版本可写", async () => {
    const ctx = makeCtx({
      sourceGenerationId: REVISED_ID,
      sourceGenerationIds: [REVISED_ID],
      mediaReferences: [receipt(REVISED_ID, "Xinyi holding the cat")],
      turnText: "just use @Add Xinyi to the image as the first frame",
      turnEntityIds: [XINYI.id],
    });

    const result = await executePropose(
      {
        kind: "video",
        structuredPrompt: "Xinyi pets the cat while it drinks from the mug, handheld",
        entityIds: [XINYI.id],
        variantSel: {},
        desiredDuration: 15,
        goal: "a 15s ad",
      },
      { context: ctx },
    );

    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({
      attachmentRole: "reference",
      attachmentRoleNote: FIRST_FRAME_DOWNGRADE_NOTE,
    });
  });
});

// ---------------------------------------------------------------------------
// 复审 P1-B —— 信号表:一句话要么指着一张图,要么就是一次新活
// ---------------------------------------------------------------------------

/**
 * 为什么这一组是**表驱动**的(复审 P1-B,2026-09-15)。
 *
 * 第一版的信号表按子串收「泛用接续标记」,于是 "keep the" / "change the" / "edit the" /
 * "now put" / "this one" / 「现在要」/「保留」这些**不带指代对象**的碎片,在任何一句全新请求里
 * 都出得来:「make me a poster for the raya sale, keep the text short」会把一张无关的猫图
 * 绑成新海报的编辑底图 —— FC-2 那一类「错的输入花了钱」,只是方向反过来。
 *
 * 判据因此收窄成两类:**指着一张图的指代**(this/that/same + image|picture|photo、这张、
 * gambar ni…),以及**接续副词 + 指向已有东西的动词**(now i want / now add / now change,
 * 走查原话就在这一档)。下面两张表是这条规则的全部行为面,一边一打以上,EN/ZH/MS 都有。
 */
describe("FC-2 复审 · 信号表两侧各一打", () => {
  const CONTINUE_PHRASES = [
    // EN —— 接续副词 + 指向已有东西的动词
    "now i wan @Xinyi hold the cat and pet it while the cat is drinking with the product",
    "now i want the cat wearing a tiny hat",
    "now add a hat on the cat",
    "now change the background to a beach",
    // EN —— 直接指着那张图
    "edit this so the mug is bigger",
    "change this to a night scene",
    "add to this a second mug",
    "can you make this image brighter",
    "use that photo but make it warmer",
    "same picture, just remove the logo",
    // ZH
    "这张图把背景换成海边",
    "在这基础上加一顶帽子",
    "改这里的杯子颜色",
    "那张的猫再大一点",
    // MS
    "gambar ni tukar background jadi pantai",
    "guna gambar tadi tapi tambah kucing",
    // 复审 P2-1 —— 明确指着那张图,而句子里恰好有个 new:修饰的是帽子/标语,不是交付物。
    // 从前软否决先跑,这几句全被判成 fresh —— 商家指着图说话,系统却当没听见。
    "add a new hat to this photo",
    "edit this and add a new tagline",
    "put a new hat on this picture",
    "这张图换个新的背景",
    "tambah topi baru pada gambar ni",
    // 复审(单镜头)的反面护栏:「a new one」进硬否决时**绝不能**顺手收开放式的
    // 「make a new …」—— 这一句里 new 修饰的是背景,不是交付物。
    "make a new background for this photo",
    "make the background of this picture darker",
    "now change her shirt to red",
    "这张图的猫换成狗",
    "tukar warna baju dalam gambar ni",
  ];

  const FRESH_PHRASES = [
    // 复审点名的五个假阳性 —— 每一句都是一次**新活**,却都含着旧表里的碎片
    "make me a poster for the raya sale, keep the text short",
    "now put together a carousel",
    "现在要一张海报",
    "保留白底，做一张新的产品图",
    "change the copy to something shorter",
    // 同一类,其余碎片
    "edit the caption for the facebook post",
    "this one looks good, make a brand new picture of a dog",
    // 明说要新的(字面 + 形态 + 三种语言)
    "make a brand new picture of a dog in a park",
    "i want another one",
    "buat poster baru untuk raya",
    "给我一张新的海报",
    "start over with a different picture",
    // 两边同时命中 ⇒ 否决票赢
    "now i want a brand new picture of the cat",
    // 一个信号都没有 ⇒ 维持今天的行为
    "a cat drinking coffee, studio light",
    "now make a poster for the raya sale",
    // 复审 P2-2 —— 「now …」那一档本身不说明对象是哪一件。点名了一件新交付物
    // (poster / flyer / banner / carousel)就不是接着这张图改,绑上去就是拿旧图去做新活。
    "now i want a poster for the raya sale",
    "now add a flyer for deepavali",
    "now i want three banners for merdeka",
    "now change the logo into a new carousel",
    // 复审 P2-1 的另一边:硬否决连指代都压得过 —— 他明说要另一件了。
    "edit this photo, actually make a brand new one",
    // 复审(单镜头)—— **既指着那张图、又点名一件新交付物**。他指着的那张正是他要扔掉的
    // 那张;把它绑进这一单,等于拿他刚否掉的图去做一件新活,而钱已经花掉了。
    "这张不好，做一张新的",
    "这张图不要了，做一张新的海报",
    "this photo is nice, now i want a new poster for the raya sale",
    "gambar ni ok, buat satu lagi yang baru untuk merdeka",
    "scrap this image, give me a fresh poster",
    // 同一条判据在第 ② 类上:点名新交付物 ⇒ 压过「指着已有东西」。
    "now i want a poster with the same cat",
    // 自查探针里留下的三句(闭合说法 / 软否决 / 闭合马来语说法)。
    "i need a new banner instead",
    "再来一张新的海报",
    "gambar ni buat satu lagi",
  ];

  it.each(CONTINUE_PHRASES)("指着那张图 ⇒ continue:%s", (text) => {
    expect(
      decideImageContinuation({ text, hasAttachedImage: false, hasCurrentImage: true }),
    ).toBe("continue");
  });

  it.each(FRESH_PHRASES)("一次新活 ⇒ fresh:%s", (text) => {
    expect(
      decideImageContinuation({ text, hasAttachedImage: false, hasCurrentImage: true }),
    ).toBe("fresh");
  });

  it("两张表各自都在一打以上,两个方向都在表里(少了就不是行为面,是几个例子)", () => {
    expect(CONTINUE_PHRASES.length).toBeGreaterThanOrEqual(12);
    expect(FRESH_PHRASES.length).toBeGreaterThanOrEqual(12);
    // 复审 P2:两个方向都必须在表里 —— 只守一边,另一边就是下一次走查的现场。
    expect(CONTINUE_PHRASES).toContain("add a new hat to this photo");
    expect(FRESH_PHRASES).toContain("now i want a poster for the raya sale");
    // 复审(单镜头)的两个方向:指着图 + 点名新交付物 ⇒ fresh;指着图 + new 修饰图里的东西 ⇒ continue。
    expect(FRESH_PHRASES).toContain("this photo is nice, now i want a new poster for the raya sale");
    expect(CONTINUE_PHRASES).toContain("make a new background for this photo");
  });
});

// ---------------------------------------------------------------------------
// 复审 P1-C —— 整包这条路不绑底图(它的行说不出「正在改的是这一张」)
// ---------------------------------------------------------------------------

describe("FC-2 复审 · 整包卡不静默继承底图", () => {
  let mockPrisma: {
    entity: { findMany: ReturnType<typeof vi.fn> };
    chatMessage: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    referenceImage: { count: ReturnType<typeof vi.fn> };
    generation: { findMany: ReturnType<typeof vi.fn> };
    genJob: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await import("@fikirtive/db");
    mockPrisma = db.prisma as unknown as typeof mockPrisma;
    mockPrisma.entity.findMany.mockResolvedValue([XINYI]);
    mockPrisma.chatMessage.findFirst.mockResolvedValue({ seq: 30 });
    mockPrisma.chatMessage.create.mockResolvedValue({});
    mockPrisma.referenceImage.count.mockResolvedValue(2);
    mockPrisma.generation.findMany.mockResolvedValue([]);
  });

  /**
   * 单张那条路继承得到、整包这条路继承不到 —— 这是**有意**的,理由写在
   * `propose-pack.ts` 那段注释里:`PackCard` 的每一行只有图标、提示词和价钱,
   * 回执一个像素都没渲染,而 `Make all` 是一次按下去买走全部几张。
   * 读不到的 id 不许跟着付费请求上路(`plan-card-contract.ts` 的同一条规矩)。
   *
   * 哪天整包卡的行说得出「正在改的是这一张」,把 `withContinuedImage` 接回去即可;
   * 在那之前,这条断言就是那个缺口的看守 —— 谁顺手接回来,这里立刻红。
   */
  it("同一句续写话,整包里每一张都不带底图与回执", async () => {
    const ctx = makeCtx({
      currentImage: receipt(CAT_MUG_ID, "a cat drinking from the orange mug"),
      turnText: "now i want three variants of this picture",
      turnEntityIds: [XINYI.id],
    });

    const result = await executeProposePack(
      {
        packTitle: "Mug variants",
        items: [
          { kind: "image", structuredPrompt: "warm light", entityIds: [], variantSel: {} },
          { kind: "image", structuredPrompt: "cool light", entityIds: [], variantSel: {} },
        ],
        goal: "an ad for the mug",
      },
      { context: ctx },
    );
    expect(result).not.toHaveProperty("error");

    const created = mockPrisma.chatMessage.create.mock.calls.map(
      (c) => (c[0] as { data: { payload: CardPayload } }).data.payload,
    );
    expect(created).toHaveLength(2);
    for (const card of created) {
      expect(card.sourceGenerationId).toBeUndefined();
      expect(card.mediaReferences).toBeUndefined();
    }
  });
});
