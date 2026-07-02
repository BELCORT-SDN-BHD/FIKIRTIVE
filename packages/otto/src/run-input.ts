import { RunState, type Agent, type AgentInputItem } from "@openai/agents";

export type RefImage = { label: string; dataUrl: string };

/**
 * Build the current user turn for an Otto run. Text-only (plain string content) when there
 * are no images; otherwise a multimodal content array of one input_text part plus one
 * input_image part per image. Uses the @openai/agents content-part shape
 * ({ type: "input_image", image }) — NOT the OpenAI chat-completions { image_url:{url} } shape.
 */
export function buildUserTurn(text: string, images?: RefImage[]): AgentInputItem {
  if (!images || images.length === 0) {
    return { role: "user", content: text } as AgentInputItem;
  }
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      ...images.map((img) => ({ type: "input_image", image: img.dataUrl })),
    ],
  } as AgentInputItem;
}

/**
 * Strip input_image parts from rehydrated history so image bytes never accumulate in the
 * persisted ottoState across turns. A historical user turn that carried images keeps its
 * text (Otto already saw the image on the turn it was sent). A user turn left with a single
 * input_text part is collapsed back to a plain string to match the fresh-turn shape.
 */
export function stripHistoryImages(history: AgentInputItem[]): AgentInputItem[] {
  return history.map((item) => {
    const it = item as { role?: string; content?: unknown };
    if (it.role !== "user" || !Array.isArray(it.content)) return item;
    const kept = (it.content as Array<{ type?: string; text?: string }>).filter(
      (p) => p?.type !== "input_image",
    );
    if (kept.length === 1 && kept[0]?.type === "input_text") {
      return { ...it, content: kept[0]!.text ?? "" } as AgentInputItem;
    }
    return { ...it, content: kept } as AgentInputItem;
  });
}

/**
 * Sanitize rehydrated Otto history before re-running (F25). Two bounded-growth leaks:
 *  1. A FRESH system message (brand context + available refs) is prepended every turn, so any
 *     system message carried inside the rehydrated history is a stale duplicate — drop them.
 *  2. Image bytes must never accumulate across turns (stripHistoryImages).
 * Together these stop ottoState from growing without bound each turn. (Token-budget truncation
 * of the remaining turns is intentionally NOT done here — naively dropping items can split a
 * tool_call/tool_result pair and break the run; that needs pair-aware handling, tracked separately.)
 */
export function sanitizeHistory(history: AgentInputItem[]): AgentInputItem[] {
  const withoutSystem = history.filter((item) => (item as { role?: string }).role !== "system");
  return stripHistoryImages(withoutSystem);
}

/**
 * Restore a persisted RunState, returning null instead of throwing on a corrupt or
 * schema-version-incompatible serialized state (F24). RunState.fromString throws on an
 * @openai/agents schema bump or a truncated/garbled ottoState; unguarded, that bricks EVERY
 * existing thread forever. Callers treat null as "no prior state": turn paths start a fresh
 * run (dropping history, which self-heals ottoState on the next write); resume paths (approve /
 * worker verdict) surface a clean error / skip rather than resume an unrecoverable state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors RunState.fromString's own `Agent<any, any>` constraint; Agent is invariant in its context param, so `Agent<unknown>` would reject the concrete `Agent<OttoContext>`.
export async function tryRestoreRunState<TAgent extends Agent<any, any>>(
  agent: TAgent,
  serialized: string,
): Promise<RunState<unknown, TAgent> | null> {
  try {
    return await RunState.fromString<unknown, TAgent>(agent, serialized);
  } catch (e) {
    console.warn("[otto] could not restore prior run state — starting fresh:", e instanceof Error ? e.message : e);
    return null;
  }
}
