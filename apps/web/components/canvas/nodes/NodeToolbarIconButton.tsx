import type * as React from "react";
import type { ReactNode } from "react";

import { TooltipButton } from "@/components/ui/tooltip-button";

export function NodeToolbarIconButton({
  label,
  visibleLabel,
  tooltip,
  variant = "secondary",
  children,
  ...props
}: Omit<React.ComponentProps<typeof TooltipButton>, "label" | "tooltip" | "size" | "variant"> & {
  label: string;
  visibleLabel: string;
  tooltip?: ReactNode;
  variant?: React.ComponentProps<typeof TooltipButton>["variant"];
  children: ReactNode;
}) {
  return (
    <TooltipButton
      label={label}
      tooltip={tooltip ?? visibleLabel}
      variant={variant}
      size="icon-xs"
      className="nodrag nopan"
      {...props}
    >
      {children}
      <span className="sr-only">{visibleLabel}</span>
    </TooltipButton>
  );
}
