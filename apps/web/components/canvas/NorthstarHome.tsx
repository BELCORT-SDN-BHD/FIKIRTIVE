"use client";

/** Frozen Create workspace: one Otto entry and the authenticated merchant's Canvas history. */

import Link from "next/link";
import { CREATE_NAV_LABEL } from "@fikirtive/core/navigation";
import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import { canvasHref } from "@/components/canvas/canvas-href";
import { StartSomething } from "@/components/start-something/StartSomething";
import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

export interface NorthstarHomeProject {
  id: string;
  name: string;
  /**
   * Pre-formatted on the server (NorthstarHomeEntry), not a raw timestamp — this is a
   * client component, so React renders it once on the server and again in the browser
   * during hydration. `toLocaleDateString` used to run here on both sides, and Node's
   * ICU data doesn't always agree with the browser's for the same locale, which trips
   * a hydration mismatch (#949 A5). Formatting it once, server-side, and shipping the
   * finished string removes the second computation entirely, so there's nothing left
   * to disagree with.
   */
  updatedLabel: string;
}

export function NorthstarHome({ projects }: { projects: NorthstarHomeProject[] }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{CREATE_NAV_LABEL}</h1>
      </header>

      <section aria-labelledby="create-with-otto-heading" className="mt-14">
        <div className="mb-4 flex items-center gap-3">
          <OttoAvatar size={32} state="idle" />
          <div>
            <h2 id="create-with-otto-heading" className="text-sm font-semibold text-foreground">
              Create with Otto
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Start with the outcome. Otto will ask only what changes the result.
            </p>
          </div>
        </div>
        <StartSomething />
        <p className="mt-2 text-xs text-muted-foreground">
          {`Nothing paid starts before you confirm the exact credits in ${PRODUCT_VOCABULARY.canvas}.`}
        </p>
      </section>

      <section aria-labelledby="canvas-history-heading" className="mt-14 border-t border-border pt-7">
        <h2 id="canvas-history-heading" className="text-sm font-semibold text-foreground">
          {`${PRODUCT_VOCABULARY.canvas} history`}
        </h2>
        {projects.length === 0 ? (
          <Empty className="mt-3 min-h-40 border border-dashed py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PanelsTopLeft aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-base">No canvases yet</EmptyTitle>
              <EmptyDescription>
                {`Describe something above. Your ${PRODUCT_VOCABULARY.canvas} and Conversation will stay together here.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mt-3">
            {projects.map((project, index) => (
              <li key={project.id}>
                <Button
                  asChild
                  variant="ghost"
                  className="h-14 w-full justify-start rounded-[var(--radius)] px-2 font-medium"
                >
                  <Link href={canvasHref(project.id)}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-muted">
                      <PanelsTopLeft className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-semibold">{project.name}</span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground tabular-nums">
                        Updated {project.updatedLabel}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </Button>
                {index < projects.length - 1 && <Separator className="mx-3 w-auto" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default NorthstarHome;
