# QA Otto Stream Route - 2026-07-04

PR: https://github.com/toolsbbb/FIKIRTIVE/pull/131
Commit: `7eef840`
Follow-up commit: `3756ec3`

## Purpose

Close autonomous parts of the real Otto LLM launch gate in the user-facing streaming route:

- insufficient-credit reserve failure
- successful stream drain, usage mapping, budget wrapper return, and finalization

The real Anthropic/Otto smoke still needs a production session and provider credentials. These tests prove app-owned route behavior without making a real LLM call.

## Boundary

- No real LLM call was made.
- No real DB connection was used.
- `withLlmBudget` is mocked:
  - to throw `InsufficientCredits` for the reserve-failure path
  - to call through for the successful path and capture the returned usage that real `withLlmBudget` would settle
- The route handler, request parsing, pre-stream USER message persistence path, stream bridge, metering seam, and finalization seam were executed.

## Scenarios

Route: `POST /api/otto/stream`

Input:

- `projectId: "proj_stream"`
- `text: "Make a launch post"`

Insufficient-credit setup:

- `requireOwner()` resolves to the test org.
- The project lookup succeeds.
- `withLlmBudget()` throws `InsufficientCredits`.

Successful-stream setup:

- `requireOwner()` resolves to the test org.
- The project lookup succeeds.
- `run()` returns a fake streamed run result that:
  - yields one `output_text_delta` event
  - resolves `completed`
  - exposes usage with cached input tokens
- `withLlmBudget()` calls through, captures the mapped usage, and returns the streamed result.
- `finalizeOttoRun()` returns completed.

## Assertions

Insufficient-credit assertions:

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

Successful-stream assertions:

- Response status is `200`.
- `withLlmBudget()` is called with:
  - the resolved org id
  - `paid: true`
  - an `otto-stream:<userMessageId>` refId prefix
- `run()` happens inside `withLlmBudget()`.
- `run()` is called with `stream: true`.
- The usage returned to `withLlmBudget()` is mapped after stream drain:
  - `inputTokens: 120`
  - `outputTokens: 30`
  - `cachedInputTokens: 50`
- `finalizeOttoRun()` receives:
  - owner id
  - generated thread id
  - `isNew: true`
  - `priorOttoState: null`
  - the streamed result
  - `seqAfterUser: 1`
- The stream contains:
  - `text-start`
  - `text-delta`
  - `text-end`
  - final `data-status` with `kind: "done"`

## Verification

Command:

```bash
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/otto-actions.test.ts lib/__tests__/otto-status-helpers.test.ts lib/__tests__/otto-stream-bridge.test.ts lib/__tests__/otto-stream-route.test.ts
```

Result:

- 4 test files passed.
- 82 tests passed.

Additional check:

```bash
pnpm --filter @fikirtive/web typecheck
```

Result: pass.

## Remaining Otto LLM Gate

This does not prove the real Anthropic/Otto production transport or real reserve-settle ledger after a real model response. It proves the route passes mapped usage to the metering seam after stream drain. The live provider smoke remains in `docs/review/EXTERNAL-SMOKE-RUNBOOK-2026-07-04.md` Gate 1.
