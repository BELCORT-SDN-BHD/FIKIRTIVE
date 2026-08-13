/**
 * reference-budget —— 「这一趟引擎真会收到几张参考图」的**唯一**算法。
 *
 * 为什么要有这个模块:卡面必须在**批准前**告诉商家有多少张参考照真会上车(#619 E-5),
 * 而真相住在 worker 里。两处各算各的,就是这个仓库反复重学的「说的与做的失同步」。
 * 所以这里把 worker 的选片规则抽成一个纯函数,卡面调它,worker 侧的等价测试
 * (`apps/worker/src/jobs/gen-reference-budget.test.ts`)再拿真 `handleGen` 发出去的
 * `inputImageUrls` 长度跟它逐例对表 —— 规则一旦漂移,那条测试当场红。
 *
 * **真相出处**(main @ 6b6c537c,`apps/worker/src/jobs/gen.ts`):
 *   - `:519-532` 元素参考照 round-robin,聚合上限 `MAX_CONDITIONING_IMAGES`;
 *   - `:650-659` image 分支把编辑底图 `unshift` 到第 0 位 —— **在上限之外再加一张**,
 *     所以带底图时引擎收到的是「截断后的元素图 + 1」;
 *   - `:636-644` video 分支的 `provider.generateVideo` 只吃 `imageUrl` /
 *     `tailImageUrl` / `refVideoUrl`,**根本不收** `inputImageUrls` —— 元素参考照一张
 *     都到不了视频引擎。
 *
 * 本模块不 reserve、不 settle、不定价、不调 provider:它只数数。
 */
import { MAX_CONDITIONING_IMAGES } from "./refgen.js";

export type ReferenceBudget = {
  /** 引擎这一趟**真会收到**的参考图张数(截断后的元素图 + 编辑底图)。 */
  used: number;
  /** 商家这一轮**提供**的参考照总数(元素活图 + 全部挂图)。 */
  total: number;
  /** 元素参考照被引擎上限截掉了(卡面必须在花钱前说)。 */
  truncated: boolean;
};

export type ReferenceBudgetInput = {
  kind: "image" | "video";
  /** 每个 @元素在 worker 口径下的活参考照数量,顺序 = `GenJob.entityIds` 顺序。
   *  worker 的口径:被 @ 的变体数该变体的图,否则数 base 图(`variantSel[id] ?? null`)。 */
  perEntityLiveCounts: number[];
  /** 这张卡带走了编辑底图吗(image 卡的 `sourceGenerationId`)。 */
  hasBaseImage: boolean;
  /** 商家这一轮挂进来的图片总数 —— 只有第一张会成为底图,其余只参与理解。 */
  attachedImageCount: number;
};

