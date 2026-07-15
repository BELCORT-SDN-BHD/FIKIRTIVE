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
    expect(unknown.message).toMatch(/Library/);
    expect(isTemplatePaidConfirmAvailable(unknown)).toBe(false);
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
    expect(failed.message).toMatch(/try again/i);
    expect(isTemplatePaidConfirmAvailable(failed)).toBe(true);
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
