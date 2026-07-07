# Otto — Ideal Experience & Product Design

Date: 2026-06-26 · Owner: founder (tools@belcort.com) · Status: design approved, ready to plan
Source: brainstorm session built on the [Otto UX/feature audit](../../ux-audit-2026-06-26-otto.md) (41 problems) + founder screen recording. Mockups: `.superpowers/brainstorm/54220-1782452068/content/01..06`.

---

## North Star

> **Otto is "Claude Code for marketing": a trustworthy super-employee.** Transparent, honest, low-key about money, shows you what it's doing, owns up when it fails, guides you with suggestion buttons, lives across the whole app, grows new capabilities as modules, and works on its own — reaching out when it needs you.

The audit's headline finding: the #1 problem is **not** visual polish — it's that Otto's *approve / charge / generation-status / failure-recovery* feel untrustworthy. So the whole design is organized around **earning trust first**, then expanding scope.

---

## The Otto Operating Contract (invariants every surface & module MUST follow)

These five rules are the spine. Every current surface and every future module obeys them — that's what makes "one Otto" coherent as capabilities grow.

1. **Transparent billing, in credits, Claude-Code-style.** Credits are the only unit (never dollars). Cost is *quiet*: a small estimate shown at the spend moment ("≈ 2 credits"), credits deducted without drama, an honest receipt afterward. The balance lives in a calm corner — never a giant number jumping down.
2. **Approve before spend.** Nothing spends real money without the user's go-ahead — *or* within a budget the user explicitly set. This holds even for autonomous/scheduled work.
3. **Status-grounded honesty.** Otto never claims progress or success it can't verify. While working it shows real stages (queued → generating → uploading) + ETA. On failure it says so plainly, **refunds the held credits**, and offers a **safe retry that won't double-charge**. No false reassurance ("Not stuck at all").
4. **Suggestion-button guidance.** Otto recommends next steps as buttons (like Claude Code's quick actions). Output is *not* a rigid template — it adapts to what the user wants, with Otto proposing options.
5. **One Otto, everywhere.** Same agent, voice, and contract across every surface and module. Adding a capability = giving Otto a new tool; the experience doesn't change.

---

## The Ideal Experience — surface by surface

### 1. Make (the core chat loop) — mockup 01 / 02
- User says what they want → Otto narrates a tight plan and posts a **plan card**.
- Card shows the **real charge in credits as small text** ("≈ 2 credits · billed only if it finishes"), a **Make it** button, and a **Change the look** button. Approval works by button **or** clear chat go-ahead — both are acknowledged.
- After approval: **transparent generation** — visible stages + elapsed/ETA + "N credits on hold".
- On failure: honest message + **auto-refund** + **`↻ Try again — won't charge twice`** + `✏️ Adjust & retry`.
- Result + **suggestion buttons** ("Make it an image instead · ~1 cr", "Try 3 variations · ~6 cr", "Tweak the idea"). Deliverable is flexible (image / video / pack) — Otto recommends, user chooses.

### 2. Brand Memory — "Otto lives here" — mockup 03
- Not a static form. Otto is present and proactive: "Want me to learn your brand? Drop a link or photos — or just tell me."
- Otto **researches** (website / socials / product photos) and returns proposed memory entries (Voice / Audience / Products / Rules) as cards the user **approves / edits / skips** one by one. "Otto learned this" becomes real.
- User can converse with memory: "what do you remember about my voice?", "tidy up my memory" (dedupe/summarize/resolve conflicts).
- Every generation can show **which memories it used**. No silent truncation.

### 3. My Stuff — Otto keeps it tidy — mockup 04
- Grouped by type (Products / Characters / Locations), **searchable / sortable**.
- Per-item **rename / delete / set-base / manage**.
- Otto is proactive: "I found 12 test-junk items — want me to clear them?" (the `Brute*/Pass*/Sloppy*/Mira*` pollution).
- Failed / in-progress generations are visible here too, not just successes.

### 4. Account — quiet & honest — mockup 04
- Credits, calm balance in the corner; an **honest receipt** (media fee / "Otto thinking" / reserved / settled / refunded) that **reconciles** with what was shown at spend time.

---

## Super-employee scope: one app, no second door — mockup 04

- **One Otto app.** The legacy `/studio` (and `/m`, `/library`) are retired/redirected; `/` and post-login land on Otto. (Matches the locked product direction: one Otto-operator app, no two doors.)
- Otto is present and proactive in **every** surface, all under the operating contract.

---

## Platform: Otto's capabilities grow — mockup 05

- Otto is a **platform-level operator**. New capabilities plug in as modules — each is "a new tool for Otto," all obeying the same contract:
  - **Live now:** Make · Brand Memory · My Stuff.
  - **Next:** 📅 **Schedule** (plan/auto-publish posts), 📣 **Run Ads** (launch & manage Meta/IG campaigns — budgets, audiences), 📊 **Analyse** (performance, recap, recommendations), ➕ future modules.
- The marketing **loop**: Create → Schedule → Run ads → Analyse → **Otto suggests** ("this one had the best ROI — make 3 more like it?") → repeat.
- Technically grounded: the codebase already has a Meta Ads tool surface and a scheduled-tasks capability Otto can call.

---

## Autonomous + proactive — mockup 06

- The user sets **recurring jobs in plain language** ("every week, check for new products; if none, remind me"; "every Friday, tell me my best ad"). Otto runs them in the background (cron).
- Otto **reaches out** (in-app notification / text) when it has news or needs a decision — with **suggestion buttons** right in the notification ("Make one · ~2 cr" / "Remind me Friday" / "Open Otto").
- **Money guardrail (non-negotiable, from contract rule #2):** autonomous work **never spends on its own** — it either asks first, or stays within a budget the user set. Autonomy never breaks "approve before spend."

---

## Relationship to the audit (gap → target)

This document is the **target**. The [41-problem audit](../../ux-audit-2026-06-26-otto.md) is the **gap** between today and this target, and its **8-PR roadmap** is the concrete path. PR 1 (honest money copy + credits, [fikirtive#11](https://github.com/toolsbbb/fikirtive/pull/11)) already shipped the first slice of the trustworthy core.

---

## Phasing (decomposition — each phase gets its own plan → build)

This vision is too large for a single implementation plan, so it decomposes. Build trust first; expand outward.

- **Phase 0 — Trustworthy core** (money truth · generation lifecycle · honesty contract). _Audit PRs 1–3._ **In progress — PR 1 shipped.**
- **Phase 1 — Super-employee surfaces** (Brand Memory conversational · My Stuff management & cleanup · one-door IA). _Audit PRs 3–6._
- **Phase 2 — Deliverable & guidance** (flexible output + suggestion-button layer + ad-pack). _Audit PR 8 + new suggestion layer._
- **Phase 3 — Platform modules** (Schedule · Run Ads · Analyse) built on the Otto contract.
- **Phase 4 — Autonomy** (cron jobs + proactive notifications + budget guardrail).

---

## Decisions still open (carried from the audit + new)

- **G1 ✅** conversation stays charged (copy made honest). **G2 ✅** credits everywhere.
- **G3** stuck-job refund/reaper (touches refund path). **G4** real self-serve top-up/checkout. **G5** purge polluted prod entities.
- **New (autonomy):** notification channel (in-app / email / SMS?), the budget model for autonomous spend, how aggressive Otto's proactivity should be.

---

## Success criteria

A merchant can go from *"I want an ad"* to a **posted ad** — always knowing what they'll pay and what actually happened, **never surprised about money**, with Otto **guiding** them and (later) **working autonomously** within guardrails — and **trusting it the whole way**. As new modules (schedule, ads, analytics) arrive, the merchant operates them all through the **same one Otto**, with no new mental model.
