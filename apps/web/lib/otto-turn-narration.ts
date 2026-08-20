/**
 * otto-turn-narration —— 等待时那句人话。一个纯映射:**已有的**回合阶段 → 一句短句。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.4「生成进度」、§3.5 原则 ⑤;票 #996(W2-9)。
 *
 * ## 这里只换文案,不造阶段
 *
 * 一轮对话今天已经有它自己的阶段信号,全在 `OttoStatusData`(`otto-stream-bridge.ts`)里:
 * 路由在 propose 工具被调用时发 `planning`,在这一轮收尾时发 `done` / `needs_approval` /
 * `degraded` / `stale`。除此之外没有别的阶段,而**这个文件一个新的都不加** —— 它只是把
 * 那些信号折成商家读得懂的三句话:
 *
 *   calling-model  还没有任何回信 —— 请求出去了,模型还没开口
 *   planning       propose 工具在跑 —— Otto 在把要做的东西想清楚
 *   settling       这一轮已经有结论,正在收尾(落库 / 结账 / 交回审批)
 *
 * `TURN_PHASE_OF_STATUS_KIND` 是一份 `satisfies Record<OttoStatusData["kind"], …>`:
 * 将来谁给流里加一个新的 status kind,**这里不表态就编译不过**,而不是悄悄掉进某个
 * 兜底分支里。反过来,`TURN_NARRATION` 的键集就是阶段的全集 —— 多长出第四个阶段,
 * `lib/__tests__/otto-narrow-cards.test.ts` 的枚举对账当场红。
 *
 * ## 措辞纪律
 *
 * 三句话都**不带任何量级**:不说「大概二十秒」,不说「马上就好」。同 `QUEUE_WAIT_NOTE`
 * (`progress-format.ts`)那条 #979 立下的规矩 —— 没有测量就不许出现量级,一个当场被自己
 * 推翻的估计比不给估计更伤信任。它们说的只是**此刻正在发生什么**,那件事是真的。
 */
import type { OttoStatusData } from "./otto-stream-bridge";

/** 商家眼里的三个阶段。这就是全集 —— 没有第四个。 */
export type TurnNarrationPhase = "calling-model" | "planning" | "settling";

/** 阶段全集的运行时形态(枚举对账要用)。 */
export const TURN_NARRATION_PHASES = ["calling-model", "planning", "settling"] as const;

/**
 * 每一个**已有的** `data-status` kind 落在哪个阶段。
 *
 * `satisfies` 而不是 `as`:少写一个 kind 就编译不过,所以流里新增的阶段信号不可能
 * 无声地没有说法。四个终态 kind 都是 `settling` —— 从商家的角度,它们是同一件事:
 * 这一轮已经跑完了,产品正在把结果落到位。它们各自要说的话由别的地方说
 * (degraded / stale 的原文由 `OttoChatStream` 直接渲染,needs_approval 由卡自己说)。
 */
export const TURN_PHASE_OF_STATUS_KIND = {
  planning: "planning",
  done: "settling",
  needs_approval: "settling",
  degraded: "settling",
  stale: "settling",
} as const satisfies Record<OttoStatusData["kind"], TurnNarrationPhase>;

/** 三句话,**这一份是唯一作者**。别处要说等待,引这里,不要再写一句。 */
export const TURN_NARRATION: Record<TurnNarrationPhase, string> = {
  "calling-model": "Getting started…",
  planning: "Considering the best approach…",
  settling: "Wrapping up…",
};

/** 读阶段要的全部事实。三样都是 `OttoChatStream` 今天已经拿在手上的。 */
export interface TurnNarrationInput {
  /** 这一轮在不在飞(useChat 的 submitted / streaming)。 */
  isBusy: boolean;
  /** 这一轮收到的最后一个 `data-status`,还没收到就是 null。 */
  liveStatus: OttoStatusData | null;
  /** 第一个字已经吐出来了没有 —— 吐出来了就该由真气泡说话,不再叙述。 */
  hasAssistantText?: boolean;
}

/**
 * 这一刻该叙述哪个阶段;没有可叙述的就是 null(不在飞,或者正文已经在写了)。
 *
 * 没有任何 status ⇒ `calling-model`:请求已经出去、还没有一个字回来,这是唯一说得出口
 * 的真话。注意这不是兜底猜测 —— 它就是「还没有阶段信号」这个事实本身。
 */
export function turnNarrationPhase(input: TurnNarrationInput): TurnNarrationPhase | null {
  if (!input.isBusy) return null;
  if (input.hasAssistantText) return null;
  const kind = input.liveStatus?.kind;
  if (kind) return TURN_PHASE_OF_STATUS_KIND[kind];
  return "calling-model";
}

/** 这一刻要显示的那句话,没有就是 null。 */
export function turnNarrationText(input: TurnNarrationInput): string | null {
  const phase = turnNarrationPhase(input);
  return phase === null ? null : TURN_NARRATION[phase];
}
