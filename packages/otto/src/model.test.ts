import { describe, it, expect, vi } from "vitest";
import { isOverloadError, withOverloadFailover } from "./model.js";

describe("isOverloadError", () => {
  it("detects a raw 529 status code", () => {
    expect(isOverloadError({ statusCode: 529 })).toBe(true);
  });

  it("detects a realistic AI SDK retry wrapper (529 nested on .lastError)", () => {
    expect(isOverloadError({ name: "AI_RetryError", message: "Failed after 3 attempts. Last error: Overloaded", lastError: { statusCode: 529 } })).toBe(true);
  });

  it("does NOT trust a bare 'overload' text mention without a structured signal (P1)", () => {
    // A non-529 error whose message merely contains the word must NOT trigger failover.
    expect(isOverloadError({ name: "AI_RetryError", message: "Last error: Overloaded" })).toBe(false);
    expect(isOverloadError({ statusCode: 400, message: "request rejected: model overloaded with tokens" })).toBe(false);
  });

  it("detects the overloaded_error response body string", () => {
    expect(isOverloadError({ responseBody: '{"type":"error","error":{"type":"overloaded_error"}}' })).toBe(true);
  });

  it("detects a structured overloaded_error in .data", () => {
    expect(isOverloadError({ data: { error: { type: "overloaded_error" } } })).toBe(true);
  });

  it("unwraps a nested overload on .lastError", () => {
    expect(isOverloadError({ name: "AI_RetryError", message: "Failed", lastError: { statusCode: 529 } })).toBe(true);
  });

  it("unwraps a nested overload on .cause", () => {
    expect(isOverloadError({ message: "wrapped", cause: { responseBody: "overloaded_error" } })).toBe(true);
  });

  it("does NOT treat auth/other errors as overload", () => {
    expect(isOverloadError({ statusCode: 401, message: "Unauthorized" })).toBe(false);
    expect(isOverloadError({ statusCode: 500, message: "Internal" })).toBe(false);
    expect(isOverloadError({ name: "AI_APICallError", message: "Not Found", statusCode: 404 })).toBe(false);
  });

  it("is safe on non-objects", () => {
    expect(isOverloadError(null)).toBe(false);
    expect(isOverloadError(undefined)).toBe(false);
    expect(isOverloadError("Overloaded")).toBe(false); // string, not an error object
  });

  it("does not infinitely recurse on a self-referential cause", () => {
    const e: Record<string, unknown> = { message: "x" };
    e.cause = e;
    expect(isOverloadError(e)).toBe(false);
  });

  it("does not infinitely recurse on a two-object cycle (P2)", () => {
    const a: Record<string, unknown> = { message: "a" };
    const b: Record<string, unknown> = { message: "b" };
    a.cause = b;
    b.cause = a;
    expect(isOverloadError(a)).toBe(false);
  });

  it("checks BOTH lastError and cause, not just lastError (P2)", () => {
    // lastError present but non-overload; the real 529 hides on cause.
    expect(isOverloadError({ lastError: { statusCode: 500 }, cause: { statusCode: 529 } })).toBe(true);
  });
});

// Minimal LanguageModel stub: the wrapper only touches these 6 members.
function stubModel(over: Partial<{ doGenerate: unknown; doStream: unknown }> = {}) {
  return {
    specificationVersion: "v2",
    provider: "anthropic.messages",
    modelId: "stub-model",
    supportedUrls: {},
    doGenerate: vi.fn(async () => ({ tag: "gen" })),
    doStream: vi.fn(async () => ({ tag: "stream" })),
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("withOverloadFailover", () => {
  it("delegates identity members to the primary", () => {
    const primary = stubModel();
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    expect(w.specificationVersion).toBe("v2");
    expect(w.provider).toBe("anthropic.messages");
    expect(w.modelId).toBe("stub-model");
  });

  it("uses the primary when it succeeds — fallback is never called", async () => {
    const primary = stubModel();
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).resolves.toEqual({ tag: "gen" });
    expect(primary.doGenerate).toHaveBeenCalledTimes(1);
    expect(fallback.doGenerate).not.toHaveBeenCalled();
  });

  it("falls back ONLY on a 529 overload (doGenerate)", async () => {
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw { statusCode: 529 }; }) });
    const fallback = stubModel({ doGenerate: vi.fn(async () => ({ tag: "fallback-gen" })) });
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).resolves.toEqual({ tag: "fallback-gen" });
    expect(primary.doGenerate).toHaveBeenCalledTimes(1);
    expect(fallback.doGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back ONLY on a 529 overload (doStream)", async () => {
    const primary = stubModel({ doStream: vi.fn(async () => { throw { responseBody: "overloaded_error" }; }) });
    const fallback = stubModel({ doStream: vi.fn(async () => ({ tag: "fallback-stream" })) });
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doStream({} as never)).resolves.toEqual({ tag: "fallback-stream" });
    expect(fallback.doStream).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-overload error WITHOUT calling the fallback", async () => {
    const authErr = { statusCode: 401, message: "Unauthorized" };
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw authErr; }) });
    const fallback = stubModel();
    const w = withOverloadFailover(primary, fallback);
    await expect(w.doGenerate({} as never)).rejects.toBe(authErr);
    expect(fallback.doGenerate).not.toHaveBeenCalled();
  });
});
