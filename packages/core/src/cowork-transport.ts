/**
 * Cowork TRANSPORT — the model-neutral port impls. mock ($0, deterministic) and
 * fal (one fetch to the OpenAI-compatible OpenRouter endpoint → Claude). The two
 * old FalCoworkProvider methods shared an identical fetch envelope; that envelope
 * is this one place now. Swapping to a self-hosted model later = a third class
 * here, with zero skill edits. The factory mirrors createGenerationProvider:
 * explicit COWORK_PROVIDER=fal opt-in, else mock — so a stray FAL_KEY can't
 * silently spend on cowork.
 */
import type { ChatMessage, CoworkTransport } from "./cowork.js";

/** $0, offline. Returns the skill's own canned reply — the transport never
 *  inspects messages, so it stays skill-agnostic (the skill owns its mock). */
export class MockTransport implements CoworkTransport {
  readonly name = "mock";
  async chat(_skillId: string, _messages: ChatMessage[], opts?: { mockReply?: () => string }): Promise<{ text: string }> {
    if (!opts?.mockReply) throw new Error("MockTransport: skill did not supply a mockReply");
    return { text: opts.mockReply() };
  }
}

/** Real cowork — a fal-hosted LLM via the OpenAI-compatible OpenRouter endpoint
 *  (reuses FAL_KEY; routes to Claude). Returns raw text; the skill parses it. */
export class FalTransport implements CoworkTransport {
  readonly name = "fal:llm";
  constructor(
    private apiKey: string,
    private model = "anthropic/claude-sonnet-4.5",
  ) {}
  async chat(_skillId: string, messages: ChatMessage[]): Promise<{ text: string }> {
    const res = await fetch("https://fal.run/openrouter/router/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`fal llm → ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? "" };
  }
}

/**
 * COWORK_PROVIDER=fal needs FAL_KEY. Anything else (incl. unset) is the mock —
 * safe by default so a misconfigured prod can't silently burn money on cowork,
 * and dev/tracer never touch the network. Mirrors createGenerationProvider.
 */
export function createTransport(): CoworkTransport {
  if (process.env.COWORK_PROVIDER === "fal") {
    const key = process.env.FAL_KEY;
    if (!key) throw new Error("COWORK_PROVIDER=fal but FAL_KEY is not set");
    return new FalTransport(key);
  }
  return new MockTransport();
}
