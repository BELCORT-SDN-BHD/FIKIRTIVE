import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function MemorySourceBadge({ source }: { source: "otto" | "user" }) {
  if (source === "otto") {
    return (
      <Badge variant="otto-soft">
        <Sparkles aria-hidden />
        Otto learned
      </Badge>
    );
  }

  return <Badge variant="default">You added</Badge>;
}
