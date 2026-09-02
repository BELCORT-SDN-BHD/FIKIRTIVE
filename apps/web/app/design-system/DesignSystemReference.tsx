import type { ReactNode } from "react";
import { Check, ImageIcon, Search, Settings2, Trash2 } from "lucide-react";

import { FikirtiveMark } from "@/components/brand/FikirtiveMark";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Swatch = {
  name: string;
  token: string;
  value: string;
  fill: string;
};

const LIGHT_NEUTRALS: Swatch[] = [
  { name: "Ground", token: "--background", value: "#FAFAFC", fill: "bg-background" },
  { name: "Surface", token: "--card", value: "#FFFFFF", fill: "bg-card" },
  { name: "Chrome", token: "--secondary", value: "#F2F3F7", fill: "bg-secondary" },
  { name: "Hover", token: "--accent", value: "#E8E9EF", fill: "bg-accent" },
  { name: "Line", token: "--border", value: "#E8E9EF", fill: "bg-border" },
  { name: "Line strong", token: "--line-strong", value: "#DDDEE6", fill: "bg-line-strong" },
  { name: "Ink", token: "--foreground", value: "#16171C", fill: "bg-foreground" },
  {
    name: "Ink secondary",
    token: "--muted-foreground",
    value: "#5B5F6C",
    fill: "bg-muted-foreground",
  },
];

const DARK_NEUTRALS: Swatch[] = [
  { name: "Ground", token: "--background", value: "#0B0B0C", fill: "bg-background" },
  { name: "Surface", token: "--card", value: "#131315", fill: "bg-card" },
  { name: "Chrome", token: "--secondary", value: "#1C1C1F", fill: "bg-secondary" },
  { name: "Hover", token: "--accent", value: "#1C1C1F", fill: "bg-accent" },
  { name: "Line", token: "--border", value: "#262629", fill: "bg-border" },
  { name: "Ink", token: "--foreground", value: "#FAFAFA", fill: "bg-foreground" },
  {
    name: "Ink secondary",
    token: "--muted-foreground",
    value: "#A1A1A8",
    fill: "bg-muted-foreground",
  },
];

const SEMANTIC_COLORS: Swatch[] = [
  { name: "Success", token: "--success", value: "#16A34A", fill: "bg-success" },
  { name: "Warning", token: "--warning", value: "#D97706", fill: "bg-warning" },
  { name: "Error", token: "--error", value: "#D02F35", fill: "bg-error" },
  { name: "Info", token: "--info", value: "#3B6FE6", fill: "bg-info" },
];

const TYPE_SCALE = [
  { token: "--text-display", role: "Display", spec: "700 32px / 1.1", sample: "Create with confidence" },
  { token: "--text-title", role: "Page title", spec: "600 22px / 1.15", sample: "Campaign performance" },
  { token: "--text-heading", role: "Section heading", spec: "600 16px / 1.3", sample: "Recent activity" },
  { token: "--text-body", role: "Body", spec: "400 14px / 1.5", sample: "Review the result before it is published." },
  { token: "--text-body-medium", role: "Body emphasis", spec: "500 14px / 1.55", sample: "Ready for review" },
  { token: "--text-small", role: "Supporting", spec: "400 12.5px / 1.5", sample: "Updated a few seconds ago" },
  { token: "--text-caption", role: "Caption", spec: "500 11.5px / 1.5", sample: "Draft saved" },
  { token: "--text-mono-meta", role: "Data", spec: "400 12px / 1.5", sample: "RM 2,350.00  |  1,240 credits" },
] as const;

const SPACING_SCALE = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

const BREAKPOINT_SCALE = [
  { width: "480px", use: "Single-column content and compact actions" },
  { width: "680px", use: "Product mobile shell and 16px page gutters" },
  { width: "768px", use: "Admin navigation and medium layouts" },
  { width: "1024px", use: "Desktop navigation and split workspaces" },
  { width: "1280px", use: "Wide grids and data-console caps" },
] as const;

