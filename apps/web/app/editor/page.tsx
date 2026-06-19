import { redirect } from "next/navigation";
import { ensureDefaultProject, getProjects, getShots, getCandidates } from "@/lib/data";
import { buildBoardEdit } from "@/lib/edit";
import { EditorShell } from "@/components/EditorShell";
import { artlioEdit } from "@artlio/core";
import { auth, allowed } from "@/auth";
import { requireOwner } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Editor · Artlio" };

export default async function EditorPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const session = await auth();
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;
  const defaultProject = await ensureDefaultProject(ownerId);
  const projects = await getProjects(ownerId);
  if (p && !projects.some((x) => x.id === p)) redirect("/editor"); // stale link → clean default
  const project = projects.find((x) => x.id === p) ?? defaultProject;
  // initial cut = attached shot renders (board order) + unattached Gen-space clips
  const [shots, candidates] = await Promise.all([getShots(ownerId, project.id), getCandidates(ownerId, project.id)]);
  const { edit: boardEdit, clipCount } = buildBoardEdit(shots, candidates);

  // the persisted working cut wins; stored canonical, re-checked anyway
  const savedParse = project.editJson ? artlioEdit.safeParse(project.editJson) : null;
  const savedEdit = savedParse?.success ? savedParse.data : null;

  return (
    <div className="flex flex-col h-dvh">
      <div className="lg:hidden bg-accent-soft text-ink text-sm px-4 py-2 text-center" role="status">
        Artlio works best on a desktop browser — this view is read-only.
      </div>
      <EditorShell
        project={{ id: project.id, name: project.name, coworkBrief: project.coworkBrief ?? null }}
        editedAt={project.updatedAt.toISOString()}
        projects={projects.map((x) => ({ id: x.id, name: x.name, coworkBrief: x.coworkBrief ?? null }))}
        boardEdit={boardEdit}
        savedEdit={savedEdit}
        attachedCount={clipCount}
      />
    </div>
  );
}
