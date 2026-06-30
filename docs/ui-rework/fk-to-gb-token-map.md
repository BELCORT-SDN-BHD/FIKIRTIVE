# fk → .gb (shadcn) token + component map

The migration converts the otto/admin surfaces off the `fk` system
(`components/fk` + `.fk`/`.fk.gb-skin` tokens in `app/otto/otto-theme.css`,
consumed as inline `style={{var(--token)}}`) onto shadcn `components/ui` + the
`.gb` token block in `app/globals.css` (tailwind v4 utilities like `bg-primary`,
`text-muted-foreground`). Coral stays OTTO/agent-only.

## Tokens (fk value → .gb token / tailwind utility)
| fk token (`.fk` / `.fk.gb-skin`) | value | .gb token | tailwind utility |
|---|---|---|---|
| `--bg-page` | `#FCFCFC` | `--background` | `bg-background` |
| `--surface-card` / `--surface-raised` | `#FFFFFF` | `--card` | `bg-card` |
| `--surface-sunken` | `#F4F4F3` | `--secondary` / `--muted` | `bg-secondary` / `bg-muted` |
| `--brand` (ink) | `#0A0A0A` | `--primary` | `bg-primary` / `text-primary` |
| `--brand-press` | `#000000` | (primary, `active:` darken) | `active:bg-primary` |
| `--brand-tint` | `#F4F4F3` | `--accent` | `bg-accent` |
| `--accent` (CORAL — OTTO only) | `#EC5828` | `--brand` | `bg-brand` / `text-brand` |
| `--accent-soft` | `#FBE4D8` | `--brand-soft` | `bg-brand-soft` |
| `--text-strong` | `#0A0A0A` | `--foreground` | `text-foreground` |
| `--text-body` | `#1A1A18` | `--foreground` | `text-foreground` |
| `--text-muted` | `#6E6E68` | `--muted-foreground` | `text-muted-foreground` |
| `--text-faint` | `#9A9A98` | `--muted-foreground` (lighter) | `text-muted-foreground/70` |
| `--border-subtle` | `#EFEFED` | `--border` | `border-border` |
| `--border-default` | `#E6E6E3` | `--border` | `border-border` |
| `--border-strong` | `#D8D7D1` | `--border` (darker) | `border-border` |
| success / warning / error / info | — | `--success` / `--warning` / `--error` / `--info` (+ `-soft`) | `bg-success-soft text-success-soft-foreground` etc. |
| radius (controls / cards / modals) | 14 / 18 / 24 | `--radius` / `--radius-card` / `--radius-modal` | `rounded-lg` / `rounded-[var(--radius-card)]` / `rounded-[var(--radius-modal)]` |

NOTE the swap (read carefully — this is where coral/ink silently invert): the
otto app's Grok-bright look comes from the `.fk.gb-skin` override block, NOT base
`.fk` (in base `.fk`, `--brand` is slate `--slate-500` and `--accent` is coral —
`otto-theme.css:103`; only `.fk.gb-skin` repaints `--brand` to INK `#0A0A0A` and
keeps `--accent` coral `#EC5828` — `otto-theme.css:289`). Map from the
**`.fk.gb-skin` values** (what users see today): `fk --brand` (ink) → `.gb
--primary` / `bg-primary`; `fk --accent` (CORAL) → `.gb --brand` / **`bg-brand`**.
**Coral is `bg-brand`/`text-brand`, NEVER `bg-accent`** (`.gb --accent` is the neutral
`#ECECEA` hover tint). Putting coral on `bg-accent` is the exact silent-inversion bug.

## Non-color tokens (spacing / type / weight / radius / motion) — needed by S1
The otto components use these fk vars heavily as inline styles (e.g. `padding:
"var(--space-3)"`, `font: "var(--text-sm)"`, `var(--weight-semibold)`,
`var(--radius-control)`, `var(--transition-control)`). They live in `otto-theme.css`,
NOT in `.gb` — so a surface cannot drop `otto-theme.css` until these are translated.
Convert each to a tailwind utility using its REAL px value (read it from
`otto-theme.css` per component; the scale below is the convention, confirm the px):
| fk var family | example | tailwind utility |
|---|---|---|
| `--space-N` (4px scale: 1=4 2=8 3=12 4=16 5=20 6=24 8=32) | `padding: var(--space-3)` | `p-3` / `px-3` / `gap-3` / `m-3` (match the px) |
| `--text-xs/sm/base/lg/xl/2xl/4xl` | `font-size: var(--text-sm)` | `text-xs` … `text-4xl` (match the px) |
| `--weight-medium/semibold/bold` | `var(--weight-semibold)` | `font-medium` / `font-semibold` / `font-bold` |
| `--radius-control/card/modal` (14/18/24) | `var(--radius-control)` | `rounded-lg` / `rounded-[var(--radius-card)]` / `rounded-[var(--radius-modal)]` (the `.gb` radius vars exist) |
| `--dur-fast` / `--ease-out` / `--transition-control` | `transition: var(--transition-control)` | `transition` + `duration-150` + `ease-out` |
| `--font-display` / `--font-body` | `font-family: var(--font-display)` | `.gb` uses Geist via `font-geist` (already on `<html>`); drop the per-element font var |

If a fk var has no clean tailwind equivalent, use an arbitrary value bound to the
EXISTING `.gb` var (`p-[var(--space-3)]`) rather than inventing a number — but prefer
the named scale.

## Components (fk → shadcn `components/ui`)
| fk (`@/components/fk`) | shadcn (`@/components/ui`) |
|---|---|
| `Button` | `button` (variants: `default`=ink, `brand`=coral, `soft`, `secondary`, `outline`, `ghost`, `destructive`, `link`) |
| `IconButton` | `button` with `size="icon"` + `variant="ghost"` |
| `Card` | `card` (`Card`/`CardHeader`/`CardContent`/...) |
| `Input` | `input` · `Textarea` → `textarea` · `Select` → `select` · `Checkbox` → `checkbox` · `Switch` → `switch` |
| `Badge` | `badge` · `Tabs` → `tabs` · `Tooltip` → `tooltip` · `ProgressBar` → `progress` |
| `Toast` | `sonner` (`<Toaster />` + `toast(...)`) |
| `Avatar` | `avatar` · `OttoAvatar` → custom component built on shadcn `avatar` (OTTO coral cloud) |

## Conversion rules
- Wrap each migrated surface's root in `className="gb"` (until S4 teardown applies it globally).
- Replace inline `style={{var(--fk-token)}}` with tailwind `.gb` utilities per the table.
- Replace `cv-*` / `al-*` CSS rules with tailwind classes; delete the rule from `otto-theme.css` once its last user is gone.
- coral (`bg-brand`/`text-brand`) ONLY on OTTO/agent elements.
- Delete an `@/components/fk/X` import + the fk file once `grep -rl "@/components/fk/X"` is empty.
