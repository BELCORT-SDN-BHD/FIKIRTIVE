"use client";
import { Play } from "lucide-react";
import { parsePerformanceCardPayload, type PerfRow } from "@/lib/performance-card";

export interface PerformanceCardProps {
  payload: unknown;
}

/** Otto 的表现诊断卡(PERFORMANCE_CARD)。纯展示 —— 无审批/轮询/花钱,
 *  P3 才把 Recreate/Make-fresh/Try-angle 接到生成链。样式忠于已批 mockup
 *  (docs/design-refs/2026-07-03-performance-card-mockup.html)。 */
export function PerformanceCard({ payload }: PerformanceCardProps) {
  const view = parsePerformanceCardPayload(payload);
  const isEmpty = view.winners.length === 0 && view.losers.length === 0;

  return (
    <div className="gb leading-[1.5]" style={{ maxWidth: 480 }}>
      <div className="rounded-[18px] border border-border bg-card overflow-hidden shadow-[var(--shadow-xs)]">
        {/* Header */}
        <div className="flex items-start gap-3 px-[18px] pt-[17px] pb-[14px]">
          <CoralCloud size={30} />
          <div className="flex-1 min-w-0">
            <div className="text-[0.9375rem] font-bold tracking-[-0.01em] text-foreground">
              Here&apos;s how your ads are doing
            </div>
            {view.basis && (
              <div className="text-[0.78125rem] text-muted-foreground mt-[3px]">{view.basis}</div>
            )}
          </div>
          <span className="text-[0.6875rem] text-muted-foreground bg-muted rounded-[7px] px-2 py-[3px] font-medium whitespace-nowrap">
            {view.stamp}
          </span>
        </div>

        {isEmpty && view.note && (
          <div className="px-[18px] pb-[16px] text-[0.8125rem] text-muted-foreground">{view.note}</div>
        )}

        {/* Winners */}
        {view.winners.length > 0 && (
          <div className="px-[18px]">
            <div className="text-[0.71875rem] font-bold tracking-[0.02em] uppercase text-muted-foreground mt-3 mb-[2px]">
              ✦ Working well — worth making more of
            </div>
            {view.winners.map((row) => (
              <PerfRowView key={row.adId} row={row} variant="winner" />
            ))}
          </div>
        )}

        {/* Losers */}
        {view.losers.length > 0 && (
          <div className="px-[18px]">
            <div className="text-[0.71875rem] font-bold tracking-[0.02em] uppercase text-muted-foreground mt-3 mb-[2px]">
              Needs attention
            </div>
            {view.losers.map((row) => (
              <PerfRowView key={row.adId} row={row} variant="loser" />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-[0.71875rem] text-muted-foreground px-[18px] pt-[13px] pb-4 border-t border-border mt-2 leading-[1.5]">
          {view.truncatedNote && <div>{view.truncatedNote}</div>}
          <div>
            ROAS shown only where Meta reports it. Organic post performance isn&apos;t included yet — it
            lights up once your Meta permission is approved.
          </div>
        </div>
      </div>
    </div>
  );
}

function PerfRowView({ row, variant }: { row: PerfRow; variant: "winner" | "loser" }) {
  const reasonText = variant === "winner"
    ? row.reasons[0]?.text
    : row.reasons.find((r) => r.kind === "creative")?.text;
  const dataGap = variant === "loser" ? row.reasons.find((r) => r.kind === "data-gap")?.text : undefined;
  const citation = variant === "loser"
    ? row.reasons.find((r) => r.kind === "creative")?.citations[0]
    : undefined;

  return (
    <div className="flex gap-3 py-3 border-t border-border first:border-t-0">
      <Thumbnail imageUrl={row.imageUrl} isVideo={row.isVideo} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[0.84375rem] font-semibold whitespace-nowrap overflow-hidden text-ellipsis text-foreground">
            {row.name}
          </span>
          {variant === "winner" ? (
            <span className="text-[0.65625rem] font-bold rounded-full px-2 py-[2px] whitespace-nowrap bg-brand-soft text-brand-soft-foreground">
              ▲ Top performer
            </span>
          ) : (
            <span className="text-[0.65625rem] font-bold rounded-full px-2 py-[2px] whitespace-nowrap bg-muted text-muted-foreground">
              Underperforming
            </span>
          )}
        </div>
        {reasonText && (
          <div className="text-[0.78125rem] leading-[1.5] text-foreground/90 mt-[5px]">{reasonText}</div>
        )}
        {citation && (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[3px] text-[0.71875rem] font-semibold text-brand bg-[#FEF2EC] rounded-[6px] px-[7px] py-[1px] mt-[6px]"
          >
            Meta: {citation.title} ↗
          </a>
        )}
        {dataGap && (
          <div className="text-[0.75rem] leading-[1.5] text-muted-foreground mt-[6px] pl-[10px] border-l-2 border-border">
            {dataGap}
          </div>
        )}
        <div className="flex gap-2 mt-[9px]">
          {variant === "winner" ? (
            <ActionButton variant="recreate">✦ Recreate this</ActionButton>
          ) : (
            <>
              <ActionButton variant="recreate">✦ Make a fresh version</ActionButton>
              <ActionButton variant="angle">Try a new angle</ActionButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ variant, children }: { variant: "recreate" | "angle"; children: React.ReactNode }) {
  return (
    <button
      type="button"
      // TODO(P3): wire recreate / new-angle to the creation chain
      onClick={() => {}}
      className={
        variant === "recreate"
          ? "h-[31px] rounded-[9px] text-[0.75rem] font-semibold px-3 inline-flex items-center gap-[5px] border border-brand text-brand bg-card"
          : "h-[31px] rounded-[9px] text-[0.75rem] font-semibold px-3 inline-flex items-center gap-[5px] border border-border text-muted-foreground bg-card"
      }
    >
      {children}
    </button>
  );
}

function Thumbnail({ imageUrl, isVideo }: { imageUrl: string | null; isVideo: boolean }) {
  return (
    <div className="w-14 h-14 rounded-[9px] flex-shrink-0 border border-border relative overflow-hidden">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-[linear-gradient(135deg,#F7B267,#EC5828)]" />
      )}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Play size={16} fill="white" color="white" />
        </div>
      )}
    </div>
  );
}

/** Otto's coral cloud mark (copied from OttoAnalytics.tsx's CoralCloud). */
function CoralCloud({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 110) / 120)}
      viewBox="0 0 120 110"
      role="img"
      aria-label="Otto"
      className="shrink-0"
    >
      <g fill="var(--brand)">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <rect x="51" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
      <rect x="66" y="48" width="7" height="13" rx="3.5" fill="#2B1308" />
    </svg>
  );
}

export default PerformanceCard;
