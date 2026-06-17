import { auth, allowed } from "@/auth";
import { redirect } from "next/navigation";
import { resolveVisionConfig } from "@/lib/runtime-config";
import { prisma } from "@artlio/db";
import { SettingsAdmin } from "@/components/admin/SettingsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Artlio admin" };

export default async function SettingsPage() {
  // defense-in-depth: re-assert auth in-page (not only via the admin layout),
  // mirroring /admin/directives, before any DB read.
  const session = await auth();
  if (!allowed(session?.user?.email)) redirect("/login");
  const vision = await resolveVisionConfig();
  const providerRow = await prisma.runtimeConfig.findUnique({ where: { key: "cowork_provider" } });
  const provider =
    (providerRow?.valueJson as { provider?: string } | null)?.provider ??
    (process.env.COWORK_PROVIDER ?? "mock");
  return <SettingsAdmin vision={vision} provider={provider} />;
}
