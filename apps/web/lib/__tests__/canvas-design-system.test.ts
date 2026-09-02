import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("Canvas uses the shared product design system", () => {
  it("uses AlertDialog for removal confirmations and keeps generation choices in Dialog", () => {
    const flow = source("components/canvas/FlowCanvas.tsx");

    expect(flow).toContain("<AlertDialog open={pendingDeleteId !== null}");
    expect(flow).toContain("<AlertDialog open={pendingBatchDeleteIds !== null}");
    expect(flow).not.toContain("<Dialog open={pendingDeleteId !== null}");
    expect(flow).not.toContain("<Dialog open={pendingBatchDeleteIds !== null}");
    expect(flow).toContain("<Dialog open={pendingAnimateId !== null}");
  });

  it("uses shared Badge, Textarea, ButtonGroup and tooltip button primitives for nodes", () => {
    const nodeLabel = source("components/canvas/nodes/CanvasNodeLabel.tsx");
    const textNode = source("components/canvas/nodes/TextNode.tsx");
    const toolbarButton = source("components/canvas/nodes/NodeToolbarIconButton.tsx");

    expect(nodeLabel).toContain('<Badge className="cv-nodelabel">');
    expect(textNode).toContain("<Textarea");
    expect(textNode).toContain('<ButtonGroup aria-label="Text actions"');
    expect(textNode).not.toContain("style={{");
    expect(toolbarButton).toContain("<TooltipButton");
  });

  it("keeps the Canvas action language neutral and icon-library based", () => {
    const files = [
      "components/canvas/FlowCanvas.tsx",
      "components/canvas/nodes/ImageNode.tsx",
      "components/canvas/nodes/VideoNode.tsx",
      "components/canvas/nodes/TextNode.tsx",
    ];

    for (const file of files) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/<(button|input|textarea|select)\b/);
      expect(contents, file).not.toMatch(/[⭐✦]/u);
    }

    expect(source("components/canvas/FlowCanvas.tsx")).not.toContain("composer-prism");
  });
});
