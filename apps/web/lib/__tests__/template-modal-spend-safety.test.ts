import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  initialTemplateRunState,
  isTemplatePaidConfirmAvailable,
  pollTemplateJob,
  startTemplateJob,
  templateRunReducer,
} from "@/components/otto/TemplateModal";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const TEMPLATE_MODAL = path.join(REPO_ROOT, "apps/web/components/otto/TemplateModal.tsx");

describe("TemplateModal spend safety", () => {
  it("uses a server-resolved model and a stable guarded idempotency key", () => {
    const src = fs.readFileSync(TEMPLATE_MODAL, "utf8");

    expect(src).toContain("getActiveGenModels");
    expect(src).not.toContain("activeImageModel");
    expect(src).toContain("inFlightRef.current");
    expect(src).toContain("idempotencyKeyRef.current");
    expect(src).toContain("crypto.randomUUID()");
    expect(src).not.toContain("Date.now()");
  });

  it("locks paid confirmation when a started request has an unknown outcome and points to Library", () => {
    const generating = templateRunReducer(initialTemplateRunState(), { type: "start" });
    const unknown = templateRunReducer(generating, { type: "unknown" });

    expect(unknown.phase).toBe("unknown");
    expect(unknown.message).toBe("This didn't finish. Check your Library in a minute.");
    expect(isTemplatePaidConfirmAvailable(unknown)).toBe(false);
  });

  it("uses the safe alert treatment and a neutral Close action for an unknown outcome", () => {
    const src = fs.readFileSync(TEMPLATE_MODAL, "utf8");
    // #896 collapsed the two-step confirm, so the branch after "unknown" is now the ONE
    // priced Generate button rather than a `confirming ?` fork.
    const unknownBranch = src.match(/phase === "unknown" \? \(([\s\S]*?)\) : \(/)?.[1] ?? "";

    expect(unknownBranch).toContain('variant="secondary"');
    expect(unknownBranch).not.toContain('variant="brand"');
    // …and the paid press that follows it is ONE button carrying the price (#896).
    expect(src).toContain("Generate · {costLabel}");
    expect(src).not.toContain("Review cost");
    expect(src).not.toContain("Confirm generate");
    expect(src).toContain('role="alert"');
    expect(src).toContain("bg-error-soft");
    expect(src).toContain("text-[13px]");
    expect(src).toContain("leading-[18px]");
    expect(src).toContain("font-medium");
    expect(src).toContain("text-[var(--error-soft-foreground)]");
    expect(src).not.toContain('color: "var(--destructive)"');
  });

  it("classifies timeout, lookup failure/null, and incomplete DONE delivery as unknown", async () => {
    const poll = (lookup: NonNullable<Parameters<typeof pollTemplateJob>[1]>["lookup"]) =>
      pollTemplateJob("job-1", { lookup, wait: async () => {}, attempts: 1 });

    const outcomes = await Promise.all([
      poll(async () => ({ status: "GENERATING", urls: [], generationIds: [] })), // timeout
      poll(async () => { throw new Error("session lost"); }),
      poll(async () => null),
      poll(async () => ({ status: "DONE", urls: [], generationIds: ["gen-1"] })),
      poll(async () => ({ status: "DONE", urls: ["/result.png"], generationIds: [] })),
    ]);

    expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ kind: "unknown" })));
  });

  it("treats a lost startGen response as unknown but an explicit returned error as retryable", async () => {
    const uncertain = await startTemplateJob({}, vi.fn(async () => { throw new Error("response lost"); }));
    const explicit = await startTemplateJob({}, vi.fn(async () => ({ error: "That request is invalid." })));

    expect(uncertain).toEqual({ kind: "unknown" });
    expect(explicit).toEqual({ kind: "explicit-error", message: "That request is invalid." });
    expect(isTemplatePaidConfirmAvailable(templateRunReducer(initialTemplateRunState(), { type: "unknown" }))).toBe(false);
    expect(isTemplatePaidConfirmAvailable(templateRunReducer(initialTemplateRunState(), {
      type: "explicit-error",
      message: explicit.kind === "explicit-error" ? explicit.message : "",
    }))).toBe(true);
  });

  it("makes an explicitly FAILED and refunded job retryable", () => {
    const generating = templateRunReducer(initialTemplateRunState(), { type: "start" });
    const failed = templateRunReducer(generating, { type: "failed" });

    expect(failed.phase).toBe("form");
    expect(failed.message).toBe("Generation failed. You weren't charged. Try again.");
    expect(isTemplatePaidConfirmAvailable(failed)).toBe(true);
  });

  it("only treats FAILED as refunded when the job has no committed result references", async () => {
    const wait = async () => {};
    const snapshots = [
      { status: "FAILED", urls: [], generationIds: [] },
      { status: "FAILED", urls: [], generationIds: ["gen-1"] },
      { status: "FAILED", urls: ["/result.png"], generationIds: [] },
      { status: "FAILED", urls: ["/result.png"], generationIds: ["gen-1"] },
    ];

    const outcomes = await Promise.all(snapshots.map((snapshot, index) => pollTemplateJob(`job-${index}`, {
      lookup: async () => snapshot,
      wait,
      attempts: 1,
    })));

    expect(outcomes).toEqual([
      { kind: "failed" },
      { kind: "unknown" },
      { kind: "unknown" },
      { kind: "unknown" },
    ]);
    for (const outcome of outcomes.slice(1)) {
      expect(outcome.kind).toBe("unknown");
      const state = templateRunReducer(initialTemplateRunState(), { type: "unknown" });
      expect(state.message).toBe("This didn't finish. Check your Library in a minute.");
      expect(isTemplatePaidConfirmAvailable(state)).toBe(false);
    }
  });

  it("classifies an explicit FAILED separately from a complete DONE delivery", async () => {
    const wait = async () => {};
    const failed = await pollTemplateJob("job-f", {
      lookup: async () => ({ status: "FAILED", urls: [], generationIds: [] }),
      wait,
      attempts: 1,
    });
    const done = await pollTemplateJob("job-d", {
      lookup: async () => ({ status: "DONE", urls: ["/result.png"], generationIds: ["gen-1"] }),
      wait,
      attempts: 1,
    });

    expect(failed).toEqual({ kind: "failed" });
    expect(done).toEqual({ kind: "done", url: "/result.png", genId: "gen-1" });
  });

  it("keeps explicit pre-start errors retryable and records a complete DONE result", () => {
    const preStartError = templateRunReducer(initialTemplateRunState(), {
      type: "explicit-error",
      message: "That generation request is out of bounds.",
    });
    expect(preStartError.phase).toBe("form");
    expect(isTemplatePaidConfirmAvailable(preStartError)).toBe(true);

    const done = templateRunReducer(initialTemplateRunState(), {
      type: "done",
      url: "https://example.test/result.png",
      genId: "gen-1",
    });
    expect(done).toMatchObject({
      phase: "done",
      resultUrl: "https://example.test/result.png",
      resultGenId: "gen-1",
    });
    expect(isTemplatePaidConfirmAvailable(done)).toBe(false);
  });
});
