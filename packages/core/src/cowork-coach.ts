/**
 * promptCoach (Phase 2) — the $0, offline rule-pass that turns the per-(family×
 * mode) ModelDirective.rules into live composer hints ("Kling: keep to ~2
 * motions", "Seedream: natural language not tag soup"). Pure: rules + prompt
 * shape → hints. No transport, no spend, no fragile NLP — v1 is note-level hints
 * plus ONE safe comma-soup heuristic.
 */
import type { GenMode } from "./gen.js";
import type { ModelDirectiveRules } from "./cowork-directives.js";

export type CoachHint = { id: string; tone: "warn" | "info"; message: string };

/** Heuristic for "comma-tag soup" — many short comma-separated fragments (the
 *  shape Seedream dislikes). Safe + cheap: needs ≥4 segments AND a short average
 *  segment, so natural sentences with a comma or two never trip it. */
export function looksLikeTagSoup(text: string): boolean {
  const segments = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 4) return false;
  const words = segments.reduce((n, s) => n + s.split(/\s+/).filter(Boolean).length, 0);
  return words / segments.length <= 3.5;
}

/** Rough count of distinct concurrent-motion cues in a prompt (subject motion +
 *  camera move). Motion verbs (+ inflections) as WHOLE words — leading AND trailing
 *  \b so prefix collisions (panda, driftwood, pullover, dashboard) don't false-fire —
 *  curated away from the worst noun-colliders (track/crane/sweep/march). Deduped to a
 *  rough base so "drifts"/"drifting" count once. A heuristic, not NLP: enough to flag
 *  an obviously over-budget prompt (subject shifts + particles drift + camera push = 3)
 *  against a model's maxConcurrentMotions ceiling. */
const MOTION_RE = /\b(dolly|dollies|dollying|zoom|zooms|zooming|orbit|orbits|orbiting|tilt|tilts|tilting|pan|pans|panning|crane|cranes|craning|push|pushes|pushing|pull|pulls|pulling|glide|glides|gliding|drift|drifts|drifting|spin|spins|spinning|swirl|swirls|swirling|float|floats|floating|rise|rises|rising|fall|falls|falling|walk|walks|walking|run|runs|running|fly|flies|flying|drive|drives|driving|turn|turns|turning|move|moves|moving|shift|shifts|shifting|animate|animates|animating|wave|waves|waving|gallop|gallops|galloping|leap|leaps|leaping|crawl|crawls|crawling|tumble|tumbles|tumbling|whirl|whirls|whirling|race|races|racing|chase|chases|chasing)\b/gi;
export function countMotionCues(text: string): number {
  const m = text.toLowerCase().match(MOTION_RE);
  if (!m) return 0;
  // dedupe to a rough base so inflections of one verb count once: strip the verb
  // suffix, a trailing silent -e, and a doubled final consonant (running→runn→run).
  return new Set(m.map((w) => w.replace(/ies$/, "y").replace(/(es|ing|s)$/, "").replace(/e$/, "").replace(/([a-z])\1$/, "$1"))).size;
}

/** Person cues for un-@mentioned multi-character prose (NLP-free, closed set —
 *  deliberately person-specific, NOT bare numbers/pronouns ("two"/"they") or
 *  non-person collectives ("group"/"team"/"family"/"couple of") which over-fire).
 *  Lets Coach softly nudge on LTX merge risk when no @mention chip is present. */
const MULTI_PERSON_CUES = /\b(friends|crowd|people|men|women|guests|strangers|lovers|siblings|twins|brothers|sisters|colleagues|dancers|soldiers|kids|children|each other|a man and a|a woman and a)\b/i;

/** Offline hints for the current (mode, rules, prompt shape). Empty when there
 *  are no rules (the cell is unseeded/family-neutral) — Coach stays silent
 *  rather than guessing. */
export function lintPrompt(input: {
  text: string;
  mode: GenMode;
  rules?: ModelDirectiveRules;
  characterCount: number;
  cameraMotion?: string; // the selected camera-motion preset — counts toward the motion budget (GenSpace appends it at gen time)
}): CoachHint[] {
  const r = input.rules;
  if (!r) return [];
  const hints: CoachHint[] = [];

  if (r.i2vMotionNotScene && (input.mode === "i2v" || input.mode === "i2v-tail")) {
    hints.push({ id: "i2v-motion", tone: "info", message: "Image-to-video: describe the motion and camera, not the scene — the input image already provides it." });
  }
  if (r.maxConcurrentMotions != null) {
    // count subject motions in the prompt PLUS the camera preset (itself a motion).
    // Escalate to an active warning ONLY on i2v/i2v-tail — those prompts are short and
    // motion-only, so the verb count ≈ concurrent motions. For t2v the prompt is scene-
    // rich (many motion verbs describe ONE action), so the count over-fires — keep the
    // passive tip there rather than cry wolf.
    const motions = countMotionCues(`${input.text} ${input.cameraMotion ?? ""}`);
    const reliableMode = input.mode === "i2v" || input.mode === "i2v-tail";
    hints.push(reliableMode && motions > r.maxConcurrentMotions
      ? { id: "max-motions", tone: "warn", message: `This looks like ~${motions} concurrent motions — this model is steadiest with ≤${r.maxConcurrentMotions}. Simplify or split the action.` }
      : { id: "max-motions", tone: "info", message: `Steadiest with ≤${r.maxConcurrentMotions} concurrent motions — keep the action simple.` });
  }
  if (r.noTagCommas && looksLikeTagSoup(input.text)) {
    hints.push({ id: "tag-soup", tone: "warn", message: "This model prefers natural-language sentences over comma-separated tags." });
  }
  if (r.castSeverity && input.characterCount >= 2) {
    hints.push({ id: "multi-char", tone: "warn", message: `This model can merge multiple characters — you have ${input.characterCount}. Consider separate shots.` });
  } else if (r.castSeverity && input.characterCount < 2 && MULTI_PERSON_CUES.test(input.text)) {
    // prose multi-character (no @mention chip → characterCount can't see it) — softer nudge
    hints.push({ id: "multi-char-prose", tone: "info", message: "This model can merge multiple characters — if this shot has more than one person, consider separate shots." });
  }
  if (r.pitfalls) {
    for (const p of r.pitfalls) hints.push({ id: `pitfall:${p}`, tone: "info", message: p });
  }
  return hints;
}
