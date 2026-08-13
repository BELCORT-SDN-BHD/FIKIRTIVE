import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getOrCreateDefaultProject } from "@/lib/actions";
import { getEntities, getCoworkThreads, getCoworkThread, resolveCoworkResultUrls, getMyAds, getMyAdJobs, getRecentGenerationThumbs, getProjects, getAllCoworkThreadMetas } from "@/lib/data";
import { toEntityDTO, toChatThreadDTO, toChatThreadMetaDTO } from "@/lib/dto";
import { getMyAccount } from "@/lib/account-actions";
import { getMyProfileNames } from "@/lib/profile-names";
import { ottoGreetingNameFromProfile } from "@/lib/otto-greeting";
import { listMemory } from "@/lib/memory-actions";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { getAnalytics } from "@/lib/analytics-actions";
import { getOwnerSettings } from "@/lib/owner-settings-actions";
import { DEFAULT_SETTINGS } from "@/lib/owner-settings";
import { OttoApp } from "@/components/otto/OttoApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Otto · Fikirtive" };

const VALID_VIEWS = ["otto", "stuff", "library", "edit", "templates", "discover", "memory", "account", "connections", "schedule", "analytics"] as const;
type ValidView = (typeof VALID_VIEWS)[number];

export default async function OttoPage({ searchParams }: { searchParams: Promise<{ view?: string; project?: string; thread?: string; new?: string }> }) {
  const sp = await searchParams;
  const rawInitialView: ValidView | undefined = (VALID_VIEWS as readonly string[]).includes(sp?.view ?? "")
    ? (sp!.view as ValidView)
    : undefined;
  const initialView: ValidView | undefined = rawInitialView === "stuff" ? "library" : rawInitialView;
  // Grok-bright ("gb") is the only skin — hardcoded, no rollback param.
  const skin = "gb" as const;

  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  // Multi-project navigation (#546: a Project is never a Campaign — the Campaign object
  // is independent, see CONTEXT.md): ensure at least one project exists, then pick the
  // active one from ?project= (must be owned) or default to the oldest.
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

  const [entities, threadRows, accountResult, memory, records, ads, adJobs, history, allThreadRows, analytics, userName, settingsResult] = await Promise.all([
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
    // #542 — the greeting's name, resolved from the merchant's own two names so that the moment
    // they set either one on /profile the greeting starts using it. The helper owns the whole
    // step including the `.catch`: a Prisma fault REJECTS rather than returning {error}, and an
    // un-caught rejection in this Promise.all would take the entire page down (round-2 P2).
    ottoGreetingNameFromProfile(getMyProfileNames),
    // #679 — the "Get Otto ready" card's dismissal, read from the workspace's own row rather
    // than from this browser's localStorage. A failed read falls back to the defaults, which
    // means "not dismissed": showing a card too often is recoverable, hiding one the merchant
    // never dismissed is not.
    getOwnerSettings().catch(() => ({ error: "load-failed" } as const)),
  ]);
  const settings = "error" in settingsResult ? DEFAULT_SETTINGS : settingsResult;

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
  // #542 (F-07) — `userName` above is already the resolved greeting name: display name → shop
  // name → "there". The email is NOT in that chain at all. Greeting a merchant by their
  // address's local part ("Hi tools") is the exact defect this ticket exists to remove, and a
  // pre-#543 workspace name IS the full address, so any candidate containing "@" is refused
  // rather than passed on. See lib/otto-greeting.ts.

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
      userName={userName}
      memory={memory}
      records={records}
      ads={ads}
      adJobs={adJobs}
      account={account}
      analytics={analytics}
      history={history}
      ottoStreamEnabled={ottoStreamEnabled}
      initialView={initialView}
      onboardingDismissed={settings.ottoOnboardingDismissed}
      skin={skin}
    />
  );
}
