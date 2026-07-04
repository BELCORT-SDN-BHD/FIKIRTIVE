# QA Otto Stream Route - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Commit: `7eef840`

## Purpose

Close one autonomous part of the real Otto LLM launch gate: the user-facing streaming route's insufficient-credit boundary.

The real Anthropic/Otto smoke still needs a production session and provider credentials. This test instead proves the route-level failure behavior when the metering wrapper refuses the turn before any LLM call.

## Boundary

- No real LLM call was made.
- No real DB connection was used.
- `withLlmBudget` was mocked to throw `InsufficientCredits`, matching the real reserve-failure path.
- The route handler, request parsing, pre-stream USER message persistence path, and stream error branch were executed.

## Scenario

Route: `POST /api/otto/stream`

Input:

- `projectId: "proj_stream"`
- `text: "Make a launch post"`

Setup:

- `requireOwner()` resolves to the test org.
- The project lookup succeeds.
- `withLlmBudget()` throws `InsufficientCredits`.

## Assertions

- Response status is `200` because the SSE-style stream opens successfully.
- The stream contains:
  - `type: "data-error"`
  - `data.kind: "insufficient_credits"`
  - `data.text: "You're out of credits."`
- `withLlmBudget()` is called with:
  - the resolved org id
  - `paid: true`
  - an `otto-stream:<userMessageId>` refId prefix
- `run()` is not called, proving Otto does not execute when reserve fails.
- `finalizeOttoRun()` is not called.
- Exactly one `ChatMessage.create()` call is made for the USER message.
- No AGENT message is persisted.

## Verification

Command:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts lib/__tests__/otto-status-helpers.test.ts lib/__tests__/otto-stream-bridge.test.ts lib/__tests__/otto-stream-route.test.ts
```

Result:

- 4 test files passed.
- 81 tests passed.

Additional check:

```bash
pnpm --filter @fikirtive/web typecheck
```

Result: pass.

## Remaining Otto LLM Gate

This does not prove the real Anthropic/Otto production transport or successful reserve-settle ledger after a real model response. That remains in `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md` Gate 1.
