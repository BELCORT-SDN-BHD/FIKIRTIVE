import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { HomeDashboardChange } from "@/design-system/patterns/founder-home/model";
import { cn } from "@/lib/utils";

export function HomeMetricChange({ change }: { change: HomeDashboardChange | null }) {
  if (!change) return null;
  const Icon = change.direction === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs font-medium",
      change.direction === "up" ? "text-success-soft-foreground" : "text-muted-foreground",
    )}>
      <Icon className="size-3.5" aria-hidden /> {change.value}
    </span>
  );
}
