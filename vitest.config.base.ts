// #862: CI runs on a machine shared with the dev-agent fleet, so vitest's
// testTimeout (5s) / hookTimeout (10s) defaults — calibrated for an idle box —
// get hit by real transform/collect delays (packages/core's `await import()`
// of its own barrel) and real DB contention (packages/db's per-test TRUNCATE
// hook under a saturated local Postgres) that have nothing to do with the
// test's own correctness. Two independent runs confirmed both families clear
// at load-free timing and only fail when the machine is busy — see the issue
// for the run ids.
//
// The ceiling's job is catching a genuine hang, not gating performance, so
// this widens it ONLY under CI (checked directly here, not passed as a CLI
// flag — pnpm's recursive script forwarding inserts its own "--" ahead of
// forwarded args, which vitest's CLI parser then treats as a raw passthrough
// boundary rather than parsing "--testTimeout" as a flag; confirmed empirically
// while fixing #862). Local runs, which don't share the machine this way,
// keep vitest's defaults.
//
// Wired into packages/core and packages/db — the two families with logged
// timeout flakes. Deliberately NOT wired into apps/web (already sets its own
// testTimeout: 20000 with a documented single-thread rationale) or
// packages/generation (its one logged flake, provider-concurrency.test.ts, was
// a real wall-clock timer race fixed with fake timers in #908/#796 — a wider
// ceiling wouldn't have fixed it and doesn't need to).
const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

export const ciTimeouts = isCI ? { testTimeout: 45_000, hookTimeout: 45_000 } : {};
