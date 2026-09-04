import { createHash } from "node:crypto";
import {
  canvasMaterialWithoutRepair,
  genJobEndedWithoutDelivering,
  imageDefaults,
  videoDefaults,
  COHERENT_SET_MIN_IMAGES,
  // #775 判官 r5 P1:锚定句式的识别器与 adaptive 常量都从 core 取 —— 与付费 schema、
  // 铸卡侧、写这段字的装配器共用同一份判据,绝不在这里另抄。
  isAnchoredVideoPrompt,
  VIDEO_ASPECT_ADAPTIVE,
  type GenModel,
  type GenVideoModel,
} from "@fikirtive/core";

const HASH_HEX_LENGTH = 32;
const FACTORY_KEY_RE = /^batch:([0-9a-f]{32}):attempt:([0-9a-f]{32})$/;
const CANVAS_KEY_RE = /^canvas:([0-9a-f]{64})$/;
const ASSET_KEY_RE = /^asset:(?:regen|animate|edit|template):[0-9a-f]{64}$/;

export interface CanvasActionKey {
  key: string;
}

export interface FactoryAttemptKey {
  key: string;
  logicalPrefix: string;
}

export interface FactoryVideoOptions extends Record<string, string | number | boolean> {
  seconds: number;
  resolution: string;
  aspectRatio: string;
  fps: number;
  audio: boolean;
}

/** #642: the image shape frozen at enqueue — mirrors FactoryVideoOptions. */
export interface FactoryImageOptions extends Record<string, string | boolean | string[] | undefined> {
  aspectRatio: string;
  /**
   * Codex staging CRE-STG-P1-003 —— 商家挂的**第一张之外**的图片参考,次序即引擎收到的次序。
   *
   * 为什么住在这一格,而不是 `GenJob` 上一列自己的列:`GenJob.sourceGenerationId` 是单值,
   * 加一列复数列要动 prisma schema 与迁移,而这一趟的授权范围里没有它(Founder 未批的
   * schema 变更不在本次修复的范围内)。`imageOptions` 正是「这一单图片作业在入队那一刻
   * 冻结的规格快照」,worker 已经从它读画幅与组图开关 —— 参考图是同一类事实,同一个读者。
   *
   * 与 `coherentSet` 同一条纪律:**只在非空时出现**。挂 0 或 1 张的任务快照与这条修改之前
   * 逐字相同,所以库里每一条既有行的幂等重放一格没变。进材料 = 「换了参考图就是换了内容」,
   * 同一个动作的重试照旧复用,换了图的请求照实被判成另一件事。
   */
  referenceGenerationIds?: string[];
  /**
   * #777:这一单是不是**一组要连贯的图**(一次调用出齐整组)。
   *
   * **只在 true 时出现**,这一点是钱路安全的,不是洁癖:写一格 `coherentSet: false`
   * 进去,库里每一条既有的图片任务(它们的快照只有 aspectRatio)就都会与新算出来的
   * 材料对不上 —— 商家的合法重放当场被判成「换了内容」,一次幂等回归。
   *
   * 它进材料 = 「一组连贯图」与「N 张散图」是**不同内容**:同一个 batchId 的同一格
   * 想把已批的一组换成散图(或反过来),复用判据会照实拒,而不是静默交付另一样东西。
   */
  coherentSet?: true;
}

export interface FactoryMaterial {
  prompt: string;
  model: string;
  kind: "IMAGE" | "VIDEO";
  count: number;
  entityIds: string[];
  variantSel: Record<string, string> | null;
  sourceGenerationId: string | null;
  tailGenerationId: string | null;
  referenceVideoGenerationId: string | null;
  shotId: string | null;
  threadId: string | null;
  videoOptions: FactoryVideoOptions | null;
  imageOptions: FactoryImageOptions | null;
}

export interface FactoryMaterialInput {
  prompt: string;
  model: string;
  kind: "image" | "video";
  count: number;
  entityIds?: string[];
  variantSel?: Record<string, string>;
  sourceGenerationId?: string | null;
  tailGenerationId?: string | null;
  referenceVideoGenerationId?: string | null;
  shotId?: string | null;
  threadId?: string | null;
  durationSeconds?: number | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  fps?: number | null;
  audio?: boolean | null;
  /** #777:这 `count` 张是一组要连贯的图。image-only(视频侧没有这个能力)。 */
  coherentSet?: boolean | null;
  /** CRE-STG-P1-003:第一张之外的图片参考(image-only)。来源只有一处 —— 服务端读出来的
   *  那张持久化卡(`startCoworkGen`),调用方提交的同名字段永远到不了这里。 */
  referenceGenerationIds?: string[] | null;
}

