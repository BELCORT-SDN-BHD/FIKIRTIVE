"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type DismissEvent = { preventDefault: () => void }
type SheetDismissHandlers = {
  onEscapeKeyDown?: (event: DismissEvent) => void
  onInteractOutside?: (event: DismissEvent) => void
  onPointerDownOutside?: (event: DismissEvent) => void
}

const SheetDismissContext = React.createContext<React.MutableRefObject<SheetDismissHandlers> | null>(null)

/**
 * FIKIRTIVE sheet — an edge-anchored panel over the page: the mobile navigation
 * drawer, and any detail panel too tall to be a dialog. Same scrim and surface
 * tokens as `<Dialog>`; it is a modal, so focus is trapped and Escape closes.
 */
function Sheet({ children, onOpenChange, ...props }: SheetPrimitive.Root.Props) {
  const dismissHandlers = React.useRef<SheetDismissHandlers>({})
  return (
    <SheetDismissContext.Provider value={dismissHandlers}>
      <SheetPrimitive.Root
        data-slot="sheet"
        onOpenChange={(open, details) => {
          if (!open) {
            let prevented = false
            const event = { preventDefault: () => { prevented = true } }
            if (details.reason === "escape-key") dismissHandlers.current.onEscapeKeyDown?.(event)
            if (details.reason === "outside-press") {
              dismissHandlers.current.onPointerDownOutside?.(event)
              dismissHandlers.current.onInteractOutside?.(event)
            }
            if (prevented) {
              details.cancel()
              return
            }
          }
          onOpenChange?.(open, details)
        }}
        {...props}
      >
        {children}
      </SheetPrimitive.Root>
    </SheetDismissContext.Provider>
  )
}

function SheetTrigger({ asChild = false, children, render, ...props }: SheetPrimitive.Trigger.Props & { asChild?: boolean }) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" render={asChild && React.isValidElement(children) ? children : render} {...props}>{asChild ? undefined : children}</SheetPrimitive.Trigger>
}

function SheetClose({ asChild = false, children, render, ...props }: SheetPrimitive.Close.Props & { asChild?: boolean }) {
  return <SheetPrimitive.Close data-slot="sheet-close" render={asChild && React.isValidElement(children) ? children : render} {...props}>{asChild ? undefined : children}</SheetPrimitive.Close>
}

function SheetPortal(props: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-[var(--z-drawer)] bg-foreground/40 backdrop-blur-[2px]",
        "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0",
        "data-open:duration-[var(--dur-3)] data-closed:duration-[var(--dur-2)] data-open:ease-[var(--ease-out)] data-closed:ease-[var(--ease-out)]",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  onEscapeKeyDown,
  onInteractOutside,
  onPointerDownOutside,
  ...props
}: SheetPrimitive.Popup.Props & SheetDismissHandlers & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const dismissHandlersRef = React.useContext(SheetDismissContext)
  React.useEffect(() => {
    if (!dismissHandlersRef) return
    dismissHandlersRef.current = { onEscapeKeyDown, onInteractOutside, onPointerDownOutside }
    return () => { dismissHandlersRef.current = {} }
  }, [dismissHandlersRef, onEscapeKeyDown, onInteractOutside, onPointerDownOutside])

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-[var(--z-drawer)] flex flex-col gap-4 border-border/80 bg-popover p-6 text-popover-foreground shadow-[var(--shadow-xl)] outline-none",
          "data-open:animate-in data-closed:animate-out",
          "data-open:duration-[var(--dur-3)] data-closed:duration-[var(--dur-2)] data-open:ease-[var(--ease-out)] data-closed:ease-[var(--ease-out)]",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full max-w-[min(400px,calc(100vw-3rem))] border-l data-closed:slide-out-to-right data-open:slide-in-from-right",
          side === "left" &&
            "inset-y-0 left-0 h-full w-full max-w-[min(400px,calc(100vw-3rem))] border-r data-closed:slide-out-to-left data-open:slide-in-from-left",
          side === "top" &&
            "inset-x-0 top-0 h-auto max-h-[85dvh] border-b data-closed:slide-out-to-top data-open:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto max-h-[85dvh] border-t data-closed:slide-out-to-bottom data-open:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-3.5 right-3.5 inline-flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none transition-[color,background-color,box-shadow,transform] duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:size-4"
          data-press-feedback="true"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold leading-snug tracking-[-0.012em]", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-[1.5] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
