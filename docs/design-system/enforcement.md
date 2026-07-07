# Design system v3 — machine enforcement plan

The spec (`design-rules-v3.md`) is law; this file is the police. Four instruments:
a grep fence script, a living component gallery, a reviewer-checklist delta, and the
sync rule. Rollout copies the `check-parity` pattern already trusted in this repo
(script in `scripts/`, wired as one CI step, warn first, then hard).

---

## (a) The fence script — `scripts/check-design.sh` → `check-design.mjs`

Grep-class static checks over `apps/web` (`.tsx`, `.ts`, plus `.gb`-scoped rules in
`globals.css`). Node script (same shape as `check-parity.mjs`: walk files, match,
print `[design] file:line — rule — offending text`, exit code by mode). No AST
needed for v1 — every rule below is a regex.

### Checks (rule id · pattern · exemptions)

| # | Rule | Pattern (v1 regex, refine in code) | Exemptions |
|---|---|---|---|
| D1 | **Raw hex outside globals.css** | `#[0-9A-Fa-f]{3,8}\b` in `.tsx/.ts` under `apps/web/{components,app,lib}` | `components/otto-mark/*` (mascot art, v3 §11) · `#000`/`#000000` in `VideoNode.tsx` letterbox · test files |
| D2 | **Raw hex in `.gb` CSS scope** | hex inside `.gb`-prefixed rule blocks of `globals.css` | the two token blocks (`.gb { }`, `.gb.dark { }`) |
| D3 | **Off-grid arbitrary px in classNames** | `[mp][trblxye]?-\[(\d+)px\]` and `gap-\[(\d+)px\]` where the number ∉ {2,4,8,12,16,20,24,32,40,48,64} | none — the grid is the grid (v3 §4) |
| D4 | **Rounded-* overrides** | `rounded-(sm|md|lg|xl|2xl|3xl)\b` in `.gb` components (these resolve through *Vapor's* radius registration — the 20px-button bug, polish-delta #1) | `rounded-full`, `rounded-none`, `rounded-[var(--radius…)]`; admin-only files until migrated |
| D5 | **Non-Lucide svg icons** | inline `<svg` in `.tsx` + imports matching `react-icons|heroicons|@radix-ui/react-icons|fontawesome` | `components/otto-mark/*` · chart SVGs in analytics components (data, not icons) · `components/ui/*` (shadcn ships a few inline chevrons — list file-by-file) |
| D6 | **Spinner keywords** | `animate-spin|Loader2|toast\.loading` | none on `.gb` surfaces (v3 §FB7) |
| D7 | **Vapor tokens on `.gb` surfaces** | `var\(--(fg|bg|glass|line)-` in `.gb` components | legacy un-migrated files (baseline list) |
| D8 | **Voice greps** (warn-only forever — strings need eyes) | em-dash `—` in string literals · `"\$[0-9]|USD` · `"[^"]*OTTO` · hype words (v3 §V8 list) | comments, docs, wordmark assets |
| D9 | **Three-place token rule** | any `--color-X: var(--X)` registered without `--X` in both `.gb` and `.gb.dark`; any `bg-/text-` utility for an unregistered state colour | non-colour tokens (consumed as `var()`) |
| D10 | **Off-ladder z-index** | `z-\[?\d+` / `z-index:\s*\d+` where value ∉ {0,10,30,40,50,60,70,80,79,100,120} | until `--z-*` tokens land, D10 runs warn-only |

### Rollout — warn → hard, the check-parity way

1. **Phase 0 (land the script):** `pnpm lint:design` runs locally + one CI step
   (`bash scripts/check-design.sh`), **report-only**: prints all violations grouped
   by rule, writes the total per rule to `scripts/design-baseline.json`, exits 0.
2. **Phase 1 (ratchet, ~1 week later):** CI fails if any rule's count **exceeds the
   committed baseline** — existing drift is tolerated, new drift is blocked. Fixing
   drift lowers the baseline in the same PR (script offers `--update-baseline`).
3. **Phase 2 (hard):** once a rule's baseline hits 0, that rule flips to hard-fail on
   any occurrence (flag per rule in the baseline file: `"mode": "hard"`). D1/D4/D6
   should reach hard within a few token-level PRs; D8 stays warn forever.
4. Exemptions live **in the script** as an explicit list with a comment citing the
   v3 section that grants them — same registered-debt discipline as
   `PARITY_EXEMPTIONS`. No inline `// design-ignore` comments: exemptions are
   centralized or they metastasize.

## (b) `/kitchensink` — the living component gallery

One route, `apps/web/app/kitchensink/page.tsx`, rendered under `.gb`, dev + admin
only (behind the same guard as `/admin`; excluded from tenant nav). It is the visual
regression surface: if a token change looks wrong, it looks wrong here first.

Contents (each block cites its v3 section in a `micro-mono` caption):

1. **Tokens:** colour swatches straight from the `.gb` vars (light/dark toggle at the
   top — also the first consumer of the §K3 theme provider) · radius trio · the 5
   shadows on cards · motion tokens firing on hover.
2. **Type:** the nine-step scale (§3), each row at spec size/weight/tracking.
3. **Buttons:** all 8 variants × 3 sizes × states (rest/hover/focus/disabled/pending
   with "Saving…").
4. **Forms (§F):** the field anatomy with every F2 state side by side · all three
   sizing tiers · select open state · checkbox/radio/switch rows · adornments ·
   a live validation demo (blur-then-live).
5. **Data (§D):** 4 KPI cards (one showing `—`) · table Form A + Form B with all four
   per-table states · the line chart with peaks + compare series · chart tokens.
6. **Feedback (§FB):** toast triggers (success/error/undo) · dialog S/M/L · the
   tier-2 and tier-3 destructive confirms · banner severities · skeleton set ·
   determinate + indeterminate progress.
7. **Otto (§O):** `OttoAvatar` at every ladder size × 8 moods · narration bar (live
   demo loop) · coral sweep trigger button · the dock (first real integration) ·
   a "coral budget" demo screen showing exactly 2+1+3.
8. **Layout (§L):** the width ladder drawn as rulers · z-map stack demo.
9. **A11y strip (§A):** focus-ring demo on every control class · reduced-motion
   toggle that flips the demos · contrast pairs table rendered live.

Rule: **a new component or variant is not merged until it appears here** — the
kitchensink diff is part of the component PR (reviewer checklist item below).

## (c) Design-review checklist delta — `docs/review/REVIEWER-PLAYBOOK.md`

Add one area block, "Design system (any diff touching apps/web UI)":

- [ ] `pnpm lint:design` green (or baseline unchanged in ratchet mode)
- [ ] New/changed tokens hit all three places: `.gb` + `.gb.dark` + `@theme inline` (v3 §T5)
- [ ] Zero raw hex / Vapor tokens / named `rounded-*` / `shadow-xs|sm|md` Tailwind
      utilities in changed `.gb` files — token utilities or `[var(--…)]` forms only
- [ ] New screen: fits an §L2 archetype, one §L3 width stop, z from the §L8 map
- [ ] Focus visible on every new interactive element (§A2 two-layer ring); no
      clickable divs; targets 36/44/24 (§A4)
- [ ] Coral budget screenshot test (§O4): ≤ 2 chrome + 1 statement + 3 mark sets
      while Otto idles; ≤ 1 `brand` button and it starts Otto work
- [ ] Copy passes §V: sentence case, no em-dash, spend buttons carry `· N credits`,
      errors have a recovery action, async buttons have a pending form
- [ ] Loading = skeleton (shape-matched); zero spinners; new motion listed in §A5
      with a reduced-motion fallback
- [ ] New component/variant added to `/kitchensink` in the same PR
- [ ] Mirror sync (below) satisfied

Precedence note (unchanged): playbook < blueprint < founder. This block cites
design-rules-v3 sections instead of restating values.

## (d) The sync rule — design project ↔ repo mirror

Three artifacts, one direction of flow (v3 §0 truth 3, §11 table):

| Artifact | Location | Role |
|---|---|---|
| Design project of record | claude.ai/design `0abf8563` "FIKIRTIVE — Grok-bright" | where change is drafted and founder-approved |
| Repo mirror | `docs/design-system/` (`design-rules.md`, `cards/*.html`, `polish-delta.md`) | the offline copy agents read; CI can see it |
| Token truth | `apps/web/app/globals.css` `.gb` block | what actually renders |

Rules:
1. **Same-PR rule:** any PR that changes `.gb` tokens, `design-rules`, or a guideline
   card updates the repo mirror in that same PR. A token PR without a mirror diff
   (or an explicit "no doc impact" line in the PR body) fails review.
2. Mirror refreshes are mechanical exports — zero hand-edits; the mirror is never a
   source and nothing in `apps/web` imports from `docs/` (fence: `grep -rn
   "docs/design" apps/web` → empty, add as check D11 warn-mode).
3. `docs/design/handoff/` is frozen pre-pivot history: read-only, never refreshed,
   never cited by new code or docs.
4. Cheap integrity check (optional, phase 2): the mirror `design-rules.md` carries a
   version line ("v3, 2026-07-07"); `check-design.mjs` warns when `globals.css`'s
   `.gb` block changed in a PR but the mirror version line didn't.
