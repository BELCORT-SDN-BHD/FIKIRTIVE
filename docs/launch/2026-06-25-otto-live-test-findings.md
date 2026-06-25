# Otto /otto — live prod E2E findings (2026-06-25)

Drove the real product on fikirtive.com/otto (founder session) end to end.

## ✅ Working (verified live, real fal)
- Auth, front door, New campaign, goal chips.
- Type a request → Otto auto-titles the thread → produces a detailed, on-brand plan card (one price).
- **Make it → real fal generation → result with Download / Copy to post / Edit by hand.** (Latte ad generated with rendered "New Oat Milk Latte" text.)
- Billing: every action deducts the credit balance (LLM turn ~$0.09, image ~$0.10 with markup). Rate is dev-tunable (`OTTO_LLM_MARGIN`, gen pricing).

## ✅ Fixed + deployed this session
- **CRITICAL: "Make it" was a dead button.** It called `ottoApprove` (resume-parked-only); Otto reaches the card via `propose()` with no parked generate → "That card isn't awaiting approval" → nothing generated. Now branches to `coworkGenerate` for proposed cards. (PR #5, `ed38223`.) Also the root cause of the Raya "go ahead → nothing" report.

## 🔧 Backlog (UX + Otto intelligence) — not yet done

| # | Issue | Root cause | Proposed approach | Impact |
|---|-------|-----------|-------------------|--------|
| 2 | **Feels laggy, no "thinking"** — sending a message doesn't echo it immediately, no streaming, the reply appears as one block after the round-trip. Want it to feel like chatting with Claude. | `ottoTurn` is request→full-response; no optimistic echo, no streaming. | (a) Optimistically render the user's message on send; (b) show a real thinking indicator; (c) stream Otto's tokens (needs a streaming server action / SSE from the agent run). | **High** (the "smart feel") |
| 1 | **Otto can't do research** | No web/research tool in Otto's toolset. | Add a research/web skill to Otto (BELCORT-authored), gated + cited. | High |
| 3 | **Saying "go ahead" in chat doesn't generate** | Otto doesn't fire `generate` from a chat "yes"; only the button does (now fixed). | Either make Otto call generate on a clear chat approval, or change the plan-card copy to point to the button. | Med |
| 4 | **Otto over-promises** — says "just say yes and I'll create the image", but the user must click "Make it". | Copy ↔ flow mismatch (ties to #3). | Align Otto's simple-mode copy with the button gate, or wire chat-yes → generate. | Med |

## Notes
- Prod is on real `fal` (confirmed by the photographic result).
- No code-level spend cap (per founder: avoid money-path bug risk); the cap during dev testing is the human "ask before each spend" gate.
