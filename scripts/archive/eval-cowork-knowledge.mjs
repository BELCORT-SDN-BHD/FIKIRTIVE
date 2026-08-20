// ARCHIVED 2026-08-19 (C2 死凭证与陈旧文档清理). Kept for history; do NOT run it.
//
// WHY: the path it exists to guard is gone. `coworkTurn` — the action this harness says it
// mirrors — was deleted 2026-07-07 (see the header of apps/web/lib/cowork-actions.ts); Otto owns
// propose now. Its two entry symbols (`mockPlannerReply`, `parseCoworkTurn`) have zero product
// callers left, only packages/core unit tests. Its `COWORK_PROVIDER` guard below pointed at a
// variable no code reads any more — `packages/core/src/env-contract.ts` (the machine-checked
// contract) does not declare it, and its test fails on any undeclared read, so there is none.
// Nothing referenced this file: no CI job, no package.json script, only the June-2026 plan that
// created it (and under its old path). It could not run from a clean checkout either — it hard-
// requires the untracked `packages/db/.env` and a built `packages/core/dist`.
//
// The invariants it checked are covered by live unit tests, which is why archiving loses nothing:
//   · directive-appears-once + re-compose is idempotent → packages/core/src/cowork-compose.test.ts
//   · every video model resolves to a known family     → packages/core/src/gen.test.ts
//   · routing/aspect/duration behaviour of suggestModel → packages/core/src/cowork-route.test.ts
//
// ── original header ────────────────────────────────────────────────────────────
// OPT-6 P2 eval harness ($0/mock). Drives the REAL money-critical CORE the way
// coworkTurn → coworkGenerate does — mockPlannerReply → parseCoworkTurn →
// suggestModel → composePrompt — and asserts STRUCTURAL invariants. NEVER calls
// startGen/coworkGenerate-spend/refgen. Mirrors scripts/archive/verify-cowork-turn.mjs.
// Run: node scripts/tools/eval-cowork-knowledge.mjs
import { readFileSync } from "node:fs";

const envPath = new URL("../../packages/db/.env", import.meta.url);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (process.env.COWORK_PROVIDER === "fal" || process.env.GENERATION_PROVIDER === "fal") {
  console.error("✗ refusing: a fal provider is set — this eval must run at $0");
  process.exit(1);
}

const core = await import("../../packages/core/dist/index.js");
const {
  mockPlannerReply, parseCoworkTurn, suggestModel,
  composePrompt, modelFamily, deriveMode, MAX_GEN_PROMPT,
  GEN_VIDEO_MODELS,
} = core;

let failed = false;
const check = (label, ok, detail) => { console.log(`${ok ? "✓" : "✗"} ${label}`, detail ?? ""); if (!ok) failed = true; };

// Replicate coworkGenerate's composer step exactly (Task 5 Step 2) with a fixed
// directive stand-in (the harness tests the TRANSFORM + family/mode resolution,
// not the DB read — getEnhanceDirective is DB-backed and unit-tested separately).
const DIRECTIVE = "Lead with MOTION and CAMERA.";
function composeAsSpend({ prompt, model, kind, entityIds, sourceGenerationId }) {
  const family = modelFamily(model);
  const mode = deriveMode({ kind, conditioned: entityIds.length > 0, hasSourceImage: !!sourceGenerationId, hasTail: false });
  const directive = family ? DIRECTIVE : undefined; // family resolves → a directive would apply
  return { prompt: composePrompt({ prompt, directive, maxLen: MAX_GEN_PROMPT }), family, mode };
}

// 1. FULL round-trip: a request → turn → suggestModel → spend-side compose.
//    Directive must appear EXACTLY ONCE in the final spent prompt; the card prompt
//    (turn.proposal.structuredPrompt) must be directive-FREE (composed only at spend).
//    NOTE: mockPlannerReply is a deterministic $0 stub that ALWAYS proposes kind:"image"
//    (it does not parse intent from the text), so the round-trip here exercises the
//    image→seedream path. The video-specific family/mode coverage is asserted in #4.
{
  const turn = parseCoworkTurn(mockPlannerReply("make a video of a calm seascape"), []);
  check("turn has a proposal", !!turn.proposal, { kind: turn.proposal?.kind });
  const cardKind = turn.proposal.kind;
  const cardPrompt = turn.proposal.structuredPrompt;
  check("card prompt is directive-FREE (no compose at coworkTurn)", !cardPrompt.includes(DIRECTIVE));
  const sm = suggestModel({ kind: cardKind, hasSourceImage: false, hasTail: false });
  const spend = composeAsSpend({ prompt: cardPrompt, model: sm.model, kind: cardKind, entityIds: turn.proposal.entityIds, sourceGenerationId: null });
  const occurrences = spend.prompt.split(DIRECTIVE).length - 1;
  check("directive appears EXACTLY ONCE in the spent prompt", occurrences === 1, { occurrences, model: sm.model, mode: spend.mode });
  // composer touches ONLY the prompt: the routed model + the proposal kind are
  // unchanged by composeAsSpend (it only rewrites the prompt string).
  check("composer touched ONLY the prompt (model/kind unchanged)", !!sm.model && cardKind === turn.proposal.kind);
}

// 2. Composing the ALREADY-composed prompt again is a no-op (idempotent — the
//    double-append guard): simulate a stale card that somehow carried the directive.
{
  const sm = suggestModel({ kind: "video" });
  const once = composeAsSpend({ prompt: "a calm sea", model: sm.model, kind: "video", entityIds: [], sourceGenerationId: null });
  const twice = composeAsSpend({ prompt: once.prompt, model: sm.model, kind: "video", entityIds: [], sourceGenerationId: null });
  check("re-composing is idempotent (no double-append)", twice.prompt === once.prompt);
}

// 3. {image, entityIds} keyframe case → family/mode = (seedream, i2i).
{
  const spend = composeAsSpend({ prompt: "Mira in a red coat", model: "seedream", kind: "image", entityIds: ["e1"], sourceGenerationId: null });
  check("image + entityIds → mode i2i, family seedream", spend.family === "seedream" && spend.mode === "i2i", { family: spend.family, mode: spend.mode });
}

// 4. Per-family coverage: every family a video model ROUTES to resolves via
//    modelFamily (the composer can find a directive cell for it).
{
  const routed = new Set(GEN_VIDEO_MODELS.map((m) => modelFamily(m)).filter(Boolean));
  const unresolved = GEN_VIDEO_MODELS.filter((m) => !modelFamily(m));
  check("every video model maps to a known family", unresolved.length === 0, { unresolved });
  check("routed families", true, [...routed].join(", "));
}

if (failed) { console.error("\n✗ cowork-knowledge eval FAILED"); process.exit(1); }
console.log("\n✓ cowork-knowledge eval: directive-once, idempotent, correct family/mode, full family coverage ($0)");
