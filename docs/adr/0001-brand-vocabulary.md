# 1. Brand vocabulary: Brand (tenant) / Brandmark (reference) / Brand Kit (identity)

Date: 2026-06-21
Status: Accepted

> Historical ADR. It explains the provenance of the vocabulary used in code, but it sits below
> `docs/BLUEPRINT.md`, current Founder Resolutions and the Founder-aligned Route-B plan. It cannot
> override newer product direction or prove current implementation status.

## Context

The word "Brand" was overloaded across the product:

- **Existing code + glossary:** `EntityType.BRAND` is a *creative reference cast member* — a
  brand's visual identity you `@mention` into a single generation, sibling to
  CHARACTER / LOCATION / PRODUCT (`packages/db/prisma/schema.prisma:22`, `packages/core/src/ref-config.ts`,
  `apps/web/components/Library.tsx`).
- **Strategy / PRD / pitch:** "Brand" is the **tenancy tier** — `Org → Brand → Project` — the
  merchant's brand/business that holds its Brand Brain, projects, and (later) customers. This is the
  load-bearing concept behind "multi-brand operator" and "Brand Brain."

Both meanings in one word would collide in scoping, queries, and UI the moment the tenancy Brand is
built — a guaranteed source of bugs and confusion. A third, related concept also needed a home: a
brand's *always-on* visual identity (logo / palette / type / tone), which is different from both.

## Decision

1. **"Brand" names the tenancy tier** (`Org → Brand → Project`). It is the strategic, user- and
   investor-facing concept and keeps the word.
2. **The creative-reference EntityType is renamed `BRAND → BRANDMARK`** — a brand's referenceable
   visual identity that you `@mention` into a specific generation. (Code rename: schema enum,
   `ref-config.ts`, `Library.tsx`, a migration — scheduled in roadmap Phase 0.)
3. **A brand's always-on visual identity is the `Brand Kit`** (logo, palette, typography, tone, style
   rules), a component of the **Brand Brain**, applied by Otto to every output by default. It is
   **not** called a "design system" — that term stays reserved for Fikirtive's own app UI component
   library.

## Consequences

- The canonical glossary (`CONTEXT.md`) is updated: Brand (tenant), Brandmark, Brand Brain, Brand Kit.
- A code rename `EntityType.BRAND → BRANDMARK` is required and is part of roadmap Phase 0 (touches the
  Prisma enum, UI config, Library UI, and a data migration of existing BRAND-type entities).
- "Design system" must never be used for a merchant's identity in code, UI, or docs.
- Reversal cost is high: this is a naming root threaded through the schema, UI, data, and the
  pitch/PRD narrative — hence this ADR.
