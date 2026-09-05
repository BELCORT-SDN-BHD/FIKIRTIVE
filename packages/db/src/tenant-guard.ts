import { Prisma } from "../generated/prisma/client.js";
import { getPrincipal } from "./principal.js";

/** Owner-scoped models protected at the Prisma boundary.
 *
 * Ambient user/tenant context pins reads and writes to its ownerId. Tenant-less system work may
 * read across owners, but must enter runAsTenant before writing. Raw SQL and nested relation writes
 * are not TENANT-SCOPED here and still require focused tests at their boundaries — but note they
 * are not invisible to a Prisma extension either: a raw operation reaches a top-level
 * `query.$allOperations` hook with `model === undefined` (measured, #743), and a nested relation
 * write always arrives inside an outer write verb. {@link withReadOnlyFrameGuard} uses exactly
 * those two facts.
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
  // FRONT-A8 (2026-09-03, 规格 docs/specs/frontend-baseline.md §7.3④):品牌上下文的改动史。
  // 它用的就是 `ownerId`(与 Memory / BrandRecord 同一条边界),而这个文件里的读写路径
  // (brand-revision.ts 的 recordBrandRevision / listBrandRevisions / stampOf)每一处都自带
  // ownerId —— 所以是 guarded,不是 exempt。
  "BrandContextRevision",
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
  // #784 (2026-08-13): 素材理解产物。GUARDED,不 EXEMPT —— 这张表装的是「Otto 知道这个商家
  // 什么」,越租户读一行就是把 A 家的菜单讲给 B 家听。worker 走的是标准两段式(具名系统身份
  // 扫描 + runAsTenant 逐行写),Otto 取回那一侧全程带 ctx.orgId,所以它不需要豁免。
  "AssetUnderstanding",
  // 前端基线 §7.3②(FRONT-A5 / A6,2026-09-03):素材库的收藏与合集。GUARDED,不 EXEMPT ——
  // 这三张表回答的是「这个商家收藏了什么、把什么归到了一起」,没有任何平台级读取需求,
  // 所以保守默认就是运行时守卫。Favorite / CollectionItem 的 subjectId 是**类型化 ID**
  // 而不是外键(取消收藏不许删原对象),目标的租户归属由 lib/library-subjects.ts 在每次
  // 写入前重新校验 —— 守卫管的是这三张表自己的行,那道校验管的是它们指向的东西。
  "Favorite", "Collection", "CollectionItem",
  // FRONT-A4 (2026-09-03,规格 docs/specs/frontend-baseline.md §7.3⑤):工作区 Home 版面。
  // GUARDED,不 EXEMPT —— 它装的是「这个商家的 Home 长什么样」,越租户读一行就是把 A 家的
  // 工作区偏好讲给 B 家看;而且它**没有**任何平台级读取需求(admin 不读版面),所以保守默认
  // 就是进守卫。唯一的读写方 apps/web/lib/home-layout-store.ts 全程显式带 ownerId,
  // 无帧(未进 runAsUser)时走的正是守卫的显式兜底那一支。
  "OrgHomeLayout",
]);

/** Tenant-scoped models whose tenant column is `orgId`, NOT `ownerId` (钱引擎⑤B, 规格 §7.7
 *  「租户兜底闸盲区」欠账⑧).
 *
 *  WHY THEY ARE LISTED AT ALL. The coverage test used to scan schema.prisma for `ownerId` only,
 *  so these three tables — the two that hold every merchant's MONEY — were not "exempt", they
 *  were **structurally invisible**: nobody had ever made a choice about them, and nobody would
 *  have noticed. Listing them turns "invisible" into "a decision with a reason attached", which
 *  is the whole point of the coverage test.
 *
 *  WHY THEY ARE NOT IN TENANT_MODELS. The runtime guard does not merely CHECK a tenant column,
 *  it INJECTS one: `scopeWhere` writes `args.where.ownerId`, `scopeCreateData` writes
 *  `data.ownerId`, and `whereHasOwnerId` / `compoundKeyOwnerIds` / `dataHasOwnerId` /
 *  `dataRewritesOwner` all read that literal name. Registering an `orgId` table as-is therefore
 *  does not guard it — it BREAKS it. Measured 2026-09-02: adding `CreditAccount` to TENANT_MODELS
 *  turns all 12 cases in apps/web/lib/__tests__/gen-ledger.test.ts red with
 *  `[tenant-guard] CreditAccount.create has no ownerId in created data`, because the row genuinely
 *  has no such column. Making it work means parameterising the tenant column through seven
 *  functions in this file — a change to the behaviour of all 40+ currently guarded models, which
 *  does not belong inside a hardening sweep. It is a scoped follow-up, not a line of this PR.
 *
 *  WHAT GUARDS THEM TODAY (measured, not asserted). Instrumenting the guard on 2026-09-02 and
 *  running the money suites (gen-ledger / refund-actions / tenant-actions) recorded **59
 *  operations on these three tables under an active tenant frame and ZERO missing `orgId`** —
 *  every call site already passes it. On top of that: `(orgId, refId, kind)` and
 *  `(orgId, idempotencyKey)` are DB-enforced unique, every credits.ts write takes `orgId` as a
 *  required argument, and e2e carries a two-tenant wallet journey in required CI (e2e.yml).
 *  So the boundary holds; what was missing was a place where someone had SAID so. */
