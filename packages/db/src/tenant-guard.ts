import { Prisma } from "../generated/prisma/client.js";
import { getPrincipal } from "./principal.js";

/** Owner-scoped models protected at the Prisma boundary.
 *
 * Ambient user/tenant context pins reads and writes to its ownerId. Tenant-less system work may
 * read across owners, but must enter runAsTenant before writing. Raw SQL and nested relation writes
 * remain outside Prisma query-extension coverage and require focused tests at their boundaries.
 * Every schema model carrying ownerId must appear here or in TENANT_GUARD_EXEMPT; the coverage
 * test enforces that choice. */
export const TENANT_MODELS = new Set([
  "Project", "Entity", "EntityVariant", "ReferenceImage", "Asset", "Shot", "ShotEntityRef",
  "Generation", "RenderJob", "GenJob", "RefGenJob", "ChatThread", "ChatMessage",
  "CaptionJob",
  "Memory", "GenerationBatch", // v1 additive
  "CanvasNode", // 2026-07-04 审计: canvas is the newest active surface; all queries verified owner-scoped
  // 2026-07-04 adversarial review: all four below verified fully owner-scoped at every
  // checked-op call site (schedule-actions, brand-record-actions, memory-actions,
  // lookup-products, _brand-record) — guarded, not exempt.
  "ScheduledPost", "BrandKit", "BrandRecord", "BrandRule",
  // L0 量测原语(2026-07-10, PR-L0a):六个 owner-scoped 对象。出生即登记(spec §二 硬约束)。
  // 重定向/扫码端点是公共匿名的,但写事件一律 server 侧 scope 到 link.ownerId —— 未来切片的
  // list-query 全部 owner-scoped,故进 TENANT_MODELS(非 EXEMPT)。
  "TrackedLink", "QrAsset", "QrPlacement", "VoucherToken", "SourceTag", "AttributionEvent",
  // B0-30 (2026-07-13): generic channel-connection layer. Owner-scoped by birth (宪法 6); unlike
  // MetaConnection (EXEMPT: worker resolves ads tokens by connection id + platform-wide admin list),
  // this new table has NO platform-wide read requirement yet, so the conservative default is guarded.
  "ChannelConnection",
  // B0-28 (2026-07-13, NODE-275 收口2): share-preview token records — owner-scoped authority layer
  // for seat-less share links (mint/revoke are owner actions; the anonymous verify路径 looks up by
  // unique tokenDigest AND pins ownerId from the HMAC claims, so it stays owner-filtered).
  "SharePreviewToken",
  // B8 一期 (2026-07-14): Campaign + CRM objects are owner-scoped by birth (缝 5).
  "Campaign", "TrendSnapshot", "Contact", "ContactIdentity", "Segment",
  // R-010 D9 M1 (2026-07-19): provider-neutral channel scopes are tenant identity authority.
  "ChannelScope",
  // R-010 consent batch M1 (2026-07-19): event authorities and rebuildable projections.
  "ConsentEvent", "ConsentStateProjection", "ContactDndEvent",
  "ProviderRefusalEvent", "ProviderRefusalState",
  // C4b-M1 (2026-07-20): provider-neutral Customer Inbox storage carriers.
  "CustomerConversation", "CustomerMessage", "CustomerConversationEvent",
  "CustomerConversationDraft", "CustomerMessageTemplate", "CustomerMessageTemplateVersion",
  // C5-M1 (2026-07-21): additive-only broadcast/frequency storage carriers.
  "BroadcastRun", "BroadcastAudienceMember", "ContactSendFrequencyEvent",
  // C6-M1 (2026-07-22): additive-only messaging receipt storage carriers.
  "MessageDeliveryEvent", "MessageDeliveryState",
  // C7-M1 (2026-07-22): additive-only workflows/lifecycle storage carriers.
  "WorkflowDefinition", "WorkflowRevision", "Routine", "RoutineRun",
  "ContactJourneyState", "WorkflowStepExecution", "BusinessHoursPolicy",
]);

/** ownerId models deliberately NOT runtime-guarded — every entry carries its reason.
 *  A new model must choose: TENANT_MODELS (all list-queries owner-scoped) or here.
 *  Entries marked "pending guard review" are candidates to move UP into TENANT_MODELS
 *  after an explicit query sweep — burn this list down, don't let it grow silently. */
export const TENANT_GUARD_EXEMPT: Record<string, string> = {
  ActionEvent: "append-only audit log; admin/founder reads are platform-wide by design",
  MetaActionExecution: "Meta write-execution audit trail; admin audit surface reads platform-wide",
  MetaConnection: "channel layer (seam 4): worker resolves tokens by connection id; admin ops list is platform-wide",
  ModelDirective: "founder model-toggle config (admin surface, platform-wide by design)",
  ModelDirectiveRevision: "revision history of ModelDirective (admin surface, platform-wide)",
  ModelRegistryOverlay: "founder model-registry overrides (admin surface, platform-wide)",
  ResearchJob: "worker claims jobs queue-style by id/status (not owner lists); owner scoping lives in research-actions",
  TemplateBundle: "templates/Discover read official platform-wide bundles",
  Transcript: "content-addressed cache shared only after the caller proves ownership of identical source bytes",
};

