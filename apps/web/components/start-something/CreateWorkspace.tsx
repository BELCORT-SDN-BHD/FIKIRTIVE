"use client";

/**
 * The Create start page, built to the approved design fixture
 * `design-system/patterns/canvas/CreateWorkspaceReference.tsx` (route `/product-patterns/create`).
 * FRONT §7.1 ⑨ · `docs/specs/frontend-baseline.md`.
 *
 * What the fixture owns and this file copies verbatim: the 920px page column, the single `Create`
 * heading, the 680px composer and Canvas-history columns, the history row geometry (32px tile,
 * two-line label, trailing arrow, `border-b` separators) and the section that carries
 * `aria-label="Create with Otto"` **without a visible heading**.
 *
 * What main had added and Founder ruled out (2026-09-03): the visible `Create with Otto` heading
 * row with its Otto avatar and the sentence "Start with the outcome. Otto will ask only what
 * changes the result.", and the sentence "Nothing paid starts before you confirm the exact credits
 * in Canvas." — the credits disclosure lives on the Canvas confirmation card, which is where the
 * money actually moves; this page starts no paid action, so it makes no money claim of its own.
 *
 * The empty state is production-necessary and the design fixture has none (it always ships three
 * canvases), so it uses the design system's own `Empty` primitive — Founder rule ②.
 *
 * Also production-necessary and absent from the fixture (its three sample names are already short):
 * the row's visible name runs through `formatCanvasTitle` (`@/lib/canvas-title`), so a legacy
 * placeholder ("New project", …) reads as canvas vocabulary and a long auto-titled prompt collapses
 * to one scannable line; the untruncated name (`canvasDisplayName`) sits on the row's `title=` so it's
 * still one hover away. Codex QA-CRE-006 — `docs/specs/frontend-baseline.md` §5.
 *
 * Data comes from `CreateWorkspaceEntry`, the controlled server adapter: this component reads no
 * session, no database and no server action, exactly like the shell it replaced.
 */

import Link from "next/link";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import { CREATE_NAV_LABEL } from "@fikirtive/core/navigation";
import { canvasHref } from "@/components/canvas/canvas-href";
import { StartSomething } from "@/components/start-something/StartSomething";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { canvasDisplayName, formatCanvasTitle } from "@/lib/canvas-title";

export interface CreateWorkspaceProject {
  id: string;
  name: string;
  /**
   * Pre-formatted on the server (CreateWorkspaceEntry), not a raw timestamp — this is a client
   * component, so React renders it once on the server and again in the browser during hydration.
   * `toLocaleDateString` used to run here on both sides, and Node's ICU data doesn't always agree
   * with the browser's for the same locale, which trips a hydration mismatch (#949 A5). Formatting
   * it once, server-side, and shipping the finished string removes the second computation
   * entirely, so there's nothing left to disagree with.
   */
  updatedLabel: string;
}

export function CreateWorkspace({ projects }: { projects: CreateWorkspaceProject[] }) {
  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{CREATE_NAV_LABEL}</h1>
      </header>

      <section aria-label="Create with Otto" className="mx-auto mt-14 max-w-[680px]">
        <div>
          <StartSomething />
        </div>
      </section>

      <section
        aria-labelledby="canvas-history-heading"
        className="mx-auto mt-14 max-w-[680px] border-t border-border pt-7"
      >
        <div>
          <h2 id="canvas-history-heading" className="text-sm font-semibold">Canvas history</h2>
        </div>

        {projects.length === 0 ? (
          <Empty className="mt-3 min-h-40 border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PanelsTopLeft aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">No canvases yet</EmptyTitle>
              <EmptyDescription>
                Describe something above. Your Canvas and Conversation will stay together here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mt-3">
            {projects.map((project) => (
              <li key={project.id} className="border-b border-border">
                <Link href={canvasHref(project.id)} title={canvasDisplayName(project.name)} className="group flex items-center gap-3 rounded-[var(--radius)] px-1 py-3 outline-none transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-muted"><PanelsTopLeft className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{formatCanvasTitle(project.name)}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">Updated {project.updatedLabel}</span>
                  </span>
                  <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default CreateWorkspace;
