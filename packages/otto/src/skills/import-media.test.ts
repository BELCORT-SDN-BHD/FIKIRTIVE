import { describe, it, expect, vi } from "vitest";
import { executeImportMedia, importMediaSkill } from "./import-media.js";
import type { OttoContext } from "../context.js";

// W-B3-B (parity debts 14,15,78,79,80,81,82 / E1-17): importMedia routes through the injected
// ctx.mediaImport port — a server-side SSRF-guarded fetch → storage → the SAME finalize authority
// the human upload lands through. $0 by construction (a startGen spy that throws proves it).

type ImportPort = NonNullable<OttoContext["mediaImport"]>;

function makeCtx(mediaImport?: ImportPort): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    sourceGenerationId: null,
    startGen: () => {
      throw new Error("$0 skill must never call startGen");
    },
    ...(mediaImport ? { mediaImport } : {}),
  } as unknown as OttoContext;
}

describe("importMedia registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`importMedia\`");
  });
});

describe("importMedia gate", () => {
  it("free/write/internal → needsApproval false ($0 import, same as the human upload)", () => {
    expect(importMediaSkill.cost).toBe("free");
    expect(importMediaSkill.effect).toBe("write");
    expect(importMediaSkill.reach).toBe("internal");
    expect(importMediaSkill.needsApproval).toBe(false);
  });
  it("declares url as a required field (the model asks before calling)", () => {
    expect(importMediaSkill.requires.some((r) => r.field === "url")).toBe(true);
  });
});

describe("executeImportMedia — port required", () => {
  it("degrades gracefully when ctx.mediaImport is not injected", async () => {
    const res = await executeImportMedia({ url: "https://cdn.example.com/x.png" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "Importing media isn't available right now." });
  });
});

describe("fromUrl routing", () => {
  it("returns the new generation id on success", async () => {
    const fromUrl = vi.fn(async () => ({ ok: true as const, generationId: "gen-9" }));
    const res = await executeImportMedia({ url: "https://cdn.example.com/x.png" }, { context: makeCtx({ fromUrl }) });
    expect(res).toEqual({ ok: true, generationId: "gen-9" });
    expect(fromUrl).toHaveBeenCalledWith("https://cdn.example.com/x.png", {});
  });
  it("threads promptText + entityIds to the port", async () => {
    const fromUrl = vi.fn(async () => ({ ok: true as const, generationId: "gen-1" }));
    await executeImportMedia(
      { url: "https://cdn.example.com/x.jpg", promptText: "hero ref", entityIds: ["e1", "e2"] },
      { context: makeCtx({ fromUrl }) },
    );
    expect(fromUrl).toHaveBeenCalledWith("https://cdn.example.com/x.jpg", { promptText: "hero ref", entityIds: ["e1", "e2"] });
  });
  it("surfaces an SSRF / fetch refusal honestly", async () => {
    const fromUrl = vi.fn(async () => ({ error: "That URL isn't a reachable public http(s) address." }));
    const res = (await executeImportMedia({ url: "http://169.254.169.254/latest" }, { context: makeCtx({ fromUrl }) })) as {
      ok: boolean; error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("public http(s)");
  });
  it("surfaces an unsupported-type refusal", async () => {
    const fromUrl = vi.fn(async () => ({ error: "Couldn't tell what kind of file that URL is (need a png/jpg/webp/gif/avif/mp4/mov/webm)." }));
    const res = (await executeImportMedia({ url: "https://cdn.example.com/doc.pdf" }, { context: makeCtx({ fromUrl }) })) as {
      ok: boolean; error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("kind of file");
  });
});
