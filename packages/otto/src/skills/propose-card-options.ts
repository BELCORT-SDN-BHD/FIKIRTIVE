/**
 * propose-card-options —— 确认卡上那三格（张数／形状／精修）的**唯一**一份口径。
 *
 * Founder 2026-09-05 裁决「加进确认卡」：⑦段把画布上那个直出 composer 退役之后，张数、
 * 形状、精修三格在商家那一侧无处可选 —— 唯一的花钱入口是 Otto 的确认卡，而那张卡从前
 * 只能整张接受或整张丢掉。这个文件就是「商家批准前可改」那一句话的实现。
 *
 * ── 为什么改在**服务端重铸卡**，而不是在卡面上算一个新价 ──────────────────────
 * 卡是钱路的单一权威：`startCoworkGen` 从**持久化的卡**读 `estimatedCredits` 当作
 * `expectedCredits`，再拿 `pricedGenCredits` 现算一次比对，对不上就在 create/reserve
 * **之前**拒。所以只要「卡面报价」与「预扣」都只从卡来，两者就不可能分家。
 * 界面自己乘一个数出来当报价则相反：那是第二处派生，而第二处派生正是「说的」与
 * 「做的」失同步的来源（#580）。这里因此只做一件事 —— 把三格意愿变成一张**新的、
 * 完整的、服务端算过价的卡**，界面拿回去照渲染。
 *
 * 纯函数：不碰 prisma、不碰 SDK、不花钱。落库与归属由 `apps/web/lib/otto-actions.ts`
 * 那个 Server Action 负责（它先按 owner 作用域读卡、再确认这张卡还没有任务行）。
 */
import {
  DEFAULT_IMAGE_MODEL,
  PRO_IMAGE_MODEL,
  GEN_IMAGE_MODEL_OPTIONS,
  MAX_GEN_COUNT,
  buildSpecChips,
  displayCredits,
  genImageCostUsd,
  imageAspectHonoured,
  imageDefaults,
  isSellableImageSku,
  pricedGenCredits,
  type GenModel,
} from "@fikirtive/core";
import type { CardPayload } from "./propose.helpers.js";

/**
 * 三格控件的**菜单**，服务端唯一一次派生，界面一格都不写死。
 *
 * 缺席（老卡、视频卡）⇒ 界面一格都不渲染：一张说不出自己能改什么的卡，不该让商家
 * 在上面猜。
 */
export type CardOptions = {
  /** 张数上限。视频恒为 1（一条片子不成组），所以视频卡根本不带这份菜单。 */
  maxCount: number;
  /**
   * 形状菜单 —— **当前这一档**那一份（精修档的像素上限更低，菜单更窄）。
   *
   * 空数组 ⇒ 这一趟真正会跑的适配器根本不采纳画幅（`imageAspectHonoured` 说了不算数），
   * 于是形状那一格不出现：一个按下去不会兑现的控件比没有这个控件更糟。
   */
  aspectRatios: string[];
  /**
   * 精修那一格今天卖不卖得动。
   *
   * false ⇒ 卡上不出现这一格（Creation 规格里「未定价的 pro SKU ⇒ 拒绝、$0」那条验收
   * 的商家侧读法）：菜单上摆一格没有价的能力，商家点了才被拒，那是把 fail closed 做成
   * 了陷阱。判据是 `isSellableImageSku`，与付费闸同一个函数。
   */
  fineDetailAvailable: boolean;
};

/** 商家在卡上改的那几格。缺席 = 这一格不动。 */
export type CardOptionEdit = {
  count?: number;
  aspectRatio?: string;
  fineDetail?: boolean;
};

/** 改不动时的回答：一句给商家看的话，**零写入**。 */
export type CardOptionResult =
  | { ok: true; payload: CardPayload }
  | { ok: false; error: string };

/** 这张卡当前落在哪一档 —— 判据只有卡上的 `model` 那一格（付费请求带走的就是它）。 */
function imageTierOf(model: string): "pro" | "default" | null {
  if (model === PRO_IMAGE_MODEL) return "pro";
  if (model === DEFAULT_IMAGE_MODEL) return "default";
  return null;
}

/**
 * 一张图片卡的三格菜单。**铸卡侧与改档侧共用这一个函数**，所以卡上写着「可以选这几个
 * 形状」与真正收得下的那几个形状不可能分家。
 */
export function cardOptionMenu(model: string): CardOptions | null {
  const opts = GEN_IMAGE_MODEL_OPTIONS[model as GenModel];
  if (!opts) return null;
  return {
    maxCount: Math.min(opts.maxCount, MAX_GEN_COUNT),
    aspectRatios: imageAspectHonoured() ? [...opts.aspectRatios] : [],
    fineDetailAvailable: isSellableImageSku(PRO_IMAGE_MODEL),
  };
}