export const ORG_SCOPED_TENANT_GUARD_EXEMPT: Record<string, string> = {
  CreditAccount:
    "orgId-scoped, not ownerId — the guard injects the literal `ownerId` and would break every query on it. " +
    "Scoped by the (orgId) primary key plus every credits.ts entry point taking orgId as a required argument.",
  CreditLedger:
    "orgId-scoped, not ownerId — same mechanism blocker. Scoped by the (orgId, refId, kind) and " +
    "(orgId, idempotencyKey) unique indexes plus the two-tenant wallet journey in required CI.",
  Membership:
    "orgId-scoped, not ownerId — same mechanism blocker. It is also the suspension AUTHORITY, read " +
    "platform-wide by the admin console, so a tenant-pinned read would be wrong for it anyway.",
  // ENGINE-A2 (规格 docs/specs/otto-engine.md §7.2②): Otto 每轮调试档案。它的 refId 主键
  // 就是账本里 `reserve:<refId>` 的那把钥匙,所以它的租户列跟着账本叫 `orgId` —— 一张
  // 「按 refId 对得上钱账」的表不能有第二种租户列名。那也正是它进不了 TENANT_MODELS 的
  // 原因(守卫注入的是字面 `ownerId`,见本常量上方的实测注释)。
  OttoTurnTrace:
    "orgId-scoped, not ownerId — same mechanism blocker (the refId primary key is the ledger's own " +
    "`reserve:<refId>` key, so the tenant column follows the ledger's name). Scoped by the orgId " +
    "foreign key (ON DELETE CASCADE) plus every read/write site passing orgId explicitly: the writer " +
    "takes it from the verified session principal (apps/web/lib/otto-actions.ts recordOttoTurnTrace), " +
    "and the only reader is the ops script scripts/ops/otto-turn-trace.ts. Two-tenant test: " +
    "packages/db/src/otto-turn-trace-tenant.test.ts.",
};

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

/**
 * The tenant ids a COMPOUND UNIQUE KEY names inside itself.
 *
 * Prisma exposes `@@unique([ownerId, contentHash])` as a single `where` field named by joining
 * the member fields with "_" (`ownerId_contentHash: { ownerId, contentHash }`), so on those
 * call sites the tenant column is one level DOWN — invisible to a top-level-only reader, which
 * is how the guard came to refuse a merchant's own upload as a cross-tenant leak (#698).
 *
 * The match is deliberately narrow: the key NAME must contain `ownerId` as one of its
 * underscore-joined segments AND the value must be a plain object carrying a non-empty string
 * `ownerId`. Relation filters (`user: { … }`) and boolean combinators (`AND`/`OR`/`NOT`) are
 * named differently and never match, so nothing that used to be refused starts passing except
 * the compound keys that genuinely name their tenant.
 */
function compoundKeyOwnerIds(where: unknown): string[] {
  if (!where || typeof where !== "object" || Array.isArray(where)) return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "ownerId" || !key.split("_").includes("ownerId")) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = (value as Record<string, unknown>).ownerId;
    if (typeof nested === "string" && nested.length > 0) found.push(nested);
  }
  return found;
}

