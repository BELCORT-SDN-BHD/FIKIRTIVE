import { ensureDefaultProject, getProjects, getShots } from "@/lib/data";
import { EditorShell } from "@/components/EditorShell";
import type { ArtlioEdit } from "@artlio/core";
import { artlioEdit, storageKeyToSrc, storageKey } from "@artlio/core";

export const dynamic = "force-dynamic";

export const metadata = { title: "Editor · Artlio" };

/** Initial cut = every shot's latest attached render in board order.
 *  MOCK durations (videos 5s, images 3s) until worker ffprobe lands in the
 *  meat phase — the only mock left standing, scoped and labeled. */
const MOCK_VIDEO_SECONDS = 5;
const MOCK_IMAGE_SECONDS = 3;

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const defaultProject = await ensureDefaultProject();
  const projects = await getProjects();
  const project = projects.find((x) => x.id === p) ?? defaultProject;
  const shots = await getShots(project.id);

  const clips: ArtlioEdit["timeline"]["tracks"][number]["clips"] = [];
  let cursor = 0;
  for (const shot of shots) {
    const latest = shot.generations[0]; // version desc, attached only
    if (!latest) continue;
    // ingest lowercases extensions at both write sites; normalize anyway
    const ext = latest.asset.ext.toLowerCase();
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isVideo && !IMAGE_EXTS.has(ext)) continue;
    const length = isVideo ? MOCK_VIDEO_SECONDS : MOCK_IMAGE_SECONDS;
    clips.push({
      asset: {
        type: isVideo ? "video" : "image",
        src: storageKeyToSrc(storageKey(latest.asset.ownerId, latest.asset.contentHash, ext)),
      },
      start: cursor,
      length,
    });
    cursor += length;
  }

  const boardEdit: ArtlioEdit | null =
    clips.length > 0
      ? {
          timeline: { background: "#000000", tracks: [{ clips }] },
          output: { format: "mp4", resolution: "1080", aspectRatio: "16:9", fps: 25 },
        }
      : null;

  // the persisted working cut wins; stored canonical, re-checked anyway
  const savedParse = project.editJson ? artlioEdit.safeParse(project.editJson) : null;
  const savedEdit = savedParse?.success ? savedParse.data : null;

  return (
    <div className="flex flex-col h-dvh">
      <div className="lg:hidden bg-accent-soft text-ink text-sm px-4 py-2 text-center" role="status">
        Artlio works best on a desktop browser — this view is read-only.
      </div>
      <EditorShell
        project={{ id: project.id, name: project.name }}
        projects={projects.map((x) => ({ id: x.id, name: x.name }))}
        boardEdit={boardEdit}
        savedEdit={savedEdit}
        attachedCount={clips.length}
      />
    </div>
  );
}
