import { describe, it, expect, beforeAll } from "vitest";
import { signState, verifyState, buildAuthorizeUrl, META_GRAPH_VERSION } from "../meta-oauth";

beforeAll(() => { process.env.BETTER_AUTH_SECRET = "test-secret-123"; });

describe("OAuth state (HMAC, CSRF)", () => {
  it("round-trips the ownerId", () => {
    const s = signState("org_abc");
    expect(verifyState(s)).toEqual({ ownerId: "org_abc" });
  });
  it("rejects a tampered payload", () => {
    const s = signState("org_abc");
    const dot = s.lastIndexOf(".");
    const bad = "x" + s.slice(1, dot) + s.slice(dot); // mutate payload, keep sig
    expect(verifyState(bad)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const s = signState("org_abc");
    expect(verifyState(s.slice(0, -2) + "zz")).toBeNull();
  });
  it("rejects an expired state (>10 min)", () => {
    const t0 = 1_000_000_000_000;
    const s = signState("org_abc", t0);
    expect(verifyState(s, t0 + 11 * 60 * 1000)).toBeNull();
    expect(verifyState(s, t0 + 5 * 60 * 1000)).toEqual({ ownerId: "org_abc" });
  });
  it("rejects malformed input", () => {
    expect(verifyState("garbage")).toBeNull();
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests ads_read with the redirect + state", () => {
    const u = new URL(buildAuthorizeUrl("APPID", "https://app/api/meta/callback", "STATE"));
    expect(u.hostname).toBe("www.facebook.com");
    expect(u.pathname).toContain(META_GRAPH_VERSION);
    expect(u.searchParams.get("client_id")).toBe("APPID");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/api/meta/callback");
    expect(u.searchParams.get("scope")).toBe("ads_read");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});
