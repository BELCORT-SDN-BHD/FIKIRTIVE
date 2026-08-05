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
  genSpentUsd,
  pricedGenCredits,
  pricedRefgenCredits,
  refgenSpentUsd,
  type GenSpendInput,
} from "./spend.js";

/** 宪法 5 毛利地板:(售价 − 成本) / 售价 ≥ 45%。(docs/BLUEPRINT.md) */
export const MARGIN_FLOOR = 0.45;
/** IEEE754 容差 —— 定价可以精确压在 45.0% 上,浮点里会差最后一位。 */
export const MARGIN_FLOOR_EPSILON = 1e-9;

/**
 * **跌破毛利地板、等 Founder 裁决的档位**(#644,2026-08-05)。
 *
 * 这不是豁免簿,是一张**待办**:名单上的每一档现在都在亏毛利底线,等 Founder 裁
 * 「调价」还是「接受」。名单被两头钉死,烂不掉 ——
 *   1. 真跌破却不在名单上 → 测试红(新的违规藏不住);
 *   2. 在名单上却已经不跌破了 → 测试红(定价修好后,名单必须清掉)。
 *
 * 为什么会跌破:记账基准从 2026-06 资源包折后价($3.564/M)回到官方牌价($5.60/M),
 * 视频成本 +57%,而收费一格没动(本片 record-only)。详见 PR「毛利真相表」章节。
 */
export const BELOW_FLOOR_PENDING_FOUNDER_RULING: ReadonlySet<string> = new Set([
  "video:seedance-2-fast:5:720p",
  "video:seedance-2-fast:10:720p",
]);

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
  model: "seedance-2-fast",
  count: 1,
  videoOptions: { seconds, resolution, audio: true },
});

/**
 * 报表覆盖的档位。**现役可售的每一档都在这里**:图片、参考图,以及现役视频模型的
 * 两个时长档与整段参考视频。(视频任务恒 count=1 —— gen-actions 强制。)
 */
export const MARGIN_TRUTH_SKUS: readonly { id: string; label: string; charge: () => number; cogs: () => number }[] = [
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
  {
    id: "video:seedance-2-fast:5:720p",
    label: "视频 720p 5 秒",
    charge: () => pricedGenCredits(videoJob(5, "720p")) / CREDITS_PER_USD,
    cogs: () => genSpentUsd(videoJob(5, "720p")),
  },
  {
    id: "video:seedance-2-fast:10:720p",
    label: "视频 720p 10 秒",
    charge: () => pricedGenCredits(videoJob(10, "720p")) / CREDITS_PER_USD,
    cogs: () => genSpentUsd(videoJob(10, "720p")),
  },
  {
    id: "video:seedance-2-fast:ref",
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
