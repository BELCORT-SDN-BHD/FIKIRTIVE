# FIKIRTIVE — App structure & screen brief (for Claude Design)

**Date:** 2026-06-24 · **Pairs with:**
[`../superpowers/specs/2026-06-24-fikirtive-product-concept.md`](../superpowers/specs/2026-06-24-fikirtive-product-concept.md)

## What this doc is — and is NOT
This gives you the **app structure, routes, and what each screen does** (its purpose, what data it
shows, how you get to/from it, and its states). It is the functional skeleton.

It deliberately says **nothing about the design system, visual language, layout, or styling** —
**that's yours to explore in Claude Design** (wireframes, prototype shape, look and feel). Treat
every screen below as "here's what it must let the user do and see," not "here's how it should
look."

## The product in one line
**Otto is your super-employee.** You talk to him; he does the work using the tools/skills he's been
given, remembers your brand, hands heavy jobs to a back-office factory, and asks before spending
money. **It's one app — you mostly just talk to Otto;** the other pages are for *looking at* what he
knows and made. There is no "simple vs pro" mode. Target user: a 60-year-old SMB owner with zero
AI/marketing knowledge — if a screen would make that person hesitate, it's wrong.

---

## App structure / routes (start here)

Five places a user can be, plus an escape hatch. Only the first four are in the main nav.

```
/            Otto            the operator — the conversation, where everything gets DONE
/stuff       My Stuff        look at what you own: your Cast (reusable people/products/logos) + your Ads
/memory      Brand memory    look at / edit what Otto knows about your brand   ← the screen added today
/account     Account         real balance, settings, sign out

/workshop    Workshop        OPTIONAL manual drill-down (editor / storyboard / manual maker).
                             NOT in the main nav. Reached only when Otto opens it for you
                             ("change this" on a result, or "let me do it by hand").

/login       Login           magic-link sign-in
```

**How they connect (the spine):**
- `/` (Otto) is home and the default landing. Everything starts as a conversation.
- From an Otto **result**, the user can: download / copy-to-post, ask Otto to change it (stays in
  chat), or "edit by hand" → opens `/workshop` scoped to that one thing, then comes back.
- **Progress is ambient, not a page to visit:** while Otto works, a small "Otto is making… (about
  N min)" indicator lives in the Otto surface; tapping it expands a panel. Don't make the novice
  navigate to a separate jobs page. (You decide its shape in Claude Design.)
- `/stuff`, `/memory`, `/account` are calm "look / manage" destinations — you go there to review,
  not to do the core work.

*(Later, for agencies: a brand/client switcher appears in the chrome and these same pages scope to
the active client. That's a future layer on this same structure — not a second app, not new routes.
Out of scope for now.)*

---

