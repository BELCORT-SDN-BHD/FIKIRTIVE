import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * FIKIRTIVE button.
 *  - `default` = INK (the confident primary CTA)
 *  - `brand`   = CORAL (OTTO / agent-initiated moments only)
 *  - `soft`    = coral-tint fill
 * 14px radius, coral focus ring, a little spring on press.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold tracking-[-0.01em] transition-[color,background-color,box-shadow,transform] duration-[var(--dur-2)] ease-[var(--ease-spring)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        brand: "bg-brand text-brand-foreground shadow-[var(--shadow-brand)] hover:brightness-[1.05]",
        soft: "bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft/75",
        secondary: "border border-border bg-card text-foreground shadow-xs hover:bg-secondary",
        outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        link: "text-brand-strong underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 rounded-[10px] px-3.5 text-[13px]",
        default: "h-11 px-5",
        lg: "h-12 px-6 text-base",
        pill: "h-11 rounded-full px-6",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
