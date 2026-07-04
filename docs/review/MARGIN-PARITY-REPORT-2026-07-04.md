# Margin Parity Report — 2026-07-04

## Scope

Aligned executable pricing, quote, reserve, settlement, and recorded COGS with the locked costing model in `docs/design/2026-07-03-harmony-04-costing-model.md`.

## Sources Checked

- `docs/BLUEPRINT.md`: margin floor >=45%, Otto margin 2.0x, no unlimited, BytePlus resource-pack alert is P1.
- `docs/design/2026-07-03-harmony-04-costing-model.md`: final prices: image 1cr, Seedance 5s/720p 8cr, Seedance 10s/720p 14cr, reference video 16cr with 2-6s input and 5s output, Otto LLM 2.0x.
- BytePlus Advanced Creation Rights guide: relevant for the future hidden KYC/high-volume asset-library path, not the public reference-video pricing path.
- BytePlus private virtual portrait / real-human asset docs: treated as KYC advanced references only; no public-launch feature change was made from these docs.

## Follow-up source audit — 2026-07-04

- Official BytePlus ModelArk pricing page was checked again. It was last updated on 2026-07-02 and still exposes Seedance 2.0 pricing as public ModelArk pricing, while the resource-pack page itself is JS/content-gated in this environment.
- Official BytePlus Seedance product page still links to pricing/billing and describes resource plans for Dreamina Seedance 2.0 / 2.0 mini, but plan prices render client-side as "Loading pricing..." here.
- Official Advanced Creation Rights guide was checked again. It lists Advanced Creation Rights at $14,000/year or $1,400/month, Premium at $42,000/year or $4,200/month, larger private asset quotas, higher QPM, non-refundability, and asset deletion after the grace/reclamation window. This is an enterprise/KYC entitlement path, not a current public-launch spend path in code.
- Official private virtual portrait and real-human asset pages remain accessible only as public shells from this environment; they were not used to change launch pricing or runtime behavior.

## Changes Made

- `pricedGenCredits` now charges Seedance video from the final model:
  - 720p 5s: 8 displayed credits
  - 720p 10s: 14 displayed credits
  - whole-clip reference video: 16 displayed credits
  - 1080p or unknown higher guardrail: 16 displayed credits
- `genSpentUsd` now records bill-backed Seedance COGS:
  - ordinary Seedance: $0.077/s
  - reference video: $0.85 fixed estimate for 6s input + 5s output
- Reference video is now gated to the costed path:
  - input duration window: 2-6s
  - output duration: fixed 5s
  - model: `seedance-2-fast` only
- Otto proposal cards now quote the same reference-video price that `startGen` reserves and the worker settles.
- `startGen` now has a focused regression test proving a reference-video request persists `referenceVideoGenerationId` and reserves exactly 16 displayed credits before the worker runs.
- Otto LLM default margin is now 2.0x.
- Admin System Health now surfaces the BytePlus resource-pack guard from env-configured pack capacity/console-used amounts, falling back to frozen spend snapshots and warning when the alert is not configured.

## Verification

- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r typecheck`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r test`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r build`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec eslint lib/gen-actions.ts lib/video-frame.ts lib/__tests__/video-frame.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/core exec vitest run src/spend.test.ts src/gen.test.ts src/llm-prices.test.ts`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec vitest run lib/__tests__/gen-actions.test.ts lib/__tests__/video-frame.test.ts lib/__tests__/otto-generation-validate.test.ts`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/core exec vitest run src/spend.test.ts src/gen.test.ts src/gen-from-card.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/otto test -- src/skills/propose.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/worker test -- src/jobs/gen.test.ts`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web typecheck`
- `git diff --check`

## Notes

- No real BytePlus paid verification was run. The repo constitution still requires explicit founder confirmation per spend.
- Full repo lint still fails on pre-existing unrelated web lint debt. The touched web files have no lint errors; `gen-actions.ts` retains its existing restricted Prisma import warning.
- Dated historical docs still mention the older 7cr/10s/1.5x assumptions. They were left as historical records; this report and the 2026-07-03 costing model are the current margin references for this PR.
