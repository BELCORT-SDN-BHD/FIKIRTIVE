/**
 * parity-manifest.ts — the 9th expansion seam (BLUEPRINT §四 / docs/design/2026-07-03-harmony-02).
 *
 * A machine- and human-readable table: every human server action ↔ the Otto skill that exposes the
 * same capability, OR an explicit exemption (four closed classes). This turns 宪法 7 ("Otto can
 * operate 100% of what a human can") from prose into structure — same philosophy as the skill fence.
 *
 * STATUS — rollout per harmony-02 §四: this is the initial SEED, registering the P1-01 product-ingest
 * surface. Full backfill of every existing action (盘点回填) and the CI enforcer
 * (scripts/check-parity.sh, warn→hard) are separate follow-ups. Keep this a PURE LITERAL
 * (SECTION_MATRIX style) so a diff is one-glance auditable. Exemptions must use one of the four
 * closed classes with a reason; a new class = a constitution amendment (founder-approved).
 */
export type ParityExemptClass = "ADMIN" | "VISUAL" | "MONEY_IN" | "ACCOUNT_SECURITY";

export type ParityEntry = { skill: string } | { exempt: ParityExemptClass; reason: string };

export const PARITY_MANIFEST = {
  // ── paired (human action → Otto skill) ──
  // P1-01 product URL ingest: the human "paste a link" action and Otto's read skill both return the
  // same deterministic ($0) product draft over the shared ctx.productIngest capability.
  "product-ingest-actions.ingestProductFromUrl": { skill: "ingestProduct" },
} as const satisfies Record<string, ParityEntry>;
