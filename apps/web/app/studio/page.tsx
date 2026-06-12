import { ensureDefaultProject, getProjects, getShots, getEntities, getProjectMedia, getCandidates } from "@/lib/data";
import { buildBoardEdit } from "@/lib/edit";
import { toEntityDTO } from "@/lib/dto";
import { artlioEdit, storageKey, storageKeyToSrc } from "@artlio/core";
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

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ p?: string; view?: string }> }) {
  const { p, view } = await searchParams;
  const initialView = view && STUDIO_VIEWS.has(view) ? (view as StudioView) : undefined;
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
      promptDoc: s.promptDoc ?? undefined, // seeds the @mention editor
      imageUrl: img && IMAGE_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
      videoUrl: img && VIDEO_EXTS.has(latest!.asset.ext.toLowerCase()) ? img : null,
    };
  });

  // boardEdit for the editor — attached shot renders in order, plus any unattached
  // Gen-space video clips (so generated footage is available to cut, not just shots)
  const candidates = await getCandidates(project.id);
  const { edit: boardEdit, clipCount } = buildBoardEdit(shots, candidates);
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
      attachedCount={clipCount}
      initialView={initialView}
    />
  );
}
