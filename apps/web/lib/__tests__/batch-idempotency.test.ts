import { describe, expect, it } from "vitest";
import { CANVAS_JOB_KEY_PREFIX, CANVAS_REPAIR_JSON_KEY, isCanvasJobKey } from "@fikirtive/core";
import {
  canvasActionKey,
  factoryAttemptKey,
  factoryMaterialMatches,
  normalizeFactoryMaterial,
  parseCanvasActionKey,
  parseFactoryAttemptKey,
  type FactoryMaterial,
  type StoredFactoryMaterial,
} from "../batch-idempotency";

describe("canvas action keys", () => {
  it("derives a stable reserved key without exposing the client action id", () => {
    const first = canvasActionKey("canvas-action-123");
    const replay = canvasActionKey("canvas-action-123");
    const other = canvasActionKey("canvas-action-456");

    expect(first).toEqual(replay);
    expect(first.key).toHaveLength(71);
    expect(first.key).not.toContain("canvas-action-123");
    expect(parseCanvasActionKey(first.key)).toEqual(first);
    expect(first).not.toEqual(other);
    expect(parseCanvasActionKey("canvas:caller-controlled")).toBeNull();
  });

  it("keeps the WHOLE key shape the settlement reads as 'this job was bought from the board'", () => {
    // The canvas settlement decides whether a delivered job belongs on a board by reading this
    // key (packages/core, isCanvasJobKey). The two live in different packages, so pin them
    // together here: changing the shape on one side without the other would silently stop paid
    // canvas work from ever reaching the board.
    const minted = canvasActionKey("canvas-action-123").key;
    expect(minted.startsWith(CANVAS_JOB_KEY_PREFIX)).toBe(true);
    expect(CANVAS_JOB_KEY_PREFIX).toBe("canvas:");
    expect(isCanvasJobKey(minted)).toBe(true);

    // …and the reading side is no looser than the minting side (#601 r2 judge P2①). Anything the
    // reserved-family parser refuses must not be read back as a board purchase either.
    for (const forged of ["canvas:caller-controlled", `${CANVAS_JOB_KEY_PREFIX}abc`, `${CANVAS_JOB_KEY_PREFIX}${"a".repeat(32)}`]) {
      expect({ forged, parsed: parseCanvasActionKey(forged), read: isCanvasJobKey(forged) })
        .toEqual({ forged, parsed: null, read: false });
    }
  });
});

describe("factory attempt keys", () => {
  it("are stable, parseable, and exactly 79 chars (inside genRequest's 80-char cap)", () => {
    const first = factoryAttemptKey("b".repeat(64), 23, "a".repeat(64));
    const replay = factoryAttemptKey("b".repeat(64), 23, "a".repeat(64));

    expect(first).toEqual(replay);
    expect(first.key).toHaveLength(79);
    expect(parseFactoryAttemptKey(first.key)).toEqual(first);
  });

  it("separates logical cells from retry attempts", () => {
    const a = factoryAttemptKey("batch-1", 0, "attempt-a");
    const replay = factoryAttemptKey("batch-1", 0, "attempt-a");
    const retry = factoryAttemptKey("batch-1", 0, "attempt-b");
    const nextCell = factoryAttemptKey("batch-1", 1, "attempt-a");

    expect(a.key).toBe(replay.key);
    expect(a.logicalPrefix).toBe(retry.logicalPrefix);
    expect(a.key).not.toBe(retry.key);
    expect(a.logicalPrefix).not.toBe(nextCell.logicalPrefix);
    expect(parseFactoryAttemptKey("batch:legacy:cell:0")).toBeNull();
  });
});

