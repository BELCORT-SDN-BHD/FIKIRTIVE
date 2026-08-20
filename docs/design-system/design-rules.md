# FIKIRTIVE design rules — v3 (2026-07-07 design evidence)

> **Status(2026-07-16 sanitation):derived, task-linked design evidence.** This document is not
> project law, a live implementation report, or an independent approval source. Apply a rule only
> when the current GitHub task/current aligned plan makes it relevant; verify rendered facts in
> code. A conflict with current Founder direction or the authority chain is a stop-and-report event,
> not permission for this file to win.

Locked direction: **"Grok bones + Headspace/Phantom heart."** (LOCKED 2026-06-28 — colours must NOT change.)
v3 = the complete system: v2's core (direction, colour, type, spacing, depth, motion, live reflection —
carried verbatim below) plus ten domain chapters covering everything v2 left implicit: tokens, layout,
navigation, forms, data, feedback, voice, Otto presence, dark mode, accessibility. Nothing in the locked
palette moves. This is completion, not redesign.

---

## 0. How to use this document

**How to use the evidence layers.**

1. **Current authority comes first.** Use the current GitHub task, Founder provenance and aligned plan to establish scope and acceptance. This document explains the dated v3 design package; it does not approve work by itself.
2. **Rendered facts come from code.** `apps/web/app/globals.css` (the `.gb` block) and the components show what the product actually renders. A disagreement with this document is drift to report and adjudicate, not a reason to silently choose either side.
3. **External design artifacts are provenance, not a second control plane.** The claude.ai design project (`0abf8563`, historical label "FIKIRTIVE — Grok-bright") and `docs/design/handoff/` may be consulted read-only when a task explicitly needs them. Neither is automatically current or a mandatory write target.

**Agent workflow — which chapter for which task.** Always read §1–§2 (direction + colour) first; they gate everything. Then:

| You are building / touching | Read |
|---|---|
| A new screen | §T tokens · §L archetypes + width ladder · then the domain below |
| Tokens, theming, a new CSS variable | §T (three-place rule) · §2 · §K if it has a dark value |
| Page structure, panes, rails, z-index | §L (esp. L8 z-map) |
| Nav rail, tabs, headers, back behaviour | §N |
| Any input, form, select, toggle | §F · §A2 (focus) · §V (labels) |
| Tables, KPIs, charts, numbers | §D |
| Toasts, dialogs, banners, loading, progress | §FB |
| Any user-facing string | §V |
| Anything Otto or coral | §7 · §8 · §O (coral budget) |
| Dark mode | §K |
| Review / QA a diff | Checklists at §A7 · §O8 · §FB10 + the general checks that actually exist on the current head; there is no dedicated `check-design` gate |

**Change protocol:** start from an authorized GitHub task and its acceptance evidence. When a change affects both implementation and this explanation, keep them coherent in the same bounded PR. Founder approval is still required wherever current project law requires it; this file and the external design project grant no write or merge authority.

---

# Part I — Core (v2 snapshot)

## 1. Direction recorded in the v3 package

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

### 2 修正案 — 双声部(dual-voice;founder-approved 2026-07-10,入城实测中)

**这是 scoped 覆盖,不是全局改动。** §2 的表值一个字节都没动;下面这一层只在北极星沉浸壳的
根容器 `.gb.ns-immersive` 上重新赋值几个 token —— 靠 CSS 自定义属性的继承下传,壳内所有工具
类(`ring-ring`/`bg-info-soft`/…)自动拿到新值,壳外(live 产品、`/northstar` 画廊)完全不受
影响。实现:`apps/web/app/create/immersive-tokens.css`(由该路由组 layout 导入),
选择器 `.gb.ns-immersive`(0,2,0)压过 globals 的 `.gb`(0,1,0),不论加载顺序都稳赢。

**两个声部,一句话记住:coral = Otto 的声音(§2 coral law 不动),blue = 人手的声音**
(交互、焦点、"这是你能点/能动的")。信息蓝在壳内被撤销 —— 蓝只许有一个意思。

| 覆盖项 | ns 内新值 | 为什么 · §A1 比值(算出来的,非目测) |
|---|---|---|
| `--background`(画布) | `#F5F6F8` | 中性冷灰底(§5a 法四;冷 = B 通道最高)。白卡 `--card #FFF` 浮其上 = 面平钮凸的地基。别名 `--ns-canvas` 同值,嵌套 well 想显式引用画布灰时用它 |
| `--human`(蓝声部 base) | `#2563EB` | 人手声部主色。作文字压画布 **5.01:1 ✓AA-small**;作焦点键线/圆点/进度条 **5.17:1 ✓**。与 coral 不同,蓝 base **可以**当小字文字用 |
| `--human-soft` | `#DBEAFE` | 蓝软片填充底 |
| `--human-soft-foreground` | `#1D4ED8` | 软片底上文字 **5.49:1 ✓**;画布上蓝标签文字 **6.5:1 ✓** |
| `--ring`(焦点环) | `#2563EB` | 焦点/键盘 = 人手动作 → 蓝。覆盖一处,globals `.gb :focus-visible` 双层键线 + `ring-ring`/`outline-ring`/`border-ring` 全部转蓝。键线压白 **5.17:1 ✓**(coral 是 3.42) |
| `--info` | `= --muted-foreground` | 信息蓝撤销 → 中性灰。圆点/图标/≥19px,压白 **4.6:1 ✓**。不新造 hex(§T1) |
| `--info-soft` | `= --secondary` | 中性淡底(替原 `#E7EEFD` 蓝) |
| `--info-soft-foreground` | `= --muted-foreground` | 压 `--secondary` **4.65:1 ✓AA**(注:muted-fg 压 `--accent` 才是 4.34 ✗,压更亮的 secondary 过关) |

dark 值已镜像备好(`--human #3B82F6` / soft `#16243D` / soft-fg `#93C5FD` / `--ring #3B82F6` /
画布 `#0B0C0E`,info 同样中性化),原型层暂不开 dark,先备着保证入 dark 不塌。

**给 10 个 zone worker 的用法(直接抄,别手搓 hex)：**

*蓝声部 —— 三个 ready 类,挂在元素上即可:*
- `.ns-human-text` → 蓝文字(base,合法小字)。人手可动的链接/强调/标注。
- `.ns-human-fill` → 蓝实心 + 白字(5.17:1,白字 <19px 合法,coral 做不到)。人手**主动作**按钮的蓝身份。
- `.ns-human-soft` → 淡蓝底 + 深蓝字。chip / 选中态 / 人手区块的低调蓝。
- 想用原子 token 也行:`bg-[var(--human)]` `text-[var(--human-soft-foreground)]` `border-[var(--human)]`(消费阶梯②,§T4)。
- **焦点不用你管**:继续写你惯用的 `focus-visible:ring-ring` / `focus-visible:outline-ring` / `focus-visible:border-ring`,壳内自动是蓝。别再手写 coral/ring 的十六进制。

*信息提示 —— 撤蓝改中性:*
- 壳内**不要**再用蓝色做"提示/信息"底色或图标。中性通知直接 `bg-info-soft text-info-soft-foreground`(现在自动是灰),或用 `--muted-foreground` + `--secondary`。蓝只留给"可交互"。

*手感四法(§5a)—— 两个工具类:*
- `.ns-pressable` → 装在**任何可点控件**上:浮起(shadow-sm→hover shadow-md)+ 1px 顶部高光边 + 按下 `scale(0.97)`。这是"可点 = 凸,可读 = 平"的主信号(§5a 法一);reduced-motion 由全局 clamp 自动压瞬时(§A5),你不用再写媒体查询。**静态阅读卡片不要挂**(法一:可读 = 平)。
- `.ns-glass` → **只给悬浮 OVER 滚动内容的 chrome**(dock 面板 / 贴顶栏 / 抽屉):`backdrop-blur` + 半透;`prefers-reduced-transparency` 下自动退实色(§G8 强制)。**静态卡片 / 数据面禁用**(§5a 法三:玻璃只给悬浮件)。
- 法二(钮不穿底衣)、法四(地面不发暖)是纪律不是类:in-flow 工具条/chip 行直接坐在页面面上,别加着色底衣条;画布灰已是冷的,别再往里调暖米色。

*新增蓝对(pair)要过闸:* 若你要在壳内引入新的 `--human-*` 变体,先把压底比值算进本表(§A7 复核清单第一条),4.5 / 3:1 不到不许上。

## 3. Type — the scale

Geist for everything; JetBrains Mono only for `micro-mono`. Whole-pixel sizes only — the half-pixel Vapor sizes (14.5 / 13.5 / 12.5 / 11.5) are legacy and quantise on touch.

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
- One control-only exception outside the scale: default/lg input value text is **16/24** — iOS refuses to zoom-on-focus at ≥16px (§F3). It is not a reading size; never use 16px for prose.

## 4. Spacing — 8pt grid

Base unit **4px**; layout rhythm **8px**. Allowed steps: `4 8 12 16 20 24 32 40 48 64`. 2px only for icon-to-dot gaps. Anything ending in 3/7/9/11 px is legacy drift — quantise on touch.

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

Radii (unchanged): `--radius` 14px controls · `--radius-card` 18px · `--radius-modal` 24px · 10px for nested elements inside a 14px control · 8px for micro controls ≤24px · 999px pills. Nothing else (9/16/20px sightings are drift).

**3-tier shadow spec.** An element sits in exactly one tier; never stack tiers; never darken a shadow to signal state (use border/ring instead). Exact values (tokenised in `.gb`):

| Tier | Token(s) | Value | Use |
|---|---|---|---|
| 1 — rest | `--shadow-xs` / `--shadow-sm` | `0 1px 2px rgba(20 20 24 / .05)` / `0 1px 3px rgba(20 20 24 / .06), 0 1px 2px rgba(20 20 24 / .05)` | controls, cards at rest |
| 2 — raised | `--shadow-md` | `0 6px 16px rgba(20 20 24 / .08), 0 2px 6px rgba(20 20 24 / .05)` | hover lift, toolbars, dropdowns |
| 3 — overlay | `--shadow-lg` / `--shadow-xl` | `0 14px 34px rgba(20 20 24 / .10)` / `0 26px 60px rgba(20 20 24 / .12), 0 8px 20px rgba(20 20 24 / .07)` | popovers + panels / modals |

`--shadow-brand` (`0 8px 22px rgba(236 88 40 / .26)`) exists solely under coral OTTO CTAs.
Hairlines: 1px `--border`, always (the 1.5px input border is drift). Selection emphasis = 2px `--brand` border, canvas nodes only. Dark-mode shadow values: §K1.

### 5a. Tactility & ground — founder rulings 2026-07-09(手感四法)