export type StoredFactoryMaterial = Omit<FactoryMaterial, "videoOptions" | "imageOptions" | "variantSel" | "threadId"> & {
  /** The database row whose repair record is allowed to describe this material. */
  id: string;
  variantSel: unknown;
  videoOptions: unknown;
  /** Legacy/non-Canvas readers may omit the column; absence is the same as null. */
  threadId?: string | null;
  /** #642: rows enqueued before the column existed have no value; absence is the same as
   *  null, which canonicalizes to the default (square) shape those rows really produced. */
  imageOptions?: unknown;
};

function shortHash(scope: string, value: string): string {
  return createHash("sha256")
    .update(scope)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, HASH_HEX_LENGTH);
}

/** Reserved, server-derived Canvas action identity. The full SHA-256 digest keeps the key
 * inside genRequest's 80-character cap while never persisting the caller's action id. */
export function canvasActionKey(actionId: string): CanvasActionKey {
  const digest = createHash("sha256")
    .update("canvas-action-v1")
    .update("\0")
    .update(`${actionId.length}:${actionId}`)
    .digest("hex");
  return { key: `canvas:${digest}` };
}

/** Recognises only the reserved v1 Canvas family. startGen refuses caller-supplied members;
 * startCanvasGen is the only entrypoint allowed to derive one server-side. */
export function parseCanvasActionKey(key: string): CanvasActionKey | null {
  return CANVAS_KEY_RE.test(key) ? { key } : null;
}

/** The attempt-INDEPENDENT half of a factory key: every attempt at the same logical cell shares
 *  it. Split out so a caller asking "was this logical cell ever dispatched?" derives the prefix
 *  from the same line the dispatcher does, instead of inventing a second copy of the formula. */
export function factoryLogicalPrefix(batchId: string, cellIndex: number): string {
  return `batch:${shortHash("factory-cell-v1", `${batchId.length}:${batchId}:${cellIndex}`)}:attempt:`;
}

/** Stable factory identity: 128-bit logical-cell hash + 128-bit caller attempt hash.
 *  The resulting key is exactly 79 characters, inside genRequest's 80-character cap. */
export function factoryAttemptKey(batchId: string, cellIndex: number, attemptId: string): FactoryAttemptKey {
  const attemptHash = shortHash("factory-attempt-v1", `${attemptId.length}:${attemptId}`);
  const logicalPrefix = factoryLogicalPrefix(batchId, cellIndex);
  return { key: `${logicalPrefix}${attemptHash}`, logicalPrefix };
}

/** Recognises only the v1 structural factory key; legacy/general/cowork keys stay on their
 *  existing startGen semantics. */
export function parseFactoryAttemptKey(key: string): FactoryAttemptKey | null {
  const match = FACTORY_KEY_RE.exec(key);
  if (!match) return null;
  return { key, logicalPrefix: `batch:${match[1]}:attempt:` };
}

function canonicalVariantSel(value: Record<string, string> | null | undefined): Record<string, string> | null;
function canonicalVariantSel(value: unknown): unknown;
function canonicalVariantSel(value: unknown): unknown {
  if (value == null) return null;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) return null;
  return value;
}

