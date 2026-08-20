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

// ---------------------------------------------------------------------------
// Shared data-* payload types — exported so the route and future client code
// reference ONE contract instead of ad-hoc inline shapes.
// ---------------------------------------------------------------------------

/** Payload for the `data-status` stream part. */
export type OttoStatusData =
  | { kind: "planning"; text: string }           // propose tool called — live status
  | { kind: "degraded"; text: string }           // MaxTurnsExceededError — friendly degrade
  | { kind: "stale"; text: string }              // CAS stale — conversation moved on
  | { kind: "needs_approval"; pendingCardIds: string[] }  // run paused; cards await approval
  | { kind: "done"; threadId: string };          // run fully completed

/** Payload for the `data-error` stream part. */
export type OttoErrorData =
  | { kind: "insufficient_credits"; text: string }
  /** #524 — the merchant's own spend cap refused the turn. Its own kind because its exit is
   *  Settings, not Billing: a top-up buys nothing when the limit is one they set. */
  | { kind: "spend_cap"; text: string }
  | { kind: "error"; text: string };

/** Payload for the `data-tool-propose` stream part (the propose tool's return value). */
export type OttoProposeData = unknown;

/** Payload for the `data-step` stream part — one agent step (a tool call), display-only. */
export type OttoStepData = { id: string; label: string; phase: "start" | "done" };

/** Payload for the `data-cost` stream part — what THIS turn actually cost, in DISPLAYED
 *  credits, read from the ledger AFTER the turn settled (#555). Display-only: the number is
 *  reported, never used to charge. The settled net, not the hold — the hold is a worst-case
 *  budget and quoting it would overstate what the merchant paid. */
export type OttoCostData = { credits: number };

// ---------------------------------------------------------------------------
// Minimal structural type for the parts this bridge emits, plus the route's
// data parts. Intentionally avoids importing `ai` so this module stays pure
// and dependency-light. The route passes results straight to writer.write(…).
// ---------------------------------------------------------------------------
export type OttoStreamPart =
  | { type: "text-delta"; delta: string; id: string }
  | { type: "reasoning-delta"; delta: string; id: string }
  | { type: "data-status"; data: OttoStatusData }
  | { type: "data-tool-propose"; data: OttoProposeData }
  | { type: "data-step"; data: OttoStepData }
  | { type: "data-cost"; data: OttoCostData }
  | { type: "data-error"; data: OttoErrorData };

// Stable ids so all deltas of one turn coalesce into a single text / reasoning part.
// The route opens text-start/-end with the SAME id around the event loop.
export const OTTO_TEXT_ID = "otto-text";
export const OTTO_REASONING_ID = "otto-reasoning";

/** Tools whose output carries the id(s) of a durable card they just persisted
 *  (GEN_CARD / ACTION_CARD / BUILD_CARD / …) — forwarded live as data-tool-propose.
 *  LOCKSTEP CONTRACT (seam 5): every no-approval skill that persists a *_CARD —
 *  directly in packages/otto/src/skills OR through an injected web port (see
 *  PORT_CARD_TOOLS in otto-card-seams.test.ts) — must be in this set, or its card
 *  silently won't render until a page refresh (the F23 class — regressed on
 *  PERFORMANCE_CARD, then RESEARCH_CARD). Approval-gated skills (e.g. generate)
 *  are exempt: they execute on worker resume, outside the live stream, and deliver
 *  via the approve flow. The card's KIND must also be in CARD_KINDS (seam 4,
 *  otto-inject-helpers.ts). Both enforced by otto-card-seams.test.ts. */
