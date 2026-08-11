"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE tabs. The list keeps the segmented-control look the product already
 * wears (quiet `--secondary` trough, active pill lifted onto `--card`) so the
 * hand-rolled `role="tablist"` switchers can move over without a visual jump —
 * what they gain is Radix's roving focus and arrow-key navigation.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit items-center gap-[3px] rounded-lg border border-border bg-secondary p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-[13px] font-semibold text-muted-foreground",
        "transition-[color,background-color,box-shadow] duration-[var(--dur-2)] ease-[var(--ease-out)] outline-none",
        "hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-40",
        "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-sm)]",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
