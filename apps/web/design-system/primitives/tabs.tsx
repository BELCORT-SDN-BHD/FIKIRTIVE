"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE tabs — `--muted` well, 10px control radius, p 4, gap 4; item
 * radius 10, px 16 py 8, 13px; active = `--card`
 * + 600 + `--shadow-sm`. The hand-rolled `role="tablist"` switchers move over
 * to this and gain Base UI's roving focus + arrow keys (§N8 requires it, and a
 * hand-rolled tablist has to implement it by hand).
 *
 * §N4 也把 **Segmented**(Schedule 的 Plan/Calendar/Queue)交给这同一个组件 ——
 * 旧的 `.al-seg` CSS 配方随 ds.tsx 在 #840 退役,分段控件改成给 TabsList /
 * TabsTrigger 传 className 压小(`--card` + 1px `--border`,radius 10,p 2;
 * item h 30 radius 8 px 12 12/600,active `--secondary`)。
 */
function Tabs({ className, activationMode: _activationMode, ...props }: TabsPrimitive.Root.Props & { activationMode?: "automatic" | "manual" }) {
  void _activationMode
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-3", className)} {...props} />
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1", className)}
      {...props}
    />
  )
}

/**
 * `asChild` 套一个真 `<Link>`(campaign-nav / schedule-tabs)时,渲染出来的是 `<a>`,不是
 * `<button>`。Base UI 的 `nativeButton` 默认为 true,于是它按「原生按钮」的口径往那个 `<a>`
 * 上挂属性(`type="button"` —— 锚点上的无效属性),并在开发期打出
 * "expected a native <button>" 警告。`button.tsx` 早就把这件事做对了
 * (`nativeButton={asChild ? false : nativeButton}`),tabs 这里漏了 —— 同一个基座上的同一件
 * 事只能有一种做法。围栏在 `lib/__tests__/tabs-aschild-semantics.test.tsx`。
 */
function TabsTrigger({ asChild = false, children, render, nativeButton, className, ...props }: TabsPrimitive.Tab.Props & { asChild?: boolean }) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-4 py-2 text-[13px] font-semibold text-muted-foreground",
        "transition-[color,background-color,box-shadow] duration-[var(--dur-2)] ease-[var(--ease-standard)] outline-none",
        "hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-40",
        "data-active:bg-card data-active:text-foreground data-active:shadow-[var(--shadow-sm)]",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none",
        className
      )}
      render={asChild && React.isValidElement(children) ? children : render}
      nativeButton={asChild ? false : nativeButton}
      {...props}
    >
      {asChild ? undefined : children}
    </TabsPrimitive.Tab>
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
