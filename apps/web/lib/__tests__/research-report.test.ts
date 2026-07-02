import { describe, it, expect } from "vitest";
import { parseResearchReportPayload } from "../research-report";

describe("parseResearchReportPayload", () => {
  it("empty / undefined / null payload → 兜底(空 topic、空 synthesis、空 sources)", () => {
    const base = { topic: "", synthesis: "", sources: [] };
    expect(parseResearchReportPayload(undefined)).toEqual(base);
    expect(parseResearchReportPayload(null)).toEqual(base);
    expect(parseResearchReportPayload({})).toEqual(base);
  });

  it("合法 payload(worker shape)→ 全字段透传", () => {
    const r = parseResearchReportPayload({
      topic: "EV market in SEA",
      synthesis: "The market is growing.\n\n## Key finding\nMargins are thin.",
      sources: [
        { url: "https://a.com", title: "Title A" },
        { url: "https://b.com", title: "Title B" },
      ],
    });
    expect(r.topic).toBe("EV market in SEA");
    expect(r.synthesis).toBe("The market is growing.\n\n## Key finding\nMargins are thin.");
    expect(r.sources).toEqual([
      { url: "https://a.com", title: "Title A" },
      { url: "https://b.com", title: "Title B" },
    ]);
  });

  it("partial payload(只有 topic)→ 其余兜底", () => {
    const r = parseResearchReportPayload({ topic: "trends" });
    expect(r).toEqual({ topic: "trends", synthesis: "", sources: [] });
  });

  it("非字符串 topic / synthesis → 兜底空串", () => {
    const r = parseResearchReportPayload({ topic: 42, synthesis: { x: 1 } });
    expect(r.topic).toBe("");
    expect(r.synthesis).toBe("");
  });

  it("sources 非数组 → 归空", () => {
    expect(parseResearchReportPayload({ topic: "x", sources: "nope" }).sources).toEqual([]);
    expect(parseResearchReportPayload({ topic: "x", sources: null }).sources).toEqual([]);
    expect(parseResearchReportPayload({ topic: "x", sources: { url: "u" } }).sources).toEqual([]);
  });

  it("malformed source entries → 过滤(缺 url / url 非字符串 / null / 非对象)", () => {
    const r = parseResearchReportPayload({
      topic: "x",
      sources: [
        { url: "https://ok.com", title: "OK" },
        { title: "no url" },
        { url: 123, title: "bad url type" },
        null,
        "just a string",
        42,
        { url: "https://ok2.com" }, // title 缺失 → 兜底空串,保留
      ],
    });
    expect(r.sources).toEqual([
      { url: "https://ok.com", title: "OK" },
      { url: "https://ok2.com", title: "" },
    ]);
  });

  it("title 非字符串 → 兜底空串(url 有效则保留该条)", () => {
    const r = parseResearchReportPayload({
      topic: "x",
      sources: [{ url: "https://a.com", title: 99 }],
    });
    expect(r.sources).toEqual([{ url: "https://a.com", title: "" }]);
  });
});
