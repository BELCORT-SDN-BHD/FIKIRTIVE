import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_COPY } from "@/components/home/home-data";

const WEB_ROOT = path.resolve(__dirname, "../..");
const source = (file: string) => readFileSync(path.join(WEB_ROOT, file), "utf8");

describe("R22 correction flow contracts", () => {
  it("uses one shared desktop content origin instead of route-specific centering", () => {
    const shell = source("components/r22/r22-dashboard.css");
    const iq = source("components/otto-iq/r22-otto-iq-hub.css");
    const routines = source("components/routines/r22-routines.css");

    expect(shell).toContain("--r22-content-gutter: 48px");
    expect(shell).toContain("--r22-content-width: 924px");
    expect(iq).toContain("var(--r22-content-gutter)");
    expect(routines).toContain("var(--r22-content-gutter)");
    expect(iq).not.toContain("margin:0 auto");
    expect(routines).not.toContain("margin:0 auto");
  });

  it("keeps the complete Home provider flow inside a shadcn dialog", () => {
    const home = source("components/home/HomeView.tsx");

    expect(home).toContain("<Dialog open={connectFlow !== null}");
    expect(home).toContain("Continue with");
    // 这两句是**状态句**(权限与 Meta 授权范围),按 Founder 2026-08-25 缩辖区裁决已收进
    // `HOME_COPY` 单一出处 —— 措辞一个字没变,只是搬了家。钉引用,不再钉字面量。
    expect(home).toContain("HOME_COPY.noPasswordStored");
    expect(home).toContain("HOME_COPY.permissionReadContent");
    expect(HOME_COPY.noPasswordStored).toBe("No password is stored in FIKIRTIVE.");
    expect(HOME_COPY.permissionReadContent).toBe("Read published content and audience insights");
    expect(home).toContain("Choose a business profile");
    expect(home).toContain("Connect this profile");
    expect(home).toContain("HOME_COPY.connectFailedTitle");
    expect(HOME_COPY.connectFailedTitle).toBe("Connection could not be completed");
    expect(home).not.toContain("connection preview only");
  });

  it("implements Jasper's full Brand Voice source, generation, review, and save sequence", () => {
    const iq = source("components/otto-iq/R22OttoIQView.tsx");

    expect(iq).toContain("Voice details");
    expect(iq).toContain("Add example content");
    expect(iq).toContain("Paste text");
    expect(iq).toContain("Add URLs");
    expect(iq).toContain("Upload files");
    expect(iq).toContain("1000 character minimum");
    expect(iq).toContain("Generating Brand Voice");
    expect(iq).toContain("Review and edit");
    expect(iq).toContain("Save Brand Voice");
  });

  it("renders the full Routine configuration before any backend adapter is connected", () => {
    const routines = source("components/routines/R22RoutinesView.tsx");

    for (const copy of [
      "Posting times",
      "Timezone",
      "Posts a week",
      "What it posts about",
      "What it may read from Otto IQ",
      "Publishing channel",
      "Approval policy",
      "Auto-publish",
      "Weekly credit cap",
      "Reminder policy",
      "If a post isn&apos;t approved by its slot",
      "Review routine",
      "Save draft",
      "Activate routine",
    ]) expect(routines).toContain(copy);
    expect(routines).not.toContain("Schedule, channel and weekly credits</b><p>The authenticated workflow service does not yet expose");
  });

  it("keeps Claude-style required input on Canvas and records its decision in Conversation", () => {
    const canvas = source("components/canvas/R22CanvasSurface.tsx");

    expect(canvas).toContain("r22-canvas-input-card");
    expect(canvas).toContain("Paused · 0 cr now · up to");
    expect(canvas).toContain("Why Otto paused");
    expect(canvas).toContain("Decision saved in Conversation");
    expect(canvas).toContain("Cancel task");
    expect(canvas).toContain("Something else…");
  });
});
