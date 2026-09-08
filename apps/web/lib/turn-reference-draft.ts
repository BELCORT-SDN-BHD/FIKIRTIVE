/**
 * turn-reference-draft —— 一轮消息随身带的那份**已解析引用**，纯函数，一份，三处共用。
 *
 * 规格 `docs/specs/creation-engine.md`（验收 CREATE-A2）与 `docs/specs/frontend-baseline.md`
 * （FRONT-A10 / FRONT-A12，§5 2026-09-08 行把 A12 的口径放宽为「那句话＋原引用一起放回」）。
 * 触发＝2026-09-08 staging E2E Round 1 的 FSE-002／003／004，Founder 当日裁「一片修完；
 * Send 按字面真发送」。
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────
 * 这三处从前各自决定「这一轮带着什么引用」：
 *
 *   · 确认卡的「Send to Otto」——**什么都不带**（它根本没送出去，只往输入框里塞了一段字）；
 *   · 「Edit and retry」——只带商家那句话，参考图一张都没回来；
 *   · 送出请求本身 —— 带 composer 自己那一份。
 *
 * 三处各写一遍，就有三种「这一轮到底带了什么」。走查里的后果是同一个形状：商家看着一张
 * 卡按下付款，而卡上少了他明明指过的那件东西。所以「一轮带什么引用」在这里只有一份形状
 * （`TurnReferences`）与一份到请求体的映射（`turnReferenceBody`）。
 *
 * ── 边界 ──────────────────────────────────────────────────────────────────
 * 这里**不**判断一件引用还在不在。归属与存活只有服务端那一次解析说了算
 * （`lib/reference-refs.ts` + `validateOttoTurnReferences`），取不到就整轮拒绝并说出那一句。
 * 这个文件只负责：把三处各自知道的东西整理成同一份形状，不丢、不猜、不编。
 */

/** 一轮消息带着的引用 —— 四条道，各自的语义在下面的注释里，形状只有这一份。 */
export interface TurnReferences {
  /** `@` 到的元素（演员／产品／地点／品牌标）的 `Entity.id`：这一轮的生成条件。 */
  entityIds: string[];
  /** 类型化引用的 wire 形式（`"<type>:<id>"`）——「这条消息提到了谁」，落进 `referenceRefs`。 */
  references: string[];
  /** 图片参考的 `Generation.id`。 */
  sourceGenerationIds: string[];
  /** 参考视频的 `Generation.id`。 */
  referenceVideoGenerationIds: string[];
}

/** 一份可以放回输入框、也可以直接送出去的草稿：那句话 ＋ 原引用 ＋ 它从哪来。 */
export interface TurnReferenceDraft {
  /** 商家自己打的那句话（重试）或「他写的那句 ＋ 卡的原话」（改这张卡）。 */
  text: string;
  refs: TurnReferences;
  /**
   * 商家读得懂的那几个名字。放回输入框时他必须**看得见**引用也一起回来了 —— 不然「带回来了」
   * 与「没带回来」在屏幕上长得一模一样，而这正是 FSE-004 的病灶。
   */
  labels: string[];
  /**
   * 源任务标识：这份草稿是从哪一条消息恢复出来的。它作为 `replyToMessageId` 上路（请求 schema
   * 早就有这一格），所以「这一轮是那一轮的重来／那张卡的修改」在记录里说得出来，不必新开字段。
   */
  sourceMessageId: string | null;
}

export const EMPTY_TURN_REFERENCES: TurnReferences = {
  entityIds: [],
  references: [],
  sourceGenerationIds: [],
  referenceVideoGenerationIds: [],
};

