import { describe, it, expect } from "vitest";
import { executeProposeIdeas, proposeIdeasSkill, normalizeIdeas, MAX_IDEAS } from "./propose-ideas.js";
import type { OttoContext } from "../context.js";

// W-B3-D (anchor I1 "反 Buffer 自证"): proposeIdeas is a pure $0 suggestion surface — it persists
// nothing, spends nothing, and creates no object. Tests assert the gate, the pure normalize (cap +
// de-dupe), and the honest $0/next-step framing.

const ctx = {
  orgId: "org-test", userId: "user-test", projectId: "proj-test", threadId: "thread-test", disabledModels: [],
} as unknown as OttoContext;

describe("proposeIdeas gate", () => {
  it("free/read/internal → needsApproval false (pure suggestion, no write)", () => {
    expect(proposeIdeasSkill.cost).toBe("free");
    expect(proposeIdeasSkill.effect).toBe("read");
    expect(proposeIdeasSkill.reach).toBe("internal");
    expect(proposeIdeasSkill.needsApproval).toBe(false);
  });
});

describe("normalizeIdeas (pure)", () => {
  it("de-dupes by case-insensitive title and preserves order", () => {
    const out = normalizeIdeas([
      { title: "Steam macro" },
      { title: "steam MACRO" }, // dup
      { title: "Restock teaser", why: "urgency", format: "teaser" },
    ]);
    expect(out.map((i) => i.title)).toEqual(["Steam macro", "Restock teaser"]);
    expect(out[1]).toEqual({ title: "Restock teaser", why: "urgency", format: "teaser" });
  });
  it("caps at MAX_IDEAS", () => {
    const out = normalizeIdeas(Array.from({ length: MAX_IDEAS + 3 }, (_, i) => ({ title: `idea ${i}` })));
    expect(out).toHaveLength(MAX_IDEAS);
  });
});

describe("executeProposeIdeas", () => {
  it("returns the suggestions with theme + the honest $0/next-step framing", async () => {
    const res = (await executeProposeIdeas(
      { theme: "this week", ideas: [{ title: "3pm croissant POV", format: "POV short-form" }, { title: "Kaya toast steam macro" }] },
      { context: ctx },
    )) as { ok: boolean; theme: string; count: number; ideas: unknown[]; nextStep: string };
    expect(res.ok).toBe(true);
    expect(res.theme).toBe("this week");
    expect(res.count).toBe(2);
    expect(res.nextStep).toContain("Ideas are free");
    expect(res.nextStep).toContain("asks before it spends");
  });
  it("refuses an all-blank list (nothing concrete to suggest)", async () => {
    const res = (await executeProposeIdeas({ ideas: [{ title: "   " }] }, { context: ctx })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("at least one");
  });
});