/** The exact shape startGen persists, shared by its lock-time binding and factory's early reject. */
export function normalizeFactoryMaterial(input: FactoryMaterialInput): FactoryMaterial {
  const videoOptions: FactoryVideoOptions | null = (() => {
    if (input.kind !== "video") return null;
    // #645 T4(判官 r1 P1-1):**有首帧的片子形状缺省 adaptive** —— 引擎跟着首帧走,
    // 而不是被一个 t2v 默认值(16:9)悄悄改成别的画幅,把商家的竖版首帧裁成横版。
    // 「有首帧」的口径与 core 的契约闸一致(gen.ts 的 tail 校验):worker 解析起始帧
    // 只认这两处 —— 显式的 sourceGenerationId,或能拿到该镜头最新静帧的 shotId。
    const hasSourceImage = !!input.sourceGenerationId || !!input.shotId;
    const defaults = videoDefaults(input.model as GenVideoModel, { hasSourceImage });
    /**
     * #775 判官 r5 P1 —— **改这条片子 / 把它接下去的请求,缺席的形状只能解析成 adaptive。**
     *
     * 这是判官逮到的那条缝,而它正好卡在两层测试中间:付费 schema **允许**比例缺席
     * (缺席 = 引擎自己跟着输入走),而这里把缺席解析成模型默认的 **16:9** —— 于是
     * 「官方句式 + 合法 clip + 不传 aspect」从 canvas / factory / 直接 action 一路走到
     * `GenJob.videoOptions`、走到预扣、走到 provider,正好踩中官方陷阱:任务先被收下、
     * 事后才异步失败,商家批准之后石沉大海。
     *
     * 为什么修在**这里**而不是让 schema 不许缺席:
     *   · 这一步是那个值的**唯一解析点** —— `GenJob.videoOptions` 只从这份 material 写
     *     (`gen-actions.ts` 的 videoOptions),worker 又只从 `job.videoOptions.aspectRatio`
     *     取值送 provider。修在解析点,任何一条路(现在的和以后新写的)都不必知道这条规矩;
     *   · 而且归一化在**工厂那条路上跑在 schema 之前**(`factory-batch.ts` 的 `cellMaterial`
     *     先算材料、再由 `startGen` 校验),那里 schema 根本够不着。
     * 让 schema 不许缺席只会把「悄悄落错值」换成「一条本来合法的请求被拒」,
     * 而且工厂那份材料仍然算错。
     *
     * 判据复用 core 的同一个识别器,不另抄一份 —— 写这段字的装配器、铸卡侧、付费 schema
     * 与这里,四处认的是同一句话。
     *
     * 收得很窄:必须**同时**是官方句式且真的带着那条片子。没有 clip 的锚定句式过不了
     * schema,这里不替它发明语义;非官方句式(含「照着这条做一条新的」)一格没动。
     */
    const anchoredToClip = !!input.referenceVideoGenerationId && isAnchoredVideoPrompt(input.prompt);
    return {
      seconds: input.durationSeconds ?? defaults.seconds,
      resolution: input.resolution ?? defaults.resolution,
      aspectRatio: input.aspectRatio ?? (anchoredToClip ? VIDEO_ASPECT_ADAPTIVE : defaults.aspectRatio),
      fps: input.fps ?? defaults.fps,
      audio: input.audio ?? defaults.audio,
    };
  })();

  // #642: the image shape, resolved once here so the persisted snapshot, the money
  // material binding, and the worker's provider call all read the same value. Absent →
  // the model's default (1:1), which is byte-for-byte what image jobs produced before.
  //
  // #777:组图那一格**只在 true 时写进去**(见 FactoryImageOptions 的注释)。
  // 一张图不成组,所以 count < 2 时它一律不落 —— 材料里不许出现一个说了不算数的开关。
  const imageOptions: FactoryImageOptions | null = input.kind === "image"
    ? {
        aspectRatio: input.aspectRatio ?? imageDefaults(input.model as GenModel).aspectRatio,
        ...(input.coherentSet === true && input.count >= COHERENT_SET_MIN_IMAGES ? { coherentSet: true as const } : {}),
        // CRE-STG-P1-003:与 `coherentSet` 同一条「只在有内容时出现」的纪律 —— 见
        // FactoryImageOptions 的注释:写一格空数组进去就会把库里每一条既有行判成材料不符。
        ...(input.referenceGenerationIds?.length
          ? { referenceGenerationIds: [...input.referenceGenerationIds] }
          : {}),
      }
    : null;

  return {
    prompt: input.prompt,
    model: input.model,
    kind: input.kind === "video" ? "VIDEO" : "IMAGE",
    count: input.kind === "video" ? 1 : input.count,
    entityIds: input.entityIds ?? [],
    // #785 判官 r2 P1-b —— 视频的变体选择不再在这里被抹掉。
    //
    // 当初(#280)把它置 null 是有理由的,而那个理由现在不成立了:那时的视频只有 i2v 一条路,
    // 条件全在首帧里,@元素的参考照一张都不进引擎,所以「选了哪个变体」对视频确实没有意义。
    // #785 之后它们真的进引擎 —— 卡面按商家选的变体数照片(`countLiveReferenceImagesPerEntity`
    // 读 `variantSel`),而 worker 拿到的却是 null、于是回落去查 base 照片。两边看的不是同一
    // 组图:卡上写「用你 2 张」,付费请求实发的是另外 5 张 base ——「说的」与「做的」分家,
    // 而且商家为一个他没选的形态付了钱。
    //
    // 现在两种 kind 走同一条规范化:空映射仍然收敛成 null(与 worker 的 `job.variantSel ?? {}`
    // 同义),非空的原样留下,落进 GenJob.variantSel,worker 按它解析照片。
    variantSel: canonicalVariantSel(input.variantSel),
    sourceGenerationId: input.sourceGenerationId ?? null,
    tailGenerationId: input.tailGenerationId ?? null,
    referenceVideoGenerationId: input.referenceVideoGenerationId ?? null,
    shotId: input.shotId ?? null,
    threadId: input.threadId ?? null,
    videoOptions,
    imageOptions,
  };
}

