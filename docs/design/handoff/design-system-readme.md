# FIKIRTIVE Design System

> ⚠️ **历史导入件(TOMBSTONE 2026-07-14)。** 本目录是外部导入的设计交接包(2026-07-06 import),非现行规范。
> 现行设计唯一规范 = `docs/design-system/design-rules.md`(REVIEWER-PLAYBOOK 北极星增补节点名)。
> 本文「movie series」等表述为 pivot 前(Artlio AI 视频)残留,「friendly AI agent」措辞与现行 Otto 措辞纪律
> (对外锚定营销员工,永不自称通用 AI 助手)不符——**勿引用本文件做任何现行设计或文案依据**。保留仅供考古。

> The friendly face of AI marketing. Build campaigns (and movie series) with OTTO — even if you've never touched AI before.

FIKIRTIVE is a SaaS platform where **OTTO**, a friendly AI agent, does the heavy lifting of marketing. You describe what you want in plain words; OTTO plans the campaign, writes the copy, generates the assets, and ships it. The north-star promise: **"Even a 60-year-old who's never used AI can make a great campaign — or a great movie series — with FIKIRTIVE."** Every design decision serves that promise: warm, calm, oversized-and-legible, never intimidating, never "techy."

---

## Sources & provenance

No external codebase, Figma file, or brand kit was provided. This system is an **original brand identity** created for FIKIRTIVE from the product brief. If you have existing brand assets (real logo, brand fonts, product screenshots, a Figma library), share them and this system should be reconciled against them.

- **Fonts:** loaded from Google Fonts CDN (Hanken Grotesk for display + body, JetBrains Mono for code). These are the *chosen brand typefaces*, not stand-ins for an unknown brand font. Swap to self-hosted binaries if licensing requires.
- **Iconography:** Lucide (CDN) — see ICONOGRAPHY.
- **OTTO mascot & logos:** original marks in `assets/` (`otto.svg`, `logo-mark.svg`, `logo-wordmark.svg`). Production source of truth is `apps/web/components/otto/OttoAvatar.tsx`; see `docs/design/2026-07-06-otto-mascot-reactions.md` for the current no-mouth reaction spec.

---

## Brand pillars

1. **Reassuring, not clever.** We remove fear of AI. Plain language, gentle pacing, "I've got this for you."
2. **Warm & human, quietly premium.** Slate blue + bone + ink, with coral as OTTO's one warm pop. Rounded everything. Composed, never clinical or cold.
3. **OTTO is a friend.** A character with personality who guides, never lectures. Always on your side. OTTO reactions are no-mouth: personality comes from eyes, pose, and subtle motion only.
4. **Big and clear.** Generous type, high contrast, large tap targets — designed for everyone, including people who find most software hard.
5. **Creative payoff.** The output is exciting (campaigns, films!). Moments of delight and color reward the user.

---

## CONTENT FUNDAMENTALS

**Voice:** A warm, capable friend who happens to be brilliant at marketing. Encouraging, plain-spoken, never condescending despite the simplicity. OTTO speaks in first person ("I'll draft three options for you"); the product/brand speaks to the user as "you."

**Person & address:**
- OTTO → **first person** ("I"). "I've put together a starter campaign — want me to tweak the tone?"
- Brand/UI → **second person** ("you" / "your"). "Your campaign is ready to review."
- Avoid corporate "we/our" except on the marketing site's company voice (About, careers).

**Tone & casing:**
- **Sentence case everywhere** — buttons, headings, menus ("Create a campaign", not "Create A Campaign" or "CREATE A CAMPAIGN"). The only all-caps is the FIKIRTIVE wordmark and tiny eyebrow labels.
- Warm, short sentences. Active voice. Verbs that do work: *make, launch, draft, remix, ship.*
- Reassurance baked in: "No experience needed.", "I'll explain as we go.", "You can always undo this."

**Do / Don't copy:**
- ✅ "Tell me what you're promoting — I'll handle the rest."
- ✅ "Nice. Want me to make it sound more playful?"
- ✅ "Your launch email is ready. Take a look?"
- ❌ "Leverage AI-powered synergies to optimize your marketing funnel." (jargon)
- ❌ "ERROR: Generation failed." → instead "Hmm, that didn't work. Let me try again." (friendly recovery)
- ❌ Hype/AI-bro tone: "10x your output", "supercharge", "next-gen".

