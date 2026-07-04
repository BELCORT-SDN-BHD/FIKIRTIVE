/**
 * parity-manifest.ts — the 9th expansion seam (BLUEPRINT §四 / docs/design/2026-07-03-harmony-02).
 *
 * A machine- and human-readable table: every human server action ↔ the Otto skill that exposes the
 * same capability, an explicit exemption (four closed classes), or a TODO_SKILL debt entry (an
 * action that SHOULD get a skill but doesn't yet — 欠账清单, not an exemption). This turns 宪法 7
 * ("Otto can operate 100% of what a human can") from prose into structure.
 *
 * STATUS — rollout per harmony-02 §四: this is the initial SEED, registering the P1-01 product-ingest
 * surface and Schedule slice action surface. Full backfill of every existing action (盘点回填) and the
 * CI enforcer (scripts/check-parity.sh, warn→hard) are separate follow-ups. Keep this a PURE LITERAL
 * (SECTION_MATRIX style) so a diff is one-glance auditable. A new exemption class = a constitution
 * amendment (founder-approved).
 */
export type ParityExemptClass = "ADMIN" | "VISUAL" | "MONEY_IN" | "ACCOUNT_SECURITY";

export type ParityEntry =
  | { skill: string }
  | { exempt: ParityExemptClass; reason: string }
  | { todo: string };

export const PARITY_MANIFEST = {
  // ── paired (human action → Otto skill) ──
  // The composer's "Save draft" and Otto's schedulePosts both draft via the SAME shared authority
  // (draftScheduledPost) — one validation + one create, no divergence.
  "schedule-actions.createScheduledPost": { skill: "schedulePosts" },

  // P1-01 product URL ingest: the human "paste a link" action and Otto's read skill both return the
  // same deterministic ($0) product draft over the shared ctx.productIngest capability.
  "product-ingest-actions.ingestProductFromUrl": { skill: "ingestProduct" },

  // ── TODO_SKILL (debt, not exemption): owner consent + read surfaces with no Otto skill yet.
  // Approve/cancel/edit are owner CONSENT actions; publish is slice 2, so an Otto approve/publish
  // skill (which would be a gated external write) waits on that infra. The list reads want free/read
  // skills so Otto isn't a blind operator. Tracked here so the debt is visible, not forgotten.
  "schedule-actions.approveScheduledPost": { todo: "Otto approve-to-publish waits on the publish worker (slice 2) — gated external write." },
  "schedule-actions.cancelScheduledPost": { todo: "no Otto cancel skill yet — owner consent action; pairs when the manage-schedule skill lands." },
  "schedule-actions.updateScheduledPost": { todo: "no Otto edit skill yet — pairs with the manage-schedule skill." },
  "schedule-actions.listScheduledPosts": { todo: "read parity: a free/read schedule-list skill so Otto can see the same queue the owner does." },
  "schedule-actions.listOwnerTargets": { todo: "read parity: a free/read connected-targets skill." },
} as const satisfies Record<string, ParityEntry>;
