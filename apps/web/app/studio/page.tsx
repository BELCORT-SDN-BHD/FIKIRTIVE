import { getEntities, getProjects } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { Studio } from "@/components/studio/Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Artlio" };

// Redesign-shell route. Elements + Gen space are wired to real data; other
// surfaces are mock until their engine slice lands.
export default async function StudioPage() {
  const [entities, projects] = await Promise.all([getEntities(), getProjects()]);
  return (
    <Studio
      entities={entities.map(toEntityDTO)}
      projectId={projects[0]?.id ?? null}
    />
  );
}
