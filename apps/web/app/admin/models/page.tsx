import { redirect } from "next/navigation";
import { GEN_MODELS, GEN_VIDEO_MODELS, REFGEN_MODELS, MODEL_FAMILIES, modelFamily, FOUNDER_OWNER_ID } from "@artlio/core";
import { prisma } from "@artlio/db";
import { requireRole } from "@/lib/auth-guard";
import { listDirectives } from "@/lib/cowork-knowledge";
import { ModelsAdmin, type ModelRow } from "@/components/admin/ModelsAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Models · Artlio admin" };

export default async function ModelsPage() {
  // §① Model & provider read = viewer/ops (or super-admin). requireRole re-asserts the
  // allowlist outer wall + the section→role matrix, and audits a denied read.
  const gate = await requireRole("model", "read");
  if ("error" in gate) redirect("/login?from=/admin/models");

  // overlay (disabled set) — keyed by modelId
  const overlay = await prisma.modelRegistryOverlay.findMany({ where: { ownerId: FOUNDER_OWNER_ID }, select: { modelId: true, enabled: true, notes: true } });
  const byId = new Map(overlay.map((o) => [o.modelId, o]));

  // iterate the typed catalogs (capability truth). Image = the seedream toggle shared
  // by GEN_MODELS + REFGEN_MODELS (deduped); video = GEN_VIDEO_MODELS.
  const imageIds = Array.from(new Set<string>([...GEN_MODELS, ...REFGEN_MODELS]));
  const videoRows: ModelRow[] = (GEN_VIDEO_MODELS as readonly string[]).map((id) => ({
    id, kind: "video", family: modelFamily(id) ?? "?", enabled: byId.get(id)?.enabled ?? true, notes: byId.get(id)?.notes ?? "",
  }));
  const imageRows: ModelRow[] = imageIds.map((id) => ({
    id, kind: "image", family: modelFamily(id) ?? "?", enabled: byId.get(id)?.enabled ?? true, notes: byId.get(id)?.notes ?? "",
  }));

  // per-family directive coverage metric: which routed video families have ≥1 enabled cell
  const directives = await listDirectives();
  const seededFamilies = new Set(directives.filter((d) => d.enabled && d.directive.trim()).map((d) => d.family));
  const routedFamilies = Array.from(new Set((GEN_VIDEO_MODELS as readonly string[]).map((m) => modelFamily(m)).filter(Boolean))) as string[];
  const coverage = routedFamilies.map((f) => ({ family: f, covered: seededFamilies.has(f) }));

  return <ModelsAdmin imageRows={imageRows} videoRows={videoRows} coverage={coverage} families={[...MODEL_FAMILIES]} />;
}