function whereHasOwnerId(where: unknown): boolean {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  if (compoundKeyOwnerIds(where).length > 0) return true;
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
  // #698 — reading the tenant out of a compound key must not soften the boundary: a key that
  // names a FOREIGN tenant is refused exactly like a foreign top-level ownerId. Without this,
  // injecting the ambient ownerId beside the compound key merely made the lookup MISS, and an
  // upsert then quietly created a row under the caller's own tenant instead of refusing.
  for (const nested of compoundKeyOwnerIds(where)) {
    if (nested !== ownerId) {
      throw new Error(
        `[tenant-guard] ${model}.${operation} tried to use ownerId outside the active tenant`,
      );
    }
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
 * Refuse EVERY write, on EVERY model, under a read-only system frame.
 *
 * WHY A SEPARATE LAYER (#743 judge r1, P1). The tenant layer below returns early for anything
 * outside TENANT_MODELS — that is its whole job, and it is correct. But it means a check written
 * inside it can never see `CreditAccount`, `CreditLedger`, `RuntimeConfig`, or the deliberately
 * exempt models (`ActionEvent`, `ModelDirective`, …), and never sees raw SQL at all (a `$allModels`
 * hook is not called for an operation with no model). A "this frame cannot write" claim placed
 * there would be true only of tenant tables, which is not what the words say. So the claim lives
 * HERE, in a layer every operation passes through.
 *
 * WHAT IT COVERS, and why the coverage is structural rather than a list:
 *  - It keys on the OPERATION VERB, not on the shape of `args`. A nested relation write hides in
 *    the DATA of an outer verb (`update({ data: { refs: { create: … } } })`, `connect`,
 *    `disconnect`, `deleteMany` inside an update) — every one of those still arrives here as
 *    `update` / `upsert` / `create`, so refusing the verb refuses the nest with it. There is no
 *    way to reach a nested write without an outer write verb.
 *  - `model === undefined` is how a RAW operation arrives ($queryRaw / $executeRaw / their
 *    Unsafe and Typed variants / $runCommandRaw). Raw SQL is opaque to any argument inspection —
 *    `SELECT … ; UPDATE …` is one string — so the whole class is refused, reads included. The
 *    admin read model issues no raw SQL, so this costs nothing and removes the analysis.
 *  - Interactive `$transaction(cb)` dispatches each inner operation through this extension, so a
 *    write cannot be smuggled inside one.
 *
 * Nothing here changes what a NON read-only frame may do: `readOnly` is false for every other
 * system reason, so the worker's reapers and dispatchers are untouched.
 */
function withReadOnlyFrameGuard<T extends object>(client: T): T {
  return (client as any).$extends({
    query: {
      async $allOperations({ model, operation, args, query }: any) {
        const principal = getPrincipal();
        // Read `readOnly` off ANY frame, not just a system one. Since #743 r2 the restriction is
        // inherited by every nested frame including a user frame, so keying on `kind === "system"`
        // would let exactly the frame that inherited it slip through.
        if (!principal?.readOnly) return query(args);
        const frame = principal.kind === "system" ? principal.reason : `user:${principal.ownerId}`;
        if (model === undefined) {
          throw new Error(
            `[tenant-guard] ${operation} is raw SQL — refused under the read-only frame "${frame}"`,
          );
        }
        if (WRITE_OPS.has(operation)) {
          throw new Error(
            `[tenant-guard] ${model}.${operation} is a write — refused under the read-only frame "${frame}"`,
          );
        }
        return query(args);
      },
    },
  }) as T;
}

/**
 * Apply tenant scope at the Prisma boundary.
 *
 * - A user or tenant-scoped system frame is authoritative: every operation is pinned to its
 *   ownerId, including unique reads and writes.
 * - A tenant-less system frame may scan, but must enter runAsTenant before writing.
 * - Older unframed call sites retain the explicit-ownerId backstop while they migrate.
 * - A READ-ONLY system frame writes nothing at all — see {@link withReadOnlyFrameGuard}.
 *
 * ORDER IS LOAD-BEARING, and it is the opposite of what reading `$extends` suggests. MEASURED
 * (read-only-system-frame.test.ts, "refuses a write to a TENANT_MODELS table"): the read-only
 * layer must be applied FIRST for its hook to run FIRST. Applied the other way round, a
 * tenant-model write under the admin frame is still refused — but by the tenant layer's older
 * "requires runAsTenant before system writes", so the same violation reports two different
 * messages depending on the table. Correctness holds either way; this order makes the refusal
 * say the same thing every time, which is what makes the invariant legible.
 */
export function withTenantGuard<T extends object>(client: T): T {
  return withTenantScope(withReadOnlyFrameGuard(client));
}

function withTenantScope<T extends object>(client: T): T {
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
