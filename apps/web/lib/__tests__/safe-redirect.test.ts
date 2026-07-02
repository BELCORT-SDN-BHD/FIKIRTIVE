import { describe, it, expect } from "vitest";
import { sanitizeCallbackURL } from "../safe-redirect";

describe("sanitizeCallbackURL", () => {
  it("keeps a normal same-origin path", () => {
    expect(sanitizeCallbackURL("/dashboard")).toBe("/dashboard");
    expect(sanitizeCallbackURL("/projects/abc?tab=1")).toBe("/projects/abc?tab=1");
    expect(sanitizeCallbackURL("/")).toBe("/");
  });

  it("rejects protocol-relative URLs (//evil.com) — the F14 open redirect", () => {
    expect(sanitizeCallbackURL("//evil.com")).toBe("/");
    expect(sanitizeCallbackURL("//evil.com/path")).toBe("/");
  });

  it("rejects backslash-smuggled protocol-relative forms (/\\evil.com)", () => {
    expect(sanitizeCallbackURL("/\\evil.com")).toBe("/");
    expect(sanitizeCallbackURL("/\\/evil.com")).toBe("/");
  });

  it("rejects absolute URLs with a scheme", () => {
    expect(sanitizeCallbackURL("https://evil.com")).toBe("/");
    expect(sanitizeCallbackURL("javascript:alert(1)")).toBe("/");
  });

  it("rejects empty/relative-without-slash input", () => {
    expect(sanitizeCallbackURL("")).toBe("/");
    expect(sanitizeCallbackURL("evil.com")).toBe("/");
    expect(sanitizeCallbackURL(undefined)).toBe("/");
  });
});
