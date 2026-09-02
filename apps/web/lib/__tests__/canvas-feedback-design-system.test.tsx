import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GeneratingBody } from "@/components/canvas/nodes/GeneratingBody";
import { Progress } from "@/components/ui/progress";

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

describe("Canvas feedback design system", () => {
  it("uses an unknown-duration status instead of inventing a percentage", () => {
    const queued = renderToStaticMarkup(<GeneratingBody gb kind="image" queued />);
    const generating = renderToStaticMarkup(<GeneratingBody gb kind="image" />);

    expect(queued).toContain('role="status"');
    expect(queued).toContain("In the queue…");
    expect(queued).toContain("Otto starts automatically");
    expect(queued).not.toContain("Otto is making this");
    expect(queued).not.toContain('role="progressbar"');

    expect(generating).toContain("Generating…");
    expect(generating).toContain("Otto is making this — you can keep working");
    expect(generating).toContain("Billed only when it finishes");
  });

  it("keeps real Progress determinate and accessible", () => {
    const markup = renderToStaticMarkup(<Progress value={60} aria-label="Export progress" />);

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="60"');
    expect(markup).toContain("width:60%");

    const progress = source("components/ui/progress.tsx");
    expect(progress).toContain("transition-[width]");
    expect(progress).toContain("motion-reduce:transition-none");
    expect(progress).not.toContain("transition-all");
  });

  it("removes the hand-rolled fake progress animation from Canvas", () => {
    const generating = source("components/canvas/nodes/GeneratingBody.tsx");
    const globals = source("app/globals.css");

    expect(generating).toContain("<Spinner");
    expect(generating).toContain("<Badge");
    expect(generating).not.toContain("cv-gen-bar");
    expect(globals).not.toMatch(/cv-gen-bar|cv-gen-slide/);
  });

  it("keeps board loading and read failure on shared feedback primitives", () => {
    const canvas = source("components/canvas/FlowCanvas.tsx");

    expect(canvas).toContain('boardStatus === "loading"');
    expect(canvas).toContain("<Spinner");
    expect(canvas).toContain('boardStatus === "unavailable"');
    expect(canvas).toContain('<Alert role="alert" variant="destructive" density="compact"');
    expect(canvas).toContain("Nothing on your board was changed.");
  });
});