const LAYER_SCALE = [
  { token: "--z-base", value: "0", use: "Page content" },
  { token: "--z-raised", value: "10", use: "In-pane floating controls" },
  { token: "--z-sticky", value: "30", use: "Sticky headers" },
  { token: "--z-nav", value: "40", use: "Navigation chrome" },
  { token: "--z-dropdown", value: "50", use: "Menus, selects, and popovers" },
  { token: "--z-tooltip", value: "60", use: "Tooltips" },
  { token: "--z-dock", value: "70", use: "Otto dock" },
  { token: "--z-drawer", value: "80", use: "Sheets and drawers" },
  { token: "--z-modal", value: "100", use: "Dialogs" },
  { token: "--z-toast", value: "120", use: "Toasts" },
] as const;

const MOTION_SCALE = [
  { token: "--dur-1", value: "120ms", use: "Hover, focus, color feedback" },
  { token: "--dur-2", value: "150ms", use: "Press and compact reveals" },
  { token: "--dur-3", value: "200ms", use: "Dialog, sheet, meaningful state change" },
  { token: "--dur-sweep", value: "600ms", use: "One-time Otto authorship highlight only" },
] as const;

const EASING_SCALE = [
  { token: "--ease-standard", value: "0.25, 0.1, 0.25, 1", use: "Hover, color, and opacity feedback" },
  { token: "--ease-out", value: "0.23, 1, 0.32, 1", use: "Elements entering or leaving" },
  { token: "--ease-in-out", value: "0.77, 0, 0.175, 1", use: "Movement or morphing already on screen" },
  { token: "--ease-drawer", value: "0.32, 0.72, 0, 1", use: "Gesture-driven drawers and sheets" },
  { token: "--ease-linear", value: "linear", use: "Constant progress only" },
] as const;

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function FoundationSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border py-10 md:py-12">
      <SectionHeading title={title} description={description} />
      <div className="mt-7">{children}</div>
    </section>
  );
}

function ColorSwatch({ swatch }: { swatch: Swatch }) {
  return (
    <div className="min-w-0">
      <div className={cn("h-16 border border-border", swatch.fill)} />
      <div className="mt-3 text-sm font-medium text-foreground">{swatch.name}</div>
      <div className="mt-1 font-mono text-[11px] leading-4 text-muted-foreground">
        <div>{swatch.token}</div>
        <div>{swatch.value}</div>
      </div>
    </div>
  );
}

function Palette({ title, swatches, dark = false }: { title: string; swatches: Swatch[]; dark?: boolean }) {
  return (
    <div
      className={cn(
        "gb border border-border bg-background p-5 text-foreground md:p-6",
        dark && "dark",
      )}
      data-theme={dark ? "dark" : "light"}
    >
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">{dark ? "Dark" : "Light"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-4">
        {swatches.map((swatch) => (
          <ColorSwatch key={`${title}-${swatch.token}`} swatch={swatch} />
        ))}
      </div>
    </div>
  );
}

function Principle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-l border-border pl-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

function ContrastPair({
  name,
  ratio,
  className,
}: {
  name: string;
  ratio: string;
  className: string;
}) {
  return (
    <div className={cn("flex min-h-24 flex-col justify-between border p-4", className)}>
      <span className="text-sm font-semibold">{name}</span>
      <span className="font-mono text-xs">{ratio}</span>
    </div>
  );
}

