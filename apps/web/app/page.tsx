import { storageKey } from "@artlio/core";
import { storage, kindOf } from "@/lib/storage";
import {
  ensureDefaultProject,
  getProjects,
  getEntities,
  getShots,
  getCandidates,
} from "@/lib/data";
import type { EntityDTO, GenerationDTO, ProjectDTO, ShotDTO } from "@/lib/types";
import { Workbench } from "@/components/Workbench";

export const dynamic = "force-dynamic";

function assetUrl(ownerId: string, contentHash: string, ext: string) {
  return storage.url(storageKey(ownerId, contentHash, ext));
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const defaultProject = await ensureDefaultProject();
  const projects = await getProjects();
  const project = projects.find((x) => x.id === p) ?? defaultProject;

  const [entities, shots, candidates] = await Promise.all([
    getEntities(),
    getShots(project.id),
    getCandidates(project.id),
  ]);

  const entityDTOs: EntityDTO[] = entities.map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    notes: e.notes,
    negativeConstraints: e.negativeConstraints,
    refs: e.referenceImages.map((r) => ({
      id: r.id,
      url: assetUrl(r.asset.ownerId, r.asset.contentHash, r.asset.ext),
      kind: kindOf(r.asset.ext),
    })),
    usageCount: e._count.shotRefs,
  }));

  const toGenDTO = (g: (typeof candidates)[number]): GenerationDTO => ({
    id: g.id,
    version: g.version,
    promptText: g.promptText,
    createdAt: g.createdAt.toISOString(),
    url: assetUrl(g.asset.ownerId, g.asset.contentHash, g.asset.ext),
    kind: kindOf(g.asset.ext),
    filename: g.asset.originalFilename,
  });

  const shotDTOs: ShotDTO[] = shots.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    status: s.status,
    promptDoc: s.promptDoc,
    promptText: s.description,
    entityIds: s.entityRefs.map((r) => r.entityId),
    generations: s.generations.map(toGenDTO),
  }));

  const projectDTOs: ProjectDTO[] = projects.map((x) => ({ id: x.id, name: x.name }));

  return (
    <Workbench
      key={project.id} // reset client selection state when switching projects
      project={{ id: project.id, name: project.name }}
      projects={projectDTOs}
      entities={entityDTOs}
      shots={shotDTOs}
      candidates={candidates.map(toGenDTO)}
    />
  );
}
