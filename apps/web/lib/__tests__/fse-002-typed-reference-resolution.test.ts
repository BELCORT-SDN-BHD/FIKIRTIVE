/**
 * FSE-002 —— 「一份已解析的 typed refs 结构，按类型解析」的**解析器那一半**。
 *
 * 规格 `docs/specs/creation-engine.md`（验收 **CREATE-A2**）与 `docs/specs/frontend-baseline.md`
 * （**FRONT-A10**）。触发＝2026-09-08 staging E2E Round 1 的 FSE-002（P1 · 双 typed 引用已保存，
 * 确认卡却丢失商品图），Founder 当日裁「一片修完」。
 *
 * 走查现场：`@` 菜单里点了官方演员与一张真实商品图，两件都进了 `ChatMessage.referenceRefs`
 * （回链是对的），可 GEN_CARD 上只有演员、没有 `sourceGenerationId` —— 那张图从来没被翻译成
 * 「这一轮挂了什么」。上一版这里只产出 `wire`（回链用），于是「提到了谁」与「真正带上路的是
 * 什么」被迫由两条路各报一遍。
 *
 * 这个文件钉的是那一次解析现在**同时**产出两半，而且按类型分对：
 *   ① entity 那几型 → `entityIds`（生成条件）；
 *   ② `generation:` / `upload:` → `media`，按**行上的真实扩展名**分成图片 / 参考片；
 *   ③ 对不上的（别家的、已删的、类型拿错的、族别读不出的）→ 计入 `unresolved`，
 *      由调用方整轮显式拒绝 —— 不是悄悄少一件。
 *
 * Prisma 是替身（这个文件不碰真库）；跑的是真的 `resolveOwnedReferenceRefs`。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@fikirtive/db", () => ({
  prisma: {
    entity: { findMany: vi.fn() },
    generation: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@fikirtive/db");
const { resolveOwnedReferenceRefs } = await import("@/lib/reference-refs");

const entityFindMany = prisma.entity.findMany as ReturnType<typeof vi.fn>;
const generationFindMany = prisma.generation.findMany as ReturnType<typeof vi.fn>;

const OWNER = "org_teratak";
const AVATAR_ID = "ent_aisyah";
const PRODUCT_GENERATION_ID = "gen_coral_mug";
const UPLOAD_ASSET_ID = "ast_shelf";
const UPLOAD_GENERATION_ID = "gen_from_upload";

/** 官方演员那一行（`catalogKey` 有值 ⇒ `entityOrigin` 判为官方目录）。 */
function officialAvatarRow() {
  return { id: AVATAR_ID, name: "Aisyah", type: "CHARACTER", catalogKey: "actor-aisyah" };
}

function imageGenerationRow() {
  return {
    id: PRODUCT_GENERATION_ID,
    assetId: "ast_mug",
    source: "GENERATED",
    promptText: "Coral travel mug on a marble counter",
    projectId: "proj_raya",
    project: { name: "Raya launch" },
    asset: { originalFilename: "mug.png", ext: "png" },
  };
}

function uploadGenerationRow() {
  return {
    id: UPLOAD_GENERATION_ID,
    assetId: UPLOAD_ASSET_ID,
    source: "UPLOAD",
    promptText: "",
    projectId: "proj_raya",
    project: { name: "Raya launch" },
    asset: { originalFilename: "shelf.jpg", ext: "jpg" },
  };
}

type Row = Record<string, unknown>;

/**
 * 判官 r5 P1 —— 替身要**读 where**,否则它证明不了任何一条 where 上的判据。
 *
 * 从前这里是 `generationFindMany.mockResolvedValue([…])`:不管解析器问什么,行都无条件回来。
 * 于是「`generation:` 认得上传件那一行」这条主张没有围栏 —— 把 where 改回 `source: { not:
 * "UPLOAD" }`(正是被修掉的那个 bug),这个文件照样全绿。下面这个替身把这一趟查询当查询来
 * 答:先按 where 过滤这家店库里摆着的那几行,再返回。`orderBy` / `select` 不建模(解析器不
 * 依赖排序,字段直接取行上的),但**每一个条件都必须认得** —— 遇到没建模的操作符就抛,免得
 * 下一次有人往 where 里加一格,替身继续无条件放行。
 *
 * 库里这几行一律是**这家店的、还活着的**(`ownerId` / `deletedAt` 补在过滤那一侧,不补进返回
 * 的行 —— 返回的形状照旧只有 select 取的那几格),所以换一位商家来问同样一趟,答案是空。
 */
