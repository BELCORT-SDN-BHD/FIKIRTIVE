import { getEntities } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { Studio } from "@/components/studio/Studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Artlio" };

// Redesign-shell route. Elements is wired to real data; other surfaces are
// mock until their engine slice lands.
export default async function StudioPage() {
  const entities = await getEntities();
  return <Studio entities={entities.map(toEntityDTO)} />;
}
