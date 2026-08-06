import "server-only";

import {
  displayCredits,
  COWORK_PLANNER_SYSTEM,
  GEN_MODES,
  FOUNDER_OWNER_ID,
  GEN_MODELS,
  GEN_VIDEO_MODELS,
  MODEL_FAMILIES,
  REFGEN_MODELS,
  ROLES,
  SECTION_MATRIX,
  familyModes,
  modelFamily,
  type Role,
  type Section,
} from "@fikirtive/core";
// Founder-only platform admin read model; every query below is bounded and metadata-first.
import { prisma } from "@fikirtive/db";
import { listDirectives } from "@/lib/cowork-knowledge";
import { listConversations } from "@/lib/conversation-admin";
import { listTenants } from "@/lib/tenant-admin";
import { resolveVisionConfig } from "@/lib/runtime-config";
import { buildBytePlusPackSignal } from "@/lib/byteplus-pack-alert";
import { sanitizeUserError } from "@/lib/provider-secrecy";

const DAY_MS = 24 * 60 * 60 * 1000;

const GEN_STATUSES = ["QUEUED", "GENERATING", "DONE", "FAILED"] as const;
const RENDER_STATUSES = ["QUEUED", "RENDERING", "DONE", "FAILED"] as const;
const ADMIN_SECTIONS: Section[] = ["model", "cost", "content", "team", "system", "knowledge", "credits", "tenants"];
const BYTEPLUS_MODELS = new Set(["seedream", "seedance-2-fast"]);

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type AdminV2Section =
  | "overview"
  | "money"
  | "tenants"
  | "staff"
  | "cases"
  | "otto"
  | "audit"
  | "system";

export type RiskSignal = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  href: string;
};

