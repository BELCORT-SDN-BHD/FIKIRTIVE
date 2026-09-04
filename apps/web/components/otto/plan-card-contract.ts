/**
 * plan-card-contract —— GEN_CARD 在前端的**唯一**契约层。
 *
 * 根因(#580 复审 r2 P1-1/P1-3):同一张卡的价格,过去在三处各判一次 ——
 * OttoPlanCard 的渲染门、OttoPlanCard 的 approve()、PackCard/pack-credit-math 的整包总价;
 * 而且三处都垫了一层「没有 credits 就拿记账用的 USD 除以 0.1 猜一个」。于是一张服务端
 * 从未报过价的卡,会被猜出一个数字、配上批准按钮送去花钱。
 *
 * 这里把它收敛成两件东西,谁要用价格都只能走这一条路:
 *   - `parsePlanCardPayload` —— DTO 边界上的运行时解析(畸形字段显式记账,不静默糊过去);
 *   - `guaranteedCredits`    —— 价格担保谓词。担保不住 = 没有价格,没有价格 = 不许批准。
 *
 * 纯展示层:这里不预扣、不结算、不调 provider。真正的扣费口径在 startGen
 * (`pricedGenCredits`),卡面显示的 `estimatedCredits` 就是服务端按那同一口径写死在
 * 卡上的数字 —— 所以这里只负责「这个数字担保得住吗」,永远不自己算钱。
 */
// The authoritative card contract, straight from the server package. Type-only, so it
// is erased at build time and drags no server code into the client bundle.
import type { CardPayload as ServerCardPayload } from "@fikirtive/otto";
// #774:审批身份的解析口径,与付费请求、worker 共用同一个纯函数。走**子路径**而不是包
// 根:`@fikirtive/core` 的桶文件带出 `node:crypto`(hash.ts),那会被拖进客户端包。
import { parseApprovedEntities, cardReferenceRoleOf } from "@fikirtive/core/reference-budget";

/**
 * The GEN_CARD payload as the card reads it — **derived from the server contract, not
 * re-declared beside it** (#580 复审 r1 P1-1: a hand-kept copy plus an `as` cast let a
 * drifting contract and a malformed payload both sail past tsc and the tests).
 *
 * Every field is optional because a durable card written before a field existed must
 * still render — but the field NAMES and their TYPES come from `CardPayload` itself,
 * so the two cannot drift apart.
 */
export type OttoPlanCardPayload = Partial<ServerCardPayload>;

/** A durable payload after runtime parsing at the DTO boundary. */
export interface ParsedPlanCardPayload {
  value: OttoPlanCardPayload;
  /** Contract fields this card carried with the WRONG type — dropped rather than
   *  rendered, and surfaced on the card. A silent drop is what #580 is about. */
  malformedFields: string[];
}

function str(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * 媒体参考回执的解析口径 —— 一份,在这里(Codex QA-CRE-FE9-013)。
 *
 * 只收**每一格都读得懂**的那几条:身份(generationId)、类型、给人看的名字、来源画布。
 * 少一格就整条丢掉,于是 `parsePlanCardPayload` 上面那句「解出来的条数必须等于原条数」
 * 会把这张卡记成畸形 —— 一条读不全的回执绝不能装成一条完整的回执。
 */
function parseMediaReferences(raw: unknown): NonNullable<OttoPlanCardPayload["mediaReferences"]> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const e = entry as Record<string, unknown>;
    if (!str(e.generationId) || !str(e.label) || !str(e.sourceProjectId) || !str(e.sourceProjectName)) return [];
    if (!str(e.previewUrl)) return [];
    if (e.kind !== "image" && e.kind !== "video") return [];
    if (typeof e.sameCanvas !== "boolean") return [];
    // Codex staging CRE-STG-P1-003 —— 角色是**这条修改之后**铸的卡才有的一格。老卡(在它
    // 存在之前铸的)缺席就退回 `reference`:少一个精确的标签是安全的降级,而把整条回执丢掉
    // 会让一张本来说得清楚的老卡突然不可批准 —— 那是拿商家的钱赔我们的迁移。
    // 值只认闭集里的那几个:陌生词同样退回 `reference`,绝不原样渲染进卡面。
    const role = cardReferenceRoleOf(e.role);
    return [{
      generationId: e.generationId,
      kind: e.kind,
      label: e.label,
      sourceProjectId: e.sourceProjectId,
      sourceProjectName: e.sourceProjectName,
      sameCanvas: e.sameCanvas,
      previewUrl: e.previewUrl,
      role,
    }];
  });
}
function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse an unknown durable payload into the card's view of it — the runtime half of
 * the type alignment. The static type says what the server MAY send; this says what
 * this particular durable row ACTUALLY carries. Anything typed wrong is dropped into
 * `malformedFields` so the card can disclose it, never silently rendered.
 *
 * Returns null when the payload isn't an object at all — there is no plan to show.
 */