1. **Flat surfaces, raised controls(面平钮凸).** Reading surfaces (cards, data panels) stay flat — §5/§D6 unchanged. Anything pressable must *look* pressable: soft small shadow + 1px top highlight edge + the §6 press class (`:active` scale). Clickable = raised; readable = flat — this is the primary "what can I click" signal.
2. **No plate behind buttons(钮不穿底衣).** In-flow toolbars / chip rows sit directly on the page surface — tinted container strips behind them are banned. The raised control IS the affordance.
3. **Glass only floats(玻璃只给悬浮件).** `backdrop-filter` material is legal only on chrome that floats OVER scrolling content (dock panel, sticky bars, drawers) — never on static cards; `prefers-reduced-transparency` fallback per §G8.
4. **The ground is never warm(地面永远不发暖).** Canvas and section grounds are neutral-cool greys (existing token family #FCFCFC/#F4F4F3; #F7F7F8 family for deeper separation). Cream/beige/manila tints are banned everywhere. Warmth comes only from content imagery, Otto's coral, and small-area semantic colour. (Full palette proposal「双声部」— blue as the human interactive voice — founder-approved 2026-07-10 and scoped-implemented on `.gb.ns-immersive`, see §2 修正案; these four laws stand regardless.)

## 6. Motion

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
| Gen-bar slide (`.cv-gen-bar`) | 1300ms loop | ease-in-out | position |

Rules: animate transform/opacity, never layout properties; nothing over 200ms except the sweep and the gen-bar loop; no delays on user-initiated actions. Reduced-motion fallbacks per animation class: §A5.

## 7. OTTO (mascot)

- Mascot: flat coral cloud, **two eyes, NO mouth**. Never a boxed robot, never gradients. Reactions change only eyes, tilt and subtle glow (`OttoAvatar.tsx` is the reference implementation; mood art locked by `docs/design/2026-07-06-otto-mascot-reactions.md`).
- 8 moods: `idle · thinking · helpful · success · warning · error · waiting · approving`. `thinking` = coral glow + 1.4s bob; state glows use the matching semantic colour at low alpha.
- Coral in the UI means "Otto did / is doing this" — the same law as §2.
- Otto is an **ever-present companion** (constitution v2.6): every screen carries the persistent Otto dock — spec in §8d, buildable detail in §O6. Where Otto may appear, in what mood, and how much coral a screen carries: §O.

## 8. Live reflection (constitution v2.6)

Principle: the UI must reflect background/Otto actions **in real time**. Otto acts through the action layer; every visible effect of an Otto action is marked with coral + a short narration. Four patterns, and only these four:

### a. Coral sweep highlight
One-shot pulse marking the element Otto just created/changed. `box-shadow: 0 0 0 2px color-mix(in oklab, var(--brand) 55%, transparent)` plus background tint `color-mix(in oklab, var(--brand-soft) 60%, transparent)`, both fading to transparent over **≤ 600ms, ease-out, runs once, never loops**.
Where allowed: canvas nodes, chat cards, library items, settings rows, list rows — the exact element acted on. Never full-screen, never on a primary CTA, never on an input the user is typing in.
Multiple targets: queue, stagger 120ms, max 3 visible at once — beyond that, sweep the container once.

### b. Card landing animation
How any Otto-authored card/result enters a surface: `opacity 0→1`, `translateY(8px)→0`, `scale(0.98)→1` — **200ms `--ease-spring`**. If agent-initiated, follow with one coral sweep (a). Reduced motion: opacity only.
Layout shift: reserve space first (skeleton), then land the card into it — landing never pushes content the user is reading.

### c. Otto narration bar
The one-line "what Otto is doing right now" strip. Anatomy: `OttoAvatar` at 20px with live mood + one line of text (`footnote` 13/500, `--muted-foreground`, sentence case, present tense: "Generating storyboard…") + a progress affordance (indeterminate 5px coral bar — the `.cv-gen-bar` recipe — or a `micro-mono` step counter "2/5").
Placement: pinned to the top of the surface Otto is acting on (canvas: floating top-centre pill; chat: above the composer; dock: the expanded header). **One narration bar per screen**; text updates in place, entries never stack. Disappears ≤ 400ms after the action settles (mood flips to `success` first). Copy register: §V6. Screen-reader contract: §A6.

### d. Persistent Otto dock
Otto's ever-present home on every screen. Collapsed: 48px circle, bottom-right, 16px inset; `OttoAvatar` with live mood; an 8px coral dot badge (subtle 2s pulse) when Otto is acting in the background; tier-2 shadow. Expanded: 320px wide, max 480px tall panel; radius `--radius-modal` 24px; tier-3 shadow; header = narration anatomy (c); body = recent Otto actions with timestamps, each row deep-links to the touched element (clicking re-fires its sweep); footer = "Open Otto" link to the full chat. Transition: 200ms ease-spring, transform-origin bottom-right.
Rules: **never covers a primary CTA** — surfaces with a bottom-right CTA shift the dock up past it; z = `--z-dock` (§L8), above content, below modals/toasts. Mobile: collapsed sits above the bottom bar (12px inset); expanded becomes a full-width bottom sheet (radius 24 top corners). Full buildable spec: §O6.

### 8e. First-run live escort(首次直播,founder-approved 2026-07-09)

When the user gives Otto a **fresh, foreground, actionable instruction** (dock or full-page) whose work lands on another surface (schedule, campaign, canvas): navigate **once** to that surface and let the work land live there (§8c narration + §8b staggered landings). Rules: fresh foreground instructions only — background/routine/re-run work never navigates (dock badge only, §O5); if the user navigates away, never pull them back (work continues; badge pulses); if they return before completion, the live state resumes (structural — the store is the single source). Reduced motion: the navigation still happens; landings follow §A5 fallbacks. This does not violate "永不抢占主场": at the moment of a fresh instruction, this task IS the user's主场.

## 9. Anti-slop

No AI purple. No cream/clay cliché. Lucide icons only. Skeletons, not spinners. Sentence case. No em-dashes in UI copy. Flat surfaces — no glass on `.gb` screens (one sanctioned blur: modal scrims, §FB5).
**Live reflection is not confetti.** Working surfaces stay calm: coral sweep ≤ 600ms and one-shot; one narration bar; no badges bouncing for attention; if everything glows coral, nothing is Otto.
Data anti-slop (§D6): no pie/donut, no 3D, no rainbow palettes, no zero-as-missing, no fake precision, no drama-cropped axes.

## 10. Components

- Kit: the 14 shadcn new-york primitives in `apps/web/components/ui/*` with FIKIRTIVE variants. Button: `default`=INK · `brand`=coral (OTTO-initiated only) · `soft` · `secondary` · `ghost` · `outline` · `destructive` · `link`.
- New screens: render under `.gb`, build from the kit + token utilities (`bg-card`, `text-muted-foreground`, `border-border`, `rounded-[var(--radius-card)]`) — never raw hex, never legacy Vapor `al-*`/glass classes on light surfaces (full recipe: `docs/review/EXPANSION-SEAMS.md` Seam 7).
- Radix portals must carry `.gb` (it lives on `<body>` — keep it that way).
- Composer convention: multi-line composers submit on Shift+Enter, plain Enter = newline; single-line fields keep Enter = submit.

## 11. Doc hygiene

Keep evidence roles explicit; do not promote a derived artifact into a competing authority:

| Layer | Lives at | Owns |
|---|---|---|
| **Current scope + acceptance** | Current GitHub task + Founder provenance + aligned Route-B plan | what may change and how it is accepted |
| **Design explanation** (this doc) | `docs/design-system/design-rules.md` | dated v3 rationale and task-linked constraints |
| **Implementation evidence** | `apps/web/app/globals.css` — the `.gb` block + components | values and behavior currently present in code |
| **Component recipes** | `apps/web/components/ui/*` | variants + sizes; comments cite this doc, don't restate it |
| **Guideline cards** | `docs/design-system/cards/` | historical/task-linked demos; they do not prove live implementation |
| **Build recipe + review** | `docs/review/EXPANSION-SEAMS.md` Seam 7 · `docs/review/REVIEWER-PLAYBOOK.md` | how new screens stay on-system; what reviewers check |
| **Machine checks** | Current workflow/package scripts that actually exist | general gates only; there is no dedicated `check-design` gate, so design conformance still requires review |
| **Mascot art** | `apps/web/components/otto-mark/*.svg` + `OttoAvatar.tsx` | Otto's face (mascot art colours are exempt from theming) |

If code and this document disagree, record the drift and resolve it through the current task/authority chain. Do not silently make either artifact win, and do not mutate an external design project without explicit scope.

---

# Part II — Domains (v3)

## T. Token architecture

**T1. Three tiers.** Primitive (raw hex/px/ms — deliberately no CSS vars of their own; inlined as semantic values; only primitive vars are the next/font families `--font-geist/--font-meta/--font-body`) → Semantic (role names in the `.gb` block — the single file of truth) → Component (cva variants + token utilities + `.gb`-scoped recipe classes). Each tier references only the tier above. Components never define colour — they arrange semantic tokens.
**No primitive ramp, on purpose**: no `--gray-100…900`, no `--coral-500`. Derive computed variants in place with `color-mix(in oklab, var(--token) N%, transparent)` — never mint a new hex.

**T2. The `.gb` vocabulary** (names LOCKED — shadcn's contract; aliases are documentation only): Surface `--background --card --popover --secondary --muted --accent` (**`--accent` = the NEUTRAL hover tint, never coral**) · Ink `--foreground` + `-foreground` partners (always use the matching partner, never cross pairs) · Action `--primary` (= ink-CTA, NOT brand) · OTTO `--brand(-soft)(-foreground) --ring --shadow-brand` · State `--success/warning/error/info` + soft pairs; `--destructive` = same value as `--error` by design (shadcn button name vs state name — values must never diverge) · Hairline `--border --input` (same value by design; `--input` exists so form borders can fork later) · Shape `--radius(-card|-modal)` · Depth `--shadow-xs…xl` · Type `--font-sans → var(--font-geist)`, `--font-mono → var(--font-meta)` (scope-dependent repointers — never read outside `.gb`) · Motion `--dur-1/2/3/sweep --ease-out/spring` (to land, §6).

**T3. Naming grammar** — one pattern, no exceptions:
```
--{role} · --{role}-foreground · --{role}-soft · --{role}-soft-foreground
--shadow-{xs|sm|md|lg|xl|brand} · --radius[-{card|modal}]
--dur-{1|2|3|sweep} · --ease-{out|spring} · --z-{layer}   (§L8)
```
Roles, not values (`--coral`, `--gray-200` forbidden). No component names in semantic tokens (`--button-bg` forbidden; a component-local knob prefixes its own name inside its own class). Reserved prefixes: `--color-*` = Tailwind `@theme` plumbing only; `--font-*` = next/font only. Pairs ship together: a surface token without its `-foreground` fails review.

**T4. Consumption ladder** — highest rung that works: ① token utility (`bg-card`, `text-muted-foreground`) — 100% of `components/ui/*`, `button.tsx` is the exemplar; ② arbitrary value bound to a var (`rounded-[var(--radius-card)]`, `shadow-[var(--shadow-brand)]`); ③ `var(--token)` in a `.gb`-scoped recipe class — only for pseudo-elements, keyframes, third-party DOM.
Forbidden in this dated design package (review-enforced; no dedicated design grep gate currently exists): raw hex/rgb/oklch in `.tsx` or new CSS (mascot art exempt) · Vapor tokens (`--fg-*`, `--bg-*`, `--glass-*`, `--line-*`) on `.gb` surfaces · reading `--color-*` directly · cross-pair mixing (`bg-card` + `text-secondary-foreground`).

**T5. The three-place rule.** A new token is not done until it exists in all three: ① `.gb` light value ② `.gb.dark` real dark value ③ `@theme inline` registration `--color-{name}: var(--{name})` — skipping ③ makes the utility **silently no-op** (Tailwind v4 generates nothing). Live drift today: `text-success`/`bg-success`/`bg-error` are consumed but `--color-success/error/info` are unregistered — backfill. Non-colour tokens skip ③ and are consumed as `var(--…)`.

**T6. Legacy tiers — frozen, not deleted** (strangler rule; read-only, migrate on touch): Vapor `:root` (serves the un-migrated dark Studio; name collisions resolved by scope — under `.gb` the `.gb` value wins) · fk tokens in `otto-theme.css` (being dismantled; map: `docs/ui-rework/fk-to-gb-token-map.md`) · `docs/design/handoff/` ramps (pre-pivot slate/Hanken export — historical, never import; `grep -rn "design/handoff" apps/web` → must be empty).

## L. Layout & grid

**L1. Shell constants.** Viewport shells use `dvh`, never `vh`. One scroll owner per pane; the body never scrolls a workbench; nothing scrolls horizontally at page level — wide content scrolls inside its own `overflow-x: auto` box. Every shrinkable flex pane carries `min-width: 0` / `min-height: 0` (the #1 blown-layout cause — check first in review). Page gutter 24 desktop / 16 at ≤680.

**L2. Page archetypes — five, plus the front door.** If a new screen doesn't fit one, that's a design conversation, not a new layout.

| Archetype | Scroll model | Frame | Reference |
|---|---|---|---|
| **Workbench** | viewport-locked, panes scroll | rail 240 + chat pane `clamp(360px, 38%, 520px)` + canvas `flex:1`; chat column 680; pane headers 52px; collapsed pane leaves a 34px reopen button | `/otto` — OttoApp/OttoView |
| **List** | pane scrolls, header pinned | pinned header (p 16, hairline, search max 360) + column 680–880 or grid to 1280; grids: `minmax(220px,1fr)` gap 12 (media) or `minmax(240px,1fr)` gap 16 (cards); rows py 12 px 16, hairlines only, never card shadows | library, schedule, analytics |
| **Detail** | pane scrolls | one column: 760 prose/config · 1280 data consoles; stack gap 20 | asset/tenant detail |
| **Settings** | body scrolls | sticky jump-nav 216 (links 8×12, radius 10, active `--secondary`+600, danger `--error`) + column 760, p 32/40, sections gap 32, `scroll-margin-top: 24px`; ≤680 nav → chip row | `.cv-settings` |
| **Auth** | fits viewport | split hero `flex 1.15 : 1` (hero hidden <1024), form column 360; coral glows on the hero half only, never behind the form | `/login` |
| *Front door* | fits pane | centered column 560, gap 24, `display` type + one composer; no cards until there is content | OttoFrontDoor |

**L3. Content width ladder** — seven stops; every scrolling page picks ONE and centers it:
`360` auth/search · `480` Otto chat cards · `560` front door, rich results, dialogs-L · `680` reading column (chat; bubbles cap 75% user / 80% agent) · `760` settings/config · `880` mixed pages, wide composers · `1280` grids + data consoles (page cap). Off-ladder widths are drift (720→760, 920→880, 1180→1280). Never mint a stop for one screen — wrong width means wrong archetype.

**L4. Rails** — four canonical widths, all `flex: none`, hairline-separated, no shadow while docked: primary nav **240** (collapses to 0 at 200ms) · icon rail **64** (hover-expands to 240 as a fixed overlay, never reflows) · secondary jump-nav **216** (sticky, in-page anchors) · mobile drawer **280** (fixed, 200ms, backdrop `rgba(0,0,0,.35)`). Nav items: h 36–40, p 8×12, radius 10, `body`/500; active `--secondary` fill; hover `--accent`; **no coral in nav**. Section labels: `micro-mono`, `--muted-foreground`. The Otto dock panel (320) is a floating layer, not a rail.

**L5. 8pt vertical rhythm** (§4 steps only). Bars: 52 pane headers · 56 page topbars. Page top pad → title 24 (workbench pane 16) · title → subtitle 4 · header → first content 24 · related blocks 16 · sections 32 · section heading → first card 12 · rows py 12 · page bottom pad 40. One rhythm per column — don't mix 20 and 24 as sibling gaps. Empty states center in the *pane*, not the page.

**L6. Breakpoints — desktop-first, five lines, no others:** `1280` ladder caps engage · `1024` auth hero hides; icon-rail ⇄ burger · `768` admin sidebar ⇄ mobile topbar · `680` **the product mobile line** (`MOBILE_BP`): rail → 280 drawer + 52px topbar; workbench goes chat-dominant, canvas collapses to a 26px peek edge — never two live panes; gutters 24→16 · `480` single-column everything. Inside `.gb` components use Tailwind `md:`/`lg:` or `MOBILE_BP`. `globals.css` is layered (`@layer base` / `@layer components`, #798), so responsive utilities now win against the design-system recipes and are the default there too — the old "unlayered CSS beats utilities, hand-write a plain `@media` instead" workaround is retired, and the fence in `lib/__tests__/globals-css-layers.test.ts` keeps the unlayered rule from coming back. A plain `@media` inside the layer is still fine when the rule belongs to the stylesheet rather than to one element. ≤680 must be *usable* (44px targets, nothing unreachable), not pixel-perfect; a phone-native app is a separate future seam — don't grow the web breakpoints to emulate it.

**L7. Density.** One density per surface; default comfortable (rows py 12, cards p 24, gap 16). Compact exists in exactly two sanctioned places: the library grid toggle (card min 220→120, user-controlled) and admin data tables (rows py 8 past ~20 rows). Density changes padding and grid minimums only — never type size, control heights below 36, or touch targets below 44. No global density preference.

**L8. Z-index & elevation map** — ten layers, tokens to live in `.gb` next to the shadows. An element takes exactly one layer; its shadow tier (§5) is bound to it — a higher layer never wears a lighter shadow than a lower one it overlaps:

| Token | z | Shadow tier | Contents |
|---|---|---|---|
| `--z-base` | 0 | 1 | page content |
| `--z-raised` | 10 | 2 | floating in-pane controls: canvas toolbar, collapse handles, reopen buttons |
| `--z-sticky` | 30 | `--shadow-sm` once scrolled | sticky headers, mobile topbars |
| `--z-nav` | 40 | 2 only while overlaying | rails, icon-rail hover expand |
| `--z-dropdown` | 50 | 3 (`--shadow-lg`) | menus, popovers, selects |
| `--z-tooltip` | 60 | 3 | tooltips, flyouts |
| `--z-dock` | 70 | 2 collapsed / 3 expanded | persistent Otto dock |
| `--z-drawer` | 80 | 3 | mobile nav drawer (backdrop 79) |
| `--z-modal` | 100 | `--shadow-xl` | dialog scrim + panel |
| `--z-toast` | 120 | 3 | sonner toasts — nothing ever covers a toast |

No raw z-index outside these ten. Scrims: max one visible; modal scrim `rgba(10,10,12,0.45)` + 3px blur (the one sanctioned blur); drawer backdrop `rgba(0,0,0,.35)`, no blur. Ad-hoc `fixed inset-0 z-50` modals are drift — use the Dialog primitive. Banners are not on the ladder — they live in flow above the app (§FB4). Known hazard this map fixes: the drawer (today z 200) covering dialogs (today z 50).

## N. Navigation

**N1. Model.** One persistent left rail + one content area + overlays. Max two levels of place: a rail destination, then a detail *overlay* — never a third page level. Rail view changes are history-backed (`pushState` + popstate; Back walks views). Tabs use `router.replace` (`?tab=`, no history entry). Overlays carry no URL — Escape/backdrop closes, Back is never needed to escape one. Admin is conventional routes with `aria-current="page"`.

**N2. Rail spec** (240 desktop; collapsed = width 0, never a mini rail; ≤680 = 280 drawer). Six zones, order fixed: ① Brand (26px OttoCloud + wordmark 17/700; collapse toggle 28×28) ② Primary action — one INK Button sm, full width, "New"; `--shadow-xs` or none, **never a coral-tinted shadow under a human CTA** ③ History (scrollable; campaigns + nested conversations; max 6×2 visible, active items forced visible) ④ Workspace tools — order follows the **Create → Assets → Operate** taxonomy (Blueprint 资产区): Create = Canvas, Library, Templates, Discover · Assets = My Stuff, Brand memory · Operate = Schedule, Analytics, Connections, Account; folded into one disclosure at ≤8 items, three labelled groups at 9+ ⑤ Balance (pinned, hairline above) ⑥ Identity (avatar 32, name 13/500, email 12).
Rows: campaign 14/600, conversation 13/400 (nested 12/400), tools 13/400; radius 10; icons 18px stroke 2 — one size everywhere. Group labels: `micro-mono`. Row actions (pin/new/⋯): hidden at rest, revealed on hover/`:focus-within`/pinned, 150ms; **always visible on touch**. Micro icon controls 22×22 radius 8. Row menu: min-w 164, radius 10, `--popover` + `--shadow-lg`.
**Coral inventory in the rail — exactly three:** the brand mark, the 6px Otto-activity dot, the 14px credit coin (credits are Otto's fuel). Anything else coral in the rail is a violation; thread status dots use semantic tokens.

**N3. Active / hover / focus — one state system for every nav surface:** rest = transparent + `--muted-foreground`/400 · hover = `--accent` fill + `--foreground` (120ms, background+color only) · active = `--secondary` fill + `--foreground` + 600 — **fill + weight is the entire signal: no coral, no left bar, no icon swap** · focus-visible = the global coral ring (§A2) · disabled = muted at 55% mix, no hover · danger = `--error` text, `--error-soft` hover fill. Active must use a *different* token than hover so a hovered row never reads as current. Exactly one active row per zone, `aria-current="page"`. Weight change must not reflow (full-width rows + `truncate`).

**N4. Tabs vs segmented — the one-sentence rule:** *tabs switch what content you're looking at; a segmented control switches how you look at the same content.* Deserves a URL → tabs; refresh should reset it → segmented.
- **Tabs** (reference: Brand memory): `--muted` well, radius 14, p 4, gap 4; item radius 10, px 16 py 8, 13px; active = `--card` + 600 + `--shadow-sm`. Count suffix 11px plain text, never a pill. Otto marker: 6px `--brand` dot, auto-clears ≤4s. Persist as `?tab=` via `replace`; 2–6 tabs, ≥7 means split the page. The shadcn underline variant is admin-only.
- **Segmented** (reference: Schedule Plan/Calendar/Queue; built from the same `<Tabs>` in `@/components/ui/tabs`, sized down via `className` on `TabsList`/`TabsTrigger` — the old `.al-seg` CSS recipe retired with `components/ds.tsx` in #840): `--card` + 1px `--border`, radius 10, p 2; item h 30, radius 8, px 12, 12/600; active `--secondary`. 2–5 single-word items; never URL-routed. Binary view toggles use this recipe, not two ghost buttons.
- **Workset tabs** (canvas only): closable user-created pills h 28, radius 14, max-w 180 + truncate; active = `--card` + hairline; 6px `--brand` working dot. Only for dynamic open-document sets.

**N5. Breadcrumbs: none on product surfaces.** Depth is capped at two levels; detail views are overlays ("back" = close, scroll preserved). Admin detail gets a single back link (`ArrowLeft` 16 + parent name, ghost) to the parent **list URL** — never `history.back()`. A screen that seems to need a 3-segment trail has the wrong IA.

**N6. Page header anatomy** — one wrapping flex row: ① Title (`h1`, `title` type; exactly one per screen) ② optional meta pills (h 28, radius 999, `--card` + hairline, 12/600) ③ `flex-1` spacer ④ right actions (h 30–34, radius 10; **max 2 visible + one overflow**). Container: the L3 column, gutter 24 (16 mobile), 24 top pad, 16 below header. **The header always renders** — empty/error/disconnected walls live in the body below it, so header controls stay reachable. Full-bleed tool surfaces may swap the h1 for a single toolbar row (h 56–64, hairline, search first at 360). No third header style; no second toolbar row.

**N7. Back behaviour.** Rail changes = history entries; tab/segment changes = replace; overlays never trap Back. Back never loses work: drafts survive view swaps; destructive closes always ask (Otto dialogs, never native prompts). Mobile: system back closes the drawer before navigating.

**N8. Keyboard map.** Tab order = rail DOM order (brand → collapse → New → history rows + revealed actions → tools → balance → identity). Enter/Space activate. **Escape peels exactly one layer per press** (menu → draft → panel → drawer → dialog). ←/→ roving focus in tablists and segmented controls (Radix gives it free; hand-rolled `role="tablist"` MUST implement it). Composers: §10 Enter convention. Double-click renames rail rows. **⌘K is reserved** for a future command menu — nothing else may bind it. Every interactive element is a real `<button>`/`<a>` — no clickable divs; no `tabindex` > 0.

## F. Forms & inputs

**F1. Field anatomy** — one fixed vertical stack: Label → 8px → Control → 8px → Help *or* Error (one line slot; error replaces help, never stacks). Label 13/18 600 `--foreground`, `<label htmlFor>` always; optional marker = ` (optional)` appended, 400 `--muted-foreground`; one right-slot link max ("Forgot?"). Help 12/16 500 `--muted-foreground` — format hints and consequences only. Error line 13/18 500 `--error-soft-foreground`, `role="alert"`, optional leading `CircleAlert` 14px. Field→field gap 20 (16 in dialogs). Form column max 480; fields full-width within it. Placeholders = example values ("you@yourbrand.com"), never label substitutes. Two related short fields may share a row (12px gap, labels per-field); never three.

**F2. Input states** (Input, Textarea, Select trigger, combobox alike). Base: bg `--card`, 1px `--input`, radius 14, `--shadow-xs`. One state at a time; transitions 120ms ease-out on border/box-shadow/color only:

| State | Border (1px always) | Ring | Note |
|---|---|---|---|
| Rest / Filled | `--input` | none | filled = identical to rest; the value is the signal |
| Hover | `color-mix(in oklab, var(--foreground) 15%, var(--input))` | none | background never tints — typing surfaces stay calm |
| Focus | `--ring` | 3px halo at 40% (§A2 field variant) | border stays 1px — depth from the ring, never thickness |
| Disabled | `--input` | none | control `opacity: 0.4`, label stays full-opacity |
| Error | `--destructive` | none at rest; focus = red-family halo, same geometry | set via `aria-invalid`, never a bare class |
| Loading (value) | — | — | skeleton at tier height, never a disabled input |
| Loading (async check) | as current | as current | "Checking…" in the help slot; no spinner in the field |

Locks: **ring alpha 40% everywhere** · **disabled opacity 0.4 everywhere** (supersede the /30–/50 and 0.5 scatter in the kit). Autofill: repaint WebKit yellow with `inset 0 0 0 1000px var(--card)` + `-webkit-text-fill-color: var(--foreground)`.

**F3. Sizing tiers** (flush with the button tiers 36/44/48): `sm` 36 × px 12, text 14/20, radius 10 — dense desktop only, never touch · `default` 44 × px 14, **text 16/24** (iOS anti-zoom — load-bearing), radius 14 · `lg` 48 × px 16, text 16/24, radius 14 — hero moments only. Textarea: min-h 64, p 12×14, radius 14, grows with content (`field-sizing: content`). Chat composers are their own component, not this textarea (§F9).

**F4. Validation — "reward early, punish late":** ① first judgment on blur, only if dirty ② once shown, re-validate on every change (errors clear the moment they're fixed) ③ never validate on first keystroke — hard constraints filter silently ④ on submit: validate all, show all, focus the first invalid and scroll it to center; no error-summary list ⑤ async checks debounce 500ms, "Checking…" in the help slot ⑥ server errors map to fields; unmappable → one form-level alert chip (bg `--error-soft`, text `--error-soft-foreground`, 13/18 500, p 12×16, radius 14, `role="alert"`) ⑦ **submit is never disabled for invalid input** — let the click run validation; disable only in-flight, label flips to present progressive ("Signing in…"), no spinner.

**F5. Required convention.** Fields are required by default; mark the exceptions with ` (optional)`. Never asterisks, never a legend, never bold-red labels. Keep native `required` for assistive tech. More optional than required fields = the form is asking too much.

**F6. Select & combobox.** Trigger = an input (F2 states, F3 tiers; supersedes stock `h-9`/`rounded-md`); `ChevronDown` 16 `--muted-foreground`. Panel: `--popover`, 1px `--border`, radius 14, `--shadow-lg`, p 4; reveal 160ms rise, exit 120ms; item min-h 36, p 8, radius 10, 14/20; hover/keyboard-active = `--accent` (never coral); selected = right-aligned `Check` 16 (new-york); group label 12/16 500; panel scrolls, page never does. Combobox (build on first need): real text input trigger; fetching = two skeleton rows, never a spinner; empty = "No results"; Enter picks the highlighted item while open.

**F7. Checkbox, radio, switch.** All three: coral focus ring (§A2), disabled 0.4, **checked fill = INK (`--primary`), never coral** — a user's toggle is a human action. Checkbox 16×16 radius 4, `Check` 14 (indeterminate `Minus`); fill 120ms, icon instant. Radio 16×16 circle, 8px dot, scale 0.6→1 150ms spring (add shadcn RadioGroup restyled on first need). Switch: track 36×20 radius 999, thumb 16 with 2px inset (sm 28×16/12); ON track `--primary`; thumb 150ms spring. Row anatomy: control + label, 12px gap, label 14/20; second line 12/16 muted under the *label*; row min-h 44 on touch, whole row clickable; control top-aligns to the first label line when it wraps. **A switch acts immediately** (no Save after it); destructive/paid flips confirm *before*, never after. Radio groups: 2–5 options vertical; 6+ becomes a select.

**F8. Adornments** — one leading + one trailing max. Leading icon: Lucide 16 `--muted-foreground`, 14 from edge, input pl 40; flips to `--foreground` on focus. Trailing action: one 36×36 icon button radius 10, inset 4, input pr 44 (pattern: password reveal). Inline validity: trailing `Check` `--success` for async-confirmed values only — never decorate ordinary valid fields. Character counter only past 80% of the limit (`micro-mono`, right of the help row; at limit → `--error`). Codes (API keys, OTP): `--font-mono` 14, +0.02em. Prefix/suffix text: 14/20 muted + 1px divider hairline.

**F9. Keyboard & submission.** Single-line: Enter = submit. Composers (anything you talk to Otto through): **Shift+Enter = send, Enter = newline**; open mention popup → Enter picks (repo law: `apps/web/AGENTS.md`). Plain form textareas are NOT composers — Enter is a newline. Esc in a dirty dialog form confirms discard first. Trailing icon button is tabbable after its field. Labels never float, slide, or shrink on focus (anti-slop).

**F10. Otto & forms (coral law applied).** The coral focus ring is the only coral a human action may produce in a form. Otto prefilled/changed a field → one sweep on the wrapper (never on a field being typed in). Otto filling a form live: fields go `readOnly` (not disabled — full contrast), one narration bar names the action, values land whole — no per-character typing theatre. A submit that spends money keeps the INK button; coral appears only on results Otto produces afterwards.

## D. Data display

**Gold standard: the Analytics screen** (`docs/design-refs/analytics-ui-kit.html`, founder-locked, built pixel-for-pixel in `OttoAnalytics.tsx`).

**D1. The seven properties every data surface keeps:** ① answers first — exactly 4 stat cards, one sentence of insight, then detail ② one chart, one question — title is the question, subtitle is the basis; a chart needing a paragraph is a table ③ provenance on everything ("via Meta · read-only" stamp) ④ honest gaps — "—" for no data, explicit truncation notes, never fake-empty ⑤ states live in the body, never full-page — header + switcher always render; each table owns its own loading/empty/error ⑥ refresh keeps old data at `opacity: 0.6`, new lands in place — never a blank flash ⑦ coral is Otto's voice even in data — peak dots + insight banner only.

**D2. Number formatting** (helpers in `lib/analytics-view.ts` — never hand-rolled): ≥10,000 → `48.2K`; 1,000–9,999 → `3,140`; <1,000 raw. Missing = `—` (never 0 for "no data" — 0 means a measured zero). Money: 2 decimals, **no hardcoded currency symbol** (prefix arrives as data). Deltas: `▲ 18%` / `▼ 9%`, dead band ±1% → flat, always with muted basis suffix ("vs prev. period"). Multipliers `3.2×`. Stacked numerals: `tabular-nums` mandatory (Geist stays). Ids/keys/timestamps: JetBrains Mono 12 `--muted-foreground`. Precision: only what the source reports.

**D3. Stat cards.** Card: `--card`, 1px `--border`, radius 14, p 15 (pinned kit exception; new kits: 16), **no shadow**. Grid 2→4 columns, gap 12; exactly 4 on a primary screen. Label 12/500 `--data-label`. Value 26/700/−0.02em `tabular-nums`, mt 4. Delta 12/600, mt 5: up = `--success-soft-foreground` · down = `--error-soft-foreground` · flat = `--data-label` — delta colours are the only semantic colours allowed (delta IS state). Empty period: every value `—` + ONE line under the grid ("No activity in this period yet."). Never a sparkline, button, or second number in a stat card. Clickable cards: standard `--accent` hover only.

**D4. Tables.** No `<table>` primitive — deliberate. Two forms, pick by density, never mix per panel: **A** hairline list rows (default — 1px top hairlines, full-bleed in an 18px-padded panel) · **B** bordered grid rows (admin/dense — each row a bordered card, radius 10, p 12, CSS-grid columns). Rows: text py 12; media py 14 + 56×56 thumb radius 10. Metric labels: 11/500 uppercase +0.03em `--data-label` (or `micro-mono` for id-like heads — one style per table). Primary cell 14/600 `truncate` — never wrap the name column. Numerics right-aligned `tabular-nums` 14/600; missing = `—`. Hover `--accent` on interactive rows only. Selected: A = `--secondary` fill; B = border flips to `--foreground` — **never coral** (coral selection is canvas nodes only). Otto-touched row: one sweep, the only coral a row may show. Badges: soft-pair pill, max one per row. Truncation is honest: "Showing your 20 biggest spenders of 63."
Per-table states (each table owns all four): loading = 3 skeleton rows at final height, shimmer, never a spinner · refreshing = rows at `opacity 0.6`, swap in place · empty = one sentence naming the period/filter · error = inline 13px `--error` + ghost Retry, panel chrome stays.

**D5. Charts.** New tokens (three-place rule §T5; verified absent today):

| Token | Light | Dark | Role |
|---|---|---|---|
| `--chart-ink` | `#0A0A0A` | `#FAFAFA` | primary series |
| `--chart-compare` | `#A6A6A0` | `#5E5E66` | second series ONLY (prev. period / benchmark) |
| `--chart-grid` | `#F4F4F2` | `#1C1C1F` | inner gridlines |
| `--chart-axis` | `#EFEFED` | `#262629` | baseline + axis |
| `--chart-peak` | `var(--brand)` | `var(--brand)` | emphasis dots — Otto-surfaced moments only |
| `--data-label` | `#86867F` | `#8E8E96` | data-label grey (KPI labels, subtitles, stamps) |

Palette law: **data is ink; emphasis is coral; state is semantic.** No decorative hues; semantic colours enter only as state (threshold line `--warning`, error-rate series `--error`). A coral series line is a coral-law violation.
Geometry: line 2.2px `--chart-ink`, no data-point dots (dots are peaks: top-3 values, r=4, coral — they exist because Otto talks about them). Area fill: single-series only, ink @10% → transparent; the compare series never gets a fill. Gridlines horizontal only, max 3. Axis labels 11 `micro-mono` `--data-label`, ≤6 x-labels; label-free is allowed when the subtitle states the range. Empty series = flat baseline + KPI `—`s — never hide the panel. Panel chrome: title 14/600 + basis subtitle 12 `--data-label` + optional stamp pill; new panels radius 18 (Phase-A analytics pinned at 16 until the founder refreshes the kit). Tooltip (when interactive): `--popover`, radius 10, `--shadow-md`, snaps to the nearest point, one per chart; a 1px `--chart-axis` cursor is the only vertical line a chart may draw.
When charts are allowed: total → stat card · trend → line, 1 series · vs last period → line, 2 series (the hard max) · ranking → table, never bars · part-of-whole → table with %, **never pie/donut** · 3+ series → table. Bars OK for discrete periods: ink @85%, radius 4 top, gap ≥30% of width.

**D6. Data anti-slop.** No pie/donut, 3D, drop-shadowed lines, rainbow palettes. No spinners in panels. No zero-as-missing, no fake precision, no drama-cropped axes (baseline 0 unless the subtitle says otherwise). Legends ≤ series count (≤2). If a dashboard glows, it's lying — data surfaces are the calmest screens in the product.

## FB. Feedback & overlays

**FB1. The interruption ladder** — always pick the lowest level that does the job. Otto's live reflection (§8) is *ambient*, never a level, never blocks input:

| Lv | Pattern | Allowed when | Max |
|---|---|---|---|
| 0 | Inline hint/status | state lives next to its element | unlimited, zero motion |
| 1 | Toast | the result is NOT visible on screen | ≤1 per action · 3 stacked |
| 2 | Banner | a *persistent* account/session condition | 1 per app frame, ever |
| 3 | Dialog | direct response to a click needing a decision | user-initiated only — never on load |
| 4 | Blocking modal | irreversible/destructive/money; forced legal gates | rarest; must offer an explicit decision |

Hard rules: **never native `alert()`/`confirm()`/`prompt()`** — always the Otto dialogs (`OttoPromptDialog.tsx`; purged in PR #177). **The result is the feedback**: visible result → no success toast; the sweep or the state change is enough. **Validation never toasts** (level 0, adjacent to the field). Error copy at any level = what happened + what now, one sentence each (§V3).

**FB2. Inline (0).** Field hint 12/16 500 muted; field error per §F1 in reserved space — never pushes the button row. Card/chat errors: `--error-soft` fill + `--error-soft-foreground` text, radius 14 — pick fill + text, never fill AND border AND icon. Motion: 120ms fade max.

**FB3. Toast (1).** One sonner Toaster, mounted once in `app/layout.tsx` — never a second. Surface: 356w, `--popover`, 1px `--border`, radius 14, `--shadow-lg`; icon 16 Lucide semantic (`CircleCheck`/`Info`/`TriangleAlert`/`OctagonX`); text `body` 14 + optional `footnote` line — max 2 lines; one action max ("Undo" is canonical). Bottom-right, 16 inset; max 3 visible; **`offset` 80px on screens with the dock** so toasts clear it. Durations: success/info 4000 (default) · error 6000 (explicit) · with action 8000 · **`toast.loading` banned** (background work belongs to skeletons/narration). ≤1 per action — batch counts ("3 references added"); same message = update by stable `id`; zero toasts on page load. **Toasts are never coral** — Otto completions announce via narration + sweep; off-screen results may get a *neutral* toast that deep-links back.

**FB4. Banner (2)** (reference: `ImpersonationBanner`). Full-width, in flow at the very top — compresses the app, never floats. No shadow/radius/motion. `role="alert"`, p 8×16, one action max (inverted chip). Severity fill: `--error` (blocking, white text) · `--warning-soft` pair (degraded) · `--info-soft` pair (notice). One banner per frame — higher severity wins, never stack. Never auto-dismisses: it clears when the *condition* clears; "×" only on genuinely ignorable info.

**FB5. Dialog (3)** (base: `ui/dialog.tsx`; portals inherit `.gb` from `<body>`). Surface: `--popover`, radius 24, p 24, 1px `--border`, `--shadow-xl`; scrim `rgba(10,10,12,0.45)` + 3px blur (the one sanctioned blur). Three sizes only: **S** `min(440px, 100vw−32px)` confirms/rename · **M** 560 multi-field forms · **L** 720 tables/pickers. Content > 80vh scrolls inside the body; header/footer never scroll away. Anatomy: title `heading` 18/24/600 + description 14 muted; Otto-voiced dialogs lead with the avatar chip (48px `--brand-soft` rounded-16 square holding a 34px `OttoAvatar`); close 32×32 top-right; body gap 16; footer right-aligned, gap 12.
Button order (fixed): `[optional ghost far-left] … Cancel (secondary) → Primary (rightmost)`. Exactly one primary — `default` ink normally, `destructive` for danger, `brand` ONLY if confirming launches Otto work. Cancel is always `variant="secondary"`, always literally "Cancel". Primary label = the verb ("Delete campaign"), never "OK"/"Yes". Pending: both disabled, label → present progressive. Dialog content is a `<form>` — Enter submits; Esc/overlay close, both blocked while pending. **Never stack dialogs.** Motion: 200ms spring in, 150ms out.

**FB6. Blocking modal (4) & the destructive confirm.** Blocking = a dialog with escapes removed (no ×, Esc/overlay disabled) — the user must pick a button. Three destructive tiers by blast radius: **1** reversible → no confirm; do it + Undo toast (8000ms) · **2** irreversible, scoped → `OttoConfirmDialog tone="danger"`: warning-mood Otto chip + impacts list + red primary · **3** irreversible, broad or money → tier 2 + type-to-confirm (the *thing's name*, never "DELETE"). The impacts list ("What happens": 1–4 plain-sentence bullets in a `--secondary`/70 panel) is mandatory at tiers 2–3 — no bare "Are you sure?". Otto witnesses danger; coral never colours the danger itself. **Money rule (宪法 2): any confirm that triggers real spend states the amount verbatim in the impacts list before the button enables.**

**FB7. Skeletons — never spinners.** Anything > 300ms gets a skeleton in reserved space. Zero `animate-spin`/`Loader2`/`toast.loading` call sites on `.gb` surfaces (lint). Shimmer recipe: `linear-gradient(90deg, var(--border) 25%, var(--card) 50%, var(--border) 75%)`, 200% size, 1.4s loop. Shape mirrors the real content (same box, same radius) — a wrong-shaped skeleton is worse than none. Max 3 shimmering blocks per viewport; the rest sit static at `--muted`. Skeletons resolve to content or an inline error — never to a spinner, never to blank; past ~10s add "Still working — this is taking longer than usual." Space is reserved *first* (§8b). Reduced motion: the `.gb` clamp freezes shimmer; the static gradient still reads as placeholder.

**FB8. Progress — one question: do we know the fraction done?**
- **Determinate**: `ui/progress.tsx` — 8px track, ink indicator (coral ONLY when Otto owns the work), always paired with a `micro-mono` counter ("3/5" / "60%") — a bar without a number is decoration.
- **Indeterminate**: the `.cv-gen-bar` recipe — 5px track, 40%-width coral chip sliding at 1.3s. Coral because indeterminate background work is Otto's; humans waiting get skeletons. In-node composition: coral label + bar + honest money line ("billed only when it finishes").
- **Narration handoff** (nearest-first): looking at the element → in-element gen state only · on the surface, off-view/multi-step → narration bar (avatar + line + bar *or* counter) · on another surface → dock badge; on completion a neutral deep-link toast. Text swaps in place (150ms crossfade); shimmer bar → counter the moment steps are countable; on settle mood flips `success` first, bar leaves ≤400ms later. One narration bar per screen — a second job queues into the same line.

## V. Voice & microcopy

One tension governs every string: **professional enough to trust with money, warm enough to never scare.** North-star reader: a non-technical boss who has never used AI. The read-aloud test: if it would sound odd said to a 60-year-old shop owner, rewrite it.

**V1. Two speakers.** **Otto** (chat, asks, celebrations): first person "I", a capable colleague, contractions, one ask per message. **Product** (buttons, settings, errors, empty states): second person / imperative, calm infrastructure, no personality — never "I", never "we" (corporate "we" is marketing-site only). The product refers to Otto in third person; Otto never does. The name is **"Otto"** in all running copy — all-caps "OTTO" is the wordmark only. Attribution is doubled: coral marks what Otto did AND the copy says so — never colour alone.

**V2. Mechanics.** Sentence case everywhere (all-caps only in `micro-mono` + wordmark). **Em-dashes banned** — period + new sentence. Middle dot `·` joins label + data ("Generate · 20 credits"), never two sentences. Ellipsis `…` (single char) means exactly "work in progress" ("Saving…"). No exclamation marks in product copy (Otto: max one, success only, never money/errors). Question marks only for real decisions (confirm titles, Otto asks). Use contractions. Digits, not words ("3 posts"); aligned numbers use `tabular-nums`. Length caps: button ≤20 chars before `· cost` · toast/inline error ≤110 · narration step 2–4 words ≤32 · dialog title ≤48 · empty state ≤120. No "please"/"kindly"/"Oops"/"Whoops"; "Sorry" at most once per screen, only for a total failure the product caused.

**V3. Errors — three slots, slot 2 optional:** `[What happened]. [What it means for your money/data — only when at stake]. [What to do now].` Slot 1: "Couldn't + verb" preferred ("Couldn't reach Otto."); no "Error:" prefix, codes, or stack language. Slot 2 mandatory when money/data is involved ("You weren't charged.") — **never claim a refund you haven't verified**; unverified: "This didn't finish. Check your Library in a minute." Slot 3 always present, imperative ("Try again." and/or a button). Never blame the user (no "invalid", "wrong") — state the requirement: "Enter a non-zero whole number of credits." Never joke in an error.

**V4. Empty states — two kinds:** true empty = 2 sentences, fact + invitation naming the exact next action ("No posts yet. Add one or ask Otto to plan your week.") · filtered/search empty = 1 sentence, fact only ("Nothing matches this filter."). The invitation names a button or Otto — never "get started". Front-door empties use `display` type and may carry the mascot; inline list empties use `footnote`, no mascot. ≤120 chars, no apology, no cuteness.

**V5. Money copy — the law: credits always, never dollars** (founder decision 2026-06-26; the $ conversion is never surfaced). Always through `formatCredits(n)` / `creditsLabel(n)`. The spend arc, one phrasing per stage: ① estimate "~20 credits now" / "About 20 credits" ② quote pending: button disabled and says so, **"Checking cost…"** — a control with no quote behind it is off, and it is off at the *action*, not only in the markup, so a keyboard shortcut cannot walk past it ③ commit **"Generate · 20 credits"** — one press, exact price on it; that press IS the approval and the button IS the receipt, never "~" ④ in flight "Generating…" ⑤ done "✓ You approved this. It used 20 credits." ⑥ failed+refunded "You weren't charged. Try again."
**One press, not two** (founder decision 2026-08-13, #896): the old arc revealed the cost, asked "Generate this video for 20 credits?", then took a second press on a screen that only re-read the number back. A price the merchant can read on the button they are about to press is the informed consent; a second screen restating it bought nothing and cost every merchant a click. The remaining confirms are the ones that are not purchases: **deletes and other irreversible acts still ask.**
**A button that spends carries its exact cost** in or immediately adjacent to the label — no exceptions (the copy face of the money-safety-review gate). Out of credits: state + door ("You're out of credits." + `Top up`), never a dead end. Irreversible spend states the full consequence in plain words before the button. Balance is "Your balance" — never "wallet"/"funds".

**V6. Otto narration.** Chat Otto: first person, one idea per message, explains cost before asking approval; emoji max one, chat only. Narration bar/trace: present-participle phrase, 2–4 words, no "I", no period; live work ends "…" ("Generating storyboard…"), trace steps don't. Single source of truth: `TOOL_STEP_LABELS` in `lib/otto-stream-bridge.ts` — every new tool gets a label there or stays silent; **raw tool names never surface**. Labels name the user's things ("Reading your ad performance"), never our machinery. Reduced-motion fallback text is exactly "Working…".

**V7. Button labels.** Verb first, imperative, 1–3 words. Add the noun when ambiguous or destructive ("Delete campaign"). Destructive confirm titles are questions stating scope; the button repeats verb + noun — never "Yes"/"No"/"OK", never bare "Confirm" on a destructive action. Cancel is always exactly "Cancel". Every async button has a pending form ("Saving…"). Spend buttons carry `· N credits`. No pronouns, no punctuation except `· cost` and pending "…". Icon-only buttons: `aria-label`, same words as the tooltip.

**V8. Words.** Use: make, add, save, remove, top up · credits, balance · campaign, post, visual, storyboard · "Couldn't [verb]" · "Not enough credits" · "Sign-in failed". Avoid: purchase, funds/wallet/$, asset (user-facing), "Failed to"/"Error", "Insufficient", "Unauthorized". ("Create campaign" and "Generate" are established vocabulary and stay.) Banned outright (grep-able): leverage, seamless, supercharge, 10x, next-gen, AI-powered, utilize, robust, empower, unlock, journey, oops, whoops, kindly, please. Banned tech leaks: API, token, payload, prompt (outside maker surfaces), model names in narration, HTTP codes, null/undefined.

**V9. 中文界面未来注记.** UI copy today is English; write it to survive translation: no idioms/wordplay; whole templates with placeholders, never grammar-assuming concatenation; units through helpers so measure words localize in one place. "credits"/"campaign"/"storyboard" 的中文选词是 founder decision — 翻译时不得机选. Chinese uses full-width punctuation; the em-dash ban, `…`, `·`, exclamation ban and all V5 money rules carry over; numerals stay Arabic + tabular. "Otto" stays Latin. zh length caps set when the zh UI is actually built. 宪法 9 不变: specs 华语, generation prompts English.

## O. Otto presence

**O1. Four bodies — nothing else exists** (no watermarks, no Otto-in-a-button, no decoration): **Chrome** (the fixed pair every screen carries: the 26px nav cloud — always `idle`, never animates — and the dock) · **Inline** (Otto attached to specific content: chat-turn avatars, proposal headers, insight banners, empty-state heroes) · **Narration** (the one-line strip, one per screen, §8c) · **Working marks** (non-avatar signals: gen bar, sweep, dock badge — only while work runs).
Size ladder: `16 · 22 · 26 · 32 · 40 · 48 · 64`, plus 34 only inside the 48px dialog chip. **Eyes need ≥ 16px** — below that, the eyeless cloud glyph. **One animated Otto per viewport** — the one nearest the live work; all others hold a static mood; off-surface work animates the dock avatar.

**O2. Moods are status, not theatre** — mood mirrors the *actual* state: `idle` default (nav cloud permanently) · `thinking` only while a request is genuinely in flight — never "to look alive" · `helpful` presenting something read · `success` holds ≤4s then `idle` — never a permanent badge · `warning` destructive/spend confirms only · `error` persists until acknowledged · `waiting` blocked on the user · `approving` executing a confirmed action. Approval moods (`waiting`/`approving`/`warning`) live in chat cards and dialogs only — an ambient surface is never "waiting".

**O3. Presence map** (inline Otto exists only where Otto has something specific to say about specific content): **Otto home** — hero 64, per-turn 22–32, all 8 moods, **dock hidden** (Otto's whole body is this screen) · **Canvas** — working marks only (in-node gen state, 2px coral selected border, top-center eyeless ink pill), no avatar moods · **Schedule** — proposal/notice/empty cards at 22–26; moods `idle·waiting·approving·success` · **Analytics** — insight banner 32 + connect empty 40; `idle·helpful` only (read-only: never `thinking`, never approval moods) · **Brand memory** — research affordance + 6px "updated" dots; `idle·helpful·thinking·success` · **Account/connections/billing** — **none, dock only**: money and identity decisions must read as the user's, unaccompanied · **Campaign zone (future)** — proposal/build chat cards are the one statement; approval-heavy by design · **Shelves** (stuff/library/templates/discover) — none; Otto-added items announce via sweep, not an avatar.

**O4. The coral budget** — classify every coral element on screen: **Chrome** = nav cloud + dock, exactly 2, nothing else may claim this class · **Live activity** = gen bars, narration, sweeps, `thinking` glow, dock badge — uncapped in count but time-gated: exists only while work runs, clears ≤400ms after settle · **Statement** = one visually bounded *static* coral region (coral-soft surface, `brand` button, or cloud ≥22px outside chrome; a uniform repeated set counts as one) — **max 1** · **Marks** = coral ≤16px (mini clouds, dots; a set counts as one) — max 3 sets. Exempt: the focus ring and the canvas selected border (user-controlled, one each).
**The screenshot test (the lint):** screenshot any screen while Otto is NOT working — coral in at most **6 places** (2 chrome + 1 statement + 3 mark sets). A 7th means one stops being Otto: demote it (neutral surface + 16px mark) or delete it. Statement precedence: proposal awaiting approval > actionable insight > informational notice — losers demote. **At most one `brand` button per viewport, and only when pressing it starts Otto work** — two coral buttons at once means one is lying.

**O5. Narration placement** — one per screen, nearest the work: looking at the element → in-element mark only · this surface, off-view/multi-step → zone narration (canvas: ink pill radius 999 with 16px eyeless glyph; chat: `StatusLine` above the thread tail) · another surface → dock badge, text waits in the dock header. The badge lights **only for off-surface work** — two simultaneous "Otto is working" signals for one job is over budget.

**O6. The dock — buildable spec** (§8d is the base; zero dock code exists yet — build to this).
*Collapsed:* 48×48 radius 999, `--card` + 1px `--border` + `--shadow-md`, inset 16/16, `--z-dock`; 26px `OttoAvatar`, live mood — the one permanently animated Otto. Badge: 8px `--brand` dot at (−2,−2) with 2px `--background` ring; hidden (idle) / pulsing while off-surface work runs (halo scale 1→1.8, 2000ms; reduced motion: steady) / steady when finished work is unseen — expanding marks seen. Hover `--accent`; press scale 0.96; focus = the coral ring. Never covers a primary CTA — the dock moves, the CTA never does. Hidden on Otto home; sits beneath modal scrims by z-order (never `display:none` for a dialog).
*Expanded:* 320w × max 480h, radius 24, `--popover` + `--shadow-xl`; origin bottom-right, in 200ms spring / out 150ms; reduced motion snaps. Header 56px = narration anatomy (24px avatar + 13/18 500 line + 64px gen bar or `micro-mono` counter; idle: "Otto", no bar). Body: last ≤20 actions, newest first; rows py 10 px 12 radius 10 — text `footnote` truncated + `caption` timestamp; click deep-links and re-fires the sweep; **rows are neutral, zero coral** (the sweep at the destination is the coral); empty: "All caught up." Footer: 44px "Open Otto" row. Esc/outside-click collapses; expanding never pauses work; one dock per app, ever.
*A11y:* trigger `<button aria-expanded>` named "Otto — {narration | 'idle'}"; panel `role="dialog" aria-label="Otto activity"`; badge changes announce via a visually-hidden `role="status"` line.
*Mobile:* collapsed 48 stays, inset 12 + safe-area, above any bottom bar. Expanded = full-width bottom sheet (top radii 24, max-h 60vh, 36×4 grabber, scrim, drag-down closes; rows py 12). The budget does not scale down — a phone screen usually shows chrome only.

### O7. Otto assist affordance(「Otto 帮我」,founder-approved 2026-07-09 — 零学习曲线检查① 的物理形态)

Every "thinking-required" surface (forms, dialogs, composers, builders, editors, error states) carries **one** small Otto-assist button (ghost style, Otto glyph ≤16px — counts as one coral mark set in the §O budget). Tap →
1. the dock opens with **context auto-attached**: zone + entity id + current form/selection state — Otto never asks "which one / where are you";
2. **2-3 scenario intent chips** (one-tap, surface-specific) sit above the composer — a zero-typing path always exists;
3. free typing remains available.
Otto's answer carries **Apply** where applicable: output lands back into the origin surface (fields filled, draft inserted) with an §8a sweep on the touched fields; sends/spends still require the user's tap (money law unchanged). The exchange enters the single stream with context chips (D2), so it is findable later from campaign/zone filtered views.

## K. Dark mode

**Status: the `.gb.dark` block exists and is ~90% sound, but it is dead code** — nothing sets `class="dark"`; `next-themes` is installed but no provider is mounted. Dark = the same system at inverted luminance; geometry and type never theme.

**K1. Token audit.** Every defined dark pair passes AA (worst text pair 5.5:1 beats light's worst 3.11:1); most pass AAA. Key facts: dark `--accent` = dark `--secondary` (`#1C1C1F`) — deliberate merge, keep equal. Dark `--brand-foreground` and `--destructive-foreground` are **ink `#0B0B0C`, not white** (white on the lightened fills fails at ~2.9–3.2:1). **Six tokens are missing from `.gb.dark` and inherit broken light values — all must land:**

| Token | Dark value (spec) |
|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0 0 0 / 0.40)` |
| `--shadow-sm` | `0 1px 3px rgba(0 0 0 / 0.45), 0 1px 2px rgba(0 0 0 / 0.35)` |
| `--shadow-md` | `0 6px 16px rgba(0 0 0 / 0.50), 0 2px 6px rgba(0 0 0 / 0.40)` |
| `--shadow-lg` | `0 14px 34px rgba(0 0 0 / 0.55)` |
| `--shadow-xl` | `0 26px 60px rgba(0 0 0 / 0.60), 0 8px 20px rgba(0 0 0 / 0.45)` |
| `--shadow-brand` | `0 8px 22px rgba(242 106 60 / 0.20)` |

**K2. Dark rules.** ① Elevation = lightness, not shadow — the four-step surface ladder `#0B0B0C → #131315 → #18181B → #1C1C1F`; adjacent layers differ by exactly one step; never invent a fifth grey. ② Shadows become borders — dark shadows ground, they can't define edges; every raised dark surface carries 1px `--border`. ③ Coral stays coral — `#EC5828 → #F26A3C`, one lightness step, same hue; never rust, never neon; text ON coral flips to ink; mascot art exempt from theming. ④ Semantic keeps the role, shifts luminance — a badge written with soft-pair tokens is automatically correct in both modes, zero `dark:` classes. ⑤ New solid-fill tokens must re-check their `-foreground` in dark — never assume white survives. ⑥ No pure black/white — ground `#0B0B0C`, ink `#FAFAFA`; `#000` only as media letterbox. ⑦ `color-scheme: light` on `.gb`, `dark` on `.gb.dark` (flips native scrollbars/pickers — absent today). ⑧ Hover on inverted primary goes *down* (`hover:bg-primary/90` is already correct both modes) — never a hardcoded hover hex. ⑨ Bright media on dark cards gets the card's 1px border holding the edge — no glow, no white matte.

**K3. Activation contract — five wires, one PR:** ① mount `next-themes` `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` so `.dark` lands on `<body>` next to `.gb` ② add `@custom-variant dark (&:where(.dark, .dark *));` to `globals.css` — without it Tailwind's `dark:` fires on the OS media query and disagrees with class-based theming forever (this already bites: OS-dark users get grey washes on selects/textareas in light mode) ③ `color-scheme` per K2.7 ④ `themeColor` metadata `#FCFCFC`/`#0B0B0C` ⑤ the six dark shadow tokens (K1). New-token law: every token lands in `.gb`, `.gb.dark`, AND `@theme inline` — a PR touching one block is incomplete.
The dated v3 review observed `.gb`-scoped dark-mode risks such as hardcoded hovers, white node buttons, raw shadows and Tailwind defaults bypassing `--shadow-*`. Re-query current code before opening a task; this paragraph is not a fix-on-touch queue.

**K4. Enforcement (eye + grep).** Raw hex inside `.gb`-scoped rules → only the two token blocks may hit. Every `box-shadow` in `.gb` scope reads `var(--shadow-…)`; kit shadow utilities use the arbitrary form `shadow-[var(--shadow-…)]` (Tailwind's named `shadow-xs/sm/md` compile to its own black defaults and bypass the tokens — `card.tsx`/`dialog.tsx` already do it right). No new `dark:` utilities until `@custom-variant dark` exists. Eye tests: turn shadows off in devtools — a dark layout must still read perfectly (borders + surface steps carry it); screenshot light and dark side by side — coral must read as the same brand colour, merely re-lit.

## A. Accessibility & motion

The floor under everything else. Thresholds: AA text 4.5:1 · AA large 3:1 (≥24px/400 or ≥18.66px/700) · non-text UI 3:1. All ratios computed, never eyeballed; a pair not in the A1 table is not approved — compute and add it before shipping.

**A1. Contrast laws** (light mode; dark passes everywhere — every light exception disappears in dark):
1. **Accent-hover law.** `--muted-foreground` never sits on `--accent` (4.34 ✗) — every accent hover swaps text to `--foreground` (the code already does; keep it).
2. **Coral-fill text law.** White on coral = 3.50 — AA-large only. The `brand` button (14/600) is a founder-accepted exception, already capped by the coral law. Everywhere else, coral-ground text <19px uses the `--brand-soft` pair (5.74 ✓).
3. **Coral-text law.** `--brand` as *text* is illegal below 19px (3.18–3.50). Coral labels move to `--brand-soft-foreground`; coral stays on avatars, dots, bars (non-text ≥3:1 ✓).
4. **Semantic-text law.** Semantic *base* colours are for dots, icons, and ≥19px text only; badge/row text uses the `-soft-foreground` shades.
5. **Destructive fill** (3.91) mirrors law 2: accepted on buttons; danger *text* on light surfaces uses `--error-soft-foreground` (5.40 ✓).
6. **Hairline law.** `--border` (1.22) is decorative — no control relies on a hairline as its only boundary; state never rides on border colour alone.
7. **Gen-bar track:** `--border` track → `--background` + 1px hairline, so the coral chip clears 3:1.
8. **Proposed token fix** (founder approves): light `--warning-soft-foreground` `#B45309` (4.45, fails by 0.05) → `#92400E` (6.28 ✓).

**A2. Focus — the coral ring, exactly.** The 40% halo alone composites to 1.64:1 (invisible to low vision), so the ring is **two layers**:
```css
.gb :focus-visible {
  outline: 2px solid transparent;   /* keeps the system indicator in forced-colors */
  outline-offset: 2px;
  box-shadow:
    0 0 0 1px var(--ring),                                        /* keyline — 3.42:1 */
    0 0 0 4px color-mix(in oklab, var(--ring) 40%, transparent);  /* halo — the warmth */
}
```
`:focus-visible` only — mouse clicks never ring; styling bare `:focus` is banned. Bordered fields: the border itself is the keyline (`border-color: var(--ring)`) + the 3px 40% halo — never a thicker border. Rich-text composers ring the *frame* via `:focus-within`. Ring fades in 120ms, disappears instantly; follows the control's own radius. `outline-none` is legal only on a line that also declares the ring. Focusables in scroll containers get `scroll-margin-block: 8px`. All kit alpha scatter (/30, /35, /50) unifies to 40% + keyline on touch.

**A3. Keyboard per component class** (rail order and Esc-layering: §N8): buttons = native `<button>`, press scale runs on keyboard too · composers = Shift+Enter sends (§F9) · mention popup = ↑/↓ + Enter/Tab select, Esc closes only the popup · dialogs = Radix trap, Enter submits, focus returns to trigger; tier-3 confirms autofocus the input; destructive dialogs give initial focus to **Cancel** · menus/selects = Radix defaults, never rebuilt by hand · tabs/segmented = ←/→ roving focus (hand-rolled tablists MUST implement it) · switch/checkbox = Space · canvas nodes = Tab reachable; selection reveals node actions without hover; **Delete key deliberately dead** (money-safe — delete only via ✕ → confirm) · dock = Enter/Space expands → focus to header, Esc collapses and restores, non-modal (no trap). Global: Tab order = DOM = visual; `tabindex` > 0 never; no clickable `<div>`s.

**A4. Target sizes.** Pointer 36×36 · touch 44×44 · absolute minimum 24×24 (WCAG 2.2, no spacing exception used) · adjacent targets ≥8px gap or merge · prose links exempt. Hit-area recipe for small visuals: `::after { position: absolute; inset: -(44 − visual)/2 }`. Sub-24 controls (switches) must sit in a ≥44px row with a clickable `<label>` spanning it.

**A5. Reduced motion — fallback per class.** Two clamps enforce the baseline (global `0.01ms` + the `.gb` clamp that also kills loops) — never weaken, never re-enable inside them. **JS-driven motion must gate itself** on `matchMedia("(prefers-reduced-motion: reduce)")`. Fallbacks: micro/press/reveal/dialog-rise → instant via clamp (landing still reserves space first) · **coral sweep** → static 2px outline held 600ms then removed (JS-gated, zero animation) · **gen-bar chip** → explicitly hidden under the media query (the clamp alone would freeze it mid-track); text + counter carry progress · dock → snaps; badge dot static · avatar bob → no bob, static glow stays · shimmer → frozen gradient still reads as placeholder · toast → instant.
Hard rules: **motion is never the only signal** — every animated state change has a static twin (text, outline, or live region); if removing the animation removes the information, the design is wrong. Any new `@keyframes` or JS motion is added to this table with its fallback before merge. No autoplay (video = poster + play button). `scroll-behavior: smooth` only inside `no-preference`. No parallax, no scroll-jacking, ever.

**A6. Screen readers — what Otto sounds like. The text-twin law:** coral is invisible to a screen reader; every visible Otto effect has exactly one text twin in a live region, and the visuals stay aria-silent. ① Narration bar = `role="status"` (polite) — mounted once per screen and kept mounted (SRs miss regions that appear pre-filled); text swaps announce; state/step changes only, ≥2000ms apart, never per-percent; on settle swap to the outcome line, then empty the region. `role="alert"` is reserved for blocking errors — progress is never assertive. ② Progress: indeterminate = `role="progressbar"` + `aria-label`, no valuenow; stepped = valuemin/max/now + `aria-valuetext="step 2 of 5"`. ③ `OttoAvatar` = `role="img"` with mood labels; when adjacent text states the fact, the avatar takes `aria-hidden` — one voice per fact; standalone avatars (collapsed dock) keep the label. ④ Sweeps and landings are silent — the narration region announces the deed. ⑤ Chat stream = `role="log"` — additions announce once, history never re-reads. ⑥ Dock: the button's accessible name carries the state ("Otto — working: generating storyboard"); the dot is `aria-hidden` — the name change IS the badge. ⑦ One-speaker rule: an Otto event announces exactly once (on-surface → narration region; navigated away → the deep-link toast). ⑧ Icon-only controls always carry `aria-label`, same words as the tooltip.

**A7. Review checklist (eye + lint).**
- [ ] New token pair? Computed ratio added to A1 (4.5 / 3:1)
- [ ] No muted-on-accent; no coral/semantic-base *text* below 19px
- [ ] Focus: `:focus-visible` only, keyline + 40% halo, zero bare `outline-none`
- [ ] Every control operable per A3; no `tabindex` > 0, no clickable divs
- [ ] Targets 36/44/24; small visuals use the hit-area recipe
- [ ] New motion listed in A5 with a fallback; JS motion gated on matchMedia
- [ ] Otto work announces exactly once via `role="status"`; sweeps/avatars aria-silent next to text
- [ ] Icon-only buttons have `aria-label`; errors `role="alert"`, progress never assertive

---

## G. Fluid gesture & spring motion(流体手感)

Recorded 2026-07-09 from the `/apple-design` skill (Emil Kowalski's WWDC distillation, MIT; mirrored at `.claude/skills/apple-design/`). In this v3 package, §6 covered one-shot, non-grabbable motion and §G covered grabbable interactions: canvas objects/pan/zoom, trim handles, drag-to-reschedule, sheets/drawers, the dock panel, sliders and swipes. The three historical conflict resolutions are logged in G8; current conflicts return to the current task/authority chain.

**G1. Response.** Feedback fires on pointer-**down**, never on release (§6 press scale already complies). During a gesture the surface tracks the pointer **1:1 the whole way** — animating only at gesture-end is a defect. Nothing non-essential sits on the input path (no debounce/timer between pointer and pixels).

**G2. Direct manipulation.** Pointer Events + `setPointerCapture`; respect the **grab offset** (never snap to element center on grab); keep a short position+timestamp history so release velocity exists. ~10px hysteresis before committing a drag direction; plausible gestures are detected in parallel and losers cancelled — never final-state-only recognizers.

**G3. Interruptibility — primary interaction invariant in this package.** Any grabbable surface must be catchable and reversible **mid-flight**: never lock input during a transition; always animate from the *presentation* (live on-screen) value, never the logical target; a closing sheet re-grabbed follows the finger. CSS transitions/`@keyframes` are **banned for gesture-driven motion** (they cannot be grabbed) — springs only. Decompose 2D motion into independent X/Y springs.

**G4. Springs — house values** (Apple's damping/response, mapped to Motion's `bounce`/`duration`):

| Interaction | Damping (bounce) | Response |
|---|---|---|
| Default UI spring — everything | `1.0` (`bounce: 0`) | `0.3–0.4s` |
| Move / reposition (canvas object) | `1.0` (`0`) | `0.4s` |
| Drawer / sheet / dock panel | `0.8` (`~0.2`) | `0.3s` |
| Momentum release (flick/throw) | `~0.8` (`≤0.2`) | `0.3–0.4s` |

Overshoot/bounce is legal **only when the user's gesture carried momentum**. A menu that faded in never bounces. Staged adoption: the prototype layer may approximate with §6 tokens, but the *interaction contract* (G1–G3) already binds it; the spring implementation (Motion lib — currently not a dependency; adding it = its own work order) becomes mandatory at 点亮 for the canvas flagship, dock, and sheets.

**G5. Velocity handoff & momentum projection.** On release, the spring starts at the finger's exact velocity (no seam between drag and animation). Land where the gesture was *going*, not where it stopped: `projected = current + (v/1000)·d/(1−d)`, `d ≈ 0.998`; snap to the target nearest the projection. **Commit-vs-cancel is decided by velocity *sign* at release, not position.**

**G6. Rubber-band boundaries.** Drag surfaces never hard-stop at an edge — resistance grows past the bound: `rubberband(o, dim, c=0.55) = (o·dim·c)/(dim + c·|o|)`. Applies to canvas pan edges, trim handles, sheet overdrag.

**G7. Spatial consistency.** Enter and exit along the **same path** (in-from-right ⇒ out-to-right); menus/popovers/dock panel scale from their **trigger** (`transform-origin` anchored, never center); reversible transitions mirror their easing; in-between frames hint *toward* the gesture's outcome. Wayfinding on every screen: where am I / where can I go / what's there / how do I get out — never trap. Labels are specific ("Campaigns", "Library"), never generic umbrellas.

**G8. Materials & depth — restricted adoption (conflict resolutions, final):**
1. Skill §12 translucency/depth **does not** overturn §5 flat cards or §D6 ("if it glows it lies") — cards and data surfaces stay flat and quiet. Translucent blur material is legal **only on floating chrome**: dock panel, mobile drawer, sticky-header scroll-edge fade (which may replace the 1px divider, per-surface work order). Never stack two translucent surfaces; `prefers-reduced-transparency` fallback mandatory (frosty → solid).
2. Skill §13 sound/haptics: **not adopted** at prototype layer (web, restraint law); revisit per-surface at 点亮 with founder approval.
3. Skill §15 system-font default: **not adopted** — our brand type stack stands; the *discipline* is adopted: tracking is size-specific (display ≤ `-0.02em`, body ~`0`, small captions slightly positive — one fixed `letter-spacing` for all sizes is a defect), leading inverse to size, hierarchy = weight+size+leading as a set, spacing in rem so Dynamic-Type-style scaling never breaks layout.

**G9. Reduced motion.** Every G-class interaction has its §A5 twin: springs → cross-fade or instant with static state twin; projection/rubber-band still *function* (position math) with animation clamped. JS springs gate on `matchMedia` like all JS motion.

**G10. Review checklist additions** (append to A7):
- [ ] Grabbable surface: feedback on pointer-down, 1:1 tracking, grab-offset respected
- [ ] Mid-flight grab reverses cleanly (no lockout, no jump-to-target, no velocity brick-wall)
- [ ] Release: velocity handed to spring; commit/cancel by velocity sign; flick lands via projection
- [ ] Bounds rubber-band, never hard-stop; bounce only after user momentum
- [ ] Popovers/sheets originate from trigger; exit path mirrors entry
- [ ] Tracking/leading size-specific; no single letter-spacing across the scale

## Changelog — v2 → v3 conflict resolutions

v3 merged ten domain sections onto the v2 base. The list below records the choices made in that dated package; it is not a new source of current approval:

1. **Z-index:** three competing ladders (layout's tokenised map, navigation's observed rungs, feedback's observed rungs) → the v3 package selected the **§L8 ten-token map**. Consequences recorded then: Otto dock = `--z-dock` 70 (was "60" in feedback/otto sections); mobile drawer = 80/79; dialogs = 100. Recheck current code before treating any drift note as current.
2. **Focus ring:** the earlier single "3px @ 40%" halo (§F2) and the 35% mix (§N3) are superseded by the **§A2 two-layer ring** (1px solid keyline + 4px 40% halo) — the 40% halo alone is 1.64:1, invisible to low vision. Bordered fields keep the field variant: ring-coloured 1px border + 3px 40% halo. All alphas unify at 40%.
3. **Field error text:** forms said `12/16 --error`, feedback said `13/18 --error-soft-foreground` → the v3 package selected **13/18, 500, `--error-soft-foreground`** (§A1 records the semantic-text rationale). Base `--error` remained legal for icons and ≥19px.
4. **Dock avatar size:** otto-presence wrote 28px inside the 48px collapsed dock, off its own 16·22·26·32… ladder → **26px** (nearest ladder step). The 34px dialog-chip exception stays.
5. **16px input text:** not on the §3 type scale but required by §F3 (iOS anti-zoom) → documented in §3 as the one **control-only** size; never a reading size.
6. **Analytics kit off-grid values** (KPI padding 15, panel radius 16): founder-locked pixel-matched kit → **pinned exception**; new data surfaces use 16 / 18; quantise when the founder refreshes the kit.
7. **`--warning-soft-foreground` light** fails AA by 0.05 → the doc records the shipped value `#B45309` (`globals.css` is implementation truth). No replacement token is approved here; any change requires a current task and Founder review where applicable (§A1.8).
8. **Ring alpha + disabled opacity locks:** §F2's 40% / 0.4 supersede the stock-shadcn 50% / 0.5 scatter across textarea/select/checkbox/switch.
9. **Tracked evidence location:** token-architecture cited `docs/design/handoff/` (a pre-pivot export); the v3 package was recorded under **`docs/design-system/`** (rules + cards, landed 2026-07-07). Neither location is current authority by itself.
10. **Historical drift evidence:** prior per-section gap tables have left the active tree and remain in Git history only. They are never an authorized work queue; a current GitHub task must independently verify and adopt any surviving gap.