export type ApprovalItem = {
  id: string;
  tenant: string;
  ownerEmail: string;
  kind: string;
  amount: number;
  limit: number;
  state: "within limit" | "over limit" | "adjustment";
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type TenantHealthRow = {
  orgId: string;
  name: string;
  ownerEmail: string;
  status: string;
  balance: number;
  genCount: number;
  lastActiveAt: string | null;
  risk: "healthy" | "watch" | "blocked";
};

/** #538 — an operator-issued invite (AllowedEmail status "invited") whose address has not
 *  become a tenant owner yet. Self-signup rows ("active") and revoked rows are not pending,
 *  so they never appear here. Bounded so a long invite history can't bloat the page payload. */
export type PendingInviteRow = {
  email: string;
  invitedBy: string;
  createdAt: string;
};

const PENDING_INVITE_LIMIT = 50;

export type CaseRow = {
  id: string;
  source: "guardian" | "otto" | "queue" | "media";
  type: string;
  tenant: string;
  ownerEmail: string;
  projectName: string;
  status: string;
  severity: "low" | "medium" | "high";
  createdAt: string;
  metadata: string[];
};

export type SystemIncident = {
  id: string;
  area: string;
  status: string;
  count: number;
  detail: string;
  updatedAt: string;
  tone: Tone;
};

export type AuditPreview = {
  id: string;
  type: string;
  ownerId: string;
  projectId: string | null;
  createdAt: string;
};

export type MoneySeriesRow = {
  day: string;
  usd: number;
  jobs: number;
};

export type MoneyJobRow = {
  id: string;
  source: "gen" | "refgen";
  label: string;
  model: string;
  count: number;
  status: string;
  spentUsd: number;
  finishedAt: string;
};

export type MoneyLedgerRow = {
  id: string;
  orgId: string;
  kind: string;
  source: string;
  displayedDelta: number;
  displayedReservedDelta: number;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type StaffRowV2 = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export type PermissionMatrixRow = {
  section: Section;
  label: string;
  read: Role[];
  mutate: Role[];
};

export type OttoOpsSummary = {
  provider: string;
  modelCount: number;
  enabledModelCount: number;
  directiveCells: number;
  filledDirectiveCells: number;
  coveredFamilies: number;
  routedFamilies: number;
  vision: { enabled: boolean; maxImages: number; maxBytes: number };
  models: { id: string; kind: "image" | "video"; family: string; enabled: boolean; notes: string }[];
  directives: {
    family: string;
    mode: string;
    directive: string;
    confidence: string;
    enabled: boolean;
    notes: string;
    source: string;
    exists: boolean;
  }[];
  families: string[];
  modes: string[];
  knowledge: { key: "planner_system" | "brief_default" | "description_template"; title: string; value: string; present: boolean }[];
};

export type AdminV2Data = {
  generatedAt: string;
  riskSignals: RiskSignal[];
  approvalQueue: ApprovalItem[];
  tenants: TenantHealthRow[];
  invitedCount: number;
  pendingInvites: PendingInviteRow[];
  cases: CaseRow[];
  systemIncidents: SystemIncident[];
  audit: AuditPreview[];
  money: {
    totalUsd: number;
    jobCount: number;
    balance: number;
    reserved: number;
    days: MoneySeriesRow[];
    jobs: MoneyJobRow[];
    ledger: MoneyLedgerRow[];
  };
  staff: {
    rows: StaffRowV2[];
    roles: Role[];
    matrix: PermissionMatrixRow[];
  };
  otto: OttoOpsSummary;
};

function permissionLabel(section: Section): string {
  const labels: Record<Section, string> = {
    model: "Model controls",
    cost: "Cost reporting",
    content: "Content and cases",
    team: "Staff and permissions",
    system: "System health",
    knowledge: "Prompt knowledge",
    credits: "Credit ledger",
    tenants: "Tenant management",
  };
  return labels[section];
}

function countsByStatus(rows: { status: string; _count: { _all: number } }[], statuses: readonly string[]) {
  const out: Record<string, number> = {};
  for (const status of statuses) out[status] = 0;
  for (const row of rows) out[row.status] = row._count._all;
  return out;
}

function ownerName(ownerByOrg: Map<string, { name: string; email: string }>, ownerId: string) {
  if (ownerId === FOUNDER_OWNER_ID) return { name: "Founder workspace", email: "founder" };
  return ownerByOrg.get(ownerId) ?? { name: ownerId, email: ownerId };
}

function tenantRisk(status: string, balance: number, lastActiveAt: string | null): TenantHealthRow["risk"] {
  if (status === "suspended" || status === "revoked") return "blocked";
  if (balance < 500) return "watch";
  if (!lastActiveAt) return "watch";
  const last = Date.parse(lastActiveAt);
  if (Number.isFinite(last) && Date.now() - last > 14 * DAY_MS) return "watch";
  return "healthy";
}

function formatDateForSort(date: Date | null | undefined) {
  return (date ?? new Date(0)).toISOString();
}

export async function getAdminV2Data(): Promise<AdminV2Data> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const todayStart = new Date(Date.now() - DAY_MS);

  const [
    tenantResult,
    founderAccount,
    ledgerRows,
    genJobs,
    refGenJobs,
    genGroups,
    refGenGroups,
    renderGroups,
    genFailed,
    refGenFailed,
    renderFailed,
    genSpendToday,
    refGenSpendToday,
    guardianBlocks,
    recentGenerations,
    conversations,
    auditEvents,
    staffRows,
    modelOverlay,
    vision,
    runtimeProvider,
    knowledgeRows,
  ] = await Promise.all([
    listTenants(),
    prisma.creditAccount.findUnique({
      where: { orgId: FOUNDER_OWNER_ID },
      select: { balance: true, reserved: true },
    }),
    prisma.creditLedger.findMany({
      where: { orgId: FOUNDER_OWNER_ID },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        orgId: true,
        kind: true,
        source: true,
        balanceDelta: true,
        reservedDelta: true,
        reason: true,
        createdBy: true,
        createdAt: true,
      },
    }),
    prisma.genJob.findMany({
      where: { ownerId: { not: "" }, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: {
        id: true,
        kind: true,
        model: true,
        count: true,
        status: true,
        spentUsd: true,
        finishedAt: true,
        updatedAt: true,
      },
      orderBy: { finishedAt: "desc" },
      take: 200,
    }),
    prisma.refGenJob.findMany({
      where: { ownerId: { not: "" }, spentUsd: { not: null }, finishedAt: { gte: since } },
      select: {
        id: true,
        mode: true,
        model: true,
        count: true,
        status: true,
        spentUsd: true,
        finishedAt: true,
        updatedAt: true,
      },
      orderBy: { finishedAt: "desc" },
      take: 200,
    }),
    prisma.genJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.refGenJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.renderJob.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.genJob.findMany({
      where: { ownerId: { not: "" }, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        id: true,
        ownerId: true,
        projectId: true,
        kind: true,
        model: true,
        error: true,
        finishedAt: true,
        updatedAt: true,
      },
    }),
    prisma.refGenJob.findMany({
      where: { ownerId: { not: "" }, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        id: true,
        ownerId: true,
        mode: true,
        model: true,
        error: true,
        finishedAt: true,
        updatedAt: true,
      },
    }),
    prisma.renderJob.findMany({
      where: { ownerId: { not: "" }, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        id: true,
        ownerId: true,
        projectId: true,
        error: true,
        finishedAt: true,
        updatedAt: true,
      },
    }),
    prisma.genJob.aggregate({
      where: { spentUsd: { not: null }, finishedAt: { gte: todayStart } },
      _sum: { spentUsd: true },
    }),
    prisma.refGenJob.aggregate({
      where: { spentUsd: { not: null }, finishedAt: { gte: todayStart } },
      _sum: { spentUsd: true },
    }),
    prisma.actionEvent.findMany({
      where: { ownerId: { not: "" }, type: "gen.guardian-block" },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, ownerId: true, projectId: true, type: true, createdAt: true },
    }),
    prisma.generation.findMany({
      where: { ownerId: { not: "" }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        ownerId: true,
        modelRef: true,
        createdAt: true,
        asset: { select: { ext: true } },
        project: { select: { name: true } },
      },
    }),
    listConversations(),
    prisma.actionEvent.findMany({
      where: { ownerId: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, ownerId: true, projectId: true, type: true, createdAt: true },
    }),
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true },
      orderBy: { email: "asc" },
    }),
    prisma.modelRegistryOverlay.findMany({
      where: { ownerId: FOUNDER_OWNER_ID },
      select: { modelId: true, enabled: true, notes: true },
    }),
    resolveVisionConfig(),
    prisma.runtimeConfig.findUnique({
      where: { key: "cowork_provider" },
      select: { valueJson: true },
    }),
    prisma.runtimeConfig.findMany({
      where: { key: { in: ["planner_system", "brief_default", "description_template"] } },
      select: { key: true, valueJson: true },
    }),
  ]);

  const ownerByOrg = new Map(
    tenantResult.tenants.map((tenant) => [
      tenant.orgId,
      { name: tenant.name || tenant.orgId, email: tenant.ownerEmail || tenant.orgId },
    ]),
  );

  const tenants: TenantHealthRow[] = tenantResult.tenants
    .map((tenant) => ({
      orgId: tenant.orgId,
      name: tenant.name,
      ownerEmail: tenant.ownerEmail,
      status: tenant.status,
      balance: tenant.balance,
      genCount: tenant.genCount,
      lastActiveAt: tenant.lastActiveAt,
      risk: tenantRisk(tenant.status, tenant.balance, tenant.lastActiveAt),
    }))
    .sort((a, b) => {
      const rank = { blocked: 0, watch: 1, healthy: 2 };
      return rank[a.risk] - rank[b.risk] || a.balance - b.balance;
    });

  const pendingInviteRows = tenantResult.invited.filter((row) => row.status === "invited");

  const moneyJobs: Array<MoneyJobRow & { internalModel: string }> = [
    ...genJobs.map((job) => ({
      id: job.id,
      source: "gen" as const,
      label: job.kind === "VIDEO" ? "video" : "image",
      model: job.kind === "VIDEO" ? "Video" : "Image",
      internalModel: job.model,
      count: job.count,
      status: job.status,
      spentUsd: job.spentUsd ?? 0,
      finishedAt: formatDateForSort(job.finishedAt ?? job.updatedAt),
    })),
    ...refGenJobs.map((job) => ({
      id: job.id,
      source: "refgen" as const,
      label: `ref:${job.mode.toLowerCase()}`,
      model: "Image",
      internalModel: job.model,
      count: job.count,
      status: job.status,
      spentUsd: job.spentUsd ?? 0,
      finishedAt: formatDateForSort(job.finishedAt ?? job.updatedAt),
    })),
  ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));

  const daysByKey = new Map<string, MoneySeriesRow>();
  for (const job of moneyJobs) {
    const day = job.finishedAt.slice(0, 10);
    const row = daysByKey.get(day) ?? { day, usd: 0, jobs: 0 };
    row.usd += job.spentUsd;
    row.jobs += 1;
    daysByKey.set(day, row);
  }

  const ledger: MoneyLedgerRow[] = ledgerRows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    kind: row.kind,
    source: row.source,
    displayedDelta: displayCredits(row.balanceDelta),
    displayedReservedDelta: displayCredits(row.reservedDelta),
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }));

  const grantLimit = 1000;
  const approvalQueue: ApprovalItem[] = ledger
    .filter((row) => row.kind === "GRANT" || row.kind === "ADJUST")
    .slice(0, 24)
    .map((row) => {
      const amount = row.displayedDelta;
      const state: ApprovalItem["state"] =
        amount < 0 ? "adjustment" : amount > grantLimit ? "over limit" : "within limit";
      return {
        id: row.id,
        tenant: row.orgId === FOUNDER_OWNER_ID ? "Founder workspace" : row.orgId,
        ownerEmail: row.orgId === FOUNDER_OWNER_ID ? "founder" : row.orgId,
        kind: row.kind,
        amount,
        limit: grantLimit,
        state,
        reason: row.reason,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      };
    });

  const genCounts = countsByStatus(genGroups, GEN_STATUSES);
  const refGenCounts = countsByStatus(refGenGroups, GEN_STATUSES);
  const renderCounts = countsByStatus(renderGroups, RENDER_STATUSES);
  const activeQueue =
    (genCounts.QUEUED ?? 0) +
    (genCounts.GENERATING ?? 0) +
    (refGenCounts.QUEUED ?? 0) +
    (refGenCounts.GENERATING ?? 0) +
    (renderCounts.QUEUED ?? 0) +
    (renderCounts.RENDERING ?? 0);

  const failedRows = [
    ...genFailed.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      projectName: row.projectId,
      area: "Generation queue",
      status: row.kind === "VIDEO" ? "video failed" : "image failed",
      detail: sanitizeUserError(row.error || (row.kind === "VIDEO" ? "Video generation failed." : "Image generation failed.")),
      updatedAt: (row.finishedAt ?? row.updatedAt).toISOString(),
      metadata: [row.kind === "VIDEO" ? "Video" : "Image", row.projectId],
    })),
    ...refGenFailed.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      projectName: "Reference generation",
      area: "Reference queue",
      status: `ref:${row.mode.toLowerCase()} failed`,
      detail: sanitizeUserError(row.error || "Reference image generation failed."),
      updatedAt: (row.finishedAt ?? row.updatedAt).toISOString(),
      metadata: ["Image"],
    })),
    ...renderFailed.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      projectName: row.projectId,
      area: "Render queue",
      status: "render failed",
      detail: sanitizeUserError(row.error || "Media render failed."),
      updatedAt: (row.finishedAt ?? row.updatedAt).toISOString(),
      metadata: ["ffmpeg", row.projectId],
    })),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const systemIncidents: SystemIncident[] = [
    {
      id: "queue-active",
      area: "In flight",
      status: activeQueue > 0 ? "active" : "clear",
      count: activeQueue,
      detail: `${genCounts.QUEUED ?? 0} gen queued, ${refGenCounts.QUEUED ?? 0} ref queued, ${renderCounts.QUEUED ?? 0} render queued`,
      updatedAt: new Date().toISOString(),
      tone: activeQueue > 20 ? "warning" : "neutral",
    },
    {
      id: "queue-failed",
      area: "Failures",
      status: failedRows.length > 0 ? "needs review" : "clear",
      count: failedRows.length,
      detail: failedRows[0]?.detail || "No failed jobs in the sampled window.",
      updatedAt: failedRows[0]?.updatedAt ?? new Date().toISOString(),
      tone: failedRows.length > 0 ? "danger" : "success",
    },
    {
      id: "spend-today",
      area: "Spend today",
      status: "recorded",
      count: Math.round(((genSpendToday._sum.spentUsd ?? 0) + (refGenSpendToday._sum.spentUsd ?? 0)) * 100),
      detail: `$${((genSpendToday._sum.spentUsd ?? 0) + (refGenSpendToday._sum.spentUsd ?? 0)).toFixed(2)} frozen spend in the last 24 hours`,
      updatedAt: new Date().toISOString(),
      tone: "info",
    },
  ];
  const bytePlusPack = buildBytePlusPackSignal({
    estimatedUsedUsd: moneyJobs
      .filter((job) => BYTEPLUS_MODELS.has(job.internalModel))
      .reduce((sum, job) => sum + job.spentUsd, 0),
    env: {
      capacityUsd: process.env.BYTEPLUS_RESOURCE_PACK_USD,
      usedUsd: process.env.BYTEPLUS_RESOURCE_PACK_USED_USD,
      alertPct: process.env.BYTEPLUS_RESOURCE_PACK_ALERT_PCT,
    },
  });
  systemIncidents.push({
    id: "byteplus-pack",
    area: "Generation capacity",
    status: bytePlusPack.status,
    count: bytePlusPack.count,
    detail: bytePlusPack.detail,
    updatedAt: new Date().toISOString(),
    tone: bytePlusPack.tone,
  });

  const cases: CaseRow[] = [
    ...guardianBlocks.map((row) => {
      const owner = ownerName(ownerByOrg, row.ownerId);
      return {
        id: row.id,
        source: "guardian" as const,
        type: row.type,
        tenant: owner.name,
        ownerEmail: owner.email,
        projectName: row.projectId ?? "No project",
        status: "blocked",
        severity: "high" as const,
        createdAt: row.createdAt.toISOString(),
        metadata: ["payload withheld", row.projectId ? `project ${row.projectId}` : "no project"],
      };
    }),
    ...conversations.slice(0, 20).map((row) => ({
      id: row.threadId,
      source: "otto" as const,
      type: "otto.thread",
      tenant: ownerName(ownerByOrg, row.ownerId).name,
      ownerEmail: row.ownerEmail,
      projectName: row.projectName,
      status: "metadata only",
      severity: row.messageCount > 30 ? ("medium" as const) : ("low" as const),
      createdAt: row.lastActiveAt,
      metadata: [`${row.messageCount} messages`, `thread ${row.threadId}`],
    })),
    ...failedRows.slice(0, 20).map((row) => {
      const owner = ownerName(ownerByOrg, row.ownerId);
      return {
        id: row.id,
        source: "queue" as const,
        type: row.status,
        tenant: owner.name,
        ownerEmail: owner.email,
        projectName: row.projectName,
        status: "failed",
        severity: "high" as const,
        createdAt: row.updatedAt,
        metadata: row.metadata,
      };
    }),
    ...recentGenerations.slice(0, 20).map((row) => {
      const owner = ownerName(ownerByOrg, row.ownerId);
      return {
        id: row.id,
        source: "media" as const,
        type: row.asset.ext.toLowerCase() === "mp4" ? "video generation" : "image generation",
        tenant: owner.name,
        ownerEmail: owner.email,
        projectName: row.project?.name ?? "(deleted project)",
        status: "sampled",
        severity: "low" as const,
        createdAt: row.createdAt.toISOString(),
        metadata: [row.asset.ext.toLowerCase() === "mp4" ? "Video" : "Image", `asset .${row.asset.ext}`],
      };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const audit: AuditPreview[] = auditEvents.map((event) => ({
    id: event.id,
    type: event.type,
    ownerId: event.ownerId,
    projectId: event.projectId,
    createdAt: event.createdAt.toISOString(),
  }));

  const modelIds = Array.from(new Set<string>([...GEN_MODELS, ...REFGEN_MODELS, ...GEN_VIDEO_MODELS]));
  const overlayByModel = new Map(modelOverlay.map((row) => [row.modelId, row]));
  const disabledModels = new Set(modelOverlay.filter((row) => !row.enabled).map((row) => row.modelId));
  const modelRows = [
    ...Array.from(new Set<string>([...GEN_MODELS, ...REFGEN_MODELS])).map((id) => ({
      id,
      kind: "image" as const,
      family: modelFamily(id) ?? "unknown",
      enabled: overlayByModel.get(id)?.enabled ?? true,
      notes: overlayByModel.get(id)?.notes ?? "",
    })),
    ...(GEN_VIDEO_MODELS as readonly string[]).map((id) => ({
      id,
      kind: "video" as const,
      family: modelFamily(id) ?? "unknown",
      enabled: overlayByModel.get(id)?.enabled ?? true,
      notes: overlayByModel.get(id)?.notes ?? "",
    })),
  ];
  const directives = await listDirectives();
  const directivesByKey = new Map(directives.map((row) => [`${row.family}:${row.mode}`, row]));
  // #647 T6:知识格从 9 家族 × 5 模式 = 45 格,收缩成**真会被读到的那几格**。
  // 家族随假引擎下架从 9 掉到 2;跨 kind 的组合(图像家族 × t2v 之类)本来就永远取不到
  // 值 —— 后台可以把它填满,引擎一辈子看不见。`familyModes` 按在册模型现算,所以上架/
  // 下架一台引擎,这张网格当场跟着变,不需要有人记得回来改一个数。
  const directiveCells = MODEL_FAMILIES.flatMap((family) =>
    familyModes(family).map((mode) => {
      const row = directivesByKey.get(`${family}:${mode}`);
      return {
        family,
        mode,
        directive: row?.directive ?? "",
        confidence: row?.confidence ?? "untested",
        enabled: row?.enabled ?? true,
        notes: row?.notes ?? "",
        source: row?.source ?? "founder",
        exists: Boolean(row),
      };
    }),
  );
  const filledDirectives = directives.filter((row) => row.enabled && row.directive.trim()).length;
  const seededFamilies = new Set(
    directives.filter((row) => row.enabled && row.directive.trim()).map((row) => row.family),
  );
  const routedFamilies = Array.from(
    new Set((GEN_VIDEO_MODELS as readonly string[]).map((id) => modelFamily(id)).filter(Boolean)),
  ) as string[];
  const provider =
    (runtimeProvider?.valueJson as { provider?: string } | null)?.provider ??
    process.env.COWORK_PROVIDER ??
    "mock";
  const knowledgeByKey = new Map(knowledgeRows.map((row) => [row.key, row.valueJson]));
  const knowledgeValue = (key: "planner_system" | "brief_default" | "description_template") => {
    const text = (knowledgeByKey.get(key) as { text?: unknown } | undefined)?.text;
    if (typeof text === "string") return text;
    if (key === "planner_system") return COWORK_PLANNER_SYSTEM;
    return "";
  };

  const lowBalanceCount = tenants.filter((tenant) => tenant.risk === "watch").length;
  const blockedTenantCount = tenants.filter((tenant) => tenant.risk === "blocked").length;
  const overLimitApprovals = approvalQueue.filter((item) => item.state === "over limit").length;
  const queueFailureCount = failedRows.length;

  return {
    generatedAt: new Date().toISOString(),
    riskSignals: [
      {
        id: "pending-approvals",
        label: "Pending approvals",
        value: String(overLimitApprovals),
        detail: "Ledger-derived grant reviews above the 1,000 credit single-action limit.",
        tone: overLimitApprovals > 0 ? "warning" : "success",
        href: "/admin/money",
      },
      {
        id: "credit-risk",
        label: "Credit risk",
        value: String(lowBalanceCount + blockedTenantCount),
        detail: `${lowBalanceCount} low-balance tenants, ${blockedTenantCount} blocked tenants.`,
        tone: lowBalanceCount + blockedTenantCount > 0 ? "warning" : "success",
        href: "/admin/tenants",
      },
      {
        id: "open-cases",
        label: "Open cases",
        value: String(cases.filter((row) => row.severity !== "low").length),
        detail: "Guardian blocks, queue failures, and long Otto threads shown as metadata.",
        tone: cases.some((row) => row.severity === "high") ? "danger" : "neutral",
        href: "/admin/cases",
      },
      {
        id: "queue-failures",
        label: "Queue failures",
        value: String(queueFailureCount),
        detail: `${activeQueue} active queue items across generation, reference, and render jobs.`,
        tone: queueFailureCount > 0 ? "danger" : "success",
        href: "/admin/system",
      },
    ],
    approvalQueue,
    tenants,
    invitedCount: pendingInviteRows.length,
    pendingInvites: pendingInviteRows.slice(0, PENDING_INVITE_LIMIT).map((row) => ({
      email: row.email,
      invitedBy: row.invitedBy,
      createdAt: row.createdAt,
    })),
    cases,
    systemIncidents,
    audit,
    money: {
      totalUsd: moneyJobs.reduce((sum, job) => sum + job.spentUsd, 0),
      jobCount: moneyJobs.length,
      balance: founderAccount?.balance ?? 0,
      reserved: founderAccount?.reserved ?? 0,
      days: Array.from(daysByKey.values()).sort((a, b) => b.day.localeCompare(a.day)),
      jobs: moneyJobs.map(({ internalModel: _internalModel, ...job }) => job),
      ledger,
    },
    staff: {
      rows: staffRows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name ?? "",
        role: row.role,
      })),
      roles: [...ROLES],
      matrix: ADMIN_SECTIONS.map((section) => ({
        section,
        label: permissionLabel(section),
        read: [...SECTION_MATRIX[section].read],
        mutate: [...SECTION_MATRIX[section].mutate],
      })),
    },
    otto: {
      provider,
      modelCount: modelIds.length,
      enabledModelCount: modelIds.filter((id) => !disabledModels.has(id)).length,
      // 计数就是那张网格本身的长度 —— 不再是「家族数 × 模式数」这个第二份推导
      // (两份推导正是「说的」与「做的」失同步的老来源)。
      directiveCells: directiveCells.length,
      filledDirectiveCells: filledDirectives,
      coveredFamilies: routedFamilies.filter((family) => seededFamilies.has(family)).length,
      routedFamilies: routedFamilies.length,
      vision: { enabled: vision.enabled, maxImages: vision.maxImages, maxBytes: vision.maxBytes },
      models: modelRows,
      directives: directiveCells,
      families: [...MODEL_FAMILIES],
      modes: [...GEN_MODES],
      knowledge: [
        {
          key: "planner_system",
          title: "Planner system prompt",
          value: knowledgeValue("planner_system"),
          present: Boolean(knowledgeByKey.get("planner_system")),
        },
        {
          key: "brief_default",
          title: "Project-brief default",
          value: knowledgeValue("brief_default"),
          present: Boolean(knowledgeByKey.get("brief_default")),
        },
        {
          key: "description_template",
          title: "Reference-description template",
          value: knowledgeValue("description_template"),
          present: Boolean(knowledgeByKey.get("description_template")),
        },
      ],
    },
  };
}
