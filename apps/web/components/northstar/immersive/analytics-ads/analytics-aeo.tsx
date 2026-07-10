"use client";

/**
 * AI visibility(AEO 可见度)—— Wave C 净新页(Z8-analytics-ads-aeo · GOOSEWORKS §二 B3)。
 *
 * 一句话:顾客越来越问 ChatGPT / Perplexity / Gemini「KL 最好的 kaya croissant 在哪」——
 * 这页测「你的店有没有被 AI 推荐」,并告诉你怎么被推荐。抄 `aeo` 全套方法:
 *   ① ~50 条「买家会问 AI 的问题」(从商家描述派生,可编辑);
 *   ② 每条打给多个引擎;③ 打分 mention rate / prominence / share-of-voice vs 对手;
 *   ④ 网站按 6 维评「AI 可读性」/10;⑤ 给修法。
 *
 * 合法性:只查 AI 引擎 + 爬商家「自己」的站,零个人数据、零对外爬取。
 * 冷启动诚实(铁律):这是 SAMPLE 演示态 —— 真跑要打真实引擎、要花钱(宪法 2:须 founder 逐笔点头),
 * 页面全程明标「sample / illustrative / industry-typical」,不假装已连真数据。
 */

import * as React from "react";
import Link from "next/link";
import { Check, Minus, Sparkles, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Panel, ProvenancePill } from "@/components/northstar/analytics/zone-kit";
import { OttoAssist } from "../otto-assist";
import { AnalyticsNav, PinnedHeader, ZoneBody } from "./kit";

/* ── mock(演示态;数字确定,骨架照真数据长)───────────────────────────────── */

const ENGINES = ["ChatGPT", "Perplexity", "Gemini"] as const;

/**
 * 50 问里抽 10 条代表(买家真会对 AI 问的话;可编辑成你店的口径)。hits = 三引擎是否提到你。
 * 代表性(铁律):抽样命中率必须贴合头条 mention rate 24%(12/50)—— 这批 10 条里只有 2 条被点名
 * (20%),而且集中在店家真正强的品类(Raya / Merdeka 礼盒);泛化查询大多落空。这才诚实反映
 * 「你还基本不被 AI 推荐」的现状,而不是满屏对勾把可见度高估成 70%。
 */
const AEO_QUESTIONS: { q: string; hits: [boolean, boolean, boolean] }[] = [
  { q: "Best kaya croissant in Kuala Lumpur?", hits: [false, false, false] },
  { q: "Where to order a Merdeka gift box in KL?", hits: [true, false, false] },
  { q: "Halal bakery for office breakfast delivery KL?", hits: [false, false, false] },
  { q: "Good bakery near KLCC for corporate orders?", hits: [false, false, false] },
  { q: "Where to buy pandan cake in Kuala Lumpur?", hits: [false, false, false] },
  { q: "Best Raya cookie boxes to pre-order in Malaysia?", hits: [true, true, false] },
  { q: "Artisan croissant shop KL open early morning?", hits: [false, false, false] },
  { q: "Bakery that does bulk kaya buns for events KL?", hits: [false, false, false] },
  { q: "Where to get a birthday cake same-day in KL?", hits: [false, false, false] },
  { q: "Malaysian bakery with gift boxes for Merdeka?", hits: [false, false, false] },
];

/** 全 50 问的汇总(演示数字;真跑后由引擎回填)。 */
const AEO_SUMMARY = {
  totalQuestions: 50,
  mentioned: 12, // 至少一个引擎提到你的问题数
  mentionRatePct: 24,
  avgPositionWhenMentioned: 3.4, // 被提到时的平均名次(越小越前)
};

/** Share of voice:同一批问题里,你 vs 对手被 AI 点名的次数占比(公开可见,非个人数据)。 */
const SHARE_OF_VOICE = [
  { name: "Kootar Bakehouse", pct: 34, you: false },
  { name: "Nyonya Kitchen KL", pct: 27, you: false },
  { name: "Roti Bulan Bakery", pct: 18, you: true },
  { name: "Everyone else", pct: 21, you: false },
];

type ReadyGrade = "strong" | "ok" | "weak";
/** 网站「AI 可读性」6 维(抄 aeo 的 6 lens),每维 /10 + 一句最该修的。 */
const SITE_DIMENSIONS: { dim: string; score: number; grade: ReadyGrade; fix: string }[] = [
  { dim: "Positioning clarity", score: 7, grade: "ok", fix: "Say what you are in the first line — \"halal KL bakery, gift boxes + office delivery.\"" },
  { dim: "Structured content", score: 4, grade: "weak", fix: "Add an FAQ block (hours, delivery area, halal, how to order) — AI reads FAQs best." },
  { dim: "Query alignment", score: 5, grade: "weak", fix: "Use the words customers ask AI: \"Merdeka gift box\", \"office breakfast delivery\", \"kaya croissant\"." },
  { dim: "Technical signals", score: 8, grade: "strong", fix: "Local business schema is present — keep the address and hours current." },
  { dim: "Content depth", score: 6, grade: "ok", fix: "One page per hero product (gift box, kaya croissant) gives AI something concrete to cite." },
  { dim: "Comparison content", score: 3, grade: "weak", fix: "Add a \"best Merdeka gift boxes in KL\" page — comparison pages are what AI quotes most." },
];

