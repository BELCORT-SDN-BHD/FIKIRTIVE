# UI Rework Mockups (Grok-bright)

Hi-fi reference mockups for the FIKIRTIVE UI rework. **These are static HTML** (Geist via Google Fonts, placeholder images from picsum) — open any file in a browser to see the target design. They are the spec for the build phase.

**Full handoff brief:** [`../superpowers/specs/2026-06-29-UI-REWORK-ENGINEER-HANDOFF.md`](../superpowers/specs/2026-06-29-UI-REWORK-ENGINEER-HANDOFF.md)
**Interactive design system + tokens + OTTO + components:** claude.ai/design project `0abf8563-147b-494a-8364-1b199c775b7d` ("FIKIRTIVE — Grok-bright").
**PNGs:** also on `~/Desktop/fikirtive-*.png`.

| File | Screen | Phase |
|---|---|---|
| `login.html` | Sign-in — split layout | P1 |
| `first-run.html` | First-run / OTTO greeting + goal tiles | P1 |
| `canvas-home.html` | Canvas home — working state (3-pane: sidebar · OTTO chat · infinite canvas) | P2 |
| `canvas-home-empty.html` | Canvas home — empty / first-open state | P2 |
| `node-types.html` | The 8 canvas node types (Product/Image/Video/Text/OTTO-task/Ad-pack/Web-research/Edit) | P2 |
| `result-payoff.html` | Result / win "bloom" moment | P2 |
| `asset-editor.html` | Per-asset editor (animate/upscale/extend/variations + "ask OTTO to change this") | P4 |
| `my-stuff.html` | My Stuff — Cast grouped by type + OTTO cleanup nudge | P3 |
| `brand-memory.html` | Brand memory — facts with "OTTO learned" / "You added" source tags | P3 |
| `account.html` | Account — calm balance + honest receipt ledger | P3 |
| `schedule.html` | Schedule — week view + OTTO auto-publish | post-loop |
| `analytics.html` | Analytics — Meta read-only, KPIs + chart + OTTO insight | post-loop |

**Design rules baked into every screen:** mono by default; **coral `#EC5828` = OTTO only**; semantic colour = state only (success/warning/error/info); wins bloom (polychrome only at the payoff); money always honest ("≈ N credits · billed only when it finishes"); sentence case; no em-dashes in UI copy.

`login.html`, `first-run.html`, `result-payoff.html` were earlier explorations (not synced to the design system as ui_kits) — treat them as directional and refine before building.