## How it should behave (product rules — not visual rules)
These shape structure, flow, and copy. They are not about styling.
1. **Plain language, zero jargon.** Never "generation / shot / render / model / prompt / credits-CR." Say "ads," "video," "scene," "about $0.50."
2. **Otto is a calm operator**, not a flashy chatbot — he shows his plan before acting.
3. **See-then-approve before money.** Nothing spends until the user sees a plain-English "this costs ~$X, you have $Y — go?" and approves.
4. **Honesty.** Real balance (never a fake number). Honest status (no fake progress, no fake performance scores). Honest endpoints (download / copy-to-post — we don't publish yet, so no publish button).
5. **Recognition over recall.** A novice picks from clear options; never face a blank "type something."
6. **Choosing beats creating.** The hero moment is the user *picking* from a small set Otto made.
7. **Every state exists.** For each screen: loading, empty, error, partial. Empty teaches the next action; errors recover inline (retry/resume), never a dead end.
8. **Desktop-first, mobile-ready.**

---

## Screens (function only — you design the form)

### Otto (`/`) — the operator. This is the product; design these first.
1. **Goal-tile front door** — first thing after login. Shows: ~6 plain-language goal tiles ("Sell a product," "Announce a sale," "Get more followers," "Make a video"…) + a "just tell Otto" option + the real balance, quietly. *Returning users also see their recent ads here.* Tapping a tile starts a scoped conversation. (Never the blank "type a prompt" chat.)
2. **Otto conversation (active)** — the working thread: Otto's messages, the user's short replies, and Otto asking only the 2–3 questions the chosen goal needs. Calm, readable.
3. **Plan card (the spend gate)** — before any paid step: what Otto will make ("3 images + a 20-second video"), **one total in plain English** ("about $3 — 30 of your 240 credits"), and **Approve / Change**. One approval for the whole batch. Shows real balance. (No model names, no per-item cost soup.)
4. **Ad-pack chooser (hero moment)** — a small set of finished ads to pick from, with Otto's plain-language pick marked ("I'd run this one — the product is the hero and the text is short"). Never a number/score.
5. **Single ad-pack / result** — one chosen result expanded: download, copy-to-post (open IG/TikTok with the file ready), "change it" (ask Otto) or "edit by hand" (→ Workshop). No publish button.
6. **Working / progress (ambient)** — plain-language "Otto is making scene 2 of 3 — about a minute left," with honest partial status ("3 of 4 ready — 1 didn't work, you weren't charged — retry?"). Lives in the Otto surface, expandable.
7. **Empty / first-run** — brand-new account: a short 3-step teach (pick a goal → tell Otto → approve & download), pointing at the goal tiles. Warm.

### My Stuff (`/stuff`)
8. **Cast** — your reusable people/products/logos, each with a thumbnail and a plain usage hint ("used in 14 ads"). Tapping one → its detail.
9. **Ads** — your finished ads, newest first, each downloadable.
10. **Cast member detail** — one cast member's reference images and where it's been used; an "edit" action that drills into Workshop.
11. **Empty states** — "no cast yet" / "no ads yet," each pointing back to making something.

### Brand memory (`/memory`) — ADDED TODAY
12. **Memory overview** — what Otto knows about your brand, in plain-language, **grouped by category** (e.g. *About the brand* — voice/tone, what you sell; *Look & feel* — colors, style notes; *Your customers*; *Do / Don't*; *Your habits & preferences*). Each item shows whether **Otto learned it** or **you added it**, and when. Read first, edit anytime.
13. **Add / edit a memory** — the user can add a fact, edit one, or delete one, in plain language (a simple labeled note under a category). A user-edited item is "pinned" — Otto suggests, never silently overwrites it.
14. **"Otto, learn my brand" entry** — a way to start a guided conversation where Otto asks about the brand and fills the memory (v1: the user pastes their about-page text or uploads a doc — Otto does NOT auto-fetch URLs yet). After it, the user lands on the memory overview and can correct anything.
15. **Memory empty state** — "Otto doesn't know your brand yet" → teaches the two ways to fill it (just keep working with Otto, or do "learn my brand").

### Workshop (`/workshop`) — drill-down only (design the frame; the inner tools mostly exist)
16. **Workshop frame + which-tool** — "you've stepped in to change one thing" with a switch between the manual tools (edit video / edit scenes / make manually / edit a cast member). Feels like an optional advanced room, not the default.
17. **"Change this / edit by hand" entry** — how a result hands off into the right Workshop tool, scoped to that exact item, and how you get back to Otto without losing your place.

### Account (`/account`)
18. **Account** — real balance, plain-language spend history ("Ramadan video — $0.90"), settings, sign out.

### Global
19. **Navigation** — how Otto / My Stuff / Memory / Account are presented (Workshop stays out of the main nav). **Login** — magic-link.
- **Recurring element:** a plain-language spend phrase ("$0.50 — 5 images") reused wherever money appears (plan card, history). Same wording everywhere.

---

## Out of scope (do NOT include)
- **Visual design / design system / layout / styling / the wireframe & prototype form** — that's yours to explore in Claude Design.
- Any publish-to-Meta/TikTok button or flow; analytics / performance dashboards / numeric scores.
- The agency / multi-client layer (brand switcher, client separation, bulk ops, approval) — a future layer on this same structure.
- Auto-fetching a brand URL ("research my brand") — v1 is paste-text / upload only.

## Handoff back
Once you've explored the wireframes/prototype in Claude Design, hand the result back here.
Engineering builds it against the live Otto loop, the real credit ledger, and the existing
generation engine — per the concept doc. The Otto front door, the plan card, and the ad-pack chooser
are net-new and don't exist in code yet; the money path, generation, and download already do.