/**
 * The EXACT column set `factoryMaterialMatches` reads, as one Prisma projection.
 *
 * 它住在比对器旁边,是因为两者必须同生共死:投影漏掉哪一列,Prisma 结果里那一列就
 * **根本不存在**,比对器只能按缺省解释它 —— 于是「同一个请求」被判成「不同内容」,
 * 商家的重试被永久拒绝(方向安全,但功能坏掉)。#642 修复轮 r1 P1 就是这么发生的:
 * 这份清单当时有两份手抄副本(startGen 一份、工厂批量一份),新增的规格列只补进了一份。
 *
 * 一份清单,两个读者。加一列只需要改这里一处。
 */
export const FACTORY_HISTORY_SELECT = {
  id: true,
  status: true,
  idempotencyKey: true,
  prompt: true,
  model: true,
  kind: true,
  count: true,
  entityIds: true,
  variantSel: true,
  sourceGenerationId: true,
  tailGenerationId: true,
  referenceVideoGenerationId: true,
  shotId: true,
  threadId: true,
  videoOptions: true,
  imageOptions: true,
} as const;

/** A history row read through FACTORY_HISTORY_SELECT. */
export type FactoryHistoryRow = StoredFactoryMaterial & {
  id: string;
  status: string;
  idempotencyKey: string | null;
};

/** #642 legacy equivalence. An IMAGE row enqueued before the shape column existed carries
 *  null — and those runs really did produce the default square, so null and an explicit
 *  default shape are the SAME material. Without this, every pre-migration attempt replay
 *  would read as a material conflict (an idempotency regression, not a shape change). */
