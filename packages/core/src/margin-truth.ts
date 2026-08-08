/**
 * 毛利真相表(#644 T3 记账真相修正)——「说的」与「做的」在毛利上合一的那张表。
 *
 * 一句话:**收费从收费函数来,成本从成本函数来,毛利现算**。这里没有一个手抄的数字,
 * 所以它不可能与真实链路失同步 —— 谁改了收费、谁改了成本,`margin-truth.test.ts`
 * 当场变红,逼一次毛利重审。这就是本片要的「测试即报表」。
 *
 * 两个数的身份(别混):
 *   - chargeUsd = `pricedGenCredits` / `pricedRefgenCredits` —— 商家真被扣的那一笔;
 *   - cogsUsd   = `genSpentUsd` / `refgenSpentUsd` —— 我们真付给引擎那一笔(record-only)。
 *
 * SKU id 与 CI 闸 `scripts/check-margin-floor.mjs` **逐字对齐**,两边说的是同一档。
 */
import {
  CREDITS_PER_USD,
  FLAT_PRICED_VIDEO_MODELS,
  genSpentUsd,
  pricedGenCredits,
  pricedRefgenCredits,
  refgenSpentUsd,
  type GenSpendInput,
} from "./spend.js";
import { GEN_VIDEO_MODEL_OPTIONS, type GenVideoModel } from "./gen.js";

/** 宪法 5 毛利地板:(售价 − 成本) / 售价 ≥ 45%。(docs/BLUEPRINT.md) */
export const MARGIN_FLOOR = 0.45;
/** IEEE754 容差 —— 定价可以精确压在 45.0% 上,浮点里会差最后一位。 */
export const MARGIN_FLOOR_EPSILON = 1e-9;

/**
 * 一条**待 Founder 裁决**的记录。四个字段都是必填 —— 缺任何一个,CI 闸直接红
 * (`evaluateFloorDecisions`,scripts/check-margin-floor.mjs)。裸 id 会退化成永久豁免,
 * 所以这里连「为什么」「谁在裁」「什么时候必须裁完」都是机器强制的。
 */
export type PendingFloorRuling = {
  /** 档位 id,与毛利表 / CI 闸逐字对齐。 */
  tier: string;
  /** 这一档为什么现在跌破 —— 逐档写,不许复制全局套话。 */
  reason: string;
  /** 呈报给 Founder 的那次记录(GitHub issue / PR 链接)。 */
  rulingRef: string;
  /** **到期日 YYYY-MM-DD**:过了这天还没裁,CI 闸变红。这不是缓刑,是闹钟。 */
  reviewBy: string;
};

/**
 * **跌破毛利地板、等 Founder 裁决的档位**(#644,2026-08-05)。
 *
 * 这不是豁免簿,是一张**带闹钟的待办**。名单被四头钉死,烂不掉 ——
 *   1. 真跌破却不在名单上 → 红(新的违规藏不住);
 *   2. 在名单上却已经不跌破了 → 红(定价修好后,名单必须清掉);
 *   3. 条目缺字段、日期格式不对、或指向一个根本不可售的档位 → 红;
 *   4. 过了 `reviewBy` 还在名单上 → 红(裁决被拖着不做,CI 就停下来等)。
 * 另外任何档位只要**收费 ≤ 成本**,名单一律救不了 —— 恒红。
 *
 * **现在是空的。** 上一批(#644,2026-08-05)挂着视频 720p 5s / 10s 两档 —— 记账基准从
 * 2026-06 资源包折后价($3.564/M)回到官方牌价($5.60/M)后,成本 +57% 而收费没动,毛利
 * 掉到 24.4% / 13.6%。Founder 于 2026-08-06 裁决**调价**(8→11cr、14→22cr,留档于
 * PR #655 评论),两档回到 45.0%,名单按第 2 条规则清空。
 */
export const BELOW_FLOOR_PENDING_FOUNDER_RULING: readonly PendingFloorRuling[] = [];

