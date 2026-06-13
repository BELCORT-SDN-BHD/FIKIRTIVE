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

/** Offline hints for the current (mode, rules, prompt shape). Empty when there
 *  are no rules (the cell is unseeded/family-neutral) — Coach stays silent
 *  rather than guessing. */
export function lintPrompt(input: {
  text: string;
  mode: GenMode;
  rules?: ModelDirectiveRules;
  characterCount: number;
}): CoachHint[] {
  const r = input.rules;
  if (!r) return [];
  const hints: CoachHint[] = [];

  if (r.i2vMotionNotScene && (input.mode === "i2v" || input.mode === "i2v-tail")) {
    hints.push({ id: "i2v-motion", tone: "info", message: "Image-to-video: describe the motion and camera, not the scene — the input image already provides it." });
  }
  if (r.maxConcurrentMotions != null) {
    hints.push({ id: "max-motions", tone: "info", message: `Steadiest with ≤${r.maxConcurrentMotions} concurrent motions — keep the action simple.` });
  }
  if (r.noTagCommas && looksLikeTagSoup(input.text)) {
    hints.push({ id: "tag-soup", tone: "warn", message: "This model prefers natural-language sentences over comma-separated tags." });
  }
  if (r.castSeverity && input.characterCount >= 2) {
    hints.push({ id: "multi-char", tone: "warn", message: `This model can merge multiple characters — you have ${input.characterCount}. Consider separate shots.` });
  }
  if (r.pitfalls) {
    for (const p of r.pitfalls) hints.push({ id: `pitfall:${p}`, tone: "info", message: p });
  }
  return hints;
}
