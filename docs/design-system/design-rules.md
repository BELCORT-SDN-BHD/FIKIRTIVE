# FIKIRTIVE design rules — v2 (2026-07-07)

Locked direction: **"Grok bones + Headspace/Phantom heart."** (LOCKED 2026-06-28 — colours must NOT change.)
v2 adds: a concrete type scale, an 8pt spacing grid, a 3-tier shadow spec, a motion table,
and the **Live reflection** section required by constitution v2.6 (agent-native UI).
Nothing in the locked palette moves. This is polish and completion, not redesign.

---

## 1. Locked direction (unchanged)

- Near-white ground `#FCFCFC`, near-black ink `#0A0A0A`. Flat surfaces, hairline borders. No glass, no gradients on working surfaces.
- Coral `#EC5828` belongs to **OTTO only**: the focus ring and agent-initiated moments. Never a human-action CTA.
- Human primary action = INK (`--primary`). Semantic colours = state only.
- Fonts: **Geist** (sans) + **JetBrains Mono** (labels/meta). Lucide icons only.
- Radii 14 / 18 / 24 px (controls / cards / modals). Sentence case everywhere. Skeletons, not spinners.
- Stack: shadcn/ui new-york + Tailwind v4. Theme lives **solely** in the `.gb` token block of `apps/web/app/globals.css`.

## 2. Colour (values unchanged)

| Token | Light | Dark (`.gb.dark`) | Role |
|---|---|---|---|
| `--background` | `#FCFCFC` | `#0B0B0C` | app ground |
| `--foreground` | `#0A0A0A` | `#FAFAFA` | ink |
| `--card` | `#FFFFFF` | `#131315` | surfaces |
| `--primary` | `#0A0A0A` | `#FAFAFA` | human CTA (INK) |
| `--secondary` / `--muted` | `#F4F4F3` | `#1C1C1F` / `#161619` | recessed fills |
| `--accent` | `#ECECEA` | `#1C1C1F` | **neutral** hover tint (NOT coral — silent-inversion bug) |
| `--muted-foreground` | `#6E6E68` | `#A1A1A8` | secondary text |
| `--border` / `--input` | `#E6E6E3` | `#262629` | hairlines |
| `--ring` | `#EC5828` | `#F26A3C` | focus ring (coral, the one OTTO-coloured global) |
| `--brand` (+`-soft`) | `#EC5828` / `#FBE4D8` | `#F26A3C` / `#3A1E12` | OTTO only |
| `--success/warning/error/info` (+`-soft` pairs) | `#16A34A` `#D97706` `#E5484D` `#3B6FE6` | see globals.css | state only |

Rules (unchanged): coral law; semantic = state, never decoration; no raw hex outside the `.gb` block; new tokens go into `.gb` **and** the `@theme inline` registration, light **and** dark.

## 3. Type — the scale (NEW, prescriptive)

Geist for everything; JetBrains Mono only for `micro-mono`. Whole-pixel sizes only — the half-pixel Vapor sizes (14.5 / 13.5 / 12.5 / 11.5) are legacy and quantise on touch (see polish-delta).

| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 28 / 34 | 700 | −0.021em | empty-state heroes, front door |
| `title` | 24 / 30 | 700 | −0.020em | page titles (Settings, Analytics) |
| `heading` | 20 / 26 | 600 | −0.017em | section + dialog titles |
| `card-title` | 18 / 24 | 600 | −0.012em | `CardTitle`, panel headers |
| `body-lg` | 15 / 22 | 400 | −0.011em | reading text: chat bubbles, composer |
| `body` | 14 / 20 | 400 (500 emphasised, 600 buttons) | −0.006em | default UI text, controls, rows |
| `footnote` | 13 / 18 | 400 | 0 | hints, secondary rows |
| `caption` | 12 / 16 | 500 | 0 | meta, timestamps, field hints |
| `micro-mono` | 11 / 14 | 500 | +0.08em, uppercase | mono labels, badges, prices |

Rules:
- Max two weights per component; hierarchy comes from size + colour (`--foreground` vs `--muted-foreground`), not extra weights.
- Negative tracking only at 14px and above. Never letter-space lowercase body text.
- Numbers that align (prices, counts, durations) use `micro-mono` or `font-variant-numeric: tabular-nums`.

## 4. Spacing — 8pt grid (NEW, prescriptive)

Base unit **4px**; layout rhythm **8px**. Allowed steps: `4 8 12 16 20 24 32 40 48 64`. 2px only for icon-to-dot gaps. Anything ending in 3/7/9/11 px is legacy drift — quantise on touch.

Component padding table:

