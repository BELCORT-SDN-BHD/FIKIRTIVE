import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getEntities, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls, getMyAds, getMyAdJobs, getRecentGenerationThumbs, getProjects, getAllCoworkThreadMetas } from "@/lib/data";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { getMyAccount } from "@/lib/account-actions";
import { listMemory } from "@/lib/memory-actions";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { getAnalytics } from "@/lib/analytics-actions";
import { OttoApp } from "@/components/otto/OttoApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otto · Fikirtive" };

const VALID_VIEWS = ["otto", "stuff", "library", "templates", "discover", "memory", "account", "connections", "schedule", "analytics"] as const;
type ValidView = (typeof VALID_VIEWS)[number];

export default async function OttoPage({ searchParams }: { searchParams: Promise<{ view?: string; skin?: string; project?: string; thread?: string; new?: string }> }) {
  const sp = await searchParams;
  const rawInitialView: ValidView | undefined = (VALID_VIEWS as readonly string[]).includes(sp?.view ?? "")
    ? (sp!.view as ValidView)
    : undefined;
  const initialView: ValidView | undefined = rawInitialView === "stuff" ? "library" : rawInitialView;
  // Grok-bright is now the official default (cutover). ?skin=fk is an internal
  // rollback escape hatch to the legacy look; everything else gets gb.
  const skin = "gb" as const;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { email, ownerId } = owner;

  // Multi-project (campaign = project): ensure at least one project exists, then
  // pick the active one from ?project= (must be owned) or default to the oldest.
  const ensured = await getOrCreateDefaultProject();
  if ("error" in ensured) redirect("/login");
  const projects = await getProjects(ownerId);
  const requestedProject = sp?.project ? projects.find((p) => p.id === sp.project) : undefined;
  const active = requestedProject || projects[0];
  const projectId = active?.id ?? ensured.id;
  if (sp?.project && !requestedProject) {
    const next = new URLSearchParams();
    next.set("project", projectId);
    if (initialView) next.set("view", initialView);
    redirect(`/otto?${next.toString()}`);
  }

  const [entities, threadRows, accountResult, memory, records, ads, adJobs, history, allThreadRows, analytics] = await Promise.all([
    getEntities(ownerId),
    getCoworkThreads(ownerId, projectId),
    getMyAccount(),
    listMemory(ownerId),
    listBrandRecords(ownerId),
    getMyAds(ownerId),
    getMyAdJobs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getMyAdJobs>>),
    getRecentGenerationThumbs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>),
    getAllCoworkThreadMetas(ownerId).catch(() => [] as Awaited<ReturnType<typeof getAllCoworkThreadMetas>>),
    // Analytics view payload for the Analytics screen (read-only Meta reads; default 30d range).
    // Refined in Task 5; provided here so the required OttoApp `analytics` prop typechecks.
    getAnalytics({}).catch(() => ({ state: "notConnected" as const })),
  ]);

  // Open the requested thread (?thread=, if it's in this project) or the most recent.
  let threads = threadRows.map(toChatThreadMetaDTO);
  const forceNewThread = sp?.new === "1";
  const openThreadId = forceNewThread
    ? undefined
    : (sp?.thread && threadRows.some((t) => t.id === sp.thread)) ? sp.thread : threadRows[0]?.id;
  if (openThreadId) {
    const activeFull = await getCoworkThread(ownerId, openThreadId);
    if (activeFull) {
      const coworkUrls = await resolveCoworkResultUrls(ownerId, [activeFull]);
      const activeDto = toChatThreadDTO(activeFull, coworkUrls);
      threads = threads.map((t) => (t.id === activeDto.id ? activeDto : t));
    }
  }

  // All conversations across every project (metas) for the Grok-style sidebar.
  const sidebarThreads = allThreadRows.map(toChatThreadMetaDTO);
  const projectList = projects.map((p) => ({ id: p.id, name: p.name, pinnedAt: p.pinnedAt ? p.pinnedAt.toISOString() : null }));

  const account = "error" in accountResult ? null : accountResult;
  const balanceUsd = account?.balanceUsd ?? 0;
  const balanceCredits = account?.balance ?? 0; // DISPLAYED credits — the nav shows credits, not $
  const userName = email.split("@")[0];

  // Streaming chat is the single Otto surface for all users (reference-vision rollout, 2026-07-01).
  const ottoStreamEnabled = true;

  return (
    <OttoApp
      key={`${projectId}:${openThreadId ?? ""}`}
      projectId={projectId}
      projects={projectList}
      activeProjectId={projectId}
      sidebarThreads={sidebarThreads}
      initialActiveThreadId={openThreadId ?? null}
      entities={entities.map(toEntityDTO)}
      threads={threads}
      balanceUsd={balanceUsd}
      balanceCredits={balanceCredits}
      userName={userName}
      userEmail={email}
      memory={memory}
      records={records}
      ads={ads}
      adJobs={adJobs}
      account={account}
      analytics={analytics}
      history={history}
      ottoStreamEnabled={ottoStreamEnabled}
      initialView={initialView}
      skin={skin}
    />
  );
}
