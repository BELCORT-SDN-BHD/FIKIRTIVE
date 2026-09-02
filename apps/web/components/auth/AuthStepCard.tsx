import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** One interaction step inside the shared Auth shell. */
export function AuthStepCard({
  children,
  description,
  footer,
  title,
}: {
  children: ReactNode;
  description: ReactNode;
  footer?: ReactNode;
  title: ReactNode;
}) {
  return (
    <Card className="gap-5 border-border/90 p-7 shadow-[var(--shadow-md)] sm:p-8">
      <CardHeader className="items-center text-center">
        <CardTitle>
          <h1 className="text-[24px] font-bold tracking-[-0.025em]">{title}</h1>
        </CardTitle>
        <CardDescription className="max-w-[310px] leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter className="justify-center">{footer}</CardFooter> : null}
    </Card>
  );
}
