import type { AgentInputItem } from "@openai/agents";

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
