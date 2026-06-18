import { redirect } from "next/navigation";
import { resolveVisionConfig } from "@/lib/runtime-config";
import { prisma } from "@artlio/db";
import { requireRole } from "@/lib/auth-guard";
import { SettingsAdmin } from "@/components/admin/SettingsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Artlio admin" };

export default async function SettingsPage() {
  // §① Model & provider read = viewer/ops (or super-admin). requireRole re-asserts the
  // allowlist outer wall + the section→role matrix (not only the admin layout), and
  // audits a denied read, before any DB read.
  const gate = await requireRole("model", "read");
  if ("error" in gate) redirect("/login");
  // modal provider is super-admin only (saveRuntimeConfig enforces it server-side too)
  const canModal = gate.role === "super-admin";
  const vision = await resolveVisionConfig();
  const providerRow = await prisma.runtimeConfig.findUnique({ where: { key: "cowork_provider" } });
  const provider =
    (providerRow?.valueJson as { provider?: string } | null)?.provider ??
    (process.env.COWORK_PROVIDER ?? "mock");
  return <SettingsAdmin vision={vision} provider={provider} canModal={canModal} />;
}