describe("factory material binding", () => {
  const expected = normalizeFactoryMaterial({
    prompt: "hero",
    model: "seedream",
    kind: "image",
    count: 1,
    entityIds: ["e1", "e2"],
    variantSel: { e1: "v1", e2: "v2" },
  });
  const storedExpected = { id: "job-1", ...expected };

  it("keeps entity order significant while ignoring JSON object key order", () => {
    expect(factoryMaterialMatches({
      ...storedExpected,
      entityIds: ["e1", "e2"],
      variantSel: { e2: "v2", e1: "v1" },
    }, expected)).toBe(true);

    expect(factoryMaterialMatches({
      ...storedExpected,
      entityIds: ["e2", "e1"],
    }, expected)).toBe(false);

    expect(factoryMaterialMatches({
      ...storedExpected,
      variantSel: { e1: "v1", e2: "changed" },
    }, expected)).toBe(false);
    expect(factoryMaterialMatches({
      ...storedExpected,
      variantSel: { e1: "v1", e3: "v2" },
    }, expected)).toBe(false);
  });

  it("canonicalizes omitted and empty image variant selections to the same material in both directions", () => {
    const omitted = normalizeFactoryMaterial({
      prompt: "hero",
      model: "seedream",
      kind: "image",
      count: 1,
      entityIds: ["e1"],
    });
    const empty = normalizeFactoryMaterial({
      prompt: "hero",
      model: "seedream",
      kind: "image",
      count: 1,
      entityIds: ["e1"],
      variantSel: {},
    });

    expect(empty.variantSel).toBeNull();
    expect(factoryMaterialMatches({ id: "job-1", ...omitted, variantSel: {} }, omitted)).toBe(true);
    expect(factoryMaterialMatches({ id: "job-1", ...empty, variantSel: null }, empty)).toBe(true);
  });

  it("does not erase duplicate entity ids — [a,a] is different from [a]", () => {
    expect(factoryMaterialMatches({
      ...storedExpected,
      entityIds: ["e1", "e2", "e2"],
    }, expected)).toBe(false);
  });

  it("binds the live thread attribution as frozen generation material", () => {
    expect(factoryMaterialMatches({
      ...storedExpected,
      threadId: "thread-other",
    }, {
      ...storedExpected,
      threadId: "thread-expected",
    })).toBe(false);
  });

  it("ignores only reserved canvas-repair bookkeeping when comparing paid material", () => {
    const userOptions = {
      seconds: 10,
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 24,
      audio: false,
      merchantChoice: "cinematic",
    };
    expect(factoryMaterialMatches({
      ...storedExpected,
      videoOptions: {
        ...userOptions,
        [CANVAS_REPAIR_JSON_KEY]: {
          attempts: 3,
          nextAt: "2026-08-03T01:00:00.000Z",
          terminalAt: null,
          reason: "board write failed",
        },
      },
    }, { ...expected, videoOptions: userOptions })).toBe(true);

    expect(factoryMaterialMatches({
      ...storedExpected,
      videoOptions: {
        ...userOptions,
        merchantChoice: "documentary",
        [CANVAS_REPAIR_JSON_KEY]: { attempts: 3 },
      },
    }, { ...expected, videoOptions: userOptions })).toBe(false);

    expect(factoryMaterialMatches({
      ...storedExpected,
      videoOptions: {
        seconds: 5,
        merchantChoice: "cinematic",
        [CANVAS_REPAIR_JSON_KEY]: {
          genJobId: "stale",
          originalVideoOptions: { seconds: 10 },
        },
      },
    }, {
      ...expected,
      videoOptions: { seconds: 5, merchantChoice: "cinematic" },
      // Deliberately malformed legacy material: bypass the normal Factory input shape so this
      // exact stale-row counterexample reaches the comparator unchanged.
    } as unknown as FactoryMaterial)).toBe(true);

    // A legacy non-object payload must remain paid material while the repair record temporarily
    // wraps it. Removing the reserved key must not turn that corruption into an apparent null.
    expect(factoryMaterialMatches({
      ...storedExpected,
      videoOptions: {
        [CANVAS_REPAIR_JSON_KEY]: {
          attempts: 3,
          originalVideoOptions: "legacy-material",
        },
      },
    }, expected)).toBe(false);

    expect(factoryMaterialMatches({ ...storedExpected, videoOptions: {} }, expected)).toBe(false);
  });

  it("binds repair restoration to the stored database row id and fails closed without one", () => {
    const original = ["legacy", "material"];
    const repair = {
      genJobId: "job-1",
      attempts: 2,
      nextAt: "2026-08-03T01:00:00.000Z",
      reason: "board write failed",
      videoOptionsWasNull: false,
      originalVideoOptions: original,
    };
    const expectedLegacy = { ...expected, videoOptions: original } as unknown as FactoryMaterial;

    expect(factoryMaterialMatches({
      ...storedExpected,
      videoOptions: { [CANVAS_REPAIR_JSON_KEY]: repair },
    }, expectedLegacy)).toBe(true);
    expect(factoryMaterialMatches({
      ...storedExpected,
      id: "job-other",
      videoOptions: { [CANVAS_REPAIR_JSON_KEY]: repair },
    }, expectedLegacy)).toBe(false);
    expect(factoryMaterialMatches({
      ...expected,
      videoOptions: { [CANVAS_REPAIR_JSON_KEY]: repair },
    } as unknown as StoredFactoryMaterial, expectedLegacy)).toBe(false);
  });
});

