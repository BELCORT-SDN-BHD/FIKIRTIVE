import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * One visual contract for Otto actions that are about to spend credits.
 * Business gates stay in the owning card; this component only makes the quote,
 * consequence, and actions read in the same order everywhere.
 */
export function SpendConfirmation({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert variant="warning" density="compact" className={className}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{description}</p>
        <div className="flex flex-wrap gap-2 pt-1">{children}</div>
      </AlertDescription>
    </Alert>
  );
}

/** Shared pending state for a paid Otto action after the merchant approves it. */
export function SpendProgress({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  className?: string;
}) {
  return (
    <Alert role="status" density="compact" className={cn("text-muted-foreground", className)}>
      <Spinner aria-hidden="true" />
      <AlertTitle className="text-foreground">{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
