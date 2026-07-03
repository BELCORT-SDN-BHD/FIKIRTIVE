import { describe, it, expect, vi } from "vitest";
import { executeIngestProduct, ingestProductSkill } from "./ingest-product.js";
import type { OttoContext } from "../context.js";

describe("ingestProduct gate", () => {
  it("free/read/external → not gated (external READ is never approval-gated)", () => {
    expect(ingestProductSkill.cost).toBe("free");
    expect(ingestProductSkill.effect).toBe("read");
    expect(ingestProductSkill.reach).toBe("external");
    expect(ingestProductSkill.needsApproval).toBe(false);
  });
});

describe("executeIngestProduct", () => {
  it("port missing (e.g. minimal worker ctx) → graceful error, does not throw", async () => {
    const res = await executeIngestProduct(
      { url: "https://shop.example.com/p" },
      { context: { orgId: "o" } as unknown as OttoContext },
    );
    expect(res).toHaveProperty("error");
  });

  it("returns the deterministic draft + page text so Otto can fill gaps and confirm", async () => {
    const draft = { name: "Latte", price: "RM 49", sourceUrl: "https://shop.example.com/p", filled: ["name", "price"] };
    const fromUrl = vi.fn().mockResolvedValue({ draft, text: "page text here" });
    const res = await executeIngestProduct(
      { url: "https://shop.example.com/p" },
      { context: { productIngest: { fromUrl } } as unknown as OttoContext },
    );
    expect(res).toMatchObject({ draft, pageText: "page text here" });
    expect(fromUrl).toHaveBeenCalledWith("https://shop.example.com/p");
    // Otto must be told not to fabricate a price (grounded-no-fabrication).
    expect(JSON.stringify(res)).toMatch(/saveProduct/i);
  });

  it("port returns an error → surfaces it, no throw", async () => {
    const fromUrl = vi.fn().mockResolvedValue({ error: "Couldn't read that URL." });
    const res = await executeIngestProduct(
      { url: "https://shop.example.com/p" },
      { context: { productIngest: { fromUrl } } as unknown as OttoContext },
    );
    expect(res).toEqual({ error: "Couldn't read that URL." });
  });
});
