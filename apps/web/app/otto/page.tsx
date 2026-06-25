import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getEntities, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls } from "@/lib/data";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { getMyAccount } from "@/lib/account-actions";
import { OttoApp } from "@/components/otto/OttoApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otto · Fikirtive" };

export default async function OttoPage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { email, ownerId } = owner;

  const projectResult = await getOrCreateDefaultProject();
  if ("error" in projectResult) redirect("/login");
  const { id: projectId } = projectResult;

  const [entities, threadRows, accountResult] = await Promise.all([
    getEntities(ownerId),
    getCoworkThreads(ownerId, projectId),
    getMyAccount(),
  ]);

  // Eager-load the most-recent thread so the conversation shows immediately (mirrors /m pattern).
  let threads = threadRows.map(toChatThreadMetaDTO);
  if (threadRows[0]) {
    const activeFull = await getCoworkThread(ownerId, threadRows[0].id);
    if (activeFull) {
      const coworkUrls = await resolveCoworkResultUrls(ownerId, [activeFull]);
      const activeDto = toChatThreadDTO(activeFull, coworkUrls);
      threads = threads.map((t) => (t.id === activeDto.id ? activeDto : t));
    }
  }

  const balanceUsd = "error" in accountResult ? 0 : accountResult.balanceUsd;
  const userName = email.split("@")[0];

  return (
    <OttoApp
      projectId={projectId}
      entities={entities.map(toEntityDTO)}
      threads={threads}
      balanceUsd={balanceUsd}
      userName={userName}
      userEmail={email}
    />
  );
}
