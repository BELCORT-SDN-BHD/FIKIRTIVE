/**
 * otto-ui-messages — PURE mapper from persisted ChatThreadDTO messages to the
 * Vercel AI SDK `UIMessage[]` that useChat is seeded with (apps/web OttoChatStream).
 *
 * Kept dependency-light (type-only `ai` import, erased at runtime) so it is unit-
 * testable in the node test harness without React / @ai-sdk/react at module load.
 * Mirrors the pure-mapper pattern of otto-stream-bridge.ts.
 *
 * TEXT messages map to a single AI-SDK `text` part. NON-text durable messages
 * (PLAN | GEN_CARD | GEN_RESULT | DENIAL | TURN_ERROR | ACTION_CARD | BUILD_CARD | STORYBOARD_CARD) map to a minimal visible
 * placeholder so a reload never silently drops history; the durable id / kind /
 * payload / genJobId ride along in message `metadata` so Task 5 can swap the
 * placeholder for the real OttoPlanCard / OttoResult widget.
 */
import type { UIMessage } from "ai";
import type { ChatThreadDTO, ChatMessageDTO } from "./types";

/** Persisted-message context carried on each mapped UIMessage so Task 5 can render
 *  the real widget (plan card / result / denial) instead of the placeholder stub. */
export interface OttoUiMessageMetadata {
  /** The durable ChatMessage id (UIMessage.id is reused from this). */
  durableId: string;
  /** The durable message kind — drives which widget Task 5 renders. */
  kind: ChatMessageDTO["kind"];
  /** The durable payload (plan card shape, gen result shape, …) — opaque here. */
  payload: unknown | null;
  /** The async generation job id, when the message is tied to one. */
  genJobId: string | null;
}

/** A UIMessage whose metadata carries the durable-message context above. */
export type OttoUiMessage = UIMessage<OttoUiMessageMetadata>;

/** Short, human-visible placeholder text for a non-TEXT durable message kind.
 *  Task 5 replaces the whole placeholder message with the real widget. */
function placeholderTextFor(kind: ChatMessageDTO["kind"], text: string): string {
  switch (kind) {
    case "GEN_CARD":
      return "📋 plan card";
    case "GEN_RESULT":
      return "🖼 result";
    case "ACTION_CARD":
      return "Otto prepared an action plan.";
    case "BUILD_CARD":
      return "Otto drafted an ad plan.";
    case "STORYBOARD_CARD":
      return "Otto laid out a storyboard.";
    case "RESEARCH_CARD":
      return "Otto planned a research task.";
    case "RESEARCH_REPORT":
      return "Otto's research report.";
    case "PERFORMANCE_CARD":
      return "Otto diagnosed your ad performance.";
    case "DENIAL":
    case "TURN_ERROR":
      // These already carry user-facing copy on the durable message.
      return text || "⚠️ couldn't do that";
    case "PLAN":
      return "💭 thinking";
    default:
      return text;
  }
}

/**
 * Map a persisted thread's messages to the UIMessage[] useChat is seeded with.
 *
 * - role: USER → 'user', AGENT → 'assistant'.
 * - kind TEXT → one `text` part with the message text.
 * - kind PLAN | GEN_CARD | GEN_RESULT | DENIAL | TURN_ERROR | ACTION_CARD |
 *   BUILD_CARD | STORYBOARD_CARD → a single `text` placeholder part (see
 *   placeholderTextFor) PLUS metadata carrying the durable id / kind / payload /
 *   genJobId for the widget renderer.
 *
 * The durable ChatMessage id is reused as the UIMessage id so streamed-then-
 * reloaded messages stay keyed stably.
 */
export function threadToUiMessages(thread: ChatThreadDTO): OttoUiMessage[] {
  return thread.messages.map((m): OttoUiMessage => {
    const role: OttoUiMessage["role"] = m.role === "USER" ? "user" : "assistant";
    const text = m.kind === "TEXT" ? m.text : placeholderTextFor(m.kind, m.text);
    return {
      id: m.id,
      role,
      parts: [{ type: "text", text }],
      metadata: {
        durableId: m.id,
        kind: m.kind,
        payload: m.payload,
        genJobId: m.genJobId,
      },
    };
  });
}
