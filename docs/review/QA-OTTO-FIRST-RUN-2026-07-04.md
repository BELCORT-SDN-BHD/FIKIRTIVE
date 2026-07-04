# Otto First-Run QA - 2026-07-04

Scope: authenticated `/otto?view=canvas` first-run/front-door path under local mock providers.

Environment:
- `GENERATION_PROVIDER=mock`
- `COWORK_PROVIDER=mock`
- `OTTO_DEFAULT_VIDEO_MODEL=seedance-2-fast`
- Local Better Auth magic-link login as `founder@artlio.test`
- No real supplier calls made.

## Findings

1. First authenticated visit to `/otto` for an owner with no project 500ed in Next 16.
   - Cause: `getOrCreateDefaultProject()` created the default project during server render and called `revalidatePath("/", "layout")`.
   - Fix: the render-safe default-project helper now creates/logs the project without cache revalidation. Explicit project mutations still revalidate through `createProject()`.
   - Regression: `apps/web/lib/__tests__/default-project-actions.test.ts`.

2. Mobile first-run onboarding could visually cover goal cards while the front-door panel scrolled.
   - Fix: mobile first-run layout now reserves onboarding height on the chat pane instead of only padding the scrolling inner content.

## Browser Coverage

Desktop:
- Magic-link login -> `/otto`.
- First-run onboarding visible.
- `Add a character or product` -> My Stuff empty state, no console errors.
- `Teach Otto your brand` -> Brand memory, no console errors.
- `Dismiss getting started` writes `localStorage["otto:onboarded"] = "1"` and persists across reload.
- Composer empty state keeps `Let's go` disabled.
- Composer text enables `Let's go`; start creates a thread and reaches the zero-credit `You're out of credits` recovery state with `Top up`.
- `Top up` link opens `/billing`.
- `Set up brand brief` expands inline form, required fields enable `Save brief`, save reaches `Saved!`.
- `Announce a sale` goal tile creates a thread and reaches the same zero-credit recovery state.
- Temporary QA threads were deleted after the pass.

Mobile (`390x844`):
- First-run onboarding, header, composer, and canvas collapse handle render without overlap.
- Goal tiles and `Set up brand brief` remain reachable after scrolling the front-door panel.
- Console errors: none after the fixes.

Screenshots captured locally:
- `.gstack/qa-reports/otto-front-door-onboarding-mobile-2026-07-04.png`
- `.gstack/qa-reports/otto-front-door-goals-mobile-2026-07-04.png`

## Verification

```bash
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web exec vitest run lib/__tests__/default-project-actions.test.ts
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web typecheck
AUTH_SECRET=... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=http://localhost:3137 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @fikirtive/web build
```

All commands passed locally. The build emitted only expected local Google OAuth warnings because no Google client credentials were configured in the QA environment.
