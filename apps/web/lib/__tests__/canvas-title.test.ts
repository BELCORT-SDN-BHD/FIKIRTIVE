/**
 * canvas-title — Codex 只读 E2E QA-CRE-006(`docs/audits/creation-e2e-2026-09-04.md` §4.1)
 * 三条发现里的两条:
 *   ① 「不叫 project」—— 存量默认名（"New project" 等）在起步页要读成画布词汇；
 *   ② 「长标题可扫描」—— 很长的 prompt 直接成为 history title，缺可扫描的名称策略。
 *
 * FRONT-A15（`docs/specs/frontend-baseline.md` §7.1 ⑨ 段）钉这两条：Create 起步页 Canvas
 * history 的可见名称与已批准的画布词汇一致、可扫描。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CANVAS_NAME,
  LEGACY_DEFAULT_CANVAS_NAMES,
  canvasDisplayName,
  formatCanvasTitle,
  isDefaultCanvasName,
  truncateCanvasTitle,
} from "../canvas-title";

describe("FRONT-A15 canvasDisplayName / formatCanvasTitle：不叫 project", () => {
  it.each(LEGACY_DEFAULT_CANVAS_NAMES)("FRONT-A15 存量默认名「%s」显示层映射成画布词汇", (legacyName) => {
    expect(canvasDisplayName(legacyName)).toBe(DEFAULT_CANVAS_NAME);
    expect(formatCanvasTitle(legacyName)).toBe(DEFAULT_CANVAS_NAME);
  });

  it("FRONT-A15 今天的默认名本身也映射成画布词汇（幂等）", () => {
    expect(canvasDisplayName(DEFAULT_CANVAS_NAME)).toBe(DEFAULT_CANVAS_NAME);
  });

  it("FRONT-A15 isDefaultCanvasName 认得当前默认名与每个旧默认名", () => {
    expect(isDefaultCanvasName(DEFAULT_CANVAS_NAME)).toBe(true);
    for (const legacy of LEGACY_DEFAULT_CANVAS_NAMES) expect(isDefaultCanvasName(legacy)).toBe(true);
    expect(isDefaultCanvasName("Raya campaign")).toBe(false);
  });

  it("FRONT-A15 短名（商家真起的名字）原样通过", () => {
    expect(canvasDisplayName("Raya campaign")).toBe("Raya campaign");
    expect(formatCanvasTitle("Raya campaign")).toBe("Raya campaign");
  });
});

describe("FRONT-A15 truncateCanvasTitle：长 prompt 收成可扫描标题", () => {
  it("FRONT-A15 短名原样，不加省略号", () => {
    expect(truncateCanvasTitle("Weekend tea launch")).toBe("Weekend tea launch");
  });

  it("FRONT-A15 恰好等于上限时原样通过", () => {
    const exact = "A".repeat(56);
    expect(truncateCanvasTitle(exact)).toBe(exact);
  });

  it("FRONT-A15 长 prompt 按词边界截断并加省略号，不超过上限＋1（省略号）", () => {
    const long =
      "Generate a bright festive Hari Raya gift box photo with warm lighting and a family gathering in the background";
    const out = truncateCanvasTitle(long);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(57);
    // 按词边界切：省略号前不该是被腰斩的半个词紧贴着源字符串里同一位置的下一个字符
    expect(long.startsWith(out.slice(0, -1).trimEnd())).toBe(true);
  });

  it("FRONT-A15 长 prompt 有第一句时优先取第一句（在上限内）", () => {
    const long = "Make a poster for the Hari Raya sale. It needs bright colors and a festive mood throughout.";
    expect(truncateCanvasTitle(long)).toBe("Make a poster for the Hari Raya sale.");
  });

  it("FRONT-A15 多行 prompt 只取首行", () => {
    const multiline = "Hari Raya hero banner\nUse the family photo from last week\nMake it warm and festive";
    expect(truncateCanvasTitle(multiline)).toBe("Hari Raya hero banner");
  });

  it("FRONT-A15 多行且首行本身超长时，首行内再按词边界截断", () => {
    const firstLine = "B".repeat(40) + " " + "C".repeat(40);
    const multiline = `${firstLine}\nSecond line here`;
    const out = truncateCanvasTitle(multiline);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("\n");
    expect(out).not.toContain("Second line here");
  });

  it("FRONT-A15 去掉包裹的引号与首尾多余空白", () => {
    expect(truncateCanvasTitle('  "Design a logo for my bakery"  ')).toBe("Design a logo for my bakery");
  });

  it("FRONT-A15 纯空白回退默认名", () => {
    expect(truncateCanvasTitle("   ")).toBe(DEFAULT_CANVAS_NAME);
    expect(truncateCanvasTitle("")).toBe(DEFAULT_CANVAS_NAME);
    expect(formatCanvasTitle("   ")).toBe(DEFAULT_CANVAS_NAME);
    expect(formatCanvasTitle("")).toBe(DEFAULT_CANVAS_NAME);
  });

  it("FRONT-A15 formatCanvasTitle 对真名字组合两条规则：先映射默认名，再截断", () => {
    const longLegacyLikeButReal =
      "New project brief: launch a Hari Raya themed hamper collection with five different price tiers for retail partners";
    // 不是精确等于某个 legacy 默认名字符串，所以不映射，只走截断。
    const out = formatCanvasTitle(longLegacyLikeButReal);
    expect(out).not.toBe(DEFAULT_CANVAS_NAME);
    expect(out.length).toBeLessThanOrEqual(57);
  });
});
