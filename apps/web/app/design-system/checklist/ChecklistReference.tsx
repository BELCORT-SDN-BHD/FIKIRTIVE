import type { ComponentType } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MinusCircle,
} from "lucide-react";

import { FikirtiveMark } from "@/components/brand/FikirtiveMark";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "ready" | "needs-work" | "later" | "not-applicable";

type ChecklistItem = {
  name: string;
  status: Status;
  decision: string;
  evidence: string;
};

type ChecklistSection = {
  name: string;
  sourceScope: string;
  items: ChecklistItem[];
};

const CHECKLIST_SECTIONS: ChecklistSection[] = [
  {
    name: "Design language",
    sourceScope: "Brand and guidelines",
    items: [
      {
        name: "Brand direction and assets",
        status: "ready",
        decision: "Fikirtive and Otto have approved identity, ownership, color, and asset rules.",
        evidence: "Brand guidelines · Foundations / Principles",
      },
      {
        name: "Voice, terminology, and microcopy",
        status: "ready",
        decision: "Sentence case, concrete verbs, honest state, money clarity, and product naming are defined.",
        evidence: "Foundations / Voice and grammar · design-rules.md",
      },
      {
        name: "Internationalization guidance",
        status: "ready",
        decision: "Locale, fallback, text expansion, number, currency, date, timezone, plural, RTL, and test rules are defined.",
        evidence: "Foundations / Internationalization · internationalization.md",
      },
    ],
  },
  {
    name: "Foundations",
    sourceScope: "Color, layout, type, elevation, motion, and icons",
    items: [
      {
        name: "Color and semantic meaning",
        status: "ready",
        decision: "Neutral product chrome, Otto coral ownership, and semantic state colors are tokenized with contrast evidence.",
        evidence: "Foundations / Color · globals.css",
      },
      {
        name: "Layout, spacing, and breakpoints",
        status: "ready",
        decision: "The 4px base, 8px rhythm, page gutters, and five responsive lines are documented.",
        evidence: "Foundations / Spacing and layout",
      },
      {
        name: "Typography",
        status: "ready",
        decision: "Geist, JetBrains Mono, hierarchy, aligned data, and language fallback rules are defined.",
        evidence: "Foundations / Typography",
      },
      {
        name: "Shape, elevation, and layer order",
        status: "ready",
        decision: "Radii, shadow purpose, and the shared z-index ladder are defined and consumed by overlays.",
        evidence: "Foundations / Shape and depth · components/ui overlays",
      },
      {
        name: "Motion and reduced motion",
        status: "ready",
        decision: "Frequency, purpose, durations, easing, pointer feedback, and reduced-motion behavior are bounded.",
        evidence: "Foundations / Motion · globals.css",
      },
      {
        name: "Iconography",
        status: "ready",
        decision: "Lucide is the single UI family with reserved meanings and accessible-name rules.",
        evidence: "Foundations / Iconography",
      },
      {
        name: "Accessibility baseline",
        status: "ready",
        decision: "Contrast, visible focus, target size, keyboard behavior, responsive reflow, and theme parity have shared rules.",
        evidence: "Foundations / Accessibility · Base UI semantics",
      },
    ],
  },
  {
    name: "Components",
    sourceScope: "Core component families and their states",
    items: [
      {
        name: "Actions",
        status: "ready",
        decision: "Button hierarchy, sizes, icons, loading, disabled, destructive, and Otto-owned variants are covered.",
        evidence: "Component library / Actions",
      },
      {
        name: "Forms and selection",
        status: "ready",
        decision: "Labels, help, error, focus, disabled, text, OTP, checkbox, switch, and select states are covered.",
        evidence: "Component library / Forms and selection",
      },
      {
        name: "Navigation",
        status: "ready",
        decision: "Breadcrumb and tabs provide the current orientation and view-switching primitives.",
        evidence: "Component library / Navigation",
      },
      {
        name: "Feedback and status",
        status: "ready",
        decision: "Badges, alerts, progress, skeletons, toast, loading, and empty states each have a bounded role.",
        evidence: "Component library / Feedback and status",
      },
      {
        name: "Data and structure",
        status: "ready",
        decision: "Cards, avatar groups, tables, and aligned values cover the current comparison and grouping needs.",
        evidence: "Component library / Data and structure",
      },
      {
        name: "Overlays",
        status: "ready",
        decision: "Menu, popover, select, tooltip, dialog, alert dialog, sheet, focus return, and Escape behavior use Base UI.",
        evidence: "Component library / Overlays · components/ui",
      },
      {
        name: "Product-specific compositions",
        status: "not-applicable",
        decision: "Dashboard, Otto conversation, work cards, and full-screen Canvas are product patterns, not Design System components.",
        evidence: "Approved phase boundary",
      },
      {
        name: "Extended primitives",
        status: "ready",
        decision: "Accordion, Calendar, Carousel, Pagination, and Radio are available with interactive states and Base UI semantics.",
        evidence: "Component library · components/ui",
      },
    ],
  },
  {
    name: "Maintenance",
    sourceScope: "Documentation, change process, and adoption",
    items: [
      {
        name: "Live documentation and sandbox",
        status: "ready",
        decision: "Foundations, interactive components, and this closure matrix are rendered as separate review surfaces.",
        evidence: "/design-system · /design-system/components · this page",
      },
      {
        name: "Source ownership and change protocol",
        status: "ready",
        decision: "Brand files own identity, globals.css owns tokens, components/ui owns recipes, and Founder review closes each phase.",
        evidence: "docs/design-system/README.md",
      },
      {
        name: "Change validation",
        status: "ready",
        decision: "Type checking, lint, focused behavior tests, production build, and browser review form the current gate.",
        evidence: "apps/web scripts · design-system tests",
      },
      {
        name: "Usage analytics and adoption reporting",
        status: "ready",
        decision: "A lightweight source audit measures which product files adopt shared UI components without adding runtime tracking.",
        evidence: "pnpm design-system:audit · scripts/design-system-usage.mjs",
      },
      {
        name: "External community support",
        status: "not-applicable",
        decision: "Fikirtive is an internal product design system, not a public multi-team component community.",
        evidence: "Current company and product scope",
      },
      {
        name: "Separate package release cycle",
        status: "not-applicable",
        decision: "The component library ships with the application; a standalone package would add governance without current value.",
        evidence: "Local apps/web component library",
      },
    ],
  },
];