| Component | Spec |
|---|---|
| Button sm / default / lg | h 36 / 44 / 48 · px 14 / 20 / 24 |
| Input / select | h 44 · px 14 |
| Card | p 24 (compact variant: 16) · internal gap 16 |
| Dialog / modal | p 24 · action row gap 12, margin-top 24 |
| List / settings row | py 12 · px 16 · hairline between rows only |
| Chat bubble | py 12 · px 16 |
| Badge / pill | py 4 · px 10 |
| Icon button | 36 × 36 (44 × 44 touch surfaces) |
| Grid gap | 16 · section gap 32–40 · page gutter 24 (16 mobile) |

## 5. Shape & depth

Radii (unchanged): `--radius` 14px controls · `--radius-card` 18px · `--radius-modal` 24px · 10px for nested elements inside a 14px control · 999px pills. Nothing else (9/16/20px sightings are drift).

**3-tier shadow spec (NEW).** An element sits in exactly one tier; never stack tiers; never darken a shadow to signal state (use border/ring instead). Exact values (already tokenised in `.gb`):

| Tier | Token(s) | Value | Use |
|---|---|---|---|
| 1 — rest | `--shadow-xs` / `--shadow-sm` | `0 1px 2px rgba(20 20 24 / .05)` / `0 1px 3px rgba(20 20 24 / .06), 0 1px 2px rgba(20 20 24 / .05)` | controls, cards at rest |
| 2 — raised | `--shadow-md` | `0 6px 16px rgba(20 20 24 / .08), 0 2px 6px rgba(20 20 24 / .05)` | hover lift, toolbars, dropdowns |
| 3 — overlay | `--shadow-lg` / `--shadow-xl` | `0 14px 34px rgba(20 20 24 / .10)` / `0 26px 60px rgba(20 20 24 / .12), 0 8px 20px rgba(20 20 24 / .07)` | popovers + panels / modals |

`--shadow-brand` (`0 8px 22px rgba(236 88 40 / .26)`) exists solely under coral OTTO CTAs.

Hairlines: 1px `--border`, always. (The 1.5px input border is drift — see polish-delta.) Selection emphasis = 2px `--brand` border, canvas nodes only.

## 6. Motion (NEW, prescriptive)

Two easings, four durations. Tokens (to live in `.gb`):
`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` · `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`
`--dur-1: 120ms` · `--dur-2: 150ms` · `--dur-3: 200ms` · `--dur-sweep: 600ms`

| Interaction class | Duration | Easing | Animates |
|---|---|---|---|
| Micro feedback (hover tint, icon colour) | 120ms | ease-out | color / background |
| Focus ring | 120ms | ease-out | box-shadow |
| Control press | 150ms | ease-spring | transform scale(0.985) |
| Reveal (tooltip, dropdown, popover) | 160ms | ease-out | opacity + 4px rise |
| Card landing / dialog rise | 200ms | ease-spring | opacity + translateY(8px) + scale(0.98) |
| Otto dock expand/collapse | 200ms | ease-spring | transform + opacity |
| Coral sweep | ≤ 600ms, one-shot | ease-out | box-shadow + background tint |
| Progress shimmer | 1300ms loop | ease-in-out | position |

Rules: animate transform/opacity, never layout properties; nothing over 200ms except the sweep and shimmer; no delays on user-initiated actions.
**Reduced motion:** the existing `.gb` `prefers-reduced-motion` clamp stays; sweeps degrade to a static 2px coral outline held ~600ms then removed; shimmer degrades to the text "Working…"; dock states snap.

## 7. OTTO (unchanged + dock pointer)

- Mascot: flat coral cloud, **two eyes, NO mouth**. Never a boxed robot, never gradients. Reactions change only eyes, tilt and subtle glow (`OttoAvatar.tsx` is the reference implementation).
- 8 moods: `idle · thinking · helpful · success · warning · error · waiting · approving`. `thinking` = coral glow + 1.4s bob; state glows use the matching semantic colour at low alpha.
- Coral in the UI means "Otto did / is doing this" — the same law as §2.
- Otto is an **ever-present companion** (v2.6): every screen carries the persistent Otto dock — full spec in §8d.

## 8. Live reflection (NEW — constitution v2.6)

Principle: the UI must reflect background/Otto actions **in real time**. Otto acts through the action layer; every visible effect of an Otto action is marked with coral + a short narration. Four patterns, and only these four:

### a. Coral sweep highlight
What: a one-shot pulse marking the element Otto just created/changed.
Spec: `box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)` plus background tint `color-mix(in oklab, var(--brand-soft) 60%, transparent)`, both fading to transparent over **≤ 600ms, ease-out, runs once, never loops**.
Where allowed: canvas nodes, chat cards, library items, settings rows, list rows — i.e. the exact element acted on. Never full-screen, never on a primary CTA, never on an input the user is typing in.
Multiple targets: queue, stagger 120ms, max 3 visible at once — beyond that, sweep the container once.

