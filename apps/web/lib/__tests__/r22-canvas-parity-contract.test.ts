import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");
const WORKSPACE_PATH = path.join(WEB_ROOT, "components/canvas/NorthstarCanvasWorkspace.tsx");
const SURFACE_PATH = path.join(WEB_ROOT, "components/canvas/R22CanvasSurface.tsx");
const STYLES_PATH = path.join(WEB_ROOT, "components/canvas/r22-canvas.css");
// token 中心化(R22 地基票)之后,ground/surface/ink/coral 的字面 hex 只在 r22-tokens.css
// 的 :root 定义一次;r22-canvas.css 改成引用 var(--r22-*)。
const TOKENS_PATH = path.join(WEB_ROOT, "components/r22/r22-tokens.css");

function source(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("R22 Canvas 是独立可见 surface,旧内核只可留作业务 contract", () => {
  it("正式 workspace 改由 R22 surface 承重,不再直接渲染 FlowCanvas", () => {
    const workspace = source(WORKSPACE_PATH);

    expect(workspace).toContain('from "./R22CanvasSurface"');
    expect(workspace).toContain("<R22CanvasSurface");
    expect(workspace).not.toContain('from "./FlowCanvas"');
    expect(workspace).not.toContain("<FlowCanvas");
  });

  it("surface 暴露稳定几何锚点与 R22 本地 Otto/composer", () => {
    expect(existsSync(SURFACE_PATH)).toBe(true);
    const surface = source(SURFACE_PATH);

    for (const marker of [
      "data-r22-canvas-surface",
      "data-r22-canvas-topbar",
      "data-r22-canvas-stage",
      "data-r22-canvas-otto",
      "data-r22-canvas-conversation",
      "data-r22-canvas-composer",
      "data-r22-canvas-tools",
      "data-r22-canvas-zoom",
    ]) {
      expect(surface, marker).toContain(marker);
    }
    expect(surface).toContain("Ask Otto, or describe what to make");
    // 样例画布那一张图的价钱仍然是 3 cr,只是不再作为字面量散在贴纸和答案里 —— 价格贴纸、
    // 答案卡的单价、批量四张的总价现在全从这一个常量派生(见 `FIXTURE_IMAGE_CREDITS` 的注释)。
    expect(surface).toContain("FIXTURE_IMAGE_CREDITS = 3");
  });

  it("production composer 的价格和付费动作共用真实 Canvas generation adapter", () => {
    const surface = source(SURFACE_PATH);
    expect(surface).toContain("useCanvasGen(");
    expect(surface).toContain("quoteCosts(1)");
    expect(surface).toContain("imageShapes()");
    expect(surface).toContain("freshCanvasActionId()");
    expect(surface).toContain("await generateImage(");
    expect(surface).toContain("costQuote.imageCredits");
    expect(surface).toContain("actionId: actionRef.current.actionId");
  });

  it("CSS 固定 R22 light tokens 与 viewport anchors,不跟 system theme", () => {
    expect(existsSync(STYLES_PATH)).toBe(true);
    const styles = source(STYLES_PATH);

    for (const contract of [
      "color-scheme: light",
      "min-height: 100dvh",
      "left: 18px",
      "top: 16px",
      "bottom: 18px",
      "right: 18px",
      "width: min(640px, 72vw)",
    ]) {
      expect(styles, contract).toContain(contract);
    }
    expect(styles).not.toContain("prefers-color-scheme");

    // ground/surface/ink/coral 的字面值现在只登记在 r22-tokens.css 的 :root——
    // 单点权威,r22-canvas.css 一律引用 var(--r22-*),不再各自重复定义。
    expect(existsSync(TOKENS_PATH)).toBe(true);
    const tokens = source(TOKENS_PATH);
    for (const contract of [
      "--r22-ground: #fafafc",
      "--r22-surface: #ffffff",
      "--r22-ink: #16171c",
      "--r22-coral: #ec5828",
    ]) {
      expect(tokens, contract).toContain(contract);
    }
    expect(styles).toContain("var(--r22-ground)");
    expect(styles).toContain("var(--r22-surface)");
    expect(styles).toContain("var(--r22-ink)");
    expect(styles).toContain("var(--r22-coral)");
  });
});
