"use client";

import * as React from "react";
import { MonitorUp } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/design-system/primitives/empty";

export function useDesktopHome() {
  const [isDesktop, setIsDesktop] = React.useState(true);

  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 1180px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

export function DesktopHomeRequired() {
  return (
    <main className="flex min-h-[calc(100dvh-2.75rem)] items-center justify-center px-6">
      <Empty className="max-w-lg border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MonitorUp /></EmptyMedia>
          <EmptyTitle>Home works best on desktop</EmptyTitle>
          <EmptyDescription>Open Fikirtive on a larger screen to review your marketing performance.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  );
}
