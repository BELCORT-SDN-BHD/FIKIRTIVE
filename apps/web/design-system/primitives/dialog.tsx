"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type DismissEvent = { preventDefault: () => void }
type DialogDismissHandlers = {
  onEscapeKeyDown?: (event: DismissEvent) => void
  onInteractOutside?: (event: DismissEvent) => void
  onPointerDownOutside?: (event: DismissEvent) => void
}

const DialogDismissContext = React.createContext<React.MutableRefObject<DialogDismissHandlers> | null>(null)

/**
 * FIKIRTIVE modal family: a 16px surface over an ink scrim. Open uses the
 * deliberate 200ms token; close is faster so the interface never feels held up.
 */
function Dialog({ children, onOpenChange, ...props }: DialogPrimitive.Root.Props) {
  const dismissHandlers = React.useRef<DialogDismissHandlers>({})
  return (
    <DialogDismissContext.Provider value={dismissHandlers}>
      <DialogPrimitive.Root
        data-slot="dialog"
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
      </DialogPrimitive.Root>
    </DialogDismissContext.Provider>
  )
}

function DialogTrigger({ asChild = false, children, render, ...props }: DialogPrimitive.Trigger.Props & { asChild?: boolean }) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" render={asChild && React.isValidElement(children) ? children : render} {...props}>{asChild ? undefined : children}</DialogPrimitive.Trigger>
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ asChild = false, children, render, ...props }: DialogPrimitive.Close.Props & { asChild?: boolean }) {
  return <DialogPrimitive.Close data-slot="dialog-close" render={asChild && React.isValidElement(children) ? children : render} {...props}>{asChild ? undefined : children}</DialogPrimitive.Close>
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] bg-foreground/40 backdrop-blur-[2px]",
        "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0",
        "data-open:duration-[var(--dur-3)] data-closed:duration-[var(--dur-2)] data-open:ease-[var(--ease-out)] data-closed:ease-[var(--ease-out)]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  closeDisabled = false,
  onEscapeKeyDown,
  onInteractOutside,
  onPointerDownOutside,
  ...props
}: DialogPrimitive.Popup.Props & DialogDismissHandlers & { closeDisabled?: boolean }) {
  const dismissHandlersRef = React.useContext(DialogDismissContext)
  React.useEffect(() => {
    if (!dismissHandlersRef) return
    dismissHandlersRef.current = { onEscapeKeyDown, onInteractOutside, onPointerDownOutside }
    return () => { dismissHandlersRef.current = {} }
  }, [dismissHandlersRef, onEscapeKeyDown, onInteractOutside, onPointerDownOutside])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-[var(--z-modal)] grid max-h-[calc(100dvh-2rem)] w-full max-w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4",
          "rounded-[var(--radius-modal)] border border-border/80 bg-popover p-6 text-popover-foreground shadow-[var(--shadow-xl)] outline-none",
          "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-open:zoom-in-95 data-closed:zoom-out-95",
          "data-open:duration-[var(--dur-3)] data-closed:duration-[var(--dur-2)] data-open:ease-[var(--ease-out)] data-closed:ease-[var(--ease-out)]",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          disabled={closeDisabled}
          className="absolute top-3.5 right-3.5 inline-flex size-8 items-center justify-center rounded-[8px] text-muted-foreground outline-none transition-[color,background-color,box-shadow,transform] duration-[var(--dur-1)] ease-[var(--ease-standard)] hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
          data-press-feedback="true"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold tracking-[-0.012em] leading-snug", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground leading-[1.5]", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