const uniq = (ids: readonly (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];

export function hasTurnReferences(refs: TurnReferences): boolean {
  return (
    refs.entityIds.length > 0 ||
    refs.references.length > 0 ||
    refs.sourceGenerationIds.length > 0 ||
    refs.referenceVideoGenerationIds.length > 0
  );
}

/** 两份合成一份（composer 自己那一份 ＋ 恢复回来的那一份）。同一件东西只上一次车。 */
export function mergeTurnReferences(a: TurnReferences, b: TurnReferences): TurnReferences {
  return {
    entityIds: uniq([...a.entityIds, ...b.entityIds]),
    references: uniq([...a.references, ...b.references]),
    sourceGenerationIds: uniq([...a.sourceGenerationIds, ...b.sourceGenerationIds]),
    referenceVideoGenerationIds: uniq([...a.referenceVideoGenerationIds, ...b.referenceVideoGenerationIds]),
  };
}

/**
 * 请求体里那几格 —— `coworkTurnRequest` 是 `.strict()` 的，所以空的一格必须**不出现**，
 * 而不是出现一个空数组。单数那两格（`sourceGenerationId` / `referenceVideoGenerationId`）
 * 与复数并存，与 `composerReferencePayload` 的口径逐字相同：老读者只认单数那一格。
 */
export function turnReferenceBody(refs: TurnReferences): Record<string, string | string[]> {
  const body: Record<string, string | string[]> = {};
  if (refs.entityIds.length) body["entityIds"] = refs.entityIds;
  if (refs.references.length) body["references"] = refs.references;
  if (refs.sourceGenerationIds.length) {
    body["sourceGenerationId"] = refs.sourceGenerationIds[0]!;
    body["sourceGenerationIds"] = refs.sourceGenerationIds;
  }
  if (refs.referenceVideoGenerationIds.length) {
    body["referenceVideoGenerationId"] = refs.referenceVideoGenerationIds[0]!;
    body["referenceVideoGenerationIds"] = refs.referenceVideoGenerationIds;
  }
  return body;
}

/**
 * composer 上那几件附件（`composerReferencePayload` 已经算好的那一份）→ 同一份形状。
 *
 * 刻意**不**在这里重算一遍「哪一件是图、哪一件是片」：那件事的作者是
 * `lib/canvas-chat-reference.ts`，抄第二份就是同一件事在仓库里有两个答案。
 */
export function turnReferencesFromComposerPayload(payload: {
  sourceGenerationIds?: string[];
  referenceVideoGenerationIds?: string[];
}): TurnReferences {
  return {
    entityIds: [],
    references: [],
    sourceGenerationIds: uniq(payload.sourceGenerationIds ?? []),
    referenceVideoGenerationIds: uniq(payload.referenceVideoGenerationIds ?? []),
  };
}

/** 一张确认卡上冻着的引用回执 —— 结构化取用，绝不 import 卡片契约（那是 UI 的事）。 */
export interface CardReferenceSource {
  approvedEntities?: { id: string; name?: string }[] | null;
  mediaReferences?: { generationId: string; kind: "image" | "video"; label?: string }[] | null;
}

/**
 * FSE-003 —— 「Send to Otto」带着**这张卡的引用**上路。
 *
 * 走查里那张表单按下去什么都没发生；就算它发了，只送一句话也会让 Otto 在没有原引用的前提下
 * 重铸一张卡 —— 与 FSE-002 同一种缺图。卡上冻着的这两格正是它当初被批准时的引用，所以
 * 「改这张卡」这一轮带的就是它们。
 */
export function turnReferencesFromCard(card: CardReferenceSource): TurnReferences {
  const media = card.mediaReferences ?? [];
  return {
    entityIds: uniq((card.approvedEntities ?? []).map((e) => e.id)),
    // 卡上没有 typed wire 形式（它冻的是 `Entity.id` 与 `Generation.id`），所以这一格是空的。
    // 编一个类型出来就是猜 —— 而 typed ref 这套东西正是为了让猜类型变得不可能。
    references: [],
    sourceGenerationIds: uniq(media.filter((m) => m.kind === "image").map((m) => m.generationId)),
    referenceVideoGenerationIds: uniq(media.filter((m) => m.kind === "video").map((m) => m.generationId)),
  };
}

/** 卡上那几件引用的名字 —— 与回执上那一行读的是同一份 label。 */
export function cardReferenceLabels(card: CardReferenceSource): string[] {
  return [
    ...(card.approvedEntities ?? []).map((e) => e.name ?? "").filter(Boolean),
    ...(card.mediaReferences ?? []).map((m) => m.label ?? "").filter(Boolean),
  ];
}

/** 一件解析过的引用在客户端的样子（`ReferenceLink` 的那几格）。 */
interface ReferenceLinkLike {
  type: string;
  id: string;
  name: string;
}

/**
 * 一条落库消息在客户端的两种样子，同一个读法。
 *
 * useChat 手上的那一份把这几格挂在 `metadata` 里（`threadToUiMessages`），而线程 DTO
 * （`thread.messages`）直接就是这几格。两种形状各写一个读法，就是同一件事有两个答案 ——
 * 所以这里两种都认，`metadata` 优先。
 */
export interface MessageReferenceSource {
  id?: string;
  references?: ReferenceLinkLike[];
  payload?: unknown;
  metadata?: {
    durableId?: string;
    references?: ReferenceLinkLike[];
    payload?: unknown;
  };
}

/**
 * FSE-004 —— 从**落库的那条 USER 消息**恢复重试草稿：那句话 ＋ 原引用 ＋ 源任务标识。
 *
 * 为什么从落库那一份恢复而不是从某个只活一瞬的 ref：走查的复现路径就是「失败 → 刷新 →
 * Edit and retry」，刷新之后客户端手上只剩这条消息。它上面两格正好齐全：`referenceRefs`
 * （服务端解析过的 typed refs，带名字，可回链）与 `payload`（这一轮真正挂上路的媒体与元素）。
 *
 * 恢复出来的每一件都会在送出时**重新**按当前 principal 解析一次。所以「已删的 / 别家的 /
 * 类型不对的」在这里不会被悄悄抹掉，而是在下一次送出时被那道闸整轮拦下并说出那一句 ——
 * 商家重新挑一件，而不是稀里糊涂地拿到一张无条件生成的卡。
 */
export function turnReferenceDraftFromMessage(
  message: MessageReferenceSource | null | undefined,
  text: string,
): TurnReferenceDraft {
  const meta = message?.metadata;
  const payload = (meta?.payload ?? message?.payload ?? null) as {
    entityIds?: unknown;
    sourceGenerationIds?: unknown;
    referenceVideoGenerationIds?: unknown;
  } | null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? uniq(value.map((v) => (typeof v === "string" ? v : null))) : [];
  const links = meta?.references ?? message?.references ?? [];
  return {
    text,
    refs: {
      entityIds: strings(payload?.entityIds),
      references: links.map((link) => `${link.type}:${link.id}`),
      sourceGenerationIds: strings(payload?.sourceGenerationIds),
      referenceVideoGenerationIds: strings(payload?.referenceVideoGenerationIds),
    },
    labels: links.map((link) => link.name).filter(Boolean),
    sourceMessageId: meta?.durableId ?? message?.id ?? null,
  };
}

/**
 * FSE-004 复修轮（判官 2026-09-08 P1-2）—— 同一轮的**两份**草稿里，带得动引用的那一份赢。
 *
 * 为什么会有两份：一轮失败时客户端手上可能有两个来源，而它们各自只在一种时刻是齐全的。
 *
 *   · 落库那条 USER 消息（`turnReferenceDraftFromMessage`）—— **刷新之后**唯一的权威：
 *     服务端解析过的 typed refs ＋ 这一轮真正挂上路的媒体，两格齐全。
 *   · 刚送出去那一份（`lastSentDraftRef`）—— **直播那一刻**唯一的权威：`sendMessage({text})`
 *     的乐观回显只有 `parts`，`metadata` 一格都没有，所以从消息里读出来的草稿是「那句话
 *     ＋ 零引用」。
 *
 * 上一版画布上那颗 Edit and retry 只读消息那一份，于是商家坐在屏幕前看着这一轮失败（没刷新）
 * 点下去，引用一件都不回来，而屏幕上一个字都不说 ——「带回来了」与「没带回来」长得一模一样，
 * 下一次送出就是一次无条件生成。那正是 FSE-004 自己定义的病灶。
 *
 * 规则只有一条，不看时序、不猜状态：**谁带得动引用谁上**。两份都带得动时落库那一份优先
 * （它经过服务端解析，名字与类型都是真的）；两份都空时也回落库那一份（刷新之后它才是权威）。
 */
export function richerTurnReferenceDraft(
  fromMessage: TurnReferenceDraft | null,
  live: TurnReferenceDraft | null,
): TurnReferenceDraft | null {
  if (fromMessage && hasTurnReferences(fromMessage.refs)) return fromMessage;
  if (live && hasTurnReferences(live.refs)) return live;
  return fromMessage ?? live;
}

/**
 * 输入框上方那一行 —— 「这些引用跟着回来了」。
 *
 * 有名字就念名字（`@` 到的那几件解析时带回了真名）；只有 id 的那几件（手动挂的附件）没有
 * 名字可念，所以只报个数 —— 编一个名字出来比不报更糟。一件都没有就一个字都不说。
 */
export function restoredReferencesNote(draft: {
  refs: TurnReferences;
  labels: string[];
}): string | null {
  const named = draft.labels.filter(Boolean);
  const total =
    draft.refs.entityIds.length +
    draft.refs.sourceGenerationIds.length +
    draft.refs.referenceVideoGenerationIds.length;
  if (named.length === 0 && total === 0) return null;
  if (named.length > 0) return `References kept: ${named.join(", ")}`;
  return total === 1 ? "1 reference kept" : `${total} references kept`;
}