const SCOPED_WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const WRITE_OPS = new Set([
  ...CREATE_OPS,
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
const SYSTEM_SCAN_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

function whereHasOwnerId(where: unknown): boolean {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  if (!Object.prototype.hasOwnProperty.call(where, "ownerId")) return false;
  const ownerFilter = (where as Record<string, unknown>).ownerId;
  if (typeof ownerFilter === "string") return ownerFilter.length > 0;
  if (!ownerFilter || typeof ownerFilter !== "object" || Array.isArray(ownerFilter)) {
    return false;
  }
  return Object.values(ownerFilter).some((value) => value !== undefined);
}

function scopeWhere(args: Record<string, any>, ownerId: string, model: string, operation: string) {
  const where = args.where && typeof args.where === "object" ? args.where : {};
  if (
    Object.prototype.hasOwnProperty.call(where, "ownerId") &&
    where.ownerId !== undefined &&
    where.ownerId !== ownerId
  ) {
    throw new Error(
      `[tenant-guard] ${model}.${operation} tried to use ownerId outside the active tenant`,
    );
  }
  args.where = { ...where, ownerId };
}

function scopeCreateData(
  data: unknown,
  ownerId: string,
  model: string,
  operation: string,
): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => scopeCreateData(entry, ownerId, model, operation));
  }
  if (!data || typeof data !== "object") {
    throw new Error(`[tenant-guard] ${model}.${operation} has no tenant-owned data`);
  }
  const row = data as Record<string, unknown>;
  if (row.ownerId !== undefined && row.ownerId !== ownerId) {
    throw new Error(
      `[tenant-guard] ${model}.${operation} tried to create data for another tenant`,
    );
  }
  return { ...row, ownerId };
}

function rejectOwnerRewrite(
  data: unknown,
  ownerId: string,
  model: string,
  operation: string,
) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  const nextOwner = (data as Record<string, unknown>).ownerId;
  if (nextOwner !== undefined && nextOwner !== ownerId) {
    throw new Error(
      `[tenant-guard] ${model}.${operation} tried to move data to another tenant`,
    );
  }
}

function dataHasOwnerId(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every(dataHasOwnerId);
  if (!data || typeof data !== "object") return false;
  return (data as Record<string, unknown>).ownerId !== undefined;
}

function dataRewritesOwner(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      (data as Record<string, unknown>).ownerId !== undefined,
  );
}

/**
 * Apply tenant scope at the Prisma boundary.
 *
 * - A user or tenant-scoped system frame is authoritative: every operation is pinned to its
 *   ownerId, including unique reads and writes.
 * - A tenant-less system frame may scan, but must enter runAsTenant before writing.
 * - Older unframed call sites retain the explicit-ownerId backstop while they migrate.
 */
export function withTenantGuard<T extends object>(client: T): T {
  return (client as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) return query(args);

          const principal = getPrincipal();
          const activeOwnerId = principal?.ownerId ?? null;
          if (activeOwnerId) {
            if (SCOPED_WHERE_OPS.has(operation)) {
              scopeWhere(args, activeOwnerId, model, operation);
            }
            if (CREATE_OPS.has(operation)) {
              args.data = scopeCreateData(args.data, activeOwnerId, model, operation);
            }
            if (operation === "upsert") {
              args.create = scopeCreateData(args.create, activeOwnerId, model, operation);
              rejectOwnerRewrite(args.update, activeOwnerId, model, operation);
            } else if (WRITE_OPS.has(operation)) {
              rejectOwnerRewrite(args.data, activeOwnerId, model, operation);
            }
          } else if (principal?.kind === "system") {
            if (!SYSTEM_SCAN_OPS.has(operation)) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} requires runAsTenant before system writes`,
              );
            }
          } else {
            if (SCOPED_WHERE_OPS.has(operation) && !whereHasOwnerId(args?.where)) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} has no ownerId filter — possible cross-tenant leak`,
              );
            }
            if (CREATE_OPS.has(operation) && !dataHasOwnerId(args?.data)) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} has no ownerId in created data`,
              );
            }
            if (operation === "upsert" && !dataHasOwnerId(args?.create)) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} has no ownerId in created data`,
              );
            }
            if (
              !CREATE_OPS.has(operation) &&
              WRITE_OPS.has(operation) &&
              dataRewritesOwner(operation === "upsert" ? args?.update : args?.data)
            ) {
              throw new Error(
                `[tenant-guard] ${model}.${operation} cannot rewrite ownerId without an active tenant`,
              );
            }
          }
          return query(args);
        },
      },
    },
  }) as T;
}

// `Prisma` is imported to anchor the extension types to the generated client version.
void Prisma;
