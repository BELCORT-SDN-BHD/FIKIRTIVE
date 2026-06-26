# Authoring an Otto skill

A skill = `defineOttoSkill({...})` in `skills/<name>.ts`. The factory derives `needsApproval`
from your 3-field declaration and fails closed. See the design spec:
`docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md`.

## The 3 fields (answer these — you cannot omit them)
- `cost`: `"free" | "spend"` — spends FIKIRTIVE credits? `spend` also REQUIRES `idempotencyKey`.
- `effect`: `"read" | "write"` — changes state (our DB OR the outside world)?
- `reach`: `"internal" | "external"` — touches the outside world (network/3rd-party)?

`needsApproval = (cost === "spend") || (effect === "write" && reach === "external")`.
External **reads** (web lookups) are NOT gated; external **writes** (post/send/publish) are.

## The 5 steps to add a skill (worked example: `searchWeb`)
1. **Declare a port** on `OttoContext` in `../context.ts` (the seam to the outside). Skills never
   call `fetch()`/Prisma-for-external/fal directly — only injected `ctx` ports.
2. **Inject the real port** in the web/worker `buildOttoContext` (API key, rate-limit, logging).
3. **Write the skill**: copy `_template.ts` → `skills/<name>.ts`, fill the 3 fields + `execute`.
   Add `export const <name> = <name>Skill.tool;` for the bare-tool export.
4. **Register**: add `import { <name>Skill }` + an entry in `../registry.ts` `allSkills`.
5. **Test**: a gate assertion in `migration.test.ts` (or a `<name>.test.ts`) + a port-required guard.
   Then regenerate the catalog: `pnpm --filter @fikirtive/otto run catalog`.

## Hard rules (enforced)
- No identity fields (`orgId`/`ownerId`/`userId`) in `parameters` — the factory throws.
- `cost:"spend"` without `idempotencyKey` — the factory throws.
- `skills/*` must not import `@fikirtive/generation` (fal) or `reserveCredits` — the CI fence fails
  (`scripts/check-skill-imports.sh`). Route spend through an injected port.
