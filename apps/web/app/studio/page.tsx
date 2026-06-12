import { ensureDefaultProject, getProjects, getShots, getEntities, getProjectMedia } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { artlioEdit, storageKey, storageKeyToSrc, type ArtlioEdit } from "@artlio/core";
import { auth } from "@/auth";
import { Studio } from "@/components/studio/Studio";

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
const IMAGE_SECONDS = 3;
const FALLBACK_VIDEO_SECONDS = 5;

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const session = await auth();
  const user = userBadge(session?.user?.name, session?.user?.email);
  const defaultProject = await ensureDefaultProject();
  const [projects, entities] = await Promise.all([getProjects(), getEntities()]);
  const project = projects.find((x) => x.id === p) ?? defaultProject;
  const shots = await getShots(project.id);

  // storyboard shots: prompt + latest generation image (for the card)
  // shots arrive ordered [scene asc, number asc]; number is a within-scene
  // display index (1..N per scene), decoupled from the stored global number.
  const sceneIdx: Record<number, number> = {};
  const storyboardShots = shots.map((s) => {
    const latest = s.generations[0];
    const img = latest ? storageKeyToSrc(storageKey(latest.asset.ownerId, latest.asset.contentHash, latest.asset.ext)) : null;
    sceneIdx[s.scene] = (sceneIdx[s.scene] ?? 0) + 1;
    return {
      id: s.id,
      number: sceneIdx[s.scene],
      scene: s.scene,
      prompt: s.description ?? "",
      entityIds: s.entityRefs.map((r) => r.entityId),
      imageUrl: img && IMAGE_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
      videoUrl: img && VIDEO_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
    };
  });

  // boardEdit for the editor (each shot's latest generation, in order)
  const clips: ArtlioEdit["timeline"]["tracks"][number]["clips"] = [];
  let cursor = 0;
  for (const shot of shots) {
    const latest = shot.generations[0];
    if (!latest) continue;
    const ext = latest.asset.ext.toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isVideo && !IMAGE_EXTS.has(ext)) continue;
    const length = isVideo ? (latest.asset.durationS ?? FALLBACK_VIDEO_SECONDS) : IMAGE_SECONDS;
    clips.push({ asset: { type: isVideo ? "video" : "image", src: storageKeyToSrc(storageKey(latest.asset.ownerId, latest.asset.contentHash, ext)) }, start: cursor, length });
    cursor += length;
  }
  const boardEdit: ArtlioEdit | null = clips.length > 0
    ? { timeline: { background: "#000000", tracks: [{ clips }] }, output: { format: "mp4", resolution: "1080", aspectRatio: "16:9", fps: 25 } }
    : null;
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
    };
  });
  // shot picker labels for "add to shot", matching the board's Scene N · Shot M
  const sceneDisplay: Record<number, number> = {};
  [...new Set(shots.map((s) => s.scene))].sort((a, b) => a - b).forEach((sc, i) => { sceneDisplay[sc] = i + 1; });
  const withinScene: Record<number, number> = {};
  const shotOptions = shots.map((s) => {
    withinScene[s.scene] = (withinScene[s.scene] ?? 0) + 1;
    return { id: s.id, label: `Scene ${sceneDisplay[s.scene]} · Shot ${withinScene[s.scene]}` };
  });

  return (
    <Studio
      project={{ id: project.id, name: project.name }}
      projects={projects.map((x) => ({ id: x.id, name: x.name }))}
      user={user}
      entities={entities.map(toEntityDTO)}
      shots={storyboardShots}
      media={media}
      shotOptions={shotOptions}
      boardEdit={boardEdit}
      savedEdit={savedEdit}
      attachedCount={clips.length}
    />
  );
}
