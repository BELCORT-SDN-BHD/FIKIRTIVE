import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isOverloadError,
  withOverloadFailover,
  injectPromptCacheControl,
  ottoPromptCacheEnabled,
  withPromptCaching,
} from "./model.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Prompt caching (engine spec §2.2 Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Realistic CallOptions shape: leading system message (Otto instructions) + history + tools. */
function callOptions() {
  return {
    prompt: [
      { role: "system", content: "You are Otto." },
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ],
    tools: [
      { type: "function", name: "propose", description: "d", inputSchema: {} },
      { type: "function", name: "generate", description: "d", inputSchema: {} },
      { type: "function", name: "setTitle", description: "d", inputSchema: {} },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Count entries carrying the anthropic ephemeral marker. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cacheMarkers(entries: any[]): number {
  return entries.filter((e) => e?.providerOptions?.anthropic?.cacheControl?.type === "ephemeral").length;
}

const ENV_KEY = "OTTO_PROMPT_CACHE";
let savedEnv: string | undefined;
beforeEach(() => { savedEnv = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("ottoPromptCacheEnabled (kill switch)", () => {
  it("defaults ON when the env var is unset", () => {
    expect(ottoPromptCacheEnabled()).toBe(true);
  });

  it.each(["0", "false", "off", "FALSE", "Off", " 0 "])("'%s' disables it", (v) => {
    process.env[ENV_KEY] = v;
    expect(ottoPromptCacheEnabled()).toBe(false);
  });

  it.each(["1", "true", "on", "yes", ""])("'%s' keeps it enabled", (v) => {
    process.env[ENV_KEY] = v;
    expect(ottoPromptCacheEnabled()).toBe(true);
  });
});

describe("injectPromptCacheControl", () => {
  it("marks EXACTLY the system + last-tool boundary: one marker on the leading system message, one on the last tool", () => {
    const out = injectPromptCacheControl(callOptions()) as ReturnType<typeof callOptions>;

    // system boundary: exactly one marked message, and it is prompt[0]
    expect(cacheMarkers(out.prompt)).toBe(1);
    expect(out.prompt[0].role).toBe("system");
    expect(out.prompt[0].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });

    // tools boundary: exactly one marked tool, and it is the LAST one
    expect(cacheMarkers(out.tools)).toBe(1);
    expect(out.tools[2].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });
    expect(out.tools[0].providerOptions).toBeUndefined();
    expect(out.tools[1].providerOptions).toBeUndefined();
  });

  it("leaves history messages (user/assistant) unmarked — only the constant prefix is cached", () => {
    const out = injectPromptCacheControl(callOptions()) as ReturnType<typeof callOptions>;
    expect(out.prompt[1].providerOptions).toBeUndefined();
    expect(out.prompt[2].providerOptions).toBeUndefined();
  });

  it("does NOT mutate its input (copy-on-write)", () => {
    const options = callOptions();
    const snapshot = JSON.parse(JSON.stringify(options));
    injectPromptCacheControl(options);
    expect(options).toEqual(snapshot);
  });

  it("skips the system marker when the first message is not a system message", () => {
    const options = callOptions();
    options.prompt = options.prompt.slice(1); // no leading system
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(cacheMarkers(out.prompt)).toBe(0);
    expect(cacheMarkers(out.tools)).toBe(1); // tools boundary still marked
  });

  it("skips the tool marker when there are no tools", () => {
    const options = callOptions();
    delete options.tools;
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(out.tools).toBeUndefined();
    expect(cacheMarkers(out.prompt)).toBe(1);
  });

  it("preserves pre-existing providerOptions keys when merging the marker", () => {
    const options = callOptions();
    options.prompt[0] = { ...options.prompt[0], providerOptions: { anthropic: { other: "x" }, someProvider: { y: 1 } } };
    const out = injectPromptCacheControl(options) as ReturnType<typeof callOptions>;
    expect(out.prompt[0].providerOptions.anthropic.other).toBe("x");
    expect(out.prompt[0].providerOptions.someProvider).toEqual({ y: 1 });
    expect(out.prompt[0].providerOptions.anthropic.cacheControl).toEqual({ type: "ephemeral" });
  });
});

describe("withPromptCaching", () => {
  it("delegates identity members to the wrapped model", () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    expect(w.specificationVersion).toBe("v2");
    expect(w.provider).toBe("anthropic.messages");
    expect(w.modelId).toBe("stub-model");
  });

  it("ON (default): doGenerate receives transformed params with both markers, injected exactly once", async () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    await w.doGenerate(callOptions());
    const passed = inner.doGenerate.mock.calls[0][0];
    expect(cacheMarkers(passed.prompt)).toBe(1);
    expect(cacheMarkers(passed.tools)).toBe(1);
  });

  it("ON (default): doStream receives transformed params with both markers", async () => {
    const inner = stubModel();
    const w = withPromptCaching(inner);
    await w.doStream(callOptions());
    const passed = inner.doStream.mock.calls[0][0];
    expect(cacheMarkers(passed.prompt)).toBe(1);
    expect(cacheMarkers(passed.tools)).toBe(1);
  });

  it.each(["0", "false", "off"])("kill switch '%s': params pass through UNTOUCHED (same reference, no markers)", async (v) => {
    process.env[ENV_KEY] = v;
    const inner = stubModel();
    const w = withPromptCaching(inner);
    const options = callOptions();
    await w.doGenerate(options);
    await w.doStream(options);
    // Bypass = byte-identical request: the very same object, zero markers added.
    expect(inner.doGenerate.mock.calls[0][0]).toBe(options);
    expect(inner.doStream.mock.calls[0][0]).toBe(options);
    expect(cacheMarkers(options.prompt)).toBe(0);
    expect(cacheMarkers(options.tools)).toBe(0);
  });

  it("composes with withOverloadFailover: markers reach the fallback on a 529 (V3)", async () => {
    const primary = stubModel({ doGenerate: vi.fn(async () => { throw { statusCode: 529 }; }) });
    const fallback = stubModel();
    const w = withPromptCaching(withOverloadFailover(primary, fallback));
    await w.doGenerate(callOptions());
    const passedToFallback = fallback.doGenerate.mock.calls[0][0];
    expect(cacheMarkers(passedToFallback.prompt)).toBe(1);
    expect(cacheMarkers(passedToFallback.tools)).toBe(1);
  });
});
