import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransport, FalTransport, ModalTransport, MockTransport } from "./cowork-transport.js";
import type { ChatContentPart, ChatMessage } from "./cowork.js";

const ENDPOINT = "https://fal.run/openrouter/router/openai/v1/chat/completions";
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hi" },
];

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COWORK_PROVIDER;
  delete process.env.FAL_KEY;
  delete process.env.MODAL_LLM_ENDPOINT;
  delete process.env.MODAL_LLM_KEY;
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

describe("createTransport provider matrix", () => {
  it("1. COWORK_PROVIDER unset → MockTransport", () => {
    delete process.env.COWORK_PROVIDER;
    const t = createTransport();
    expect(t).toBeInstanceOf(MockTransport);
    expect(t.name).toBe("mock");
  });

  it("2. COWORK_PROVIDER=fal + no FAL_KEY → throws", () => {
    process.env.COWORK_PROVIDER = "fal";
    delete process.env.FAL_KEY;
    expect(() => createTransport()).toThrow("COWORK_PROVIDER=fal but FAL_KEY is not set");
  });

  it("3. COWORK_PROVIDER=fal + FAL_KEY → FalTransport", () => {
    process.env.COWORK_PROVIDER = "fal";
    process.env.FAL_KEY = "x";
    const t = createTransport();
    expect(t).toBeInstanceOf(FalTransport);
  });

  it("4. COWORK_PROVIDER=modal + neither env → throws", () => {
    process.env.COWORK_PROVIDER = "modal";
    delete process.env.MODAL_LLM_ENDPOINT;
    delete process.env.MODAL_LLM_KEY;
    expect(() => createTransport()).toThrow("COWORK_PROVIDER=modal but MODAL_LLM_ENDPOINT or MODAL_LLM_KEY is not set");
  });

  it("5. COWORK_PROVIDER=modal + only endpoint (no key) → throws", () => {
    process.env.COWORK_PROVIDER = "modal";
    process.env.MODAL_LLM_ENDPOINT = "https://my.modal.run";
    delete process.env.MODAL_LLM_KEY;
    expect(() => createTransport()).toThrow("COWORK_PROVIDER=modal but MODAL_LLM_ENDPOINT or MODAL_LLM_KEY is not set");
  });

  it("6. COWORK_PROVIDER=modal + both envs → ModalTransport", () => {
    process.env.COWORK_PROVIDER = "modal";
    process.env.MODAL_LLM_ENDPOINT = "https://my.modal.run";
    process.env.MODAL_LLM_KEY = "secret";
    const t = createTransport();
    expect(t).toBeInstanceOf(ModalTransport);
    expect(t.name).toBe("modal");
  });

  it("7. COWORK_PROVIDER=garbage → MockTransport (default-safe)", () => {
    process.env.COWORK_PROVIDER = "garbage";
    const t = createTransport();
    expect(t).toBeInstanceOf(MockTransport);
    expect(t.name).toBe("mock");
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

describe("ModalTransport", () => {
  it("POSTs to endpoint/v1/chat/completions (trailing slash collapsed), Bearer auth, returns choices[0].message.content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: "modal reply" } }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const out = await new ModalTransport("https://x.modal.run/", "k").chat("planner", [{ role: "user", content: "hi" }]);

    expect(out).toEqual({ text: "modal reply" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://x.modal.run/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer k" });
  });

  it("non-2xx → throws error containing the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "bad gateway" }),
    );
    await expect(new ModalTransport("https://x.modal.run", "k").chat("planner", [{ role: "user", content: "hi" }])).rejects.toThrow(
      "modal llm → 502: bad gateway",
    );
  });

  it("forwards multimodal array content in the request body verbatim", async () => {
    const parts: ChatContentPart[] = [
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: "https://img/a.png" } },
    ];
    const msg: ChatMessage = { role: "user", content: parts };

    let sentBody: any;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await new ModalTransport("https://x.modal.run", "k").chat("planner", [msg]);

    expect(sentBody.messages[0].content).toEqual(parts);
  });

  it("name is modal", () => {
    expect(new ModalTransport("https://x.modal.run", "k").name).toBe("modal");
  });
});

describe("ChatMessage multimodal content (additive type widening)", () => {
  it("array-content ChatMessage is assignable to ChatMessage (type-level)", () => {
    // This is a compile-time assertion: if ChatMessage.content only accepted string,
    // the line below would be a TS error. The test passing = the widening is correct.
    const parts: ChatContentPart[] = [
      { type: "text", text: "describe this image" },
      { type: "image_url", image_url: { url: "https://x/y.png" } },
    ];
    const msg: ChatMessage = { role: "user", content: parts };
    expect(msg.role).toBe("user");
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("MockTransport.chat with array-content message returns mockReply (ignores content)", async () => {
    const parts: ChatContentPart[] = [
      { type: "text", text: "describe this image" },
      { type: "image_url", image_url: { url: "https://x/y.png" } },
    ];
    const msg: ChatMessage = { role: "user", content: parts };
    const out = await new MockTransport().chat("vision-skill", [msg], { mockReply: () => "ok" });
    expect(out).toEqual({ text: "ok" });
  });

  it("string-content ChatMessage still works (back-compat)", async () => {
    const msg: ChatMessage = { role: "user", content: "plain text" };
    const out = await new MockTransport().chat("text-skill", [msg], { mockReply: () => "back-compat" });
    expect(out).toEqual({ text: "back-compat" });
  });
});