const STATUS_META: Record<
  Status,
  { label: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; className: string }
> = {
  ready: {
    label: "Ready",
    Icon: CheckCircle2,
    className: "border-success/25 bg-success-soft text-success-soft-foreground",
  },
  "needs-work": {
    label: "Needs work",
    Icon: AlertCircle,
    className: "border-error/25 bg-error-soft text-error-soft-foreground",
  },
  later: {
    label: "Later",
    Icon: Clock3,
    className: "border-info/25 bg-info-soft text-info-soft-foreground",
  },
  "not-applicable": {
    label: "Not applicable",
    Icon: MinusCircle,
    className: "border-border bg-secondary text-muted-foreground",
  },
};

const ALL_ITEMS = CHECKLIST_SECTIONS.flatMap((section) => section.items);
const STATUS_COUNTS = Object.fromEntries(
  (Object.keys(STATUS_META) as Status[]).map((status) => [
    status,
    ALL_ITEMS.filter((item) => item.status === status).length,
  ]),
) as Record<Status, number>;

function StatusBadge({ status }: { status: Status }) {
  const { label, Icon, className } = STATUS_META[status];

  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap", className)}>
      <Icon className="size-3.5" aria-hidden={true} />
      {label}
    </Badge>
  );
}

export function ChecklistReference() {
  return (
    <main
      className="mx-auto w-full max-w-6xl px-5 py-12 text-foreground sm:px-8 md:py-16"
      data-scope="design-system-checklist"
    >
      <header className="pb-12 md:pb-16">
        <a
          href="/design-system/components"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Component library
        </a>
        <div className="mt-10 flex items-center gap-3">
          <FikirtiveMark size={36} />
          <span className="text-lg font-semibold tracking-[-0.025em]">fikirtive</span>
        </div>
        <div className="mt-10 max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">Design system closure · Phase 1C</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            The design system checklist is complete.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            The public Design System Checklist is mapped to Fikirtive&apos;s actual product scope. Every Design System requirement is evidenced now; product patterns and unnecessary governance are excluded by design.
          </p>
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <Badge variant="success">Founder approved</Badge>
          <Badge variant="success">0 current blockers</Badge>
          <Badge variant="outline">24 decisions</Badge>
          <a
            href="https://www.designsystemchecklist.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-[var(--dur-1)] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            Source checklist
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      </header>

      <section aria-labelledby="status-summary" className="border-t border-border py-10 md:py-12">
        <div className="max-w-2xl">
          <h2 id="status-summary" className="text-xl font-semibold tracking-[-0.02em]">Decision summary</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Needs work and Later are both at zero. Not applicable records deliberate scope boundaries, not unfinished foundations.
          </p>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(STATUS_META) as Status[]).map((status) => {
            const { label, Icon } = STATUS_META[status];
            return (
              <div key={status} className="flex min-h-28 flex-col justify-between border border-border bg-card p-4">
                <Icon className="size-4 text-muted-foreground" aria-hidden={true} />
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums">{STATUS_COUNTS[status]}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {CHECKLIST_SECTIONS.map((section) => (
        <section key={section.name} className="border-t border-border py-10 md:py-12">
          <div className="grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
            <div>
              <h2 className="text-base font-semibold tracking-[-0.015em]">{section.name}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.sourceScope}</p>
            </div>
            <div className="min-w-0 border-y border-border">
              {section.items.map((item) => (
                <article key={item.name} className="grid gap-4 border-b border-border py-5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{item.name}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.decision}</p>
                    <p className="mt-3 font-mono text-[11px] leading-4 text-muted-foreground">Evidence · {item.evidence}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <footer className="border-t border-border py-10">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Founder approval received. Design System Phase 1 is closed. The next bounded phase is product patterns: application shell, Dashboard and Otto interaction, then full-screen Canvas.
        </p>
      </footer>
    </main>
  );
}

export default ChecklistReference;