export function referenceBudget(input: ReferenceBudgetInput): ReferenceBudget {
  // video:元素参考照进不了 generateVideo(gen.ts:636-644),不替它编数字。
  if (input.kind !== "image") return { used: 0, total: 0, truncated: false };

  // round-robin,逐条镜像 gen.ts:521-532 —— 早到的元素带很多图时,不能把后面
  // @ 到的元素挤掉(那等于花钱做出来的东西少了一个它)。
  let taken = 0;
  for (let round = 0; taken < MAX_CONDITIONING_IMAGES; round++) {
    let progressed = false;
    for (const liveCount of input.perEntityLiveCounts) {
      if (round >= liveCount) continue;
      taken += 1;
      progressed = true;
      if (taken >= MAX_CONDITIONING_IMAGES) break;
    }
    if (!progressed) break;
  }

  const elementTotal = input.perEntityLiveCounts.reduce((sum, n) => sum + n, 0);
  // 底图是 unshift 进去的,不占元素的上限名额(gen.ts:658)。
  const base = input.hasBaseImage ? 1 : 0;
  return {
    used: taken + base,
    total: elementTotal + Math.max(input.attachedImageCount, base),
    truncated: taken < elementTotal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #774 U2 —— 参考图编号(官方句式 `Define … in <Image_N> as <Subject_N>`)
// ═══════════════════════════════════════════════════════════════════════════

/** @元素的四种类型(= `Entity.type` 枚举)。四选一,没有写入口能改它。 */
export type ReferenceSlotType = "CHARACTER" | "LOCATION" | "PRODUCT" | "BRANDMARK";

/**
 * 引擎输入数组里的**一个槽位** —— 与 `inputImageUrls` 的下标一一对应,
 * 第 i 项就是 `<Image_{i+1}>`。
 *
 * 这个类型是编号的**唯一入口**:调用方只能交出「引擎真收到的那个数组」,
 * 没有第二条路可以凭猜测编号。
 */
export type ReferenceSlot =
  | { kind: "baseImage" }
  | {
      kind: "entity";
      entityId: string;
      type: ReferenceSlotType;
      /**
       * 这个元素在**商家批准那一刻**叫什么。`null` = 这一趟没有获批的名字,于是编号句
       * 只说「第几张是谁」,一个字的自由文本都不加(见 `referenceMapLines`)。
       *
       * 为什么名字只能是快照(#774 判官 r2 P1):这一句是**给模型的指令**,而元素名是
       * 商家随时可改的自由文本 —— `updateEntity` 只 trim,不拦句号、换行或指令句。
       * 批准后改一次名,就能把没过审批的指令塞进已经批准的那次付费调用。
       */
      name: string | null;
    };

/** 元素类型 → 那个名词。给引擎的编号句与给商家看的那行披露共用这一份,不许各写各的。 */
const SLOT_NOUN: Record<ReferenceSlotType, string> = {
  CHARACTER: "person",
  LOCATION: "setting",
  PRODUCT: "product",
  BRANDMARK: "logo",
};

const SLOT_TYPES = Object.keys(SLOT_NOUN) as ReferenceSlotType[];

/**
 * 元素在**审批载荷里冻结**的身份 —— 卡上写下、随付费请求走、worker 照此认人。
 *
 * 它就是商家在卡上看到的那份映射:名字与类型都在批准前摆在他面前,批准之后谁也改不动
 * 这一份(卡的 payload 不可变)。worker 只读它,绝不在付费调用前重读活名称。
 */
export type ApprovedEntity = { id: string; type: ReferenceSlotType; name: string };

/**
 * 纯:把一段来路不明的 JSON(卡 payload / `GenJob.approvedEntities` 列)解析成审批身份表。
 *
 * 任何读不懂的条目一律**丢弃**而不是猜:丢掉的结果是那个槽位变成无名句(少一个名字),
 * 猜错的结果是给模型一条没人批准过的指令。两者不对称,所以这里只往安全那边倒。
 */
export function parseApprovedEntities(raw: unknown): ApprovedEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: ApprovedEntity[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (typeof e.name !== "string" || e.name.length === 0) continue;
    if (typeof e.type !== "string" || !SLOT_TYPES.includes(e.type as ReferenceSlotType)) continue;
    if (seen.has(e.id)) continue; // 同一个元素两份身份 = 说不清批的是哪一份
    seen.add(e.id);
    out.push({ id: e.id, type: e.type as ReferenceSlotType, name: e.name });
  }
  return out;
}

/** 纯:`id → 审批身份`。worker 认人只走这一张表。 */
export function approvedEntityMap(raw: unknown): Map<string, ApprovedEntity> {
  return new Map(parseApprovedEntities(raw).map((e) => [e.id, e]));
}

/**
 * 纯:审批时冻结的身份与**现在**的身份对不上的那些元素 id。
 *
 * 用在花钱之前那道闸(`startGen`)。商家批准的那段提示词里写的是**当时**那个名字;
 * 名字或类型后来变了,这张卡承诺的东西就不再是它会做出来的东西 —— 与既有「内容漂移 =
 * 重新批准」同一条语义,fail closed,$0。
 */
export function approvedEntityDrift(
  approved: ApprovedEntity[],
  live: { id: string; type: string; name: string }[],
): string[] {
  const byId = new Map(live.map((e) => [e.id, e]));
  return approved
    .filter((a) => {
      const now = byId.get(a.id);
      return !now || now.name !== a.name || now.type !== a.type;
    })
    .map((a) => a.id);
}

/**
 * 编号句里名字的长度上限。元素名商家最长可以取 120 字,槽位最多 11 个(10 张元素图 +
 * 编辑底图),不封顶的话这段机器加的前缀最坏能顶到 ~2KB —— 而商家自己那段提示词本来
 * 就有 `MAX_GEN_PROMPT` 的额度。编号句只是**认人**用的,名字全称照旧在商家自己那几句
 * 锁身份的话里,所以这里截断不丢信息。
 */
const SLOT_NAME_MAX = 60;
const slotName = (n: string) => (n.length > SLOT_NAME_MAX ? n.slice(0, SLOT_NAME_MAX) : n);

/**
 * 纯:把「引擎这一趟真收到的那个数组」翻成官方编号句。
 *
 * ── 为什么编号只能长在这里 ────────────────────────────────────────────────
 * 编错位比不编号更糟:模型会照着编号去认人,`<Image_2>` 一旦指的不是它以为的那张,
 * 串脸串产品就从「可能」变成「必然」,而这条错指令一路走到商家批准后的付费调用。
 *
 * 所以编号**不由**写提示词的一方推算 —— 写提示词的时候,谁有几张活参考照、商家挂没挂
 * 底图、镜头后来被改成了别的元素,统统还不知道。编号只由**真正装那个数组的那段代码**
 * 顺手产出(`apps/worker/src/jobs/gen.ts`,与 `inputImageUrls` 同一个循环),两者
 * 结构上不可能漂移。`apps/worker/src/jobs/gen-reference-budget.test.ts` 跑真的
 * `handleGen`,逐例把这些句子和真发出去的 URL 次序对表。
 *
 * 同一个元素的第二张往后的照片不再重复定义,只挂回它自己的 `<Subject_N>`。
 *
 * ── 名字从哪里来 ─────────────────────────────────────────────────────────
 * 只从审批快照来。`name` 是 `null` 时(旧任务行、或这个元素没进审批载荷)照样编号,
 * 只是不写名字 —— 编号本身是结构事实,推不出自由文本,所以这条降级不丢安全也不丢对位。
 * 类型是四选一的枚举、建好之后没有写入口,结构上写不进指令,因此它可以来自活行。
 */
export function referenceMapLines(slots: ReferenceSlot[]): string[] {
  const firstSlotOf = new Map<string, number>();
  return slots.map((slot, idx) => {
    const n = idx + 1;
    if (slot.kind === "baseImage") return `<Image_${n}> is the image being edited.`;
    const first = firstSlotOf.get(slot.entityId);
    const name = slot.name === null ? null : slotName(slot.name);
    if (first === undefined) {
      firstSlotOf.set(slot.entityId, n);
      const head = `Define the ${SLOT_NOUN[slot.type]} in <Image_${n}> as <Subject_${n}>`;
      return name === null ? `${head}.` : `${head}: ${name}.`;
    }
    const tail = `<Image_${n}> is another photo of <Subject_${first}>`;
    return name === null ? `${tail}.` : `${tail} (${name}).`;
  });
}

/** 纯:把编号句放在商家那段提示词**之前**(官方要求先定义再描述)。空槽位 → 原样返回。 */
export function withReferenceMap(prompt: string, slots: ReferenceSlot[]): string {
  const lines = referenceMapLines(slots);
  return lines.length === 0 ? prompt : `${lines.join(" ")}\n${prompt}`;
}

/**
 * 卡面那行披露 —— 商家在**花钱之前**看到「引擎会被告知这些照片是谁」。
 *
 * 它读的就是随请求走、worker 照着认人的那同一份快照,而且用同一把长度尺
 * (`slotName`),所以卡上写的名字与引擎收到的名字逐字相同 —— 卡说的不可能比做的多。
 * 空表 → `null`(没有元素就没有这行,不写一句空话)。
 */
export function approvedEntitiesNote(approved: ApprovedEntity[]): string | null {
  if (approved.length === 0) return null;
  const parts = approved.map((e) => `${slotName(e.name)} (${SLOT_NOUN[e.type]})`);
  return `Reference names sent to the engine: ${parts.join(", ")}.`;
}
