"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }
>({
  size: "default",
  variant: "default",
  spacing: 0,
})

type ToggleGroupBaseProps = Omit<
  ToggleGroupPrimitive.Props,
  "defaultValue" | "multiple" | "onValueChange" | "value"
>

type ToggleGroupSingleProps = ToggleGroupBaseProps & {
  type?: "single"
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}

type ToggleGroupMultipleProps = ToggleGroupBaseProps & {
  type: "multiple"
  defaultValue?: string[]
  value?: string[]
  onValueChange?: (value: string[]) => void
}

type ToggleGroupProps = (ToggleGroupSingleProps | ToggleGroupMultipleProps) &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
  }

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0,
  type = "single",
  defaultValue,
  value,
  onValueChange,
  children,
  ...props
}: ToggleGroupProps) {
  const multiple = type === "multiple"
  const baseValue = multiple
    ? (value as string[] | undefined)
    : value === undefined
      ? undefined
      : [value as string]
  const baseDefaultValue = multiple
    ? (defaultValue as string[] | undefined)
    : defaultValue === undefined
      ? undefined
      : [defaultValue as string]

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        "group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
        className
      )}
      multiple={multiple}
      value={baseValue}
      defaultValue={baseDefaultValue}
      onValueChange={(nextValue) => {
        if (multiple) {
          ;(onValueChange as ((next: string[]) => void) | undefined)?.(nextValue)
        } else {
          ;(onValueChange as ((next: string) => void) | undefined)?.(nextValue[0] ?? "")
        }
      }}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10",
        "data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