/** 取某一档的待裁决记录;不在名单上返回 undefined。纯函数。 */
export function pendingRulingFor(tier: string): PendingFloorRuling | undefined {
  return BELOW_FLOOR_PENDING_FOUNDER_RULING.find((p) => p.tier === tier);
}

/**
 * 一条**Founder 已裁、明示接受**的地板豁免。与上面那张「待裁决」名单是两件事:
 * 待裁决 = 还没人拍板,带闹钟催;这里 = **已经拍过板了**,裁决内容是「接受」。
 * 所以它没有 `reviewBy`(没有什么在等),取而代之的是 `ruledOn` + `source`:
 * 哪一天、由谁在哪里裁的,机器强制写全。
 */
export type AcceptedFloorException = {
  /** 档位 id,与毛利表 / CI 闸逐字对齐。 */
  tier: string;
  /** 具体是**哪几个比例**把这一档压到地板下(同档其余比例是过的)。 */
  ratios: readonly string[];
  /** 裁决当天这一档的毛利率(留档用;真值仍然是现算的,对不上会红)。 */
  margin: number;
  /** 为什么接受 —— 逐档写。 */
  reason: string;
  /** 裁决日期 YYYY-MM-DD。 */
  ruledOn: string;
  /** 裁决留档链接。 */
  source: string;
};

/**
 * **Founder 已裁接受的地板豁免**。
 *
 * 这张名单同样被两头钉死(闸里的 A1–A4 规则):跌破却不在名单上 → 红;在名单上却已经
 * 清了地板 → 红;条目缺字段或指向不存在的档位 → 红;同一档同时出现在两张名单上 → 红。
 *
 * **现在是空的。** 上一批(#645,2026-08-06,留档
 * https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/645#issuecomment-5202464378)挂着 720p 的 5 / 10 / 15 秒
 * 三档:2.2cr/秒在这三个整点上不产生进位余量(收费正好 11 / 22 / 33cr),而按**最差比例**
 * (4:3 / 3:4,927,408px)建模的成本让它们落到 44.67%,差地板 0.33 个点,Founder 明示接受。
 *
 * #769(2026-08-08)换引擎之后这三档**不再跌破**:牌价从 fast 的 $5.60/M 降到 mini 的
 * $3.50/M,同样的收费(11 / 22 / 33cr,一格没动)对上的成本变成 $0.3804 / $0.7608 /
 * $1.1411,毛利率 65.42%。缺口不是被豁免掉的,是被成本降没的 —— 按规则 2(「在名单上却
 * 已经清了地板 → 红」)这三条必须清掉,留着就是让一条不再成立的豁免继续挂在账上。
 * 清空之后全表 27 档最低毛利率 65.42%,没有任何一档需要豁免。
 */
export const BELOW_FLOOR_FOUNDER_ACCEPTED: readonly AcceptedFloorException[] = [];

/** 取某一档的已裁豁免;不在名单上返回 undefined。纯函数。 */
export function acceptedExceptionFor(tier: string): AcceptedFloorException | undefined {
  return BELOW_FLOOR_FOUNDER_ACCEPTED.find((e) => e.tier === tier);
}

export type MarginRow = {
  /** 与 CI 闸对齐的档位 id。 */
  id: string;
  /** 人话档位名(报表用)。 */
  label: string;
  /** 商家付的钱(USD)。 */
  chargeUsd: number;
  /** 我们付给引擎的钱(USD,record-only)。 */
  cogsUsd: number;
  /** 毛利额(USD)。 */
  grossUsd: number;
  /** 毛利率 = grossUsd / chargeUsd。 */
  margin: number;
  /** 是否清过 45% 地板。 */
  clearsFloor: boolean;
};

/** 纯计算:一档的收费 + 成本 → 毛利行。 */
export function marginRow(id: string, label: string, chargeUsd: number, cogsUsd: number): MarginRow {
  const grossUsd = chargeUsd - cogsUsd;
  const margin = grossUsd / chargeUsd;
  return { id, label, chargeUsd, cogsUsd, grossUsd, margin, clearsFloor: margin >= MARGIN_FLOOR - MARGIN_FLOOR_EPSILON };
}

