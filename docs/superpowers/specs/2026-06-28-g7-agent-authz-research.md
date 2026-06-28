# G7 Research — Safe Authorization for an Autonomous LLM Agent That Spends Real Money

**Date:** 2026-06-28
**Method:** deep-research harness — 6 angles, 28 sources fetched, 138 claims extracted, 25 verified with 3-vote adversarial verification, 12 survived (all 3-0), 2 refuted.
**Question:** Best-practice architecture + frameworks for letting an autonomous LLM agent take real-money / irreversible external actions (e.g. spending on Meta Ads), covering SoD, least privilege, HITL, policy-as-code, spend caps, idempotency, audit, kill-switch — and which fits a TS/Next.js "agent proposes, server executes" codebase.

---

## The one-line answer (the field converges hard on this)

> **Treat the LLM as an untrusted *proposer* only. Move every money/safety decision into deterministic server code. Enforcement lives in code, never in the system prompt.**

Asserted nearly verbatim by the two strongest primary sources — Microsoft Zero Trust/SFI and the OWASP AI Agent Security Cheat Sheet. There is **no turnkey "best framework" product**; the answer is a **composition** of well-known patterns. This is exactly the architecture we converged on independently.

---

## Verified findings (all high-confidence, 3-0 adversarial votes)

1. **Enforcement in deterministic code, not the prompt.** "System messages reinforce roles… always backed by deterministic controls." "The critical design mistake is letting the model decide when human review is required — an adversarial prompt can bypass review entirely. HITL is enforced deterministically by the application layer; escalation triggers are defined in code." — MS Zero Trust/SFI, MS Security Blog (2026-05), OWASP.

2. **SoD = proposer / approver / executor.** OWASP §4 verbatim: "Separate decision-making from execution. The agent can propose an action, but a policy service or execution component should independently validate scope, privilege, and approval state before execution." This is banking maker-checker applied to agents. — OWASP, MS.

3. **Least privilege = default-deny + capability-scoped.** "Start with no permitted actions by default; incrementally enable by role/risk. Assign each agent a unique verifiable identity (RBAC)." Per-tool read-vs-write allowlists, per-resource path allowlists; **never wildcards**; blocked-patterns only as a secondary brake. Caveat: least privilege is necessary-but-not-sufficient vs prompt injection. — MS, OWASP.

4. **HITL = pause before the irreversible step, code-enforced.** LangGraph `interrupt()` pauses, persists, and requires explicit `Command(resume=…)`; scoped to "API calls, database changes, financial transactions." Caveat: it's Python-first — the *pattern* (pause-persist-resume gate in server code) transfers to TS; implement natively. — LangChain/LangGraph; AI SDK / Inngest for the TS-native equivalent.

5. **Bind approval to the EXACT action.** OWASP verbatim: "Bind approval to the exact action. Include the actor, tool name, target resource, normalized parameters, timestamp, and expiry." + "Use short-lived authorization artifacts and replay protection for irreversible operations." Mark approvals **CONSUMED** (single-use) so replay's second use fails. — OWASP, AP2/APEX papers, LoginRadius, SuperTokens.

6. **Policy-as-code: Cedar fits a TS app better than OPA/Rego.** Cedar is safe-by-default & deterministic: default-deny, **forbid-overrides-permit**, order-independent, each policy a standalone allow/deny — formally verified (OOPSLA 2024). Pick Cedar on *determinism*, **not** speed (the "42–60× faster than Rego" claim was REFUTED). Both engines viable. — AWS, Cedar docs + paper.

7. **Hard deterministic spend/rate/loop caps ("Denial of Wallet").** "Enforce token, cost, retry, and tool-chain limits"; circuit breakers; per-session cost thresholds. Never let the model self-limit (real 2026 incidents: $82K from a stolen key in 48h; $46K/day LLMjacking). — OWASP, Datadog, TrueFoundry.

8. **Irreversible writes need exactly-once *processing* (delivery is impossible).** Client-generated idempotency key via `Idempotency-Key` header on POST; a retry returns the cached original result instead of re-executing the side effect. — Stripe (IETF-draft-standardized).

9. **Transactional outbox for atomic intent-before-write.** Write business state + the outbound message in the SAME DB transaction (both or neither); a relay sends and marks processed only after success, else retries. TS/Postgres lib exists: **`pg-transactional-outbox`**. Guarantees at-least-once to the relay → must pair with idempotency keys at execution. — AWS Prescriptive Guidance, npm.

10. **Can't rely on the broker for exactly-once.** At-least-once delivery means the consumer performing the irreversible action MUST be idempotent (inbox / processed-tracking). Exactly-once *processing* achievable; exactly-once *delivery* not. (FIFO-queue exactly-once claim REFUTED — FIFO only dedupes enqueue, not the external side effect.) — AWS, pg-transactional-outbox.

