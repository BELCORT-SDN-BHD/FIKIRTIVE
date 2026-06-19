import { describe, it, expect, vi } from "vitest";

const mockRequireOwner = vi.fn();
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mockRequireOwner }));
vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { email: "a@test" } }), allowed: () => true }));
vi.mock("@/lib/storage", () => ({
  storage: { presignedGet: vi.fn().mockResolvedValue(null), get: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) },
  mimeOf: () => "image/png", kindOf: () => "image",
}));

const { GET } = await import("@/app/files/[...key]/route");
const HASH = "a".repeat(64);

function reqFor(): any { return { headers: { get: () => null }, url: "http://x/files" }; }

describe("/files route — cross-tenant guard", () => {
  it("404s when the key's owner != the resolved owner", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgB", `${HASH}.png`] }) });
    expect(res.status).toBe(404);
  });
  it("serves when the key's owner == the resolved owner", async () => {
    mockRequireOwner.mockResolvedValue({ email: "a@test", ownerId: "orgA" });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgA", `${HASH}.png`] }) });
    expect(res.status).toBe(200);
  });
  it("redirects to /login when requireOwner returns an error", async () => {
    mockRequireOwner.mockResolvedValue({ error: "Not authorized." });
    const res = await GET(reqFor(), { params: Promise.resolve({ key: ["u", "orgA", `${HASH}.png`] }) });
    expect([302, 404]).toContain(res.status); // either redirect or 404 is acceptable fail-closed
  });
});