export function DesignSystemReference() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12 text-foreground sm:px-8 md:py-16" data-scope="foundations-only">
      <header className="pb-12 md:pb-16">
        <div className="flex items-center gap-3">
          <FikirtiveMark size={36} />
          <span className="text-lg font-semibold tracking-[-0.025em]">fikirtive</span>
        </div>
        <div className="mt-10 max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">Design foundations</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            One visual language for every product surface.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            This page defines the shared visual rules. Components, product patterns, dashboards,
            Otto flows, and Canvas screens are reviewed in later stages.
          </p>
        </div>
      </header>

      <FoundationSection
        title="Principles"
        description="The system stays calm enough for daily work and distinctive enough to feel like Fikirtive."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Principle title="Neutral product canvas">Cold neutrals carry the interface. Product imagery supplies visual richness.</Principle>
          {/* #682:Otto 只按名字称呼,不许有代词替它开头。上一版是「…and Otto. It never means…」
              —— 那个 It 指的是 coral,但代词围栏只看形状,读者也一样会读岔。合成一句之后就没有
              代词可以指错人了(otto-pronoun-consistency.test.ts 钉这一条)。 */}
          <Principle title="Coral has ownership">Coral identifies Fikirtive and Otto, never a generic human action.</Principle>
          <Principle title="State has meaning">Green, amber, red, and blue appear only when a real state needs to be understood.</Principle>
          <Principle title="Structure comes first">Type, spacing, and lines establish hierarchy before shadow, color, or decoration.</Principle>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Color"
        description="Product chrome uses one cold neutral family. Dark tokens preserve the same meaning for a future approved mode. Warm paper and gradients are not app chrome."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <Palette title="Product neutrals" swatches={LIGHT_NEUTRALS} />
          <Palette title="Product neutrals" swatches={DARK_NEUTRALS} dark />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Semantic state</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {SEMANTIC_COLORS.map((swatch) => (
                <ColorSwatch key={swatch.token} swatch={swatch} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Brand identity</h3>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="flex min-h-36 flex-col justify-between bg-brand p-4 text-brand-ink">
                <FikirtiveMark size={40} />
                <div>
                  <div className="text-sm font-semibold">Coral</div>
                  <div className="mt-1 font-mono text-[11px]">#EC5828</div>
                </div>
              </div>
              <div className="flex min-h-36 flex-col justify-between border border-brand/25 bg-brand-soft p-4 text-brand-soft-foreground">
                <OttoAvatar size={44} mood="idle" />
                <div>
                  <div className="text-sm font-semibold">Otto presence</div>
                  <div className="mt-1 font-mono text-[11px]">--brand-soft</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Typography"
        description="Geist is the interface voice. JetBrains Mono is reserved for aligned data, prices, dates, and identifiers."
      >
        <div className="border-y border-border">
          {TYPE_SCALE.map((row) => (
            <div
              key={row.token}
              className="grid gap-3 border-b border-border py-5 last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)_180px] md:items-baseline"
            >
              <div className="text-xs font-medium text-muted-foreground">{row.role}</div>
              <div style={{ font: `var(${row.token})` }}>{row.sample}</div>
              <div className="font-mono text-[11px] leading-4 text-muted-foreground md:text-right">
                <div>{row.token}</div>
                <div>{row.spec}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-6 border-l border-border pl-4 sm:grid-cols-2">
          <div>
            <div className="text-sm font-semibold">English UI copy</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Sentence case, short verbs, and plain explanations.</p>
          </div>
          <div>
            <div className="text-sm font-semibold">中文 fallback</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">PingFang SC or Noto Sans SC follows the same hierarchy and rhythm.</p>
          </div>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Spacing and layout"
        description="A 4px base unit supports compact controls. An 8px rhythm organizes sections, rows, and page gutters."
      >
        <div className="border-y border-border">
          {SPACING_SCALE.map((size) => (
            <div key={size} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-5 border-b border-border py-3 last:border-b-0">
              <span className="font-mono text-xs text-muted-foreground">{size}px</span>
              <div className="h-2 bg-foreground" style={{ width: `min(${size * 4}px, 100%)` }} />
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Principle title="Page gutter">16px on narrow screens, 24-32px on desktop workspaces.</Principle>
          <Principle title="Content rhythm">16px inside compact groups, 24px inside primary surfaces.</Principle>
          <Principle title="Section rhythm">32-48px separates distinct tasks or information groups.</Principle>
        </div>
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground">Responsive breakpoints</h3>
          <div className="mt-4 border-y border-border">
            {BREAKPOINT_SCALE.map((row) => (
              <div key={row.width} className="grid gap-2 border-b border-border py-4 last:border-b-0 sm:grid-cols-[96px_minmax(0,1fr)]">
                <span className="font-mono text-xs text-muted-foreground">{row.width}</span>
                <span className="text-sm text-muted-foreground">{row.use}</span>
              </div>
            ))}
          </div>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Shape and depth"
        description="Three radii cover the product. Shadows explain elevation, never decorate static reading surfaces."
      >
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Radius scale</h3>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-xs)]" style={{ borderRadius: "var(--radius)" }}>
                <span className="text-xs text-muted-foreground">10px control</span>
              </div>
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-xs)]" style={{ borderRadius: "var(--radius-card)" }}>
                <span className="text-xs text-muted-foreground">12px surface</span>
              </div>
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-xs)]" style={{ borderRadius: "var(--radius-modal)" }}>
                <span className="text-xs text-muted-foreground">16px overlay</span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-foreground">Elevation scale</h3>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-xs)]">
                <span className="text-xs text-muted-foreground">Rest</span>
              </div>
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-md)]">
                <span className="text-xs text-muted-foreground">Raised</span>
              </div>
              <div className="flex aspect-square items-end border border-border bg-card p-3 shadow-[var(--shadow-xl)]">
                <span className="text-xs text-muted-foreground">Overlay</span>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
          Reading surfaces stay flat. Interactive controls may lift slightly. Popovers, sheets, and dialogs receive the strongest depth.
        </p>
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-foreground">Layer order</h3>
          <div className="mt-4 border-y border-border">
            {LAYER_SCALE.map((row) => (
              <div key={row.token} className="grid gap-2 border-b border-border py-3 last:border-b-0 sm:grid-cols-[128px_48px_minmax(0,1fr)]">
                <span className="font-mono text-xs text-muted-foreground">{row.token}</span>
                <span className="font-mono text-xs text-foreground">{row.value}</span>
                <span className="text-sm text-muted-foreground">{row.use}</span>
              </div>
            ))}
          </div>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Motion"
        description="Motion communicates feedback or a state change. Nothing moves only to make the interface feel busy."
      >
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Duration</h3>
            <div className="mt-4 border-y border-border">
              {MOTION_SCALE.map((row) => (
                <div key={row.token} className="grid gap-2 border-b border-border py-4 last:border-b-0 sm:grid-cols-[96px_64px_minmax(0,1fr)]">
                  <span className="font-mono text-xs text-muted-foreground">{row.token}</span>
                  <span className="text-sm font-medium text-foreground">{row.value}</span>
                  <span className="text-sm text-muted-foreground">{row.use}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Easing by purpose</h3>
            <div className="mt-4 border-y border-border">
              {EASING_SCALE.map((row) => (
                <div key={row.token} className="grid gap-2 border-b border-border py-4 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
                  <div>
                    <div className="font-mono text-xs text-muted-foreground">{row.token}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{row.value}</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{row.use}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Principle title="Frequency first">Keyboard actions and interactions repeated 100+ times a day stay instant.</Principle>
          <Principle title="Purpose first">Motion must explain space, state, feedback, or a meaningful transition.</Principle>
          <Principle title="Pointer feedback">Pointer press feedback may scale to 0.97 for 120ms. Keyboard activation stays instant.</Principle>
          <Principle title="Reduced motion">Remove spatial movement while retaining useful color and opacity feedback.</Principle>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Iconography"
        description="Lucide is the single interface icon family. Meaning comes from the icon, its accessible name, and the surrounding copy rather than decorative color."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { name: "Search", Icon: Search },
            { name: "Settings", Icon: Settings2 },
            { name: "Confirm", Icon: Check },
            { name: "Media", Icon: ImageIcon },
            { name: "Delete", Icon: Trash2 },
          ].map(({ name, Icon }) => (
            <div key={name} className="flex min-h-28 flex-col justify-between border border-border bg-card p-4">
              <Icon className="size-5" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">{name}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Principle title="One family">Use Lucide at the inherited text color. Do not mix icon styles inside product chrome.</Principle>
          <Principle title="One meaning">Reserve destructive and semantic icons for their real state or consequence.</Principle>
          <Principle title="Accessible names">Icon-only controls always carry an aria-label and a matching tooltip.</Principle>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Accessibility"
        description="The visual system establishes minimum contrast, visible focus, comfortable targets, and theme parity before components are built."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ContrastPair name="Primary ink" ratio="17.17:1" className="border-border bg-background text-foreground" />
          <ContrastPair name="Secondary ink" ratio="6.11:1" className="border-border bg-background text-muted-foreground" />
          <ContrastPair name="Coral with brand ink" ratio="5.00:1" className="border-brand bg-brand text-brand-ink" />
          <ContrastPair name="Error fill" ratio="5.07:1" className="border-error bg-error text-destructive-foreground" />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="grid gap-5 sm:grid-cols-2">
            <Principle title="Visible focus">Keyboard focus uses an ink keyline and halo. Coral remains reserved for Otto.</Principle>
            <Principle title="Target size">Primary controls target 44px. Compact desktop controls keep an equivalent interaction area.</Principle>
            <Principle title="Responsive reflow">Foundations must survive 320px width and 200% zoom without hiding information.</Principle>
            <Principle title="Theme parity">A future dark mode must preserve the same meaning and hierarchy.</Principle>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="text-sm font-semibold">Focus preview</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Use Tab to inspect the system focus treatment.</p>
            <Button type="button" variant="outline" className="mt-5">
              Review focus
            </Button>
          </div>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Voice and grammar"
        description="Interface language should explain the current state, the next action, and any consequence without marketing language."
      >
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          <Principle title="Sentence case">Use natural capitalization for headings, labels, buttons, and status messages.</Principle>
          <Principle title="Concrete verbs">Prefer Create, Review, Send, Save, Retry, and Remove over vague promotional language.</Principle>
          <Principle title="Honest state">Say what happened, what remains safe, and what the user can do next.</Principle>
          <Principle title="Money clarity">Show the exact credit consequence before approval and confirm when nothing was charged.</Principle>
          <Principle title="Product names">Use Fikirtive in prose, fikirtive for the wordmark, Otto for the assistant, and credits in full.</Principle>
          <Principle title="Formatting">Use RM 2,350.00, 24 credits, and 27 Aug 2026. Use tabular figures in aligned data.</Principle>
        </div>
      </FoundationSection>

      <FoundationSection
        title="Internationalization"
        description="The same hierarchy must survive translation, locale formatting, text expansion, timezone changes, and bidirectional layouts."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Principle title="Complete messages">Translate full message keys. Never assemble a sentence from fragments with a fixed English order.</Principle>
          <Principle title="Locale-aware data">Format numbers, currency, dates, and plurals with Intl APIs and the workspace locale.</Principle>
          <Principle title="Flexible copy">Allow at least 30% text expansion. Controls reflow instead of clipping or shrinking readable type.</Principle>
          <Principle title="Direction and time">Use logical layout directions and workspace timezone. Mirror only directional icons in RTL.</Principle>
        </div>
        <div className="mt-8 border-y border-border">
          {[
            ["English", "27 Aug 2026 · RM 2,350.00"],
            ["Bahasa Melayu", "27 Ogo 2026 · RM 2,350.00"],
            ["简体中文", "2026年8月27日 · MYR 2,350.00"],
          ].map(([locale, example]) => (
            <div key={locale} className="grid gap-2 border-b border-border py-4 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)]">
              <span className="text-sm font-medium text-foreground">{locale}</span>
              <span className="font-mono text-xs text-muted-foreground">{example}</span>
            </div>
          ))}
        </div>
      </FoundationSection>

      <footer className="border-t border-border py-10">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          This checkpoint contains foundations only. The component library and closure checklist have their own review pages; product patterns begin after Founder approval.
        </p>
      </footer>
    </main>
  );
}

export default DesignSystemReference;
