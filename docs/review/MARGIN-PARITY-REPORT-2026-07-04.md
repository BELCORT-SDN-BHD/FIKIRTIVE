# Margin Parity Report — 2026-07-04

## Scope

Aligned executable pricing, quote, reserve, settlement, and recorded COGS with the locked costing model in `docs/design/2026-07-03-harmony-04-costing-model.md`.

## Sources Checked

- `docs/BLUEPRINT.md`: margin floor >=45%, Otto margin 2.0x, no unlimited, BytePlus resource-pack alert remains P1.
- `docs/design/2026-07-03-harmony-04-costing-model.md`: final prices: image 1cr, Seedance 5s/720p 8cr, Seedance 10s/720p 14cr, reference video 16cr with 2-6s input and 5s output, Otto LLM 2.0x.
- BytePlus Advanced Creation Rights guide: relevant for the future hidden KYC/high-volume asset-library path, not the public reference-video pricing path.
- BytePlus private virtual portrait / real-human asset docs: treated as KYC advanced references only; no public-launch feature change was made from these docs.

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
- Otto LLM default margin is now 2.0x.

## Verification

- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r typecheck`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r test`
- `DATABASE_URL='postgresql://artlio:artlio@localhost:5432/artlio_test' COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -r build`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec eslint lib/gen-actions.ts lib/video-frame.ts lib/__tests__/video-frame.test.ts`
- `git diff --check`

## Notes

- No real BytePlus paid verification was run. The repo constitution still requires explicit founder confirmation per spend.
- Full repo lint still fails on pre-existing unrelated web lint debt. The touched web files have no lint errors; `gen-actions.ts` retains its existing restricted Prisma import warning.
- Dated historical docs still mention the older 7cr/10s/1.5x assumptions. They were left as historical records; this report and the 2026-07-03 costing model are the current margin references for this PR.
