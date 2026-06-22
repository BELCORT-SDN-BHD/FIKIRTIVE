import { getEntities, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls, getRecordedOutcomeGenerationIds } from "@/lib/data";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { Cowork } from "@/components/studio/Cowork";

export const dynamic = "force-dynamic";
export const metadata = { title: "Make a video · Fikirtive" };

/** Simple Mode merchant surface: single default project, Otto chat, no studio chrome.
 *  Behind the same closed-beta auth wall as /studio (requireOwner → allowlist). */
export default async function SimplePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  const projectResult = await getOrCreateDefaultProject();
  if ("error" in projectResult) redirect("/login");
  const { id: projectId } = projectResult;

  const [entities, threadRows, recordedOutcomes] = await Promise.all([
    getEntities(ownerId),
    getCoworkThreads(ownerId, projectId),
    getRecordedOutcomeGenerationIds(ownerId),
  ]);

  // Eager-load the most-recent thread so the chat shows immediately (mirrors studio/page.tsx).
  let threads = threadRows.map(toChatThreadMetaDTO);
  if (threadRows[0]) {
    const activeFull = await getCoworkThread(ownerId, threadRows[0].id);
    if (activeFull) {
      const coworkUrls = await resolveCoworkResultUrls(ownerId, [activeFull]);
      const activeDto = toChatThreadDTO(activeFull, coworkUrls);
      threads = threads.map((t) => (t.id === activeDto.id ? activeDto : t));
    }
  }

  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Cowork
        projectId={projectId}
        entities={entities.map(toEntityDTO)}
        threads={threads}
        recordedOutcomes={recordedOutcomes}
        simple
      />
    </main>
  );
}
