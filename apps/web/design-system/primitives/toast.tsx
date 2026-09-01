"use client"

import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const toastManager = ToastPrimitive.createToastManager()

const toast = Object.assign(toastManager, {
  success: (title: string) => toastManager.add({ title, type: "success" }),
  error: (title: string) => toastManager.add({ title, type: "error" }),
  warning: (title: string) => toastManager.add({ title, type: "warning" }),
  info: (title: string) => toastManager.add({ title, type: "info" }),
  message: (title: string) => toastManager.add({ title }),
  loading: (title: string) => toastManager.add({ title, type: "loading" }),
  dismiss: (id?: string) => toastManager.close(id),
})

function ToastIcon({ type }: { type?: string }) {
  const icon =
    type === "success" ? <CircleCheckIcon className="text-success-soft-foreground" /> :
    type === "info" ? <InfoIcon className="text-info-soft-foreground" /> :
    type === "warning" ? <TriangleAlertIcon className="text-warning-soft-foreground" /> :
    type === "error" ? <OctagonXIcon className="text-error-soft-foreground" /> :
    type === "loading" ? <Loader2Icon className="animate-spin text-muted-foreground" /> :
    null

  return icon ? <span data-slot="toast-icon" className="shrink-0 [&_svg]:size-4">{icon}</span> : null
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <ToastPrimitive.Root
      key={toastItem.id}
      toast={toastItem}
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(var(--z-toast)-var(--toast-index))] w-full origin-bottom overflow-hidden rounded-[var(--radius-card)] border border-border bg-popover text-popover-foreground shadow-[var(--shadow-lg)] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.08)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_300ms,height_150ms]",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]"
      )}
    >
      <ToastPrimitive.Content className="flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity data-behind:opacity-0 data-expanded:opacity-100">
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastPrimitive.Title className="text-sm font-semibold" />
          <ToastPrimitive.Description className="text-sm text-muted-foreground" />
        </div>
        <ToastPrimitive.Action render={<Button variant="secondary" size="xs" />} />
        <ToastPrimitive.Close
          aria-label="Close toast"
          render={<Button variant="ghost" size="icon-xs" />}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <XIcon aria-hidden="true" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ))
}

function Toaster({ toastManager: manager = toastManager, ...props }: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider toastManager={manager} limit={3} {...props}>
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[var(--z-toast)] mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full"
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

export { Toaster, toast, toastManager }
