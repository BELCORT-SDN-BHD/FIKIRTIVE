/** `/create` is the controlled Otto entry plus Canvas history; auth and data stay in the entry. */

import { Suspense } from "react";
import type { Metadata } from "next";
import { CreateWorkspaceEntry } from "@/components/start-something/CreateWorkspaceEntry";
import { DeepLinkFallback } from "@/components/northstar/immersive/deeplink-fallback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create · Fikirtive",
};

export default function Page() {
  return (
    <Suspense fallback={<DeepLinkFallback />}>
      <CreateWorkspaceEntry />
    </Suspense>
  );
}
