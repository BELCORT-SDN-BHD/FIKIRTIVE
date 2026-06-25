/**
 * otto-stream-bridge — PURE event→part mapper for the streaming route handler.
 *
 * bridgeEvent maps ONE @openai/agents-core RunStreamEvent to ONE Vercel AI SDK
 * UIMessageChunk, or null when the event carries nothing the client needs. It is
 * pure (no DB, no SDK construction, no I/O) so it is unit-tested directly. The
 * route handler owns the writer + the text-start/text-end framing; this module
 * only computes the per-event part.
 *
 * Source-of-truth shapes (installed @openai/agents-core@0.11.8 dist .d.ts):
 *   RunRawModelStreamEvent  { type:'raw_model_stream_event', data: ResponseStreamEvent }
 *       token delta:        data = { type:'output_text_delta', delta:string }
 *   RunItemStreamEvent      { type:'run_item_stream_event', name, item: RunItem }
 *       name values:        'tool_called' | 'tool_output' | 'reasoning_item_created' | …
 *       tool_called   item: RunToolCallItem        → item.rawItem.name (FunctionCallItem.name)
 *       tool_output   item: RunToolCallOutputItem  → item.rawItem.name, item.output (return value)
 *       reasoning     item: RunReasoningItem       → item.rawItem.content[].text (input_text)
 *   RunAgentUpdatedStreamEvent { type:'agent_updated_stream_event' }
 *
 * AI SDK part-type strings for THIS installed version (ai@6.0.208 UIMessageChunk union):
 *   text:      { type:'text-delta',      delta:string, id:string }
 *   reasoning: { type:'reasoning-delta', delta:string, id:string }
 *   data part: { type:`data-${string}`,  data:unknown }
 *              We emit 'data-status' (tool_called → "planning…") and
 *              'data-tool-propose' (tool_output → { cardId, … } the propose tool returned).
 *              ('tool-propose' is a custom inline part; the data-* channel is the
 *               AI SDK's typed extension point, and the client renders it in Task 5.)
 */

// Minimal structural type for the part we emit. We intentionally type the OUTPUT
// structurally (not as the full UIMessageChunk union) so this module stays free of
// any `ai` import — keeping it a pure, dependency-light unit. The route handler
// passes the result straight to writer.write(...), which is typed against the SDK.
export type OttoStreamPart =
  | { type: "text-delta"; delta: string; id: string }
  | { type: "reasoning-delta"; delta: string; id: string }
  | { type: "data-status"; data: { text: string } }
  | { type: "data-tool-propose"; data: unknown };

// Stable ids so all deltas of one turn coalesce into a single text / reasoning part.
// The route opens text-start/-end with the SAME id around the event loop.
export const OTTO_TEXT_ID = "otto-text";
export const OTTO_REASONING_ID = "otto-reasoning";

/** Read the tool name off a run_item event's item, tolerant of item shape. */
function toolNameOf(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const raw = (item as { rawItem?: { name?: unknown } }).rawItem;
  const name = raw?.name;
  return typeof name === "string" ? name : undefined;
}

/** Join the text of a reasoning item's content entries. */
function reasoningTextOf(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const content = (item as { rawItem?: { content?: unknown } }).rawItem?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .join("");
}

/**
 * Map one streaming event to a UI-message-stream part, or null if it carries no
 * client-facing content. Typed input as `unknown` to keep the mapper decoupled
 * from the SDK's event classes (it discriminates structurally on `.type`/`.name`).
 */
export function bridgeEvent(event: unknown): OttoStreamPart | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown };

  // 1) Raw model token deltas → text-delta
  if (e.type === "raw_model_stream_event") {
    const data = (event as { data?: { type?: unknown; delta?: unknown } }).data;
    if (data?.type === "output_text_delta" && typeof data.delta === "string") {
      return { type: "text-delta", delta: data.delta, id: OTTO_TEXT_ID };
    }
    return null;
  }

  // 2) Run-item events (tool calls, tool outputs, reasoning)
  if (e.type === "run_item_stream_event") {
    const name = (event as { name?: unknown }).name;
    const item = (event as { item?: unknown }).item;

    if (name === "tool_called") {
      // Only the propose tool gets a live status; other $0 tools are silent.
      if (toolNameOf(item) === "propose") {
        return { type: "data-status", data: { text: "planning your ad…" } };
      }
      return null;
    }

    if (name === "tool_output") {
      // The durable GEN_CARD is persisted by the propose tool itself; here we just
      // forward its return value ({ cardId, shownPriceDisplay }) so the client can
      // render the card inline immediately. The card DATA is on the OUTPUT event.
      if (toolNameOf(item) === "propose") {
        const output = (item as { output?: unknown }).output;
        return { type: "data-tool-propose", data: output };
      }
      return null;
    }

    if (name === "reasoning_item_created") {
      const text = reasoningTextOf(item);
      if (text) return { type: "reasoning-delta", delta: text, id: OTTO_REASONING_ID };
      return null;
    }

    return null;
  }

  // 3) agent_updated_stream_event and anything else → no client part
  return null;
}
