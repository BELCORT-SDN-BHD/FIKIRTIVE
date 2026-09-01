import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE card: white surface, 12px radius, hairline border + subtle shadow to
 * lift off the cool ground. Hover lifts 2px (opt-in via className).
 *
 * `min-w-0` is load-bearing, not cosmetic (#730). A card is almost always a grid or
 * flex item, and such an item defaults to `min-width: auto` — its own content sets a
 * floor it may not shrink below. One `truncate` line inside (truncate means
 * `white-space: nowrap`, whose min-content width is the WHOLE line) then pushes the
 * card straight through its track and the page scrolls sideways. `min-width: 0` hands
 * the width back to the track, which is what makes `truncate` truncate at all.
 */
function Card({
  className,
  size = "default",
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  tone?: "default" | "otto"
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-tone={tone}
      className={cn(
        "group/card flex min-w-0 flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-card p-6 text-card-foreground shadow-[var(--shadow-sm)] data-[size=sm]:gap-3 data-[size=sm]:p-4 data-[tone=otto]:border-brand/25 data-[tone=otto]:bg-brand-soft/35",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-lg font-semibold tracking-[-0.012em] leading-snug group-data-[size=sm]/card:text-sm", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-3", className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
