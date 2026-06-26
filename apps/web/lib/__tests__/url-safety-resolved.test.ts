import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DNS so we can simulate a public hostname whose A/AAAA record points at a private IP
// (the DNS-rebinding SSRF the lexical assertPublicHttpUrl alone cannot catch).
const lookup = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup }));

const { assertPublicHttpUrlResolved } = await import("@/lib/url-safety");

beforeEach(() => vi.clearAllMocks());

describe("assertPublicHttpUrlResolved — DNS-rebinding guard (audit #45)", () => {
  it("rejects a public hostname resolving to cloud-metadata 169.254.169.254", async () => {
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertPublicHttpUrlResolved("https://evil.example.com")).rejects.toThrow(/private|reserved/i);
  });

  it("rejects a public hostname resolving to loopback", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicHttpUrlResolved("https://rebind.example.com")).rejects.toThrow(/private|reserved/i);
  });

  it("rejects when ANY resolved address is private (public + private mix)", async () => {
    lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertPublicHttpUrlResolved("https://mixed.example.com")).rejects.toThrow(/private|reserved/i);
  });

  it("rejects a private/loopback IPv6 resolution", async () => {
    lookup.mockResolvedValue([{ address: "::1", family: 6 }]);
    await expect(assertPublicHttpUrlResolved("https://v6.example.com")).rejects.toThrow(/private|reserved/i);
  });

  it("accepts a hostname resolving only to a public IP", async () => {
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertPublicHttpUrlResolved("https://example.com/path");
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe("example.com");
    expect(lookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects lexically-bad URLs BEFORE doing any DNS lookup", async () => {
    await expect(assertPublicHttpUrlResolved("https://127.0.0.1")).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("throws a clear error when the hostname does not resolve", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertPublicHttpUrlResolved("https://nope.example.com")).rejects.toThrow(/resolve/i);
  });
});
