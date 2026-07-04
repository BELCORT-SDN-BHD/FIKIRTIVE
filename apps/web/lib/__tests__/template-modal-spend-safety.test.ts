import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
});
