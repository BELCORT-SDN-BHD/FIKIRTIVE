/**
 * research-report — PURE 渲染侧解析:把 worker 写的 RESEARCH_REPORT payload(unknown)
 * 防御式映射成视图模型。无 React / 无 I/O,可在 node 测试跑(对齐 research-card)。
 *
 * 权威来源 = apps/worker/src/jobs/research.ts 的 RESEARCH_REPORT 落盘 shape:
 *   payload = { topic: string, synthesis: string, sources: { url, title }[] }
 * 此处只做 defensive typeof 兜底,好让遗留/半成 payload 也能渲染而不抛。
 */

/** 一条来源 = worker 的 ctx.sourcesRead 元素({url,title},已按 url 去重)。 */
export interface ResearchSourceView {
  url: string;
  title: string;
}

export interface ResearchReportView {
  topic: string;
  synthesis: string;
  sources: ResearchSourceView[];
}

/** 把一条候选 source 兜底成 {url,title};url/title 非字符串 → null(调用方过滤)。 */
function parseSource(raw: unknown): ResearchSourceView | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as { url?: unknown; title?: unknown };
  if (typeof r.url !== "string") return null;
  const title = typeof r.title === "string" ? r.title : "";
  return { url: r.url, title };
}

export function parseResearchReportPayload(payload: unknown): ResearchReportView {
  const p = (payload ?? {}) as { topic?: unknown; synthesis?: unknown; sources?: unknown };
  const topic = typeof p.topic === "string" ? p.topic : "";
  const synthesis = typeof p.synthesis === "string" ? p.synthesis : "";
  const sources = Array.isArray(p.sources)
    ? p.sources
        .map(parseSource)
        .filter((s): s is ResearchSourceView => s !== null)
    : [];
  return { topic, synthesis, sources };
}
