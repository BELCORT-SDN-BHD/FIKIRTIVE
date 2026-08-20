/**
 * performance-card — PURE 渲染侧解析:把 DB 存的 PERFORMANCE_CARD payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(镜像 research-card.ts)。
 * 单一真相源 = @fikirtive/otto 的 PerformanceCardPayload(P2a diagnosePerformance 的输出
 * + P2b buildPerformanceCardPayload 打的包);此处只做 defensive typeof 兜底,
 * 好让遗留/半成 payload 也能渲染出一张卡而不抛。stamp/rangeLabel/fmtDate 逻辑与
 * per-ad-view.ts(P1b)保持一致(同一份 RANGES,同一套 tz-safe ISO slice)。
 */
import { RANGES } from "./analytics-view";
import type { PerformanceCardPayload, PerfCardAd, AdVerdict, DiagReason } from "@fikirtive/otto";
// 与 per-ad-view.ts 共用同一份实现,不再各抄一份月名数组(lib/short-date-label)。
import { shortIsoDayLabel as fmtDate } from "./short-date-label";

export type PerfRow = {
  adId: string;
  name: string;
  verdict: string;
  metric: string;
  value: string;
  reasons: { kind: string; text: string; grounded: boolean; citations: { url: string; title: string }[] }[];
  suggestRecreate: boolean;
  imageUrl: string | null;
  isVideo: boolean;
};

export type PerformanceCardView = {
  stamp: string;
  basis: string;
  metricUsed: string;
  note: string | null;
  truncatedNote: string | null;
  winners: PerfRow[];
  losers: PerfRow[];
  neutral: PerfRow[];
};

// getPerformanceCard's datePreset is the Meta preset form ("last_30d"); RANGES.preset matches it
// (RANGES.key is the short "30d" form — do NOT match on key here). Mirrors per-ad-view.ts.
function rangeLabel(preset: string): string {
  return RANGES.find((r) => r.preset === preset)?.label ?? preset;
}

const KNOWN_VERDICTS: ReadonlySet<string> = new Set(["winner", "loser", "neutral"]);

function isCitation(c: unknown): c is { url: string; title: string } {
  return !!c && typeof c === "object" && typeof (c as { url?: unknown }).url === "string" && typeof (c as { title?: unknown }).title === "string";
}

function parseReason(r: unknown): PerfRow["reasons"][number] | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Partial<DiagReason> & { citations?: unknown };
  if (typeof o.kind !== "string" || typeof o.text !== "string") return null;
  return {
    kind: o.kind,
    text: o.text,
    grounded: typeof o.grounded === "boolean" ? o.grounded : false,
    citations: Array.isArray(o.citations) ? o.citations.filter(isCitation) : [],
  };
}

function parseVerdict(v: unknown, creativeByAdId: Map<string, PerfCardAd>): PerfRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<AdVerdict>;
  if (typeof o.adId !== "string") return null;
  const rawVerdict = typeof o.verdict === "string" ? o.verdict : "";
  const verdict = KNOWN_VERDICTS.has(rawVerdict) ? rawVerdict : "neutral";
  const creative = creativeByAdId.get(o.adId);
  return {
    adId: o.adId,
    name: typeof o.name === "string" ? o.name : "Untitled ad",
    verdict,
    metric: typeof o.metric === "string" ? o.metric : "",
    value: typeof o.value === "string" ? o.value : "—",
    reasons: Array.isArray(o.reasons) ? o.reasons.map(parseReason).filter((r): r is PerfRow["reasons"][number] => r != null) : [],
    suggestRecreate: typeof o.suggestRecreate === "boolean" ? o.suggestRecreate : false,
    imageUrl: creative?.imageUrl ?? null,
    isVideo: creative?.isVideo ?? false,
  };
}

export function parsePerformanceCardPayload(payload: unknown): PerformanceCardView {
  const p = (payload ?? {}) as Partial<PerformanceCardPayload>;
  const datePreset = typeof p.datePreset === "string" ? p.datePreset : "";
  const fetchedAt = typeof p.fetchedAt === "string" ? p.fetchedAt : "";
  const truncated = typeof p.truncated === "boolean" ? p.truncated : false;
  const metricUsed = typeof p.metricUsed === "string" ? p.metricUsed : "";
  const basis = typeof p.basis === "string" ? p.basis : "";
  const note = typeof p.note === "string" ? p.note : null;

  const adsRaw: unknown[] = Array.isArray(p.ads) ? p.ads : [];
  const ads: PerfCardAd[] = adsRaw.filter(
    (a): a is PerfCardAd => !!a && typeof a === "object" && typeof (a as PerfCardAd).adId === "string",
  );
  const creativeByAdId = new Map(ads.map((a) => [a.adId, a]));

  const verdictsRaw: unknown[] = Array.isArray(p.verdicts) ? p.verdicts : [];
  const rows = verdictsRaw.map((v) => parseVerdict(v, creativeByAdId)).filter((r): r is PerfRow => r != null);

  const winners = rows.filter((r) => r.verdict === "winner");
  const losers = rows.filter((r) => r.verdict === "loser");
  const neutral = rows.filter((r) => r.verdict === "neutral");

  return {
    stamp: `Meta · ${rangeLabel(datePreset)} · fetched ${fmtDate(fetchedAt)}`,
    basis,
    metricUsed,
    note,
    truncatedNote: truncated ? `Based on your top ${ads.length} ads by spend.` : null,
    winners,
    losers,
    neutral,
  };
}
