import { kindOf, storage } from "@/lib/storage";
import {
  ensureDefaultProject,
  getProjects,
  getEntities,
  getShots,
  getCandidates,
} from "@/lib/data";
import { assetUrl, toEntityDTO } from "@/lib/dto";
import type { GenerationDTO, ProjectDTO, ShotDTO } from "@/lib/types";
import { Workbench } from "@/components/Workbench";

export const dynamic = "force-dynamic";

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

  const entityDTOs = entities.map(toEntityDTO);

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
      directUpload={storage.supportsDirectUpload}
    />
  );
}