function generationRowsInDb(...rows: Row[]) {
  generationFindMany.mockImplementation(async (args: { where: Row }) =>
    rows.filter((row) => matchesWhere({ ownerId: OWNER, deletedAt: null, ...row }, args.where)),
  );
}

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "OR") return (condition as Row[]).some((branch) => matchesWhere(row, branch));
    return matchesField(row[field] ?? null, condition);
  });
}

function matchesField(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== "object") return value === condition;
  const operator = condition as Record<string, unknown>;
  if ("in" in operator) return (operator.in as unknown[]).includes(value);
  if ("equals" in operator) return value === operator.equals;
  if ("not" in operator) return value !== operator.not;
  throw new Error(`FSE-002 替身没建模这个 where 条件:${JSON.stringify(condition)}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  entityFindMany.mockResolvedValue([]);
  generationRowsInDb();
});

describe("FSE-002 / CREATE-A2 —— 一次解析，两半产出", () => {
  it("FSE-002 / CREATE-A2 / FRONT-A10 演员＋商品图一起 @ ⇒ 元素与媒体各归各位，一件都不丢", async () => {
    entityFindMany.mockResolvedValue([officialAvatarRow()]);
    generationRowsInDb(imageGenerationRow());

    const out = await resolveOwnedReferenceRefs(OWNER, [
      `official-avatar:${AVATAR_ID}`,
      `generation:${PRODUCT_GENERATION_ID}`,
    ]);

    expect(out.unresolved).toBe(0);
    // 回链那一格照旧（这一半从前就是对的 —— 缺的是下面那一半）。
    expect(out.wire).toEqual([`official-avatar:${AVATAR_ID}`, `generation:${PRODUCT_GENERATION_ID}`]);
    // 走查里丢掉的正是这两格。
    expect(out.entityIds).toEqual([AVATAR_ID]);
    expect(out.media).toEqual([{ generationId: PRODUCT_GENERATION_ID, kind: "image" }]);
  });

  it("FSE-002 / CREATE-A2 `upload:` 解析成**摄取它的那一行 Generation**（wire 上是 Asset id）", async () => {
    // 契约 §4 说 upload 的规范身份是 Asset；可这一轮真正挂上路的是 Generation ——
    // 两者不是同一个 id，所以这一步只能发生在读过那一行之后。
    generationRowsInDb(uploadGenerationRow());

    const out = await resolveOwnedReferenceRefs(OWNER, [`upload:${UPLOAD_ASSET_ID}`]);

    expect(out.unresolved).toBe(0);
    expect(out.media).toEqual([{ generationId: UPLOAD_GENERATION_ID, kind: "image" }]);
    // wire 保持商家点的那一份（回链要认得它）。
    expect(out.wire).toEqual([`upload:${UPLOAD_ASSET_ID}`]);
  });

  it("FSE-002 / CREATE-A2 片子按行上的扩展名进参考片那一族（不靠 id 形状猜）", async () => {
    generationRowsInDb(
      { ...imageGenerationRow(), id: "gen_clip", asset: { originalFilename: "clip.mp4", ext: "mp4" } },
    );

    const out = await resolveOwnedReferenceRefs(OWNER, ["generation:gen_clip"]);

    expect(out.media).toEqual([{ generationId: "gen_clip", kind: "video" }]);
  });

  it("FSE-002 / CREATE-A2 同一行被两条 wire 指到 ⇒ 只上一次车", async () => {
    generationRowsInDb(uploadGenerationRow());

    const out = await resolveOwnedReferenceRefs(OWNER, [
      `upload:${UPLOAD_ASSET_ID}`,
      `generation:${UPLOAD_GENERATION_ID}`,
    ]);

    expect(out.media).toEqual([{ generationId: UPLOAD_GENERATION_ID, kind: "image" }]);
  });
});

describe("FSE-002 / CREATE-A2 —— 对不上的四种，一律显式未解析", () => {
  it("FSE-002 / CREATE-A2 错类型：把 GEN_CARD 消息 id 当商品 ⇒ 不解析成任何一半", async () => {
    // 走查里模型纠正时递的就是这个：一条 GEN_CARD 的**消息 id**。它在 Entity 表里查不到，
    // 在 Generation 表里也查不到 —— 从前这种 id 会被静默滤掉，卡照铸、钱照扣。
    const out = await resolveOwnedReferenceRefs(OWNER, ["product:01M1ZS6Z94N92QE2JHD5QT8DV8"]);

    expect(out.entityIds).toEqual([]);
    expect(out.media).toEqual([]);
    expect(out.unresolved).toBe(1);
  });

  it("FSE-002 / CREATE-A2 类型与行对不上（自己的产品报成官方演员）⇒ 未解析", async () => {
    entityFindMany.mockResolvedValue([
      { id: "ent_mug", name: "Coral travel mug", type: "PRODUCT", catalogKey: null },
    ]);

    const out = await resolveOwnedReferenceRefs(OWNER, ["official-avatar:ent_mug"]);

    expect(out.entityIds).toEqual([]);
    expect(out.unresolved).toBe(1);
  });

  it("FSE-002 / CREATE-A2 引用已删除 ⇒ 未解析（查询本身带 deletedAt: null）", async () => {
    // 已删的行不会被 owner-scoped 查询选中，所以替身返回空 —— 与「别家的」在这里长得一模一样。
    const out = await resolveOwnedReferenceRefs(OWNER, [`generation:${PRODUCT_GENERATION_ID}`]);

    expect(out.media).toEqual([]);
    expect(out.unresolved).toBe(1);
    expect(generationFindMany.mock.calls[0]![0].where).toMatchObject({ ownerId: OWNER, deletedAt: null });
  });

  it("FSE-002 / CREATE-A2 跨租户 id ⇒ 未解析，而且每一次查询都带这一位商家的 ownerId", async () => {
    const out = await resolveOwnedReferenceRefs(OWNER, [
      "product:ent_other_shop",
      "generation:gen_other_shop",
    ]);

    expect(out.entityIds).toEqual([]);
    expect(out.media).toEqual([]);
    expect(out.unresolved).toBe(2);
    expect(entityFindMany.mock.calls[0]![0].where).toMatchObject({ ownerId: OWNER, deletedAt: null });
    expect(generationFindMany.mock.calls[0]![0].where).toMatchObject({ ownerId: OWNER, deletedAt: null });
  });

  // 复修轮（判官 2026-09-08 P1-1）：上一版把这种行记成 `unresolved`，于是商家自己的、就摆在
  // Library 里的 gif／音频被整轮 400 拒绝，读到的还是那句「isn't available any more」——
  // 一句他一查就知道是假的话。这一族现在**解析成功**（回链、芯片照旧），只是不进媒体槽，
  // 单独记一个数，由写入侧说出真正的原因。
  it("FSE-002 / CREATE-A2 格式当不了引用的行 ⇒ 照旧解析成功（回链在），只是不进媒体槽", async () => {
    generationRowsInDb(
      { ...imageGenerationRow(), asset: { originalFilename: "thing.psd", ext: "psd" } },
    );

    const out = await resolveOwnedReferenceRefs(OWNER, [`generation:${PRODUCT_GENERATION_ID}`]);

    expect(out.media).toEqual([]);
    // 它是商家自己的、还活着的行 —— 「消失了」是假的，所以它不算未解析。
    expect(out.unresolved).toBe(0);
    expect(out.unusableFormat).toBe(1);
    // 回链那一半照旧在：读路径（历史消息上的芯片）走的就是这里。
    expect(out.wire).toEqual([`generation:${PRODUCT_GENERATION_ID}`]);
    expect(out.links).toHaveLength(1);
    // 而且它**不能**掉进 `entityIds` —— 那会把一件素材当成一个元素递给铸卡层。
    expect(out.entityIds).toEqual([]);
  });

  // 商家上传得了、却当不了参考的那几族（`UPLOAD_EXTS` ⊃ `REFERENCE_*_EXTS`）：gif／avif／mkv
  // 与全部音频。`@` 选单对上传行不做扩展名过滤，所以这几件是真挑得到的。
  it.each([
    ["gif", "loop.gif"],
    ["avif", "hero.avif"],
    ["mkv", "cut.mkv"],
    ["mp3", "jingle.mp3"],
  ])(
    "FSE-002 / CREATE-A2 自有上传的 %s ⇒ 不是「消失了」，而是「格式当不了引用」",
    async (ext, filename) => {
      generationRowsInDb(
        { ...uploadGenerationRow(), asset: { originalFilename: filename, ext } },
      );

      const out = await resolveOwnedReferenceRefs(OWNER, [`upload:${UPLOAD_ASSET_ID}`]);

      expect(out.unresolved).toBe(0);
      expect(out.unusableFormat).toBe(1);
      expect(out.media).toEqual([]);
      expect(out.entityIds).toEqual([]);
    },
  );

  it("FSE-002 / CREATE-A2 一件能用一件不能用 ⇒ 能用的照旧上路，不能用的单独记数", async () => {
    entityFindMany.mockResolvedValue([]);
    generationRowsInDb(
      imageGenerationRow(),
      { ...uploadGenerationRow(), asset: { originalFilename: "loop.gif", ext: "gif" } },
    );

    const out = await resolveOwnedReferenceRefs(OWNER, [
      `generation:${PRODUCT_GENERATION_ID}`,
      `upload:${UPLOAD_ASSET_ID}`,
    ]);

    expect(out.media).toEqual([{ generationId: PRODUCT_GENERATION_ID, kind: "image" }]);
    expect(out.unresolved).toBe(0);
    expect(out.unusableFormat).toBe(1);
  });

  it("FSE-002 / CREATE-A2 一件都没挂的一轮 ⇒ 两半都是空表，连库都不问", async () => {
    const out = await resolveOwnedReferenceRefs(OWNER, []);

    expect(out).toMatchObject({ entityIds: [], media: [], wire: [], unresolved: 0, unusableFormat: 0 });
    expect(entityFindMany).not.toHaveBeenCalled();
    expect(generationFindMany).not.toHaveBeenCalled();
  });
});

/**
 * creation §5 :178(判官 r1 P1-①)—— 解析器要认得**自己的产物**。
 *
 * 分镜卡把这一镜挂着的图存成规范身份(`Generation.id`),商家再加一张 / 取下一张时,卡面发回
 * 的是**整份新清单** —— 里面那几张已经挂着的只能以 `generation:<id>` 的形状回来。而上传件落
 * 下的那一行 Generation 的 `source` 正是 UPLOAD:从前 `generation:` 那一支明写着「source 不是
 * UPLOAD」,于是整次编辑被判 unresolved、整份拒绝,商家读到的是一句关于他自己那个文件的假话
 * (「isn't one of your images any more」),而那个文件就在 Library 里。
 *
 * 归属那一格一格没动:这一趟查询照旧带 ownerId,别家店的行照旧读不出来。
 */
describe("creation §5 :178 —— 解析器认得自己的产物(上传件那一行)", () => {
  it("creation §5 :178: 上传件解析出来的规范身份,原样发回来时读得出来(不是「这文件没了」)", async () => {
    generationRowsInDb(uploadGenerationRow());

    const out = await resolveOwnedReferenceRefs(OWNER, [`generation:${UPLOAD_GENERATION_ID}`]);

    expect(out.unresolved).toBe(0);
    expect(out.media).toEqual([{ generationId: UPLOAD_GENERATION_ID, kind: "image" }]);
    // 归属仍然是那一趟查询的事 —— 这一格没动。
    expect(generationFindMany.mock.calls[0]![0].where.ownerId).toBe(OWNER);
  });

  it("creation §5 :178: 挂着的上传件 + 新挂的一张 ⇒ 两张都在,一张都不丢", async () => {
    generationRowsInDb(uploadGenerationRow(), imageGenerationRow());

    const out = await resolveOwnedReferenceRefs(OWNER, [
      `generation:${UPLOAD_GENERATION_ID}`,
      `generation:${PRODUCT_GENERATION_ID}`,
    ]);

    expect(out.unresolved).toBe(0);
    expect(out.media.map((m) => m.generationId)).toEqual([UPLOAD_GENERATION_ID, PRODUCT_GENERATION_ID]);
  });
});
