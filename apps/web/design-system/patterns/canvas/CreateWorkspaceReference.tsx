"use client"

import Link from "next/link"
import * as React from "react"
import { ArrowUpRight, PanelsTopLeft } from "lucide-react"

import { SHELL_ROUTES } from "@fikirtive/core/navigation"
import { ProductPatternShellFrame } from "@/design-system/patterns/application-shell/ProductPatternShellFrame"
import { OttoPanelFlowReference } from "@/components/otto/panel/OttoPanelFlowReference"
import { CreationComposer } from "@/design-system/patterns/canvas/CreationComposer"
import { REVIEW_ACCOUNT } from "@/design-system/patterns/application-shell/review-account"
import { inferGenerationKind } from "./model"
import {
  CANVAS_REVIEW_HREF,
  newCanvasReviewHref,
} from "./review-links"

const RECENT_CANVASES = [
  { name: "Hari Raya gifting", meta: "3 generations · Updated today" },
  { name: "Weekend tea launch", meta: "8 generations · Updated yesterday" },
  { name: "New arrivals", meta: "5 generations · Updated 3 days ago" },
] as const

export function CreateWorkspaceReference({ initialContext }: { initialContext?: string }) {
  const [prompt, setPrompt] = React.useState("")
  const [reference, setReference] = React.useState<string | undefined>(initialContext)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  function submitCreation() {
    const value = prompt.trim()
    if (!value) return
    window.location.assign(newCanvasReviewHref({ prompt: value, mode: inferGenerationKind(value), reference }))
  }

  return (
    <div className="gb min-h-dvh bg-background text-foreground">
      <OttoPanelFlowReference
        founderName={REVIEW_ACCOUNT.displayName}
        recommendedPrompt="Help me turn a campaign goal into an image or video."
      >
        <ProductPatternShellFrame
          pathname={SHELL_ROUTES.create}
        >
          <main className="min-h-[calc(100dvh-2.75rem)] bg-background">
            <div className="mx-auto w-full max-w-[920px] px-8 py-12">
              <header>
                <h1 className="text-3xl font-semibold tracking-tight">Create</h1>
              </header>

              <section aria-label="Create with Otto" className="mx-auto mt-14 max-w-[680px]">
                <div>
                  <CreationComposer
                    inputRef={inputRef}
                    prompt={prompt}
                    reference={reference}
                    surface="entry"
                    onPromptChange={setPrompt}
                    onReferenceChange={setReference}
                    onSubmit={submitCreation}
                  />
                </div>
              </section>

              <section aria-labelledby="canvas-history-heading" className="mx-auto mt-14 max-w-[680px] border-t border-border pt-7">
                <div>
                  <h2 id="canvas-history-heading" className="text-sm font-semibold">Canvas history</h2>
                </div>

                <ul className="mt-3">
                  {RECENT_CANVASES.map((canvas) => (
                    <li key={canvas.name} className="border-b border-border">
                      <Link href={CANVAS_REVIEW_HREF} className="group flex items-center gap-3 rounded-[var(--radius)] px-1 py-3 outline-none transition-colors duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-muted"><PanelsTopLeft className="size-4" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{canvas.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{canvas.meta}</span>
                        </span>
                        <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              <p className="mx-auto mt-8 max-w-[680px] text-xs text-muted-foreground">Review fixture only</p>
            </div>
          </main>
        </ProductPatternShellFrame>
      </OttoPanelFlowReference>
    </div>
  )
}
