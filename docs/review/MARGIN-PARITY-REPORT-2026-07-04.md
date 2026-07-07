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
- Extracted public Seedance Fast price signals from the embedded pricing payload:
  - `dreamina-seedance-2-0-fast-260128`
  - 1080p output is not supported on Fast.
  - token unit prices: input without video $5.6/M; input with video $3.3/M.
  - `Dreamina Seedance 2.0 Fast (USD per video)` examples include $0.30-$0.66 and $0.64-$1.43 ranges; BytePlus notes the low end corresponds to 2-4s input and the high end to 15s input.
  - Launch implication: normal Fast remains 720p-only; the public 15s input-video high end is not an allowed whole-clip-reference path because runtime gates reference inputs to 2-6s and fixed 5s output.
- Official BytePlus Seedance product page still links to pricing/billing and describes resource plans for Dreamina Seedance 2.0 / 2.0 mini, but plan prices render client-side as "Loading pricing..." here.
- Official Advanced Creation Rights guide was checked again. It lists Advanced Creation Rights at $14,000/year or $1,400/month, Premium at $42,000/year or $4,200/month, larger private asset quotas, higher QPM, non-refundability, and asset deletion after the grace/reclamation window. This is an enterprise/KYC entitlement path, not a current public-launch spend path in code.
- Official private virtual portrait and real-human asset pages were checked as KYC-only references. The visible/embedded content points at private asset-library and Assets API flows for invited/verified use cases; no current public launch path calls CreateAsset, private asset groups, or a real-human asset library. Current whole-clip reference video still uses the ordinary Seedance task endpoint with `role: "reference_video"`.

## Launch Margin Check

All launch-priced spend points are still above the `docs/BLUEPRINT.md` >=45% margin floor using the current executable charge and record-only COGS:

| Spend point | Revenue | COGS basis | Gross margin |
|---|---:|---:|---:|
| Image | 1cr = $0.10 | $0.04 recorded / $0.035 bill fact | 60%-65% |
| Seedance Fast 720p 5s | 8cr = $0.80 | $0.385 | 51.9% |
| Seedance Fast 720p 10s | 14cr = $1.40 | $0.77 | 45.0% |
| Reference video, 2-6s input + 5s output | 16cr = $1.60 | $0.85 estimate | 46.9% |
| Otto LLM | actual token cost x2.0 | official token-rate table | 50.0% |

The 10s Seedance price is exactly at the constitutional floor. Any supplier price increase, loss of the BytePlus resource-pack rate, 1080p Fast enablement, or reference-video input-window expansion must trigger a pricing review before launch.

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

- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r typecheck`
- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r test`
- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r build`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec eslint lib/gen-actions.ts lib/video-frame.ts lib/__tests__/video-frame.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/core exec vitest run src/spend.test.ts src/gen.test.ts src/llm-prices.test.ts`
- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec vitest run lib/__tests__/gen-actions.test.ts lib/__tests__/video-frame.test.ts lib/__tests__/otto-generation-validate.test.ts`
- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/core exec vitest run src/spend.test.ts src/gen.test.ts src/gen-from-card.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/otto test -- src/skills/propose.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/worker test -- src/jobs/gen.test.ts`
- `DATABASE_URL='postgresql://fikirtive:fikirtive@localhost:5432/fikirtive_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web typecheck`
- `git diff --check`

## Notes

- No real BytePlus paid verification was run. The repo constitution still requires explicit founder confirmation per spend.
- Full repo lint still fails on pre-existing unrelated web lint debt. The touched web files have no lint errors; `gen-actions.ts` retains its existing restricted Prisma import warning.
- Dated historical docs still mention the older 7cr/10s/1.5x assumptions. They were left as historical records; this report and the 2026-07-03 costing model are the current margin references for this PR.
