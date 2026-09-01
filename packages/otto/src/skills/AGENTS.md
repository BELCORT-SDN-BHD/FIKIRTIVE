# Authoring an Otto skill

A skill = `defineOttoSkill({...})` in `skills/<name>.ts`. The factory derives `needsApproval`
from your 3-field declaration and fails closed. See the design spec:
`docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md`.

## The 3 fields (answer these — you cannot omit them)
- `cost`: `"free" | "spend"` — does **this skill** route through approval and hold a reservation
  **of its own**? `spend` = yes, and it also REQUIRES `idempotencyKey`. `free` = no — it does **NOT**
  mean "the merchant is never billed for this". A `free` skill's work can still be paid for by the
  money leg of the turn it runs in, or by a price charged elsewhere in the flow. Two live examples:
  `researchWeb`'s `query` leg is billed per **successful** search against the conversation turn's own
  reservation (MONEY-A10), and `importMedia` charges the understanding price at the moment of upload
  (MONEY-A9). Both are `free` because neither one holds a reservation itself — not because they are
  gratis. Getting this backwards is how a billed action ends up with no approval story.
- `effect`: `"read" | "write"` — changes state (our DB OR the outside world)?
- `reach`: `"internal" | "external"` — touches the outside world (network/3rd-party)?

`needsApproval = (cost === "spend") || (effect === "write" && reach === "external")`.
External **reads** (web lookups) are NOT gated; external **writes** (post/send/publish) are.

## The 5 steps to add a skill (worked example: `searchWeb`)
1. **Declare a port** on `OttoContext` in `../context.ts` (the seam to the outside). Skills never
   call `fetch()`/Prisma-for-external/fal directly — only injected `ctx` ports.
2. **Inject the real port** in the web/worker `buildOttoContext` (API key, rate-limit, logging).
3. **Write the skill**: copy `_template.ts` → `skills/<name>.ts`, fill the 3 fields + `execute`.
   Export `<name>Skill` only — do NOT add a bare `export const <name> = <name>Skill.tool;`.
   Nothing imports it (removed repo-wide, C2b); the registry and every caller take the Skill
   object and reach `.tool` when they need the raw tool.
4. **Register**: add `import { <name>Skill }` + an entry in `../registry.ts` `allSkills`.
5. **Test**: a gate assertion in `migration.test.ts` (or a `<name>.test.ts`) + a port-required guard.
   Then regenerate the catalog: `pnpm --filter @fikirtive/otto run catalog`.

## Hard rules (enforced)
- No identity fields (`orgId`/`ownerId`/`userId`) in `parameters` — the factory throws.
- `cost:"spend"` without `idempotencyKey` — the factory throws.
- `skills/*` must not import `@fikirtive/generation` (fal) or `reserveCredits` — the CI fence fails
  (`scripts/check-skill-imports.sh`). Route spend through an injected port.
