import { ensureDefaultProject, getProjects, getShots, getEntities, getMediaPage, getLooseVideoClips, getFrameCandidates, getGenerationThumbs, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls } from "@/lib/data";
import { getRulesMap } from "@/lib/cowork-knowledge";
import { buildBoardEdit } from "@/lib/edit";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { fikirtiveEdit, storageKey, storageKeyToSrc } from "@fikirtive/core";
import { redirect } from "next/navigation";
import { auth } from "@/lib/better-auth/compat";
import { requireOwner } from "@/lib/auth-guard";
import { Studio } from "@/components/studio/Studio";
import type { StudioView } from "@/components/studio/StudioShell";

/** Views that can be deep-linked via ?view= (e.g. /studio?view=elements). */
const STUDIO_VIEWS = new Set(["genspace", "storyboard", "editor", "elements", "assets", "cowork", "plans", "account"]);

/** Initials + label for the topbar avatar, from the signed-in user. */
function userBadge(name: string | null | undefined, email: string | null | undefined) {
  const label = name?.trim() || email || "You";
  const basis = (name?.trim() || email?.split("@")[0] || "you").replace(/[^a-zA-Z ]/g, " ").trim();
  const parts = basis.split(/\s+/).filter(Boolean);
  const initials = (parts.length >= 2 ? parts[0][0] + parts[1][0] : basis.slice(0, 2)).toUpperCase();
  return { initials: initials || "Y", label };
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Fikirtive" };

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
// the worker's i2v fallback only animates these still formats — a gif/avif (or a
// video-only shot) is NOT an animatable source, so Animate must gate on this set
const ANIMATABLE_STILL_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ p?: string; view?: string }> }) {
  const { p, view } = await searchParams;
  const initialView = view && STUDIO_VIEWS.has(view) ? (view as StudioView) : undefined;
  const session = await auth();
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");

  // Deprecation redirect: /studio and all non-editor views → /otto.
  // Only /studio?view=editor still renders the Studio surface.
  // TODO(future): migrate the editor itself into /otto (larger effort).
  if (view !== "editor") redirect("/otto");
  const { ownerId } = owner;
  const user = userBadge(session?.user?.name, session?.user?.email);
  const defaultProject = await ensureDefaultProject(ownerId);
  const [projects, entities] = await Promise.all([getProjects(ownerId), getEntities(ownerId)]);
  // a ?p that matches no owned project (stale/deleted link) → drop it and land on
  // the default, rather than silently showing the oldest project as if intended
  if (p && !projects.some((x) => x.id === p)) redirect(initialView ? `/studio?view=${initialView}` : "/studio");
  const project = projects.find((x) => x.id === p) ?? defaultProject;
  // Cowork: thread LIST is metadata only (no eager messages → page load stays O(threads)).
  // Eager-load just the most-recent thread (the one Cowork opens to) so its chat shows
  // immediately; every other thread's messages lazy-load on select via getCoworkThreadClient.
  const threadRows = await getCoworkThreads(ownerId, project.id);
  let threads = threadRows.map(toChatThreadMetaDTO);
  if (threadRows[0]) {
    const activeFull = await getCoworkThread(ownerId, threadRows[0].id);
    if (activeFull) {
      const coworkUrls = await resolveCoworkResultUrls(ownerId, [activeFull]);
      const activeDto = toChatThreadDTO(activeFull, coworkUrls);
      threads = threads.map((t) => (t.id === activeDto.id ? activeDto : t));
    }
  }
  const shots = await getShots(ownerId, project.id);
  // resolve each segment's first/last keyframe thumbnails (the i2v slots)
  const frameThumbs = await getGenerationThumbs(ownerId,
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
  const looseClips = await getLooseVideoClips(ownerId, project.id);
  const { edit: boardEdit, clipCount } = buildBoardEdit(shots, looseClips);
  // image candidates for the Storyboard drag-to-attach strip (drop onto a shot's frame slot)
  const frameCandidates = (await getFrameCandidates(ownerId, project.id))
    .map((c) => ({ id: c.id, src: storageKeyToSrc(storageKey(c.asset.ownerId, c.asset.contentHash, c.asset.ext.toLowerCase())) }));
  const savedParse = project.editJson ? fikirtiveEdit.safeParse(project.editJson) : null;
  const savedEdit = savedParse?.success ? savedParse.data : null;

  // Assets library DTOs (client-safe — no BigInt): first keyset page, newest first.
  // The Assets surface appends further pages via the loadMoreMedia action (scales to any size).
  const mediaPage = await getMediaPage(ownerId, project.id);
  // shot picker labels for "add to shot" (same Scene N · Shot M as the board)
  const shotOptions = shots.map((s) => ({ id: s.id, label: shotLabelById.get(s.id)! }));
  // promptCoach rules (family→mode→rules) — threaded so the composer lints at $0
  const rulesMap = await getRulesMap();

  return (
    <Studio
      project={{ id: project.id, name: project.name, coworkBrief: project.coworkBrief ?? null }}
      projects={projects.map((x) => ({ id: x.id, name: x.name, coworkBrief: x.coworkBrief ?? null }))}
      user={user}
      entities={entities.map(toEntityDTO)}
      shots={storyboardShots}
      media={mediaPage.items}
      mediaCursor={mediaPage.nextCursor}
      mediaHasMore={mediaPage.hasMore}
      frameCandidates={frameCandidates}
      shotOptions={shotOptions}
      boardEdit={boardEdit}
      savedEdit={savedEdit}
      attachedCount={clipCount}
      editedAt={project.updatedAt.toISOString()}
      rulesMap={rulesMap}
      threads={threads}
      initialView={initialView}
    />
  );
}