const videoJob = (seconds: number, resolution: string): GenSpendInput => ({
  kind: "VIDEO",
  model: "seedance-2-mini",
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

type MarginSku = { id: string; label: string; charge: () => number; cogs: () => number };

/**
 * 现役可售视频档 = **从能力表现枚举**(#645 T4),不是手抄清单。
 *
 * 为什么改成枚举:扩容后是 2 分辨率 × 12 时长 = 24 档。手抄一份就等于把菜单抄了第二遍,
 * 而这个仓库反复栽在「说的」与「做的」是两份副本上 —— 菜单加一档、报表忘一档,毛利闸
 * 就再也看不见那一档。现在菜单是唯一来源:加一档,报表当场多一行,CI 闸当场要它的成本
 * 输入(没有就红)。
 */
function sellableVideoSkus(): MarginSku[] {
  const out: MarginSku[] = [];
  for (const model of FLAT_PRICED_VIDEO_MODELS) {
    const o = GEN_VIDEO_MODEL_OPTIONS[model as GenVideoModel];
    if (!o) continue;
    const resolutions = o.resolutions.length ? o.resolutions : [""];
    for (const seconds of o.durations) {
      for (const resolution of resolutions) {
        const job = { kind: "VIDEO" as const, model, count: 1, videoOptions: { seconds, resolution, audio: true } };
        out.push({
          id: `video:${model}:${seconds}:${resolution}`,
          label: `视频 ${resolution || "默认档"} ${seconds} 秒`,
          charge: () => pricedGenCredits(job) / CREDITS_PER_USD,
          cogs: () => genSpentUsd(job),
        });
      }
    }
  }
  return out;
}

/**
 * 报表覆盖的档位。**现役可售的每一档都在这里**:图片、参考图,现役视频模型的
 * 全部时长 × 分辨率(#645 T4 起 24 档),以及整段参考视频。
 * (视频任务恒 count=1 —— gen-actions 强制。)
 */
export const MARGIN_TRUTH_SKUS: readonly MarginSku[] = [
  {
    id: "image:seedream",
    label: "图片 ×1",
    charge: () => pricedGenCredits({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }) / CREDITS_PER_USD,
    cogs: () => genSpentUsd({ kind: "IMAGE", model: "seedream", count: 1, videoOptions: null }),
  },
  {
    id: "refgen:seedream",
    label: "参考图 ×1",
    charge: () => pricedRefgenCredits({ model: "seedream", count: 1 }) / CREDITS_PER_USD,
    cogs: () => refgenSpentUsd({ model: "seedream", count: 1 }),
  },
  ...sellableVideoSkus(),
  {
    id: "video:seedance-2-mini:ref",
    label: "整段参考视频(6 秒参考上限 + 5 秒出片)",
    charge: () => pricedGenCredits({ ...videoJob(5, "720p"), referenceVideoGenerationId: "ref" }) / CREDITS_PER_USD,
    cogs: () => genSpentUsd({ ...videoJob(5, "720p"), referenceVideoGenerationId: "ref" }),
  },
];

/** 现算整张毛利真相表。 */
export function marginTruthTable(): MarginRow[] {
  return MARGIN_TRUTH_SKUS.map((s) => marginRow(s.id, s.label, s.charge(), s.cogs()));
}

/** 把毛利表排成人看的文本(测试跑起来会打印它 —— 报表就是这个)。 */
export function formatMarginTruthTable(rows: readonly MarginRow[]): string {
  const usd = (n: number) => `$${n.toFixed(4)}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const width = Math.max(...rows.map((r) => [...r.label].length));
  const lines = rows.map(
    (r) =>
      `  ${r.clearsFloor ? "OK " : "地板 ↓"} ${r.label.padEnd(width)}  收费 ${usd(r.chargeUsd)}  成本 ${usd(r.cogsUsd)}  毛利 ${usd(r.grossUsd)}  毛利率 ${pct(r.margin)}`,
  );
  return [`毛利真相表(#644,地板 ${pct(MARGIN_FLOOR)})`, ...lines].join("\n");
}
