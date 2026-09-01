"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

type DismissEvent = { preventDefault: () => void }

/**
 * FIKIRTIVE popover — an anchored panel of arbitrary content (filters, pickers,
 * "what does this mean" panels). For a list of ACTIONS use `<DropdownMenu>` instead:
 * a menu carries menu semantics and type-ahead, a popover does not.
 * Card radius + `--shadow-lg`, matching every other anchored surface. The
 * transform origin follows the trigger, never the center of the viewport.
 */
type PopoverAnchorState = {
  elementRef: React.RefObject<HTMLElement | null>
  virtualRef?: React.RefObject<{ getBoundingClientRect: () => DOMRect }>
  setVirtualRef: (ref?: React.RefObject<{ getBoundingClientRect: () => DOMRect }>) => void
}

const PopoverAnchorContext = React.createContext<PopoverAnchorState | null>(null)

function Popover({ children, ...props }: PopoverPrimitive.Root.Props) {
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const [virtualRef, setVirtualRef] = React.useState<React.RefObject<{ getBoundingClientRect: () => DOMRect }> | undefined>()
  const anchorState = React.useMemo<PopoverAnchorState>(() => ({ elementRef: anchorRef, virtualRef, setVirtualRef }), [virtualRef])
  return (
    <PopoverAnchorContext.Provider value={anchorState}>
      <PopoverPrimitive.Root data-slot="popover" {...props}>{children}</PopoverPrimitive.Root>
    </PopoverAnchorContext.Provider>
  )
}

function PopoverTrigger({ asChild = false, children, render, ...props }: PopoverPrimitive.Trigger.Props & { asChild?: boolean }) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" render={asChild && React.isValidElement(children) ? children : render} {...props}>{asChild ? undefined : children}</PopoverPrimitive.Trigger>
}

function PopoverAnchor({ asChild = false, children, virtualRef, ...props }: React.ComponentProps<"span"> & { asChild?: boolean; virtualRef?: React.RefObject<{ getBoundingClientRect: () => DOMRect }> }) {
  const anchorState = React.useContext(PopoverAnchorContext)
  const setVirtualRef = anchorState?.setVirtualRef
  React.useEffect(() => {
    setVirtualRef?.(virtualRef)
    return () => setVirtualRef?.(undefined)
  }, [setVirtualRef, virtualRef])

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      ...props,
      ref: anchorState?.elementRef,
      "data-slot": "popover-anchor",
    })
  }

  return <span ref={anchorState?.elementRef} data-slot="popover-anchor" {...props}>{children}</span>
}

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 6,
  alignOffset = 0,
  collisionPadding,
  sticky,
  hideWhenDetached: _hideWhenDetached,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onFocusOutside: _onFocusOutside,
  motion = "standard",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"> & {
  sticky?: boolean | "always" | "partial"
  hideWhenDetached?: boolean
  onOpenAutoFocus?: (event: DismissEvent) => void
  onCloseAutoFocus?: (event: DismissEvent) => void
  onFocusOutside?: (event: DismissEvent) => void
  motion?: "standard" | "instant"
}) {
  const anchorState = React.useContext(PopoverAnchorContext)
  void _hideWhenDetached
  void _onFocusOutside
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        anchor={() => anchorState?.virtualRef?.current ?? anchorState?.elementRef.current ?? null}
        align={align}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        sticky={sticky === true || sticky === "always"}
        className="isolate z-[var(--z-dropdown)]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-[var(--z-dropdown)] w-72 origin-(--transform-origin) rounded-[var(--radius-card)] border border-border/80 bg-popover p-4 text-popover-foreground shadow-[var(--shadow-lg)] outline-none",
            motion === "standard" && [
              "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-open:zoom-in-95 data-closed:zoom-out-95",
              "data-open:duration-[var(--dur-2)] data-closed:duration-[var(--dur-1)] data-open:ease-[var(--ease-out)] data-closed:ease-[var(--ease-out)]",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
            ],
            className
          )}
          initialFocus={onOpenAutoFocus ? false : undefined}
          finalFocus={onCloseAutoFocus ? false : undefined}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
