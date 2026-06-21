import { coworkTurnSchema, MAX_PLAN_STEPS, type ChatContentPart, type ChatMessage, type CoworkTurn } from "./cowork.js";

export { MAX_PLAN_STEPS, coworkTurnSchema };

export const COWORK_PLANNER_SYSTEM =
  `You are Otto, Fikirtive's AI marketing operator. The user describes what they want to create. ` +
  `Respond with ONLY a JSON object (no prose, no markdown fences): ` +
  `{"planSteps":["short step", ...],"title":"≤6 word summary","reply":"a short natural-language message in the user's language","briefUpdate"?:"concise project brief ≤60 words","proposal":null | {"kind":"image"|"video","desiredAspect"?:"16:9","desiredDuration"?:5,"desiredAudio"?:true,"structuredPrompt":"a vivid generator prompt","entityIds":["<id>"...],"variantSel":{"<entityId>":"<variantId>"}}}. ` +
  `planSteps: 2-${MAX_PLAN_STEPS} short reasoning steps (what you'll look at, which model class, why). ` +
  `title: a short (≤6 words) summary of the conversation. ` +
  `proposal: set it ONLY when the user wants something generated; otherwise null and just talk in "reply". ` +
  `Reference ONLY entity ids from the provided available-refs list; never invent ids. Do NOT choose a model or set price — that is decided downstream. ` +
  `For a VIDEO that should feature a specific character variant, propose an IMAGE keyframe first (kind:"image"); video conditions on a source frame, not on entity refs. ` +
  `Write "reply" and "title" in the SAME LANGUAGE as the user's message. The "structuredPrompt", however, MUST be written in English — the image/video generation models are English-tuned — regardless of the user's language. ` +
  `When the proposal references a character/entity (or animates a source frame), the "structuredPrompt" should include concise identity-preservation phrasing (keep the same face, appearance, and wardrobe as the reference) rather than re-describing the character from scratch. ` +
  `Optionally include "briefUpdate": a concise (≤60 words) refinement of the PROJECT BRIEF capturing durable creative direction you've learned (tone, visual style, recurring constraints like aspect ratio or language, key characters). Refine the existing Project brief shown in your context rather than rewriting it from scratch; emit it ONLY when you have a clear, durable signal — otherwise omit it. The user can edit it anytime. ` +
  `When reference IMAGES are shown to you this turn, for each one add an entry to "refDescriptions" keyed by its @name (exactly as labeled, e.g. "@Mira") with a concise visual description (appearance, wardrobe, style, distinctive features) — this is cached so future turns recall the look without re-sending the image. Omit "refDescriptions" entirely when no images are shown. Full JSON shape: {"planSteps":[...],"title":"...","reply":"...","briefUpdate"?:"...","refDescriptions"?:{"@Name":"..."},"proposal":null|{...}}.`;

/** Build the planner messages: system + a context block + bounded NL history + the user turn. */
export function buildPlannerMessages(args: {
  userText: string;
  history: ChatMessage[];        // already windowed + NL-only (assistant/user)
  availableRefs: { id: string; name: string; type: string; description?: string }[];
  modelSummary: string;          // e.g. "image: seedream; video: kling/veo3.1/... (agent picks)"
  quoted?: { kind: string; preview: string }; // injected into the current turn only (NOT history)
  brief?: string;                // per-project creative brief (injected into system head — cacheable)
  images?: { label: string; dataUrl: string }[]; // Phase C vision: ref images to attach to the user turn
}): ChatMessage[] {
  const refsBlock = args.availableRefs.length
    ? `Available @refs (use ONLY these ids): ${args.availableRefs.map((r) => `${r.id}=${r.name}(${r.type})${r.description ? `: ${r.description}` : ""}`).join("; ")}`
    : "Available @refs: none";
  const briefBlock = args.brief && args.brief.trim()
    ? `\n\nProject brief (the creative direction for this project — honor it):\n${args.brief.trim()}`
    : "";
  const userContent = args.quoted
    ? `[The user is replying to an earlier ${args.quoted.kind} message: "${args.quoted.preview}"]\n\n${args.userText}`
    : args.userText;
  // Phase C vision: when images are supplied, the user turn becomes a multimodal array;
  // labeled text parts precede each image so the model can correlate label→pixels.
  // Without images → plain string (back-compat, all existing callers unchanged).
  const userTurnContent: string | ChatContentPart[] = args.images?.length
    ? (() => {
        const parts: ChatContentPart[] = [{ type: "text", text: userContent }];
        for (const img of args.images) {
          parts.push({ type: "text", text: `[Reference — ${img.label}]` });
          parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
        }
        return parts;
      })()
    : userContent;
  return [
    { role: "system", content: `${COWORK_PLANNER_SYSTEM}\n\n${refsBlock}\nModels available downstream: ${args.modelSummary}${briefBlock}` },
    ...args.history,
    { role: "user", content: userTurnContent },
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
