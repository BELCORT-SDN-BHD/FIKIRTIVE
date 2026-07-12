import { Prisma } from "../generated/prisma/client.js";

/** The owner-scoped models. findMany/findFirst/updateMany/deleteMany on these MUST carry an
 *  ownerId filter (the repository convention). This extension is a BACKSTOP, not the sole
 *  guarantee — documented blind spots (raw SQL, nested writes, findUnique-by-unique-key,
 *  aggregate/groupBy) are owned by the explicit filters + the 2-org isolation test.
 *  COVERAGE CONTRACT (2026-07-04 审计): every schema model carrying ownerId must be in THIS
 *  set or in TENANT_GUARD_EXEMPT below — enforced by tenant-guard-coverage.test.ts. */
export const TENANT_MODELS = new Set([
  "Project", "Entity", "EntityVariant", "ReferenceImage", "Asset", "Shot", "ShotEntityRef",
  "Generation", "RenderJob", "GenJob", "RefGenJob", "ChatThread", "ChatMessage",
  "CaptionJob", "Transcript",
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
};

// Operations we check (those that take a `where`). findUnique is exempt (unique-key access),
// aggregate/groupBy/count are exempt (admin platform-wide reads use them intentionally).
const CHECKED_OPS = new Set(["findMany", "findFirst", "updateMany", "deleteMany"]);

function whereHasOwnerId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  // `ownerId: undefined` is NOT a filter — Prisma drops undefined keys — so require a
  // defined value, not mere key presence, before treating the query as owner-scoped.
  if ((where as Record<string, unknown>).ownerId !== undefined) return true;
  // allow ownerId nested under a top-level AND
  const and = (where as { AND?: unknown }).AND;
  if (Array.isArray(and)) return and.some((c) => whereHasOwnerId(c));
  return false;
}

/** Apply to the PrismaClient. In production it WARNS (never throws — a false positive must
 *  not 500 a live request); under test it THROWS so the isolation suite catches an unscoped
 *  query. Result shape is never modified. */
export function withTenantGuard<T extends object>(client: T): T {
  const strict = process.env.NODE_ENV === "test";
  return (client as any).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (TENANT_MODELS.has(model) && CHECKED_OPS.has(operation) && !whereHasOwnerId(args?.where)) {
            const msg = `[tenant-guard] ${model}.${operation} has no ownerId filter — possible cross-tenant leak`;
            if (strict) throw new Error(msg);
            console.warn(msg);
          }
          return query(args);
        },
      },
    },
  }) as T;
}

// `Prisma` is imported to anchor the extension types to the generated client version.
void Prisma;