### b. Card landing animation
What: how any Otto-authored card/result enters a surface.
Spec: `opacity 0→1`, `translateY(8px)→0`, `scale(0.98)→1` — **200ms `--ease-spring`**. If agent-initiated, follow with one coral sweep (a). Reduced motion: opacity only.
Layout shift: reserve space first (skeleton), then land the card into it — landing never pushes content the user is reading.

### c. Otto narration bar
What: the one-line "what Otto is doing right now" strip.
Anatomy: `OttoAvatar` at 20px with live mood + one line of text (`footnote` 13/500, `--muted-foreground`, sentence case, present tense: "Generating storyboard…") + a progress affordance (indeterminate 5px coral bar — the `.cv-gen-bar` recipe — or a `micro-mono` step counter "2/5").
Placement: pinned to the top of the surface Otto is acting on (canvas: floating top-centre pill; chat: above the composer; dock: the expanded header). **One narration bar per screen**; text updates in place, entries never stack. Disappears ≤ 400ms after the action settles (mood flips to `success` first).

### d. Persistent Otto dock
What: Otto's ever-present home on every screen.
Collapsed: 48px circle, bottom-right, 16px inset; contains `OttoAvatar` with live mood; a 8px coral dot badge (subtle 2s pulse) when Otto is acting in the background; tier-2 shadow.
Expanded: 320px wide, max 480px tall panel; radius `--radius-modal` 24px; tier-3 shadow; header = narration anatomy (c); body = recent Otto actions with timestamps (`caption` type), each row deep-links to the touched element (clicking re-fires its sweep); footer = "Open Otto" link to the full chat.
Transition: 200ms ease-spring, transform-origin bottom-right.
Rules: **never covers a primary CTA** — surfaces with a bottom-right CTA shift the dock up past it; z-index above content, below modals/toasts. Mobile: collapsed sits above the bottom bar (12px inset); expanded becomes a full-width bottom sheet (radius 24 top corners).

## 9. Anti-slop (unchanged + one addition)

No AI purple. No cream/clay cliché. Lucide icons only. Skeletons, not spinners. Sentence case. No em-dashes in UI copy. Flat surfaces — no glass on `.gb` screens.
**New: live reflection is not confetti.** Working surfaces stay calm: coral sweep ≤ 600ms and one-shot; one narration bar; no badges bouncing for attention; if everything glows coral, nothing is Otto.

## 10. Components

- Kit: the 14 shadcn new-york primitives in `apps/web/components/ui/*` with FIKIRTIVE variants. Button: `default`=INK · `brand`=coral (OTTO-initiated only) · `soft` · `secondary` · `ghost` · `outline` · `destructive` · `link`.
- New screens: render under `.gb`, build from the kit + token utilities (`bg-card`, `text-muted-foreground`, `border-border`, `rounded-[var(--radius-card)]`) — never raw hex, never legacy Vapor `al-*`/glass classes on light surfaces (full recipe: `docs/review/EXPANSION-SEAMS.md` Seam 7).
- Radix portals must carry `.gb` (it lives on `<body>` — keep it that way).
- Composer convention: multi-line composers submit on Shift+Enter, plain Enter = newline; single-line fields keep Enter = submit.

## 11. Doc hygiene (NEW)

How this system is organised — one truth per layer, no duplication:

| Layer | Lives at | Owns |
|---|---|---|
| **Direction + specs** (this doc) | claude.ai design project → `design-rules.md` (v2) | the rules above; the only place values are *explained* |
| **Implementation truth** | `apps/web/app/globals.css` — the `.gb` block only | every token value; light + dark; `@theme inline` registration |
| **Component recipes** | `apps/web/components/ui/*` | variants + sizes; comments cite this doc, don't restate it |
| **Guideline cards** | design project `cards/*.html` | one self-contained looping demo per pattern; first line `<!-- @dsCard group="…" -->` |
| **Build recipe + review** | `docs/review/EXPANSION-SEAMS.md` Seam 7 · `docs/review/REVIEWER-PLAYBOOK.md` | how new screens stay on-system; what reviewers check |
| **Mascot art** | `apps/web/components/otto-mark/*.svg` + `OttoAvatar.tsx` | Otto's face (mascot art colours are exempt from theming) |

Change protocol: propose in the design project → founder approves → one PR: tokens in `globals.css` first, component adoption second. If code and this doc disagree, the doc wins for *intent*, the founder wins for *everything*. Sections are numbered — link to `design-rules-v2.md §N`, never paste values into other docs.
