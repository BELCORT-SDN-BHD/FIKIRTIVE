"use client";
import React from "react";
import { FileText } from "lucide-react";
import { parseResearchReportPayload, type ResearchSourceView } from "@/lib/research-report";

export interface ResearchReportProps {
  /** The durable RESEARCH_REPORT message id (kept for parity with sibling widgets; unused). */
  cardId: string;
  payload: unknown;
}

/** Dedupe sources by url (worker already dedupes, but a legacy/half-written payload might not). */
function dedupeByUrl(sources: ResearchSourceView[]): ResearchSourceView[] {
  const seen = new Set<string>();
  const out: ResearchSourceView[] = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

/** Otto 的深度研究报告卡(RESEARCH_REPORT)。样式镜像 OttoActionPlanCard 的审批卡外观。
 *  纯渲染,$0 —— 只消费 worker 落盘的 payload({topic, synthesis, sources}),无任何 spend/action。
 *  - header:FileText 图标 + "Research: {topic}"(topic 缺失 → "Research report")。
 *  - synthesis:whitespace-pre-wrap 保留换行,不引 markdown 库。
 *  - Sources:去重后逐条列 title + 可点 url(外链安全 rel/target);空则整段省略。 */
export function ResearchReport({ payload }: ResearchReportProps) {
  const view = parseResearchReportPayload(payload);
  const sources = dedupeByUrl(view.sources);
  const heading = view.topic ? `Research: ${view.topic}` : "Research report";

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="gb leading-[1.5]" style={{ maxWidth: 560 }}>
      <div className="rounded-[18px] border border-border bg-secondary p-6">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <FileText size={20} className="text-foreground" />
          <span className="font-bold text-[0.8125rem] text-foreground">{heading}</span>
        </div>

        {/* Synthesis body — plain text, line breaks preserved (no markdown lib) */}
        {view.synthesis && (
          <div className="text-[0.875rem] text-foreground whitespace-pre-wrap break-words mb-4">
            {view.synthesis}
          </div>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <div className="pt-3 border-t border-border">
            <div className="text-[0.75rem] font-semibold text-muted-foreground mb-2">Sources</div>
            <div className="flex flex-col gap-2">
              {sources.map((s, i) => (
                <div
                  key={i}
                  className="bg-card rounded-[14px] flex flex-col gap-[2px]"
                  style={{ padding: "10px 12px" }}
                >
                  {s.title && (
                    <span className="font-semibold text-[0.8125rem] text-foreground break-words">
                      {s.title}
                    </span>
                  )}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[0.75rem] text-primary underline break-all"
                  >
                    {s.url}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResearchReport;