/** 从最低分维度派生 3 条修法(不拍脑袋:按分数升序取前 3)。 */
function topFixes() {
  return [...SITE_DIMENSIONS].sort((a, b) => a.score - b.score).slice(0, 3);
}

const GRADE_STYLE: Record<ReadyGrade, string> = {
  strong: "text-success-soft-foreground",
  ok: "text-muted-foreground",
  weak: "text-error-soft-foreground",
};

function EngineDot({ hit }: { hit: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-full",
        hit ? "bg-success-soft text-success-soft-foreground" : "bg-secondary text-muted-foreground",
      )}
    >
      {hit ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={2.5} />}
    </span>
  );
}

export default function AnalyticsAeo() {
  const fixes = topFixes();
  const avgSiteScore = Math.round(
    (SITE_DIMENSIONS.reduce((a, b) => a + b.score, 0) / SITE_DIMENSIONS.length) * 10,
  ) / 10;
  // 抽样命中数(现算)—— 用来在表下把「这 10 条命中几次」和头条 24% 明确挂钩,消除高估错觉。
  const sampleNamed = AEO_QUESTIONS.filter((r) => r.hits.some(Boolean)).length;

  return (
    <>
      <PinnedHeader
        title="AI visibility"
        meta={
          <span className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground">
            Sample run
          </span>
        }
        nav={<AnalyticsNav />}
        provenance={<ProvenancePill text="AI engines + your own site" />}
        actions={
          <OttoAssist
            zone="Analytics"
            entityLabel="AI visibility"
            label="Ask Otto"
            formState={{ mentionRatePct: AEO_SUMMARY.mentionRatePct, siteScore: avgSiteScore }}
            intents={[
              {
                id: "run-real",
                label: "Run a real check on my store",
                prompt: "Run a real AI-visibility check on my actual website and questions.",
                reply:
                  "A real run queries ChatGPT, Perplexity and Gemini with all 50 questions and reads your live site — that costs money to run, so I'll need your OK on the amount first. Want me to price it?",
              },
              {
                id: "which-fix",
                label: "Which fix helps most?",
                prompt: "Of the site fixes, which one gets me recommended by AI the fastest?",
                // 从 topFixes() 现算,和上方「fix these 3 first」的排名一致(不自相矛盾):
                // #1 = Comparison content 3/10(最低分)· #2 = Structured content 4/10。
                reply: `Start with ${fixes[0].dim.toLowerCase()} — at ${fixes[0].score}/10 it's your lowest score, and a "best Merdeka gift boxes in KL" comparison page is what AI quotes most. ${fixes[1].dim} (an FAQ block) is the next lever at ${fixes[1].score}/10.`,
              },
              {
                id: "edit-questions",
                label: "These aren't how my customers ask",
                prompt: "Let me edit the 50 questions to match how my customers actually search.",
                reply:
                  "Good instinct — these are industry-typical starters. Tell me the words your customers use (\"kuih raya\", \"birthday cake same day\") and I'll rewrite the set before the real run.",
              },
            ]}
          />
        }
      />

      <ZoneBody>
        <div className="mt-5 flex flex-col gap-3.5">
          {/* 冷启动诚实横幅(宪法 2:真跑要花钱,须逐笔点头) */}
          <div className="flex flex-wrap items-start gap-2 rounded-[12px] border border-[var(--human)] bg-[var(--human-soft)] px-4 py-3">
            <Bot className="mt-0.5 size-4 shrink-0 text-[var(--human-soft-foreground)]" strokeWidth={2} />
            <p className="min-w-0 flex-1 basis-64 text-[13px] leading-[18px] text-[var(--human-soft-foreground)]">
              This is a <span className="font-semibold">sample run</span> on industry-typical questions, to show what the
              real thing looks like. A live check queries ChatGPT, Perplexity and Gemini and reads your own website —
              that costs money each run, so Otto will price it and ask before spending.
            </p>
          </div>

          {/* 答案先行:4 个可见度读数 */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-[14px] border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Mention rate</div>
              <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
                {AEO_SUMMARY.mentionRatePct}%
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {AEO_SUMMARY.mentioned} of {AEO_SUMMARY.totalQuestions} questions named you
              </div>
            </div>
            <div className="rounded-[14px] border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Share of voice</div>
              <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">18%</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">vs 2 local competitors</div>
            </div>
            <div className="rounded-[14px] border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Position when named</div>
              <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
                #{AEO_SUMMARY.avgPositionWhenMentioned.toFixed(1)}
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">avg rank in the AI&apos;s answer</div>
            </div>
            <div className="rounded-[14px] border border-border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">Site AI-readability</div>
              <div className="mt-1 text-[26px] leading-8 font-bold tracking-[-0.02em] text-foreground tabular-nums">
                {avgSiteScore}/10
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">how easily AI can quote you</div>
            </div>
          </div>

          {/* Otto 指令:3 条最该修的(从最低分维度派生,coral statement) */}
          <div className="rounded-[var(--radius-card)] border border-brand-soft bg-brand-soft/40 p-4">
            <div className="flex items-center gap-2">
              <OttoAvatar size={26} mood="helpful" />
              <span className="text-sm font-semibold text-foreground">To get recommended more — fix these 3 first</span>
            </div>
            <ol className="mt-3 flex flex-col gap-2">
              {fixes.map((f, i) => (
                <li key={f.dim} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-bold text-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground">
                    <span className="font-semibold">{f.dim} ({f.score}/10):</span> {f.fix}
                  </span>
                </li>
              ))}
            </ol>
            <Button asChild variant="brand" size="sm" className="ns-pressable mt-3">
              <Link href="/northstar-immersive/assets/brand-memory">
                <Sparkles />
                Draft the FAQ + comparison page
              </Link>
            </Button>
          </div>

          {/* Share of voice 条(你 vs 对手;蓝声部标「你」) */}
          <Panel title="Who the AI recommends" basis="Times named across the 50 questions · public answers, no personal data">
            <div className="mt-2 flex flex-col gap-2.5">
              {SHARE_OF_VOICE.map((s) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className={cn("w-40 shrink-0 truncate text-sm", s.you ? "ns-human-text font-semibold" : "text-foreground")}>
                    {s.name}
                    {s.you && " (you)"}
                  </span>
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", s.you ? "bg-[var(--human)]" : "bg-muted-foreground/50")}
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-sm font-semibold text-foreground tabular-nums">{s.pct}%</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* 50 问 → 引擎命中(抽 10 条示范) */}
          <Panel title="Which questions name you" basis={`Sample of ${AEO_QUESTIONS.length} of your ${AEO_SUMMARY.totalQuestions} questions · a tick means that engine mentioned you`}>
            <div className="mt-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-2">
                <span className="font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Question</span>
                <div className="flex items-center gap-3">
                  {ENGINES.map((e) => (
                    <span key={e} className="w-12 text-center font-mono text-[10px] font-medium tracking-[0.02em] text-muted-foreground">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
              {AEO_QUESTIONS.map((row) => {
                const any = row.hits.some(Boolean);
                return (
                  <div key={row.q} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-2.5">
                    <span className={cn("min-w-0 truncate text-sm", any ? "text-foreground" : "text-muted-foreground")}>{row.q}</span>
                    <div className="flex items-center gap-3">
                      {row.hits.map((hit, i) => (
                        <span key={ENGINES[i]} className="flex w-12 justify-center">
                          <EngineDot hit={hit} />
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              This slice names you in {sampleNamed} of {AEO_QUESTIONS.length} — across all {AEO_SUMMARY.totalQuestions}{" "}
              questions it&apos;s {AEO_SUMMARY.mentioned} ({AEO_SUMMARY.mentionRatePct}%), so most searches still skip you.
              These are industry-typical questions to start; ask Otto to rewrite them in the words your own customers use
              before a real run.
            </p>
          </Panel>

          {/* 6 维网站可读性 */}
          <Panel title="Can AI read your site?" basis="Six things AI assistants look for before quoting a shop · scored /10 with the fix">
            <div className="mt-2">
              {SITE_DIMENSIONS.map((d) => (
                <div key={d.dim} className="border-t border-border py-2.5 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{d.dim}</span>
                    <span className={cn("shrink-0 text-sm font-bold tabular-nums", GRADE_STYLE[d.grade])}>{d.score}/10</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">{d.fix}</p>
                </div>
              ))}
            </div>
          </Panel>

          <p className="text-[11px] leading-4 text-muted-foreground">
            AI visibility (AEO) is the new word-of-mouth: more customers ask an assistant before they search. This page
            never scrapes anyone — it only asks public AI engines and reads your own website.
          </p>
        </div>
      </ZoneBody>
    </>
  );
}
