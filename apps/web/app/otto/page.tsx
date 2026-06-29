import { redirect } from "next/navigation";
import { isFounderAdmin } from "@/lib/allowlist";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getEntities, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls, getMyAds, getMyAdJobs } from "@/lib/data";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { getMyAccount } from "@/lib/account-actions";
import { listMemory } from "@/lib/memory-actions";
import { OttoApp } from "@/components/otto/OttoApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otto · Fikirtive" };

const VALID_VIEWS = ["otto", "stuff", "library", "templates", "discover", "memory", "account", "connections"] as const;
type ValidView = (typeof VALID_VIEWS)[number];

export default async function OttoPage({ searchParams }: { searchParams: Promise<{ view?: string; skin?: string }> }) {
  const sp = await searchParams;
  const initialView: ValidView | undefined = (VALID_VIEWS as readonly string[]).includes(sp?.view ?? "")
    ? (sp!.view as ValidView)
    : undefined;
  // Strangler flag: ?skin=gb opts into the Grok-bright re-skin; default stays the old look.
  const skin = sp?.skin === "gb" ? ("gb" as const) : undefined;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { email, ownerId } = owner;

  const projectResult = await getOrCreateDefaultProject();
  if ("error" in projectResult) redirect("/login");
  const { id: projectId } = projectResult;

  const [entities, threadRows, accountResult, memory, ads, adJobs] = await Promise.all([
    getEntities(ownerId),
    getCoworkThreads(ownerId, projectId),
    getMyAccount(),
    listMemory(ownerId),
    getMyAds(ownerId, projectId),
    getMyAdJobs(ownerId, projectId).catch(() => [] as Awaited<ReturnType<typeof getMyAdJobs>>),
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

  const account = "error" in accountResult ? null : accountResult;
  const balanceUsd = account?.balanceUsd ?? 0;
  const balanceCredits = account?.balance ?? 0; // DISPLAYED credits — the nav shows credits, not $
  const userName = email.split("@")[0];

  // Founder-first streaming chat. Temporary flag (deleted in Task 8 once verified).
  const ottoStreamEnabled = isFounderAdmin(email);

  return (
    <OttoApp
      projectId={projectId}
      entities={entities.map(toEntityDTO)}
      threads={threads}
      balanceUsd={balanceUsd}
      balanceCredits={balanceCredits}
      userName={userName}
      userEmail={email}
      memory={memory}
      ads={ads}
      adJobs={adJobs}
      account={account}
      ottoStreamEnabled={ottoStreamEnabled}
      initialView={initialView}
      skin={skin}
    />
  );
}
