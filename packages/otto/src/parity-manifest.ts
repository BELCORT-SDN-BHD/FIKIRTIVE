/**
 * parity-manifest.ts — the 9th expansion seam (BLUEPRINT §四 / docs/design/2026-07-03-harmony-02).
 *
 * A machine- and human-readable table: every human server action ↔ the Otto skill that exposes the
 * same capability, OR an explicit exemption (four closed classes). This turns 宪法 7 ("Otto can
 * operate 100% of what a human can") from prose into structure — same philosophy as the skill fence.
 *
 * STATUS — rollout per harmony-02 §四: this is the initial SEED, registering the P-block Meta
 * performance surface. Full backfill of every existing action (盘点回填) and the CI enforcer
 * (scripts/check-parity.sh, warn→hard) are separate follow-ups. Keep this a PURE LITERAL
 * (SECTION_MATRIX style) so a diff is one-glance auditable. Exemptions must use one of the four
 * closed classes with a reason; a new class = a constitution amendment (founder-approved).
 */
export type ParityExemptClass = "ADMIN" | "VISUAL" | "MONEY_IN" | "ACCOUNT_SECURITY";

export type ParityEntry = { skill: string } | { exempt: ParityExemptClass; reason: string };

export const PARITY_MANIFEST = {
  // ── paired (human action → Otto skill) ──
  // P1a/P1b Meta per-ad performance: the human panel action and Otto's read skill both resolve to
  // fetchOwnerAdPerformance (the shared ctx.metaPerformance capability). The PERFORMANCE_CARD
  // diagnosis (meta-expert) is Otto-only reasoning over that same read — the human equivalent is
  // reading the panel, so it needs no separate action entry.
  "meta-performance-actions.getAdPerformance": { skill: "meta-ad-performance" },
} as const satisfies Record<string, ParityEntry>;
