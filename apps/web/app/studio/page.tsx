import { ensureDefaultProject, getProjects, getShots, getEntities, getProjectMedia, getCandidates, getGenerationThumbs } from "@/lib/data";
import { getRulesMap } from "@/lib/cowork-knowledge";
import { buildBoardEdit } from "@/lib/edit";
import { toEntityDTO } from "@/lib/dto";
import { artlioEdit, storageKey, storageKeyToSrc } from "@artlio/core";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Studio } from "@/components/studio/Studio";
import type { StudioView } from "@/components/studio/StudioShell";

/** Views that can be deep-linked via ?view= (e.g. /studio?view=elements). */
const STUDIO_VIEWS = new Set(["genspace", "storyboard", "editor", "elements", "assets", "plans", "account"]);

/** Initials + label for the topbar avatar, from the signed-in user. */
function userBadge(name: string | null | undefined, email: string | null | undefined) {
  const label = name?.trim() || email || "You";
  const basis = (name?.trim() || email?.split("@")[0] || "you").replace(/[^a-zA-Z ]/g, " ").trim();
  const parts = basis.split(/\s+/).filter(Boolean);
  const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : basis.slice(0, 2)).toUpperCase();
  return { initials: initials || "Y", label };
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Artlio" };

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
// the worker's i2v fallback only animates these still formats — a gif/avif (or a
// video-only shot) is NOT an animatable source, so Animate must gate on this set
const ANIMATABLE_STILL_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ p?: string; view?: string }> }) {
  const { p, view } = await searchParams;
  const initialView = view && STUDIO_VIEWS.has(view) ? (view as StudioView) : undefined;
  const session = await auth();
  const user = userBadge(session?.user?.name, session?.user?.email);
  const defaultProject = await ensureDefaultProject();
  const [projects, entities] = await Promise.all([getProjects(), getEntities()]);
  // a ?p that matches no owned project (stale/deleted link) → drop it and land on
  // the default, rather than silently showing the oldest project as if intended
  if (p && !projects.some((x) => x.id === p)) redirect(initialView ? `/studio?view=${initialView}` : "/studio");
  const project = projects.find((x) => x.id === p) ?? defaultProject;
  const shots = await getShots(project.id);
  // resolve each segment's first/last keyframe thumbnails (the i2v slots)
  const frameThumbs = await getGenerationThumbs(
    shots.flatMap((s) => [s.firstFrameGenerationId, s.lastFrameGenerationId].filter((x): x is string => !!x)),
  );

  // renumbered "Scene N · Shot M" label per shot id — shared by the Assets badge
  // and the "add to shot" picker so both read the same as the board
  const sceneDisplay: Record<number, number> = {};
  [...new Set(shots.map((s) => s.scene))].sort((a, b) => a - b).forEach((sc, i) => { sceneDisplay[sc] = i + 1; });
  const withinScene: Record<number, number> = {};
  const shotLabelById = new Map<string, string>();
  for (const s of shots) {
    withinScene[s.scene] = (withinScene[s.scene] ?? 0) + 1;
    shotLabelById.set(s.id, `Scene ${sceneDisplay[s.scene]} · Shot ${withinScene[s.scene]}`);
  }

  // storyboard shots: prompt + latest generation image (for the card)
  // shots arrive ordered [scene asc, number asc]; number is a within-scene
  // display index (1..N per scene), decoupled from the stored global number.
  const sceneIdx: Record<number, number> = {};
  const storyboardShots = shots.map((s) => {
    const latest = s.generations[0];
    const img = latest ? storageKeyToSrc(storageKey(latest.asset.ownerId, latest.asset.contentHash, latest.asset.ext)) : null;
    // does this shot have a still the worker could animate (legacy generate→animate)?
    const hasStill = s.generations.some((g) => ANIMATABLE_STILL_EXTS.has(g.asset.ext.toLowerCase()));
    sceneIdx[s.scene] = (sceneIdx[s.scene] ?? 0) + 1;
    return {
      id: s.id,
      number: sceneIdx[s.scene],
      scene: s.scene,
      prompt: s.description ?? "",
      entityIds: s.entityRefs.map((r) => r.entityId),
      promptDoc: s.promptDoc ?? undefined, // seeds the @mention editor
      imageUrl: img && IMAGE_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
      videoUrl: img && VIDEO_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
      hasStill,
      firstFrame: s.firstFrameGenerationId && frameThumbs[s.firstFrameGenerationId] ? { id: s.firstFrameGenerationId, src: frameThumbs[s.firstFrameGenerationId].src } : null,
      lastFrame: s.lastFrameGenerationId && frameThumbs[s.lastFrameGenerationId] ? { id: s.lastFrameGenerationId, src: frameThumbs[s.lastFrameGenerationId].src } : null,
      transition: (s.transition === "in" || s.transition === "out" || s.transition === "both" ? s.transition : null) as "in" | "out" | "both" | null,
    };
  });

  // boardEdit for the editor — attached shot renders in order, plus any unattached
  // Gen-space video clips (so generated footage is available to cut, not just shots)
  const candidates = await getCandidates(project.id);
  const { edit: boardEdit, clipCount } = buildBoardEdit(shots, candidates);
  // image candidates for the Storyboard drag-to-attach strip (drop onto a shot's frame slot)
  const FRAME_IMG_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);
  const frameCandidates = candidates
    .filter((c) => FRAME_IMG_EXTS.has(c.asset.ext.toLowerCase()))
    .map((c) => ({ id: c.id, src: storageKeyToSrc(storageKey(c.asset.ownerId, c.asset.contentHash, c.asset.ext.toLowerCase())) }));
  const savedParse = project.editJson ? artlioEdit.safeParse(project.editJson) : null;
  const savedEdit = savedParse?.success ? savedParse.data : null;

  // Assets library DTOs (client-safe — no BigInt): all generated media, newest first
  const media = (await getProjectMedia(project.id)).map((g) => {
    const ext = g.asset.ext.toLowerCase();
    return {
      id: g.id,
      src: storageKeyToSrc(storageKey(g.asset.ownerId, g.asset.contentHash, ext)),
      kind: VIDEO_EXTS.has(ext) ? ("video" as const) : ("image" as const),
      prompt: g.promptText ?? "",
      attached: g.shotId != null,
      shotLabel: g.shotId ? (shotLabelById.get(g.shotId) ?? null) : null,
    };
  });
  // shot picker labels for "add to shot" (same Scene N · Shot M as the board)
  const shotOptions = shots.map((s) => ({ id: s.id, label: shotLabelById.get(s.id)! }));
  // promptCoach rules (family→mode→rules) — threaded so the composer lints at $0
  const rulesMap = await getRulesMap();

  return (
    <Studio
      project={{ id: project.id, name: project.name }}
      projects={projects.map((x) => ({ id: x.id, name: x.name }))}
      user={user}
      entities={entities.map(toEntityDTO)}
      shots={storyboardShots}
      media={media}
      frameCandidates={frameCandidates}
      shotOptions={shotOptions}
      boardEdit={boardEdit}
      savedEdit={savedEdit}
      attachedCount={clipCount}
      rulesMap={rulesMap}
      initialView={initialView}
    />
  );
}