export function parsePlanCardPayload(raw: unknown): ParsedPlanCardPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const value: OttoPlanCardPayload = {};
  const malformedFields: string[] = [];

  /** Take `key` only when the durable value passes `ok`; otherwise record it. */
  function take<K extends keyof OttoPlanCardPayload>(
    key: K,
    ok: (v: unknown) => boolean,
    read: (v: unknown) => OttoPlanCardPayload[K],
  ): void {
    const v = p[key as string];
    if (v === undefined || v === null) return;
    if (!ok(v)) {
      malformedFields.push(key as string);
      return;
    }
    value[key] = read(v);
  }

  take("kind", (v) => v === "image" || v === "video", (v) => v as "image" | "video");
  take("model", str, (v) => v as string);
  take("reason", str, (v) => v as string);
  take("structuredPrompt", str, (v) => v as string);
  take("goal", str, (v) => v as string);
  take("sourceGenerationId", str, (v) => v as string);
  // Codex staging CRE-STG-P1-003 —— 第一张之外的挂图。与 entityIds 同一条解析纪律:
  // 不是「每一项都是字符串的数组」就是畸形,记账、披露、不许批准。
  take("referenceGenerationIds", (v) => Array.isArray(v) && v.length > 0 && v.every(str), (v) => v as string[]);
  take("referenceVideoGenerationId", str, (v) => v as string);
  take("downgradeNote", str, (v) => v as string);
  take("downgraded", (v) => typeof v === "boolean", (v) => v as boolean);
  take("estimatedPriceUsd", num, (v) => v as number);
  take("estimatedCredits", num, (v) => v as number);
  take("entityIds", (v) => Array.isArray(v) && v.every(str), (v) => v as string[]);
  // #774 判官 r2 P1 —— 引擎认人那几句机器指令里的名字,商家必须在花钱之前看得见。
  // 解析口径不在这里重写:`parseApprovedEntities` 是唯一那一份(卡面、付费请求、worker
  // 共用),这里只判「这张卡到底带没带一份读得懂的快照」。带了但一条都读不懂 = 畸形,
  // 记进 malformedFields —— 与其它字段同一条纪律,不静默糊过去。
  take(
    "approvedEntities",
    (v) => Array.isArray(v) && v.length > 0 && parseApprovedEntities(v).length === v.length,
    (v) => parseApprovedEntities(v),
  );
  // Codex QA-CRE-FE9-013 —— 媒体参考的审批回执。与 approvedEntities 同一条纪律:带了但读不
  // 懂 = 畸形,记账、披露、不许批准;一条都不带就是老卡的形状(下面 planCardGate 另有一问)。
  take(
    "mediaReferences",
    (v) => Array.isArray(v) && v.length > 0 && parseMediaReferences(v).length === v.length,
    (v) => parseMediaReferences(v),
  );
  take(
    "variantSel",
    (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(str),
    (v) => v as Record<string, string>,
  );
  // The spec line the merchant reads. Built ONCE, server-side, from what execution
  // really honours — the card renders it verbatim and derives no spec of its own.
  take("specChips", (v) => Array.isArray(v) && v.every(str), (v) => v as string[]);
  take(
    "params",
    (v) => !!v && typeof v === "object" && !Array.isArray(v),
    (v) => {
      const q = v as Record<string, unknown>;
      return {
        ...(str(q.aspectRatio) ? { aspectRatio: q.aspectRatio } : {}),
        ...(str(q.resolution) ? { resolution: q.resolution } : {}),
        ...(num(q.durationSeconds) ? { durationSeconds: q.durationSeconds } : {}),
        ...(typeof q.audio === "boolean" ? { audio: q.audio } : {}),
        count: num(q.count) ? q.count : 1,
      };
    },
  );
  take(
    "videoStep",
    (v) => !!v && typeof v === "object" && num((v as Record<string, unknown>).estimatedCredits),
    (v) => ({ estimatedCredits: (v as { estimatedCredits: number }).estimatedCredits }),
  );

  return { value, malformedFields };
}