export const CARD_TOOL_NAMES = new Set(["propose", "proposeStoryboard", "editStoryboard", "proposePack", "propose-meta-action", "propose-ad-build", "meta-expert", "proposeResearch"]);

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
      // Only the card-proposing tools get a live status; other $0 tools are silent.
      const called = toolNameOf(item);
      if (called === "propose" || called === "proposeStoryboard") {
        return { type: "data-status", data: { kind: "planning", text: "planning your ad…" } };
      }
      return null;
    }

    if (name === "tool_output") {
      // The durable card is persisted by the tool itself; here we just forward its
      // return value so the client can render the card inline immediately (F23).
      // Shapes: propose / proposeStoryboard → { cardId, … }; proposePack →
      // { packId, cardIds[] }; propose-meta-action / propose-ad-build →
      // { message, cardId?, … } (cardId absent on validation failure — the
      // client's cardIdsOf handles that).
      if (CARD_TOOL_NAMES.has(toolNameOf(item) ?? "")) {
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

// ---------------------------------------------------------------------------
// Step narration — a SECOND pure mapper the route calls alongside bridgeEvent to
// emit `data-step` parts (the live trace UI). It only NARRATES the agent's tool
// calls; it never changes the run, approval, or spend path. Kept separate so
// bridgeEvent's contract/tests are untouched.
// ---------------------------------------------------------------------------

/** Tool name → friendly, sentence-case step label. Unlisted tools stay silent.
 *  Keys are the EXACT tool names from packages/otto/src/skills/*.ts (mixed casing). */
const TOOL_STEP_LABELS: Record<string, string> = {
  researchWeb: "Researching your brand",
  rememberBrandFact: "Saving a brand note",
  updateBrief: "Updating the brief",
  describeRefs: "Looking at your references",
  propose: "Planning the campaign",
  proposePack: "Planning the ad pack",
  proposeStoryboard: "Laying out the storyboard",
  editStoryboard: "Editing the storyboard",
  seedreamPrompt: "Crafting the image prompt",
  seedancePrompt: "Crafting the video prompt",
  generate: "Making a visual",
  "meta-insights": "Reading your ad performance",
  "meta-list-objects": "Checking your Meta account",
  "list-meta-pages": "Finding your Pages",
  "propose-meta-action": "Planning a Meta change",
  "propose-ad-build": "Planning the campaign build",
  "meta-ad-performance": "Reading your per-ad performance",
  "meta-expert": "Diagnosing your ad performance",
  proposeResearch: "Planning the research",
  // B4 debt-70~74 (schedule five-action parity):
  approveScheduledPost: "Asking you to approve a post",
  cancelScheduledPost: "Canceling a scheduled post",
  editScheduledPost: "Editing a scheduled post",
  listScheduledPosts: "Checking your schedule",
  listPublishTargets: "Finding your connected accounts",
  // B0-103 / B0-28 (new schedule reads/shares):
  suggestPostTimes: "Finding good times to post",
  sharePostPreview: "Making a share link",
  manageCanvas: "Working on your canvas",
  // W-B3-B (media-editor / asset-viewer $0):
  manageMedia: "Organizing your media",
  // #780 — the skill no longer only exports: it also puts clips together, captions them and
  // lays music under them, so the line the merchant reads while it runs can't say "exporting".
  renderVideo: "Working on your video",
  importMedia: "Importing media",
  // W-B3-D (home/ideas/library/brand debt):
  manageProjects: "Organizing your projects",
  manageEntities: "Updating your elements",
  manageLibrary: "Looking through your saved media",
  manageBrandMemory: "Updating your brand memory",
  proposeIdeas: "Thinking up ideas",
  // setTitle stays silent (internal housekeeping).
};

/** Friendly step label for a tool, or null for tools that shouldn't surface a step. */
export function labelForTool(name: string | undefined): string | null {
  if (!name) return null;
  return TOOL_STEP_LABELS[name] ?? null;
}

/** Read a stable call id off a run_item event's item (pairs start↔done). */
function callIdOf(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const raw = (item as { rawItem?: { callId?: unknown; id?: unknown } }).rawItem;
  const id = raw?.callId ?? raw?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Map a run_item event to a step (display-only narration of the agent's tool calls):
 * tool_called → phase:"start"; tool_output → phase:"done". Returns null when the event
 * isn't a labelled tool boundary. PURE — no DB/IO. The spend/approval path is untouched;
 * this only describes what the agent is doing for the trace UI.
 */
export function stepEventOf(event: unknown): OttoStepData | null {
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown; name?: unknown; item?: unknown };
  if (e.type !== "run_item_stream_event") return null;
  const phase = e.name === "tool_called" ? "start" : e.name === "tool_output" ? "done" : null;
  if (!phase) return null;
  const label = labelForTool(toolNameOf(e.item));
  if (!label) return null;
  const id = callIdOf(e.item);
  if (!id) return null;
  return { id, label, phase };
}