function canonicalImageOptions(value: unknown, kind: "IMAGE" | "VIDEO"): unknown {
  if (kind !== "IMAGE") return null;
  if (value == null) return { aspectRatio: imageDefaults("seedream").aspectRatio };
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 资产详情面板 / 模板弹窗那一族付费动作的服务端动作名。见 `assetActionKey`。 */
export const ASSET_ACTION_OPS = ["regen", "animate", "edit", "template"] as const;
export type AssetActionOp = (typeof ASSET_ACTION_OPS)[number];

export interface AssetActionKey {
  key: string;
}

/**
 * 保留的、**服务端自己算**的资产动作身份 —— 与 `canvasActionKey` 同一条纪律,只是
 * 身份的来源不同:画布那边是浏览器给一个稳定的逻辑 actionId,这边一个字都不问浏览器,
 * 直接从「商家这一次想要的东西」本身算出来。
 *
 * 为什么必须这样:详情面板过去自己出键 —— `regen-<genId>-<Date.now()>`。时间戳意味着
 * **同一个意图的两次提交拿到两个不同的键**:刷新一次、开第二个标签页、双击一次,服务端
 * 与数据库的去重(GenJob_active_idempotency_key)都看不见那是同一次重放,于是第二次
 * reserveCredits 照跑 —— 商家为同一件东西付两次钱。挡在中间的只有 React 的一个 ref,
 * 它随页面一起消失。
 *
 * 摘要覆盖的正是「换了它就是另一个动作」的那些东西:动作类型、这一次锚在哪一张图上,
 * 以及整个付费请求体(提示词、模型、张数、@元素、形状/时长/清晰度…)。`genRequest`
 * 是 `.strict()` 的,所以能走到这里的请求体只可能由已知字段组成 —— 调用方塞不进一个
 * 只为了变键的垃圾字段。价格不进摘要:调价不改变商家想要的东西(它自有一道重核闸)。
 *
 * 键长固定 `asset:` + op + `:` + 64 位十六进制 ≤ 79,在 genRequest 的 80 字符上限内。
 */
export function assetActionKey(
  op: AssetActionOp,
  anchorGenerationId: string,
  request: unknown,
): AssetActionKey {
  const digest = createHash("sha256")
    .update("asset-action-v1")
    .update("\0")
    .update(`${op.length}:${op}`)
    .update("\0")
    .update(`${anchorGenerationId.length}:${anchorGenerationId}`)
    .update("\0")
    .update(canonicalJson(request))
    .digest("hex");
  return { key: `asset:${op}:${digest}` };
}

/** 只认这一族保留键。`startGen` 拒收调用方自带的成员;只有 `startAssetGen` 能算出一个。 */
export function parseAssetActionKey(key: string): AssetActionKey | null {
  return ASSET_KEY_RE.test(key) ? { key } : null;
}

/**
 * 一个逻辑格**这一趟会不会被收钱**,只判一次(#708)。
 *
 *   - `conflict` —— 历史里有材料对不上的行:这一格根本不会被受理,收 0;
 *   - `reused` —— 历史里有一单还没「结束且什么都没交付」:复用那一单,收 0;
 *   - `fresh` —— 没有历史,或历史全都结束且没交付:这一趟真会新建 + 预扣,收全价。
 *
 * 为什么必须只有一份:报价与派发原本各判各的 —— 派发这边知道「已经生成过的条目不再收费」,
 * 报价那边不知道,于是确认卡把一笔实收 1 credit 的动作报成 12 credits,并拿这个数去比
 * 余额、去禁用按钮,把商家挡在一笔他其实付得起的动作外面(#708)。判据抄成两份,
 * 「说的」与「做的」就一定会分家。
 *
 * 纯函数:只读历史行,不写库、不动钱。它**不是**预扣授权 —— startGen 在项目锁里重判一次,
 * 那一次才算数;这里的结果只用于「花钱之前如实告诉商家会扣多少」。
 */
export type FactoryDisposition = "fresh" | "reused" | "conflict";

/**
 * 「还有一单没结束、也没交付」的那一行 —— **复用判据唯一的一处定义**。
 *
 * 复用的意思只有一个:那一单还活着,所以这一趟不再新建、不再收钱。它**不代表做完了**
 * —— QUEUED / GENERATING 的片子还在跑(#708 修复轮 P2-1)。谁想知道「做完没有」,读
 * 这一行的 `status`,不要另写一套判据。
 */
function stillLivePrior(history: readonly FactoryHistoryRow[]): FactoryHistoryRow | null {
  return history.find((prior) => !genJobEndedWithoutDelivering(prior.status)) ?? null;
}

export function factoryHistoryDisposition(
  history: readonly FactoryHistoryRow[],
  expected: FactoryMaterial,
): FactoryDisposition {
  if (history.some((prior) => !factoryMaterialMatches(prior, expected))) return "conflict";
  if (stillLivePrior(history)) return "reused";
  return "fresh";
}

/**
 * `factoryHistoryDisposition` 判成 `reused` 时,**被复用的就是这一行**(#708 修复轮 P2-1)。
 *
 * 同一个判据的两种问法:上面那个答「收不收钱」,这个答「收不了钱是因为哪一单」。所以卡面
 * 想说「已经做好了」还是「还在做」,读的是同一份历史、同一条判据 —— 不可能与收费口径分家。
 * 材料对不上(conflict)时没有可复用的那一单,返回 null。PURE。
 */
export function factoryReusedPrior(
  history: readonly FactoryHistoryRow[],
  expected: FactoryMaterial,
): FactoryHistoryRow | null {
  if (history.some((prior) => !factoryMaterialMatches(prior, expected))) return null;
  return stillLivePrior(history);
}

/** Full material binding. FAILED rows are deliberately not special: status never weakens content
 *  identity. entityIds are order-sensitive and preserve duplicates because the worker consumes
 *  them in order; JSON object key order is irrelevant. */
export function factoryMaterialMatches(prior: StoredFactoryMaterial, expected: FactoryMaterial): boolean {
  if (typeof prior.id !== "string" || prior.id.length === 0) return false;
  return (
    prior.prompt === expected.prompt &&
    prior.model === expected.model &&
    prior.kind === expected.kind &&
    prior.count === expected.count &&
    canonicalJson(prior.entityIds) === canonicalJson(expected.entityIds) &&
    canonicalJson(canonicalVariantSel(prior.variantSel)) === canonicalJson(canonicalVariantSel(expected.variantSel)) &&
    prior.sourceGenerationId === expected.sourceGenerationId &&
    prior.tailGenerationId === expected.tailGenerationId &&
    prior.referenceVideoGenerationId === expected.referenceVideoGenerationId &&
    prior.shotId === expected.shotId &&
    (prior.threadId ?? null) === expected.threadId &&
    canonicalJson(canvasMaterialWithoutRepair(prior.videoOptions, prior.id)) ===
      canonicalJson(canvasMaterialWithoutRepair(expected.videoOptions, prior.id)) &&
    // kind equality is asserted above, so both sides canonicalize under the same kind.
    canonicalJson(canonicalImageOptions(prior.imageOptions, expected.kind)) ===
      canonicalJson(canonicalImageOptions(expected.imageOptions, expected.kind))
  );
}