/**
 * 把商家在卡上改的三格，变成一张**重新算过价**的卡。
 *
 * 三条纪律，与铸卡侧逐字同一条：
 *  ① **价只有一个来源** —— `pricedGenCredits`，也就是 `startGen` 预扣时用的那个函数。
 *     这里绝不在旧价上乘一个数：那是第二份价目。
 *  ② **要么原样落到卡上，要么整张不改** —— 商家点的形状这一档给不了、精修今天没有价，
 *     一律如实拒绝（$0，卡一个字节都不动），绝不静默换一格。
 *  ③ **规格条目重算，不手工补一格** —— 与 `withVideoReferenceChip` 同一条做法：拿同一个
 *     `buildSpecChips` 重跑一遍，`EXECUTED_SPEC` 那道闸因此照旧管得到卡面每一句话。
 */
export function applyCardOptions(payload: CardPayload, edit: CardOptionEdit): CardOptionResult {
  if (payload.kind !== "image") {
    return {
      ok: false,
      error: "This one's settings can't be changed here — tell me what you'd like instead and I'll set it up.",
    };
  }
  const currentTier = imageTierOf(payload.model);
  if (currentTier === null) {
    return {
      ok: false,
      error: "I can't change this card any more — ask me to put it together again and I'll make a fresh one.",
    };
  }

  // 档位:先定它,因为形状菜单与价都跟着它走。
  const wantFineDetail = typeof edit.fineDetail === "boolean" ? edit.fineDetail : currentTier === "pro";
  if (wantFineDetail && !isSellableImageSku(PRO_IMAGE_MODEL)) {
    return { ok: false, error: "Fine detail isn't available right now — I can make this one without it." };
  }
  const model: GenModel = wantFineDetail ? PRO_IMAGE_MODEL : DEFAULT_IMAGE_MODEL;
  const menu = GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios;
  const honoured = imageAspectHonoured();

  // 形状:商家点了就用他点的那一格;没点就沿用卡上那一格。两种情况都必须落在这一档的
  // 菜单上 —— 落不上就是「批 A 做 B」,所以拒绝,而不是替他换一格。
  if (edit.aspectRatio !== undefined && !honoured) {
    return { ok: false, error: "I can't set the shape on this one — it'll come out square." };
  }
  const wantAspect = honoured
    ? edit.aspectRatio ?? payload.params.aspectRatio ?? imageDefaults(model).aspectRatio
    : payload.params.aspectRatio;
  if (honoured && !menu.includes(wantAspect ?? "")) {
    return {
      ok: false,
      error: wantFineDetail
        ? `Fine detail can't do ${wantAspect} — it can do ${menu.join(", ")}. Pick one of those and I'll set it up.`
        : `${wantAspect} isn't a shape I can make here — I can do ${menu.join(", ")}.`,
    };
  }

  // 张数:与铸卡侧 Step 3.5 同一个夹取式(付费 schema 的上限在预扣前再核一次)。
  const rawCount = typeof edit.count === "number" ? edit.count : payload.params.count;
  if (!Number.isFinite(rawCount)) {
    return { ok: false, error: "That number of images isn't something I can do." };
  }
  const count = Math.min(Math.max(Math.trunc(rawCount), 1), Math.min(GEN_IMAGE_MODEL_OPTIONS[model].maxCount, MAX_GEN_COUNT));

  const params = { ...payload.params, ...(wantAspect ? { aspectRatio: wantAspect } : {}), count };
  const estimatedCredits = displayCredits(
    pricedGenCredits({ kind: "IMAGE", model, count, videoOptions: null }),
  );

  // `fineDetail` 显式重写(不靠展开继承):关掉精修的那一次,旧卡上那一格必须真的消失,
  // 否则卡说「不精修」而 payload 里还写着 true。
  const { fineDetail: _previous, ...rest } = payload;
  return {
    ok: true,
    payload: {
      ...rest,
      model,
      params,
      // 与铸卡侧同一个 builder、同一组入参形状:图片卡的 `hasSourceImage` 永远是 false
      // (那一格是 i2v 的概念),`usesAttachedImage` 就是「这张卡带着编辑底图」。
      specChips: buildSpecChips("image", params, false, !!payload.sourceGenerationId, {
        elementReferenceCount: 0,
        hasStartFrame: false,
      }),
      // 记账用的引擎成本(record-only,不是报价 —— 报价是下面那个 `estimatedCredits`)。
      // **按这一档自己的钉点取**:精修档跑的是 pro,成本钉点也就该是 pro 那一条。写死 lite
      // 基数会让将来的毛利核算读到一个偏低的数(复审 r1 P2-2)。
      estimatedPriceUsd: genImageCostUsd(model) * count,
      estimatedCredits,
      ...(wantFineDetail ? { fineDetail: true as const } : {}),
      options: cardOptionMenu(model) ?? payload.options,
    },
  };
}
