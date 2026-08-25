import * as React from "react"

import { cn } from "@/lib/utils"

function SelectNative({ className, unstyled = false, ...props }: React.ComponentProps<"select"> & { unstyled?: boolean }) {
  return (
    <select
      data-slot="native-select"
      className={unstyled ? className : cn("h-11 rounded-lg border border-input bg-card px-3 text-sm", className)}
      {...props}
    />
  )
}

export { SelectNative }