**Emoji:** Used **sparingly and warmly**, mostly from OTTO in chat, never in dense UI or formal marketing headlines. A single ✨ / 🎬 / 👋 as a friendly punctuation is on-brand; rows of emoji are not. Never use emoji as functional icons (that's Lucide's job).

**Numbers & buttons:** CTAs are short verbs ("Make my campaign", "Start free", "Show me an example"). Microcopy under CTAs removes risk ("Free to try · no card needed").

---

## VISUAL FOUNDATIONS

**Color vibe.** Cool, composed, and quietly premium. **Slate blue (#5B7B9A)** is the hero — primary actions, links, focus, key accents. **Ink (#1C1B18)** and a **warm-gray stone** neutral family carry most of the UI (premium = lots of neutral, little color). **Coral (#FF6B47)** is reserved exclusively for **OTTO** — the single warm pop that keeps the brand friendly. **Honey (#D6880F)** and **Teal (#14B8A6)** are sparing secondary accents. The page sits on a clean **bone (#F6F5F2)** paper, never a cold gray dashboard. Use one hero color per view; lean on neutral + ink, let slate and coral punctuate.f intelligence (OTTO's antenna, AI moments, links). Neutrals are **warm** (brown-tinted grays) on a **cream (#FFF8F2)** page so the product feels like paper and sunlight, never a cold dashboard. Status colors are warm-leaning. Use one hero color per view; don't rainbow.

**Typography.** A single refined grotesk — **Hanken Grotesk** — across display and body (the premium-SaaS approach, cf. Salesforce / HubSpot / Pencil). Headings are **700 weight**, tightly tracked (−0.025em), and sized with restraint rather than oversized. Body is the same family at 400/500 — clean and very legible. Mono is **JetBrains Mono** for code/IDs. The scale runs large for accessibility — body is 16–18px minimum, heroes are 58–92px. Headings use tight tracking (−0.02em); body is relaxed (1.65 line-height).

**Spacing & layout.** 4px base grid. Generous whitespace; sections breathe (64–96px between). Max content width ~1200px. Cards and panels favor air over density. Left-aligned text; centered only for hero moments and empty states.

**Backgrounds.** Mostly flat **bone** or white. No heavy photographic hero backdrops by default. Allowed depth: very soft **radial slate glows** behind heroes (and a coral glow only around OTTO), plus a subtle large-dot or grain texture at low opacity. **Gradients are restrained** — warm coral→honey only, on CTAs, OTTO, and the occasional hero accent. Never bluish-purple AI-cliché gradients. No glassmorphism as a default.

**Corner radii.** Friendly and generous: controls 14px, cards 28px, modals 36px, chips/pills fully round. Avatars and OTTO use squircle/pill shapes. Sharp corners are essentially never used.

**Cards.** White surface, 28px radius, soft **warm-tinted shadow** (`--shadow-md`), 1px subtle warm border optional. No colored left-border-only cards. Hover lifts the card 2px with a slightly larger shadow.

**Shadows.** Soft, warm-brown-tinted (not gray), diffuse. Layered (ambient + key). Primary CTAs get a **slate glow** (`--shadow-brand`); OTTO keeps a coral glow (`--shadow-accent`). Inner shadows only for inset inputs.

**Borders.** Hairline 1px, warm neutral, used sparingly — we lean on shadow + surface contrast rather than hard outlines. Inputs get a 1.5px border that turns slate on focus.

**Focus & states.**
- *Hover:* primary buttons darken one step (slate-500→600) and lift 1px; cards lift 2px; ghost/secondary get a soft tint background.
- *Press:* scale down to ~0.97 and settle (the springy ease). Color deepens one more step.
- *Focus:* 4px soft slate focus ring (`--ring-focus`), always visible for keyboard users.
- *Disabled:* 45% opacity, no shadow, no pointer.

**Motion.** Friendly and lightly **springy** — entrances and toggles use a gentle overshoot (`--ease-spring`, cubic-bezier(0.34,1.56,0.64,1)). Durations are quick (140–360ms); nothing sluggish. Fades + small rises (8–12px) for content entrances. OTTO has subtle idle life (blink, gentle bob). No infinite spinners where a calm progress bar will do. Respect `prefers-reduced-motion`.

**Transparency & blur.** Used lightly: sticky headers get a cream blur (`backdrop-filter`) when scrolled; modal scrims are warm-ink at ~45% with a small blur. Not a glass aesthetic — surfaces are mostly solid.

**Imagery.** When photography appears it's **warm, bright, human, optimistic** — real people making things, slightly golden. Generated campaign assets shown in the product can be any style, framed in rounded cards. Avoid cold/blue/corporate stock.

---

## ICONOGRAPHY

- **System:** [Lucide](https://lucide.dev) (CDN). Chosen because its rounded, even-weight, open stroke style matches FIKIRTIVE's friendly geometry. **This is a substitution flag:** no brand icon set was provided; Lucide is the recommended match. Swap if a real set exists.
- **Style rules:** stroke icons, ~2px stroke, rounded line caps/joins, 20–24px in UI, 32px+ for feature glyphs. Icon color inherits `currentColor` — usually `--text-muted` or `--text-body`, brand coral only when an icon *is* the accent.
- **OTTO** is the one illustrated character (not an icon) — used as avatar, empty-state hero, and loading presence. Don't redraw OTTO ad-hoc; use `OttoAvatar` and its no-mouth `mood` states. Legacy static assets may be used only when they match the same no-mouth rule.
- **Emoji** appears only as occasional warmth in OTTO's chat copy — never as functional UI icons.
- **Unicode glyphs** are not used as icons (use Lucide).

Load Lucide in a card/kit:
```html
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="sparkles"></i>
<script>lucide.createIcons();</script>
```

---

## INDEX / manifest

**Root**
- `styles.css` — global entry (import this). `@import`s everything below.
- `readme.md` — this file.
- `SKILL.md` — Agent-Skill front matter for use in Claude Code.

**`tokens/`** — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `radius.css`, `shadows.css`, `motion.css`

**`assets/`** — `otto.svg` (mascot), `logo-mark.svg`, `logo-wordmark.svg`

**`guidelines/`** — foundation specimen cards (Type, Colors, Spacing, Brand) shown in the Design System tab.

**`components/`** — 16 reusable React primitives. Each has `.jsx`, `.d.ts`, `.prompt.md`, and one `@dsCard` per group.
- `core/` — Button, IconButton, Badge, Avatar, **OttoAvatar** (the no-mouth animated agent mascot with `idle`, `thinking`, `helpful`, `success`, `warning`, `error`, `waiting`, `approving` moods), Card, Tabs
- `forms/` — Input, Textarea, Select, Checkbox, Switch
- `feedback/` — ProgressBar, Toast, Tooltip, Dialog

**`ui_kits/`** — full-screen interactive product recreations (each `{README.md, index.html, *.jsx}`):
- `marketing/` — landing page with a live OTTO demo (Marketing group card)
- `app/` — OTTO chat-based campaign builder: login → chat → assets → schedule (OTTO App group card)
- `dashboard/` — campaign analytics: KPIs, performance chart, OTTO insight, campaigns table (Dashboard group card)

**`templates/`** — copy-and-go starting folders for consuming projects:
- `pitch-deck/` — `PitchDeck.dc.html`, a branded 16:9 launch/pitch deck (6 slide types). Shows under "Templates" in the consumer picker.

**Starting points** (consumer "seed a new design" picker): Button, Card, OttoAvatar (Core), Input (Forms).

### Conventions for consumers
- Link `styles.css`; everything (tokens + fonts) flows from it.
- Mount components in `@dsCard`/kit HTML via `const { Button } = window.FIKIRTIVEDesignSystem_2bb27e` after loading `_ds_bundle.js`.
- Icons: Lucide via CDN (`<i data-lucide="…">` + `lucide.createIcons()`).
- OTTO: use the `OttoAvatar` component and its no-mouth `mood` states — never redraw. If exporting static assets, follow `docs/design/2026-07-06-otto-mascot-reactions.md`.

> Namespace for mounting components in card HTML: `window.FIKIRTIVEDesignSystem_2bb27e`.
