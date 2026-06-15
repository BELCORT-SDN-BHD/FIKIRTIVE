import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransport, FalTransport, MockTransport } from "./cowork-transport.js";
import type { ChatMessage } from "./cowork.js";

const ENDPOINT = "https://fal.run/openrouter/router/openai/v1/chat/completions";
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COWORK_PROVIDER;
  delete process.env.FAL_KEY;
});

describe("createTransport (R4: explicit COWORK_PROVIDER gate)", () => {
  it("defaults to MockTransport when COWORK_PROVIDER is unset (even with FAL_KEY)", () => {
    process.env.FAL_KEY = "sk-present";
    const t = createTransport();
    expect(t).toBeInstanceOf(MockTransport);
    expect(t.name).toBe("mock");
  });

  it("COWORK_PROVIDER=fal + FAL_KEY → FalTransport named fal:llm", () => {
    process.env.COWORK_PROVIDER = "fal";
    process.env.FAL_KEY = "sk-present";
    const t = createTransport();
    expect(t).toBeInstanceOf(FalTransport);
    expect(t.name).toBe("fal:llm");
  });

  it("COWORK_PROVIDER=fal but no FAL_KEY → throws (fail-loud, never silent-mock)", () => {
    process.env.COWORK_PROVIDER = "fal";
    expect(() => createTransport()).toThrow("COWORK_PROVIDER=fal but FAL_KEY is not set");
  });
});

describe("MockTransport", () => {
  it("returns the skill's mockReply verbatim, ignoring messages", async () => {
    const out = await new MockTransport().chat("draftStoryboard", MESSAGES, { mockReply: () => "canned-$0" });
    expect(out).toEqual({ text: "canned-$0" });
  });

  it("throws if a skill forgot to supply a mockReply", async () => {
    await expect(new MockTransport().chat("x", MESSAGES)).rejects.toThrow();
  });
});

describe("FalTransport", () => {
  it("POSTs the exact OpenRouter envelope and returns choices[0].message.content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "the reply" } }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const out = await new FalTransport("KEY123").chat("draftStoryboard", MESSAGES);

    expect(out).toEqual({ text: "the reply" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Key KEY123", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "anthropic/claude-sonnet-4.5", messages: MESSAGES }),
    });
  });

  it("missing content → empty text (skill.parse decides what to do)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await new FalTransport("K").chat("x", MESSAGES)).toEqual({ text: "" });
  });

  it("non-2xx → throws the exact `fal llm → status: detail` error (detail clamped 300)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "u".repeat(400) }),
    );
    await expect(new FalTransport("K").chat("x", MESSAGES)).rejects.toThrow(
      `fal llm → 503: ${"u".repeat(300)}`,
    );
  });

  it("name encodes the transport for the audit `via` field", () => {
    expect(new FalTransport("K").name).toBe("fal:llm");
  });

  it("FalTransport forwards response_format + max_tokens in the request body", async () => {
    let sentBody: any;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: any) => { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) }; }) as any;
    try {
      const { FalTransport } = await import("./cowork-transport.js");
      await new FalTransport("k").chat("planner", [{ role: "user", content: "hi" }], { responseFormat: "json_object", maxTokens: 1500 });
      expect(sentBody.response_format).toEqual({ type: "json_object" });
      expect(sentBody.max_tokens).toBe(1500);
    } finally { globalThis.fetch = orig; }
  });
});
