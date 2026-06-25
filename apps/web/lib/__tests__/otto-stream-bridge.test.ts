/**
 * otto-stream-bridge.test.ts — unit tests for the PURE bridgeEvent(event) mapper.
 *
 * bridgeEvent maps ONE @openai/agents-core RunStreamEvent to ONE Vercel AI SDK
 * UIMessageChunk (or null when the event has no client-facing part). It is pure:
 * no DB, no SDK construction, no I/O — so it is fully unit-testable here without
 * mocking. The route handler (otto/stream/route.ts) owns text-start/-end framing
 * and the writer; this mapper only computes the per-event part.
 *
 * Event/item shapes are taken VERBATIM from the installed
 * @openai/agents-core@0.11.8 dist .d.ts:
 *   - RunRawModelStreamEvent: { type:'raw_model_stream_event', data: ResponseStreamEvent }
 *       token delta: data = { type:'output_text_delta', delta:string }
 *   - RunItemStreamEvent: { type:'run_item_stream_event', name, item: RunItem }
 *       name ∈ 'tool_called' | 'tool_output' | 'reasoning_item_created' | ...
 *       tool_called  item: RunToolCallItem      → item.rawItem.name === 'propose'
 *       tool_output  item: RunToolCallOutputItem → item.rawItem.name, item.output (return value)
 *       reasoning    item: RunReasoningItem      → item.rawItem.content[].text
 *
 * AI SDK part-type strings (ai@6.0.208 UIMessageChunk union):
 *   text:      'text-delta'   { delta, id }
 *   reasoning: 'reasoning-delta' { delta, id }
 *   data part: 'data-${string}' { data }  → we use 'data-status' and 'data-tool-propose'
 */
import { describe, it, expect } from "vitest";
import { bridgeEvent } from "@/lib/otto-stream-bridge";

// ── Helpers to build minimal events with the verified shapes ─────────────────

function tokenEvent(delta: string) {
  return {
    type: "raw_model_stream_event" as const,
    data: { type: "output_text_delta", delta },
  };
}

function toolCalledEvent(toolName: string, args: Record<string, unknown> = {}) {
  return {
    type: "run_item_stream_event" as const,
    name: "tool_called" as const,
    item: {
      type: "tool_call_item",
      rawItem: { type: "function_call", name: toolName, callId: "call_1", arguments: JSON.stringify(args) },
    },
  };
}

function toolOutputEvent(toolName: string, output: unknown) {
  return {
    type: "run_item_stream_event" as const,
    name: "tool_output" as const,
    item: {
      type: "tool_call_output_item",
      output,
      rawItem: { type: "function_call_result", name: toolName, callId: "call_1", output: String(output) },
    },
  };
}

function reasoningEvent(text: string) {
  return {
    type: "run_item_stream_event" as const,
    name: "reasoning_item_created" as const,
    item: {
      type: "reasoning_item",
      rawItem: { type: "reasoning", content: [{ type: "input_text", text }] },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("bridgeEvent — token (raw_model_stream_event)", () => {
  it("maps an output_text_delta to a text-delta part carrying the delta", () => {
    const part = bridgeEvent(tokenEvent("Hel"));
    expect(part).toMatchObject({ type: "text-delta", delta: "Hel" });
    expect((part as { id?: string }).id).toBeTruthy();
  });

  it("ignores non-text raw events (returns null)", () => {
    const part = bridgeEvent({
      type: "raw_model_stream_event" as const,
      data: { type: "response_done", response: { id: "r", usage: {}, output: [] } },
    });
    expect(part).toBeNull();
  });
});

describe("bridgeEvent — tool_called(propose)", () => {
  it("maps to a data-status part announcing the plan is being built", () => {
    const part = bridgeEvent(toolCalledEvent("propose", { kind: "image" }));
    expect(part).not.toBeNull();
    expect((part as { type: string }).type).toBe("data-status");
    // carries some human-facing status text under .data
    const data = (part as { data: { text: string } }).data;
    expect(typeof data.text).toBe("string");
    expect(data.text.length).toBeGreaterThan(0);
  });

  it("ignores tool_called for non-propose tools (returns null)", () => {
    expect(bridgeEvent(toolCalledEvent("setTitle"))).toBeNull();
  });
});

describe("bridgeEvent — tool_output(propose)", () => {
  it("maps to a data-tool-propose part carrying the tool output (cardId + payload)", () => {
    const output = { cardId: "card_123", shownPriceDisplay: 40 };
    const part = bridgeEvent(toolOutputEvent("propose", output));
    expect(part).not.toBeNull();
    expect((part as { type: string }).type).toBe("data-tool-propose");
    expect((part as { data: unknown }).data).toEqual(output);
  });

  it("ignores tool_output for non-propose tools (returns null)", () => {
    expect(bridgeEvent(toolOutputEvent("setTitle", { ok: true }))).toBeNull();
  });
});

describe("bridgeEvent — reasoning_item_created", () => {
  it("maps to a reasoning-delta part carrying the reasoning text", () => {
    const part = bridgeEvent(reasoningEvent("thinking about composition"));
    expect(part).not.toBeNull();
    expect((part as { type: string }).type).toBe("reasoning-delta");
    expect((part as { delta: string }).delta).toBe("thinking about composition");
    expect((part as { id?: string }).id).toBeTruthy();
  });
});

describe("bridgeEvent — unhandled events", () => {
  it("returns null for agent_updated_stream_event", () => {
    expect(bridgeEvent({ type: "agent_updated_stream_event" } as never)).toBeNull();
  });

  it("returns null for run_item events that have no client-facing part", () => {
    expect(
      bridgeEvent({
        type: "run_item_stream_event" as const,
        name: "message_output_created" as const,
        item: { type: "message_output_item", rawItem: { content: [] } },
      }),
    ).toBeNull();
  });
});