describe("#642 图片规格快照(imageOptions)", () => {
  const base = { prompt: "hero", model: "seedream", kind: "image" as const, count: 1, entityIds: [] };

  it("图片作业落一份规格快照;没选画幅就落默认 1:1(与今日方图一致)", () => {
    expect(normalizeFactoryMaterial(base).imageOptions).toEqual({ aspectRatio: "1:1" });
    expect(normalizeFactoryMaterial({ ...base, aspectRatio: "9:16" }).imageOptions)
      .toEqual({ aspectRatio: "9:16" });
  });

  it("视频作业不落图片快照(两条规格路互不串台)", () => {
    const v = normalizeFactoryMaterial({ prompt: "clip", model: "seedance-2-mini", kind: "video", count: 1, aspectRatio: "16:9" });
    expect(v.imageOptions).toBeNull();
    expect((v.videoOptions as { aspectRatio: string }).aspectRatio).toBe("16:9");
  });

  it("画幅是材料的一部分:同键换画幅 = 材料冲突,不是静默复用", () => {
    const square = normalizeFactoryMaterial(base);
    const portrait = normalizeFactoryMaterial({ ...base, aspectRatio: "9:16" });
    expect(factoryMaterialMatches({ id: "job-1", ...square }, square)).toBe(true);
    expect(factoryMaterialMatches({ id: "job-1", ...square }, portrait)).toBe(false);
  });

  it("迁移前的历史行(该列为 NULL)与显式的默认画幅是同一份材料 —— 幂等键行为零回归", () => {
    const square = normalizeFactoryMaterial(base);
    // 老行库里没有这一列(null),甚至连字段都读不出来(undefined)。两种都必须照旧命中复用。
    expect(factoryMaterialMatches({ id: "job-1", ...square, imageOptions: null }, square)).toBe(true);
    const { imageOptions: _drop, ...legacyRow } = { id: "job-1", ...square };
    expect(factoryMaterialMatches(legacyRow as StoredFactoryMaterial, square)).toBe(true);
    // 但老行不等于「竖版」—— 它当年真的产出方图。
    expect(factoryMaterialMatches({ id: "job-1", ...square, imageOptions: null },
      normalizeFactoryMaterial({ ...base, aspectRatio: "9:16" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #645 T4(判官 r1 P1-1)—— i2v 的形状缺省
// ---------------------------------------------------------------------------
//
// 已定设计:**有首帧的片子默认 adaptive**(引擎跟着首帧走),没有首帧才落 t2v 默认 16:9。
// normalizeFactoryMaterial 是通用 startGen 与工厂逐格**共用**的那一份材料规范化,所以
// 这条路把缺省落错,等于 Otto/画布之外的每一条 i2v 都被悄悄改成 16:9 —— 商家的竖版
// 首帧会被裁成横版,而且全程没有一句话解释。
describe("#645 T4:i2v 形状缺省 = adaptive(通用 startGen / 工厂逐格共用的那一份)", () => {
  const videoInput = (over: Record<string, unknown> = {}) => ({
    prompt: "a product spin",
    model: "seedance-2-mini",
    kind: "video" as const,
    count: 1,
    entityIds: [] as string[],
    ...over,
  });

  it("有首帧(sourceGenerationId)⇒ 形状缺省 adaptive", () => {
    const m = normalizeFactoryMaterial(videoInput({ sourceGenerationId: "gen_frame" }));
    expect(m.videoOptions?.aspectRatio).toBe("adaptive");
  });

  it("有首帧(shotId —— 分镜那条路同样解析得出首帧)⇒ 形状缺省 adaptive", () => {
    const m = normalizeFactoryMaterial(videoInput({ shotId: "shot_1" }));
    expect(m.videoOptions?.aspectRatio).toBe("adaptive");
  });

  it("没有首帧(t2v)⇒ 形状缺省仍是 16:9,一格未动", () => {
    const m = normalizeFactoryMaterial(videoInput());
    expect(m.videoOptions?.aspectRatio).toBe("16:9");
  });

  it("商家明说了形状 ⇒ 照他说的来,缺省规则不参与", () => {
    const m = normalizeFactoryMaterial(videoInput({ sourceGenerationId: "gen_frame", aspectRatio: "9:16" }));
    expect(m.videoOptions?.aspectRatio).toBe("9:16");
  });

  it("时长/清晰度/声音三项不受首帧影响 —— 只有形状分开处理", () => {
    const withFrame = normalizeFactoryMaterial(videoInput({ sourceGenerationId: "gen_frame" }));
    const without = normalizeFactoryMaterial(videoInput());
    expect(withFrame.videoOptions?.seconds).toBe(without.videoOptions?.seconds);
    expect(withFrame.videoOptions?.resolution).toBe(without.videoOptions?.resolution);
    expect(withFrame.videoOptions?.audio).toBe(without.videoOptions?.audio);
  });
});

// ---------------------------------------------------------------------------
// #769 —— 换引擎(Seedance 2.0 Fast → 2.0 mini)之后,内容指纹说的还是不是实话
// ---------------------------------------------------------------------------
//
// 换代有两种做法,这里钉的是**已选的那一种**:换 option key(seedance-2-fast →
// seedance-2-mini),而不是在同一个 key 底下悄悄换后端的 Ark 版本化 id。
//
// 指纹这一侧的判据:`factoryMaterialMatches` 比的是 `model` —— 落库的那个 option key,
// 不是 `dreamina-seedance-2-0-*` 那个版本化 id(它只活在 provider 边界上,从不进库)。
// 于是:
//   ① 同 key 重放 = 同材料。**版本化 id 换了也不会被误判成内容漂移** —— 那个 id 根本
//      不在指纹里。这条是本票要求证明的那一条。
//   ② 换 key ⇒ 老快照(fast)与新请求(mini)判成不同材料。这是**正确**语义:两台引擎
//      出的片子不一样(Founder 眼看 7 条对比片:mini 更忠于商家参考图,fast 会换背景),
//      成本也差 1/3。判成「同材料」会让一次 mini 请求复用掉一条 fast 的片子并收 0 ——
//      静默的错。判成不同,商家那一格会如实走一趟新的生成。
//   ③ 零用户零存量,所以 ② 今天不会真的咬到任何商家;钉住它是为了让语义写在测试里,
//      而不是靠「反正没人用」。
describe("#769 换引擎之后的内容指纹语义(同 key 重放 ≠ 内容漂移;换 key = 换材料)", () => {
  const material = (model: string): FactoryMaterial =>
    normalizeFactoryMaterial({
      prompt: "a product spin",
      model,
      kind: "video",
      count: 1,
      sourceGenerationId: "gen_frame",
    });

  const stored = (m: FactoryMaterial, id = "job_1"): StoredFactoryMaterial => ({
    id,
    prompt: m.prompt,
    model: m.model,
    kind: m.kind,
    count: m.count,
    entityIds: m.entityIds,
    variantSel: m.variantSel,
    sourceGenerationId: m.sourceGenerationId,
    tailGenerationId: m.tailGenerationId,
    referenceVideoGenerationId: m.referenceVideoGenerationId,
    shotId: m.shotId,
    threadId: m.threadId,
    videoOptions: m.videoOptions,
    imageOptions: m.imageOptions,
  });

  it("同一个 key 的重放仍然判成同材料 —— 后端 Ark 版本化 id 换了也影响不到指纹", () => {
    const mini = material("seedance-2-mini");
    expect(factoryMaterialMatches(stored(mini), material("seedance-2-mini"))).toBe(true);
    // 指纹里存的是 option key 本身,不是 dreamina-seedance-2-0-mini-260615 那个版本化 id。
    expect(mini.model).toBe("seedance-2-mini");
    expect(JSON.stringify(mini)).not.toContain("dreamina-");
  });

  it("老快照(下架的 seedance-2-fast)与新的 mini 请求判成**不同材料**", () => {
    const legacyFastRow = stored(material("seedance-2-fast"));
    expect(factoryMaterialMatches(legacyFastRow, material("seedance-2-mini"))).toBe(false);
  });

  it("这一格的其余材料完全相同 —— 判成不同的**唯一**理由就是引擎变了", () => {
    const fast = material("seedance-2-fast");
    const mini = material("seedance-2-mini");
    const strip = ({ model, videoOptions, ...rest }: FactoryMaterial) => rest;
    expect(strip(fast)).toEqual(strip(mini));
    // 下架的 id 走 videoDefaults 的空规格(#647 T6 早就为「菜单外的历史 id」建好的那条路):
    // 「我不知道这台引擎当年给的是什么」,而不是编一份看起来像真的档位出来。
    expect(fast.videoOptions).toEqual({ seconds: 0, resolution: "", aspectRatio: "", fps: 0, audio: false });
    expect(mini.videoOptions).toEqual({ seconds: 5, resolution: "720p", aspectRatio: "adaptive", fps: 0, audio: true });
  });
});