/**
 * 价格担保谓词 —— 卡面显示价格、按钮允许花钱,都只认它。
 *
 * 只有服务端按扣费口径写在卡上的、**正的安全整数** credits 才算一个担保得住的价格。
 * 其它一律返回 null:
 *   - 缺失:服务端没报过价,前端也不许替它报;
 *   - 0 或负数:不存在「免费生成」,这只可能是脏数据;
 *   - 小数或超出安全整数范围:显示与扣费会对不上;
 *   - `estimatedPriceUsd`:那是记账用的 provider 成本(约为售价的 1/2.5),
 *     除以 0.1 猜出来的数字既不是报价也不是扣费额 —— 这条回退已经删除,不要重建。
 */
export function guaranteedCredits(payload: OttoPlanCardPayload): number | null {
  const credits = payload.estimatedCredits;
  return typeof credits === "number" && Number.isSafeInteger(credits) && credits > 0 ? credits : null;
}

/** 一张卡过完门之后的全部判断。渲染与批准共用这一个结果,不再各判各的。 */
export interface PlanCardGate {
  /** null ⇒ 这根本不是一个 payload,没有方案可展示。 */
  parsed: ParsedPlanCardPayload | null;
  value: OttoPlanCardPayload;
  malformedFields: string[];
  /** 担保得住的价格;null ⇒ 没有价格。 */
  credits: number | null;
  /** 读得懂,而且价格担保得住 —— 可以把它当一个方案渲染出来。 */
  readable: boolean;
  /**
   * Codex QA-CRE-FE9-013 —— 这张卡带着一件参考,却没有它的回执。
   *
   * 值是人话的参考名(`"reference image"` / `"reference video"`),空数组 = 每一件都有回执。
   * 非空 ⇒ 不可批准:卡上有一个 id 会随付费请求上路,而商家在按下按钮之前读不到它是什么。
   */
  missingReferenceReceipts: string[];
  /** 在 `readable` 之上再要求「一个字段都没读错」,且每一件参考都有回执。畸形或缺回执的卡
   *  自己都承认说不清将要用什么,不许拿去花钱(#580 复审 r2 P1-2;QA-CRE-FE9-013)。 */
  approvable: boolean;
}

/**
 * 这张卡带着 id 却没有回执的那几件参考(Codex QA-CRE-FE9-013)。
 *
 * 判据是**卡自己**的两个 id 字段:有 `sourceGenerationId` 就必须有一条 image 回执,有
 * `referenceVideoGenerationId` 就必须有一条 video 回执。老卡(在回执存在之前铸的)因此会
 * 落进这里 —— 那是有意的:一张说不清将要用哪张图的卡,重铸一张的代价是一句话,批下去的
 * 代价是一次不含指定产品的付费素材。
 */
export function missingReferenceReceipts(value: OttoPlanCardPayload): string[] {
  const receipts = value.mediaReferences ?? [];
  const missing: string[] = [];
  if (value.sourceGenerationId && !receipts.some((r) => r.generationId === value.sourceGenerationId)) {
    missing.push("reference image");
  }
  // Codex staging CRE-STG-P1-003 —— 第 2 张起的挂图同样是「一个会随付费请求上路的 id」,
  // 所以同样必须有回执。缺一条就整张卡不可批准:走查那一天商家读不到的正是这几张。
  // 一句话只说一次(缺 3 张也只写一个 "reference image"),否则卡上那句会念成绕口令。
  if (
    (value.referenceGenerationIds ?? []).some((id) => !receipts.some((r) => r.generationId === id)) &&
    !missing.includes("reference image")
  ) {
    missing.push("reference image");
  }
  if (
    value.referenceVideoGenerationId &&
    !receipts.some((r) => r.generationId === value.referenceVideoGenerationId)
  ) {
    missing.push("reference video");
  }
  return missing;
}

/** 过门。渲染门与 approve() 都调这一个函数,所以两者不可能判出不同结果。 */
export function planCardGate(raw: unknown): PlanCardGate {
  const parsed = parsePlanCardPayload(raw);
  const value = parsed?.value ?? {};
  const malformedFields = parsed?.malformedFields ?? [];
  const credits = parsed === null ? null : guaranteedCredits(value);
  const readable = parsed !== null && credits !== null;
  const missing = parsed === null ? [] : missingReferenceReceipts(value);
  return {
    parsed,
    value,
    malformedFields,
    credits,
    readable,
    missingReferenceReceipts: missing,
    approvable: readable && malformedFields.length === 0 && missing.length === 0,
  };
}