11. **Grade autonomy deliberately (5-level taxonomy).** operator / collaborator / consultant / **approver** / observer. "Approver" (L4) = maker-checker default: agent plans & executes but must get explicit sign-off before consequential actions; "user may specify conditions for seeking approval." Autonomy is "a deliberate design decision, separate from capability" — constrain what it's *permitted* to do independently of what it's *able* to do. — Feng/McDonald/Zhang, arXiv:2506.12469.

12. **Idempotent where possible; explicit duplicate-confirmation where not.** OWASP: "Make high-impact actions idempotent where possible and require explicit duplicate confirmation when idempotency is not possible," scoped to destructive/financial/external ops. The answer to "what if you literally can't refund": gate the non-idempotent action behind explicit human duplicate confirmation. — OWASP, CockroachLabs, Stripe.

## Refuted (do NOT rely on)
- "Cedar evaluates 42–60× faster than Rego" (1-2). → choose Cedar on safe-by-default determinism, not performance.
- "FIFO queues + dedup IDs give exactly-once for irreversible external side effects" (1-2). → FIFO dedupes enqueue only; the consumer still must be idempotent.

## Caveats
Agentic-security guidance is fast-moving (MS pages 2026-03; OWASP alongside 2026 material) — revisit in 6–12 months. No single turnkey product bundles all of this; the recommendation is a synthesis. Confirm the TS/Node Cedar integration path (native bindings vs AWS Verified Permissions vs WASM/FFI) before committing. Least privilege + these controls reduce but don't eliminate prompt injection — defense-in-depth.

## Open questions (relevant to G7)
- Production TS/Node integration path + latency for Cedar vs a lightweight in-app deterministic check for a small policy.
- For non-refundable Meta spend: the concrete proposal→idempotency-key→outbox-row→Meta-call→ledger chain so a crash anywhere is provably exactly-once-settled; and the human duplicate-confirmation UX for non-idempotent retries.
- Whether a battle-tested framework exists vs bespoke server code (currently bespoke is the safer choice).
- Operationalizing the 5-level taxonomy as per-action policy, and its interaction with Claude-Code-style plan-level batch approval.

---

## How this maps to G7 (validation + what to add)

**VALIDATED (our design = the industry backbone):**
- "Enforcement in code, not the soul" = finding 1 (the #1 principle). ✅ exact match.
- proposer(Otto) / approver(human) / executor(server) = finding 2. ✅ exact match.
- Otto has no write tool + CI fence = finding 3 (default-deny capability least-privilege). ✅
- server-action gate, never model-decided = findings 1, 4. ✅
- frozen, concrete plan = finding 5 — but **strengthen** (below).
- per-step idempotency = findings 8–10, 12 — **strengthen** (below).
- money-class server-computed + autonomy modes = finding 11 (our ① Ask ≈ L4 "approver"; ③ Auto = safe-auto/spend-ask).

**THREE concrete strengthenings to fold into the spec:**
- **(A) Bind + expire + single-use the approval.** Don't just freeze the plan — bind the human approval to a **hash of the normalized step params + actor + target + timestamp + expiry**, and mark it **CONSUMED** on use (replay protection). An approval can never apply to a different/edited action or be replayed. (finding 5)
- **(B) Outbox + idempotent settlement.** Record intent-to-act in a Postgres **outbox row in the same transaction** as marking the plan approved; the executor reads live Meta state, applies via `metaGraphPost` with a per-step idempotency key, marks the row settled only on success. We're already on Postgres/Prisma; `pg-transactional-outbox` is the reference pattern. (findings 8–10)
- **(C) Non-idempotent → explicit duplicate-confirm.** Meta spend can't be refunded. If a step's apply-status is ambiguous after a crash (MAYBE-APPLIED), the executor **re-reads live state to reconcile**; if it genuinely can't tell, it **asks the human to confirm the retry** rather than auto-retrying. (finding 12) — this is exactly our "stop + report, never auto-rollback" rule, now research-backed.

**ONE decision (recommendation): policy engine.**
- Finding 6 says Cedar is the best-fit *engine* IF you adopt one. But our v1 policy is tiny: **2 modes × ~5 ops × {safe,spend}** — a handful of deterministic rules. **Recommendation: hand-rolled deterministic policy in TS for v1** (one pure function, fully unit-tested, default-deny), **structured so it can migrate to Cedar later** if the policy grows (more modes, per-account rules, ④ Autopilot caps). Adding a policy-engine dependency for ~10 rules is premature. (YAGNI; revisit when ④ + per-account rules land.)

**Kill-switch (finding 7):** add a deterministic global "**pause all Meta writes**" switch (a flag the executor checks first, fail-closed) so a human can hard-stop everything instantly, independent of autonomy mode. Cheap to add in v1.
