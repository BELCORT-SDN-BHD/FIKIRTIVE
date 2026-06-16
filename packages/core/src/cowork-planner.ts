import { coworkTurnSchema, MAX_PLAN_STEPS, type ChatMessage, type CoworkTurn } from "./cowork.js";

export { MAX_PLAN_STEPS, coworkTurnSchema };

export const COWORK_PLANNER_SYSTEM =
  `You are Artlio's creative-director agent. The user describes what they want to create. ` +
  `Respond with ONLY a JSON object (no prose, no markdown fences): ` +
  `{"planSteps":["short step", ...],"title":"≤6 word summary","reply":"a short natural-language message in the user's language","proposal":null | {"kind":"image"|"video","desiredAspect"?:"16:9","desiredDuration"?:5,"desiredAudio"?:true,"structuredPrompt":"a vivid generator prompt","entityIds":["<id>"...],"variantSel":{"<entityId>":"<variantId>"}}}. ` +
  `planSteps: 2-${MAX_PLAN_STEPS} short reasoning steps (what you'll look at, which model class, why). ` +
  `title: a short (≤6 words) summary of the conversation. ` +
  `proposal: set it ONLY when the user wants something generated; otherwise null and just talk in "reply". ` +
  `Reference ONLY entity ids from the provided available-refs list; never invent ids. Do NOT choose a model or set price — that is decided downstream. ` +
  `For a VIDEO that should feature a specific character variant, propose an IMAGE keyframe first (kind:"image"); video conditions on a source frame, not on entity refs. ` +
  `Write "reply" and "title" in the SAME LANGUAGE as the user's message. The "structuredPrompt", however, MUST be written in English — the image/video generation models are English-tuned — regardless of the user's language. ` +
  `When the proposal references a character/entity (or animates a source frame), the "structuredPrompt" should include concise identity-preservation phrasing (keep the same face, appearance, and wardrobe as the reference) rather than re-describing the character from scratch.`;

/** Build the planner messages: system + a context block + bounded NL history + the user turn. */
export function buildPlannerMessages(args: {
  userText: string;
  history: ChatMessage[];        // already windowed + NL-only (assistant/user)
  availableRefs: { id: string; name: string; type: string }[];
  modelSummary: string;          // e.g. "image: seedream; video: kling/veo3.1/... (agent picks)"
  quoted?: { kind: string; preview: string }; // injected into the current turn only (NOT history)
}): ChatMessage[] {
  const refsBlock = args.availableRefs.length
    ? `Available @refs (use ONLY these ids): ${args.availableRefs.map((r) => `${r.id}=${r.name}(${r.type})`).join("; ")}`
    : "Available @refs: none";
  const userContent = args.quoted
    ? `[The user is replying to an earlier ${args.quoted.kind} message: "${args.quoted.preview}"]\n\n${args.userText}`
    : args.userText;
  return [
    { role: "system", content: `${COWORK_PLANNER_SYSTEM}\n\n${refsBlock}\nModels available downstream: ${args.modelSummary}` },
    ...args.history,
    { role: "user", content: userContent },
  ];
}

/** Pull the first {...} (json-mode usually returns clean JSON; this is the fallback). */
function sliceJson(text: string): string {
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("cowork: no JSON object in planner output");
  return text.slice(s, e + 1);
}

/** Validate the (untrusted) planner output into a CoworkTurn, constraining refs to availableRefs. */
export function parseCoworkTurn(text: string, availableRefIds: string[]): CoworkTurn {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { raw = JSON.parse(sliceJson(text)); }
  const turn = coworkTurnSchema.parse(raw);
  if (turn.proposal) {
    const allowed = new Set(availableRefIds);
    const entityIds = turn.proposal.entityIds.filter((id) => allowed.has(id));
    const variantSel: Record<string, string> = {};
    for (const [k, v] of Object.entries(turn.proposal.variantSel)) if (entityIds.includes(k)) variantSel[k] = v;
    turn.proposal = { ...turn.proposal, entityIds, variantSel };
  }
  return turn;
}

/** Deterministic $0 planner reply for dev/test (parsed like a real one). */
export function mockPlannerReply(userText: string): string {
  const t = userText.trim().replace(/\s+/g, " ").slice(0, 140);
  return JSON.stringify({
    planSteps: ["read the request", "draft a structured image prompt"],
    title: t.split(" ").slice(0, 6).join(" "),
    reply: `Here's a proposal for: ${t}`,
    proposal: { kind: "image", structuredPrompt: `${t}, cinematic lighting, rich detail`, entityIds: [], variantSel: {} },
  });
}
