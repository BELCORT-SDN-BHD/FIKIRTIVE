"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE tabs — design-rules v3 §N4 "Tabs" row, verbatim: `--muted` well,
 * radius 14, p 4, gap 4; item radius 10, px 16 py 8, 13px; active = `--card`
 * + 600 + `--shadow-sm`. The hand-rolled `role="tablist"` switchers move over
 * to this and gain Radix's roving focus + arrow keys (§N8 requires it, and a
 * hand-rolled tablist has to implement it by hand).
 *
 * §N4 也把 **Segmented**(Schedule 的 Plan/Calendar/Queue)交给这同一个组件 ——
 * 旧的 `.al-seg` CSS 配方随 ds.tsx 在 #840 退役,分段控件改成给 TabsList /
 * TabsTrigger 传 className 压小(`--card` + 1px `--border`,radius 10,p 2;
 * item h 30 radius 8 px 12 12/600,active `--secondary`)。
 */
function Tabs({ className, unstyled = false, ...props }: React.ComponentProps<typeof TabsPrimitive.Root> & { unstyled?: boolean }) {
  return <TabsPrimitive.Root data-slot="tabs" className={unstyled ? className : cn("flex flex-col gap-3", className)} {...props} />
}

function TabsList({ className, unstyled = false, ...props }: React.ComponentProps<typeof TabsPrimitive.List> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={unstyled ? className : cn("inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1", className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, unstyled = false, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={unstyled ? className : cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 py-2 text-[13px] font-semibold text-muted-foreground",
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

function TabsContent({ className, unstyled = false, ...props }: React.ComponentProps<typeof TabsPrimitive.Content> & { unstyled?: boolean }) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={unstyled ? className : cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
