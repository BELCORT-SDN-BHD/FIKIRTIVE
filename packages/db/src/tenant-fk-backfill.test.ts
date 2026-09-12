/**
 * TENANT 切片⑤(#1380,规格 docs/specs/tenant-isolation.md「已冻结·v1」TENANT-A7)——
 * 75 处裸外键回填的验收测试。
 *
 * 盘点结论(逐条见 PR #1380 描述的推导表,这里只留断言用的事实):
 * schema.prisma 151 条 `@relation(fields:)` 中 76 条已含租户列(复合外键,历史切片建表时
 * 就是这么写的);裸外键 75 条,拆成三类——
 *
 *   ① ROOT(68 条):`X.organization -> Organization`(fk = ownerId / orgId)。这条 FK **就是**
 *      租户标识本身 —— Organization 是租户根,没有第二个租户维度可以拿来复合校验,"A 的子行
 *      挂到 B 的父行"这个攻击形状对它不成立(父行"属于哪个租户"不存在第二种独立说法可以和
 *      它分歧)。技术证据:全库 `ownerId`/`orgId` 零可空(见下面 test 用同一条正则验证),且
 *      每个模型如果还有指向"别的业务实体"的关系,那条关系早就是复合的(如 Generation.shot、
 *      Shot.project——只有 Generation.organization / Shot.organization 这两条直连根的关系是裸的)。
 *      这一类不需要 schema 改动,豁免理由是结构性的,不是"懒得改"。
 *   ② IDENTITY(4 条):`UserRole.user` / `Membership.user` -> User,`BetterAuthSession.user` /
 *      `BetterAuthAccount.user` -> BetterAuthUser。User / BetterAuthUser 是跨租户身份表(一个人
 *      可以属于多个 org,Better Auth 的登录身份更是登录期就先于租户存在),它们本来就没有
 *      ownerId 概念,租户维度全部由 Membership.orgId 承载。豁免理由同样是结构性的。
 *   ③ 本片实际回填(2 条,已落地):`ScheduledPostMedia.post` / `PublishAttempt.post` ->
 *      ScheduledPost。这两张子表原本没有自己的 ownerId(租户身份只能"去查父行"才知道,
 *      数据库看不见),现在都加了 ownerId(migration 20260912200852_tenant_slice5_fk_backfill
 *      从 ScheduledPost.ownerId 传递性回填)、外键升级成复合 `[scheduledPostId, ownerId] ->
 *      ScheduledPost([id, ownerId])`。PublishAttempt 正是规格 §3"不做"节点名、留到这一片
 *      评估的那条;ScheduledPostMedia 是同一张父表下结构相同的姊妹表,一并处理。
 *   ④ 本片评估后暂缓(1 条):`MembershipRole.membership` -> Membership。Membership 早就有
 *      `@@unique([id, orgId])`,MembershipRole 结构上和②③同类(自己没有 orgId,租户身份靠
 *      查父行)。暂缓理由是范围,不是技术不可行:membershipRole.create/upsert 的真实 DB 调用点
 *      有 2 处生产代码 + 14 个 __tests__ 文件直接对真库写行,补一列 orgId 会让全部 14 个测试
 *      文件的建库调用点都要跟着改——量级和 PublishAttempt(2 处生产调用 + 1 个测试文件)/
 *      ScheduledPostMedia(2 处生产调用、其余全是 mock)完全不是一个数量级。建议列入下一张
 *      工单(与 #1380 同源,建议标题:「MembershipRole 补 orgId 列 + 复合外键」)。
 *
 * 下面第一个 test 是机器闸:程序化解析 schema.prisma,断言"裸外键剩余数 == 豁免清单长度"
 * ——以后任何人在 schema 里新增一条裸外键,这个 test 当场变红,不许静默绕过。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { prisma } from "./index.js";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/schema.prisma",
);

/** Walks schema.prisma model-by-model and returns "Model.relField" for every
 *  `@relation(fields: [...])` declaration whose `fields:` array has exactly one
 *  column (a "bare" foreign key — no tenant column riding along with the parent id).
 *
 *  Splits into per-model bodies first, then matches `@relation(` with a multi-line-safe
 *  `[\s\S]*?` capture (same technique as tenant-guard-coverage.test.ts's
 *  ownerScopedRelations) — a single-line-only match would silently miss a relation whose
 *  `@relation(...)` wraps onto its own line(s), letting a new bare FK slip past the gate. */
function extractBareForeignKeys(schemaText: string): string[] {
  const bare: string[] = [];
  for (const modelMatch of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const currentModel = modelMatch[1]!;
    const body = modelMatch[2] ?? "";
    for (const relMatch of body.matchAll(
      /^\s*(\w+)\s+(\w+)(?:\?|\[\])?\s+@relation\(([\s\S]*?)\)/gm,
    )) {
      const relField = relMatch[1] ?? "?";
      const relationArgs = relMatch[3] ?? "";
      const fieldsMatch = relationArgs.match(/fields:\s*\[([^\]]*)\]/);
      const fieldsList = fieldsMatch
        ? (fieldsMatch[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      if (fieldsList.length === 1) {
        bare.push(`${currentModel}.${relField}`);
      }
    }
  }
  return bare;
}

// ── ① ROOT: direct-to-Organization tenant FKs — structurally exempt, see file header. ──
const EXEMPT_ROOT_DIRECT_TO_ORGANIZATION = [
  "ActionEvent.organization", "Asset.organization", "AssetUnderstanding.organization",
  "BrandContextRevision.organization", "BrandKit.organization", "BrandRecord.organization",
  "BrandRule.organization", "BroadcastAudienceMember.organization", "BroadcastRun.organization",
  "BusinessHoursPolicy.organization", "Campaign.organization", "CaptionJob.organization",
  "ChannelConnection.organization", "ChannelScope.organization", "ChatMessage.organization",
  "ChatThread.organization", "Collection.organization", "CollectionItem.organization",
  "ConsentEvent.organization", "ConsentStateProjection.organization", "Contact.organization",
  "ContactDndEvent.organization", "ContactIdentity.organization", "ContactJourneyState.organization",
  "ContactSendFrequencyEvent.organization", "CreditAccount.org", "CreditLedger.org",
  "CustomerConversation.organization", "CustomerConversationDraft.organization",
  "CustomerConversationEvent.organization", "CustomerMessage.organization",
  "CustomerMessageTemplate.organization", "CustomerMessageTemplateVersion.organization",
  "Entity.organization", "EntityVariant.organization", "Favorite.organization",
  "GenJob.organization", "Generation.organization", "GenerationBatch.organization",
  "Membership.org", "Memory.organization", "MessageDeliveryEvent.organization",
  "MessageDeliveryState.organization", "MetaConnection.organization", "ModelDirective.organization",
  "ModelDirectiveRevision.organization", "ModelRegistryOverlay.organization",
  "OrgHomeLayout.organization", "OttoTurnTrace.org", "Project.organization",
  "ProviderRefusalEvent.organization", "ProviderRefusalState.organization", "RefGenJob.organization",
  "ReferenceImage.organization", "RenderJob.organization", "ResearchJob.organization",
  "Routine.organization", "RoutineRun.organization", "ScheduledPost.organization",
  "Segment.organization", "SharePreviewToken.organization", "Shot.organization",
  "ShotEntityRef.organization", "Transcript.organization", "TrendSnapshot.organization",
  "WorkflowDefinition.organization", "WorkflowRevision.organization",
  "WorkflowStepExecution.organization",
];

// ── ② IDENTITY: pre-tenant identity tables — no ownerId concept applies. ──
const EXEMPT_CROSS_TENANT_IDENTITY = [
  "BetterAuthAccount.user", // Better Auth's own login-identity table; predates org membership
  "BetterAuthSession.user", // same — a session belongs to a login identity, not an org
  "Membership.user",        // User is the cross-org identity; Membership is what carries orgId
  "UserRole.user",          // platform staff roles — not org-scoped (see schema.prisma comment)
];

// ── ④ Deferred this slice — see file header for the full reasoning. ──
const EXEMPT_DEFERRED_TO_FOLLOWUP = [
  "MembershipRole.membership", // Membership already has @@unique([id, orgId]); blast radius
                                // (14 real-DB test files + 2 prod call sites) is out of scope
                                // for this ticket — recommended as a follow-up ticket in the PR.
];

const EXEMPT_BARE_FOREIGN_KEYS = [
  ...EXEMPT_ROOT_DIRECT_TO_ORGANIZATION,
  ...EXEMPT_CROSS_TENANT_IDENTITY,
  ...EXEMPT_DEFERRED_TO_FOLLOWUP,
].sort();

describe("TENANT-A7 schema-level 机器闸:裸外键剩余数 == 豁免清单长度", () => {
  it("TENANT-A7: schema.prisma 的裸外键集合逐条等于硬编码豁免清单(新增裸外键当场变红)", () => {
    const schemaText = readFileSync(SCHEMA_PATH, "utf8");
    const actualBare = extractBareForeignKeys(schemaText).sort();
    expect(actualBare).toEqual(EXEMPT_BARE_FOREIGN_KEYS);
  });

  it("TENANT-A7: 全库零可空租户列(ownerId/orgId 均非 String? ) —— NULL 放行面不存在", () => {
    // Postgres 复合外键是 MATCH SIMPLE:任一列 NULL 就直接放行,不做比对。这条测试证明当前
    // schema 里没有任何一条裸外键 / 复合外键的租户列是可空的,所以“NULL 放行”在这个 schema
    // 里目前是零可利用面 —— 不是没有测,是测过、真的没有。
    const schemaText = readFileSync(SCHEMA_PATH, "utf8");
    const nullableTenantCols = schemaText
      .split("\n")
      .filter((l) => /^\s*(ownerId|orgId)\s+String\?/.test(l));
    expect(nullableTenantCols).toEqual([]);
  });
});

// ── DB-level proof: cross-tenant attach is a Postgres-level rejection, not an app promise. ──
const ORG_A = "tenant-fk-org-a";
const ORG_B = "tenant-fk-org-b";
const POST_A = "tenant-fk-post-a";

async function seed(): Promise<void> {
  await prisma.organization.createMany({ data: [{ id: ORG_A }, { id: ORG_B }] });
  await prisma.scheduledPost.create({
    data: {
      id: POST_A,
      ownerId: ORG_A,
      projectId: ORG_A,
      channel: "instagram",
      caption: "org a's post",
      scheduledAt: new Date(),
      scheduledTz: "UTC",
      source: "owner",
    },
  });
}

describe("TENANT-A7 DB 级:ScheduledPostMedia 复合外键", () => {
  it("TENANT-A7: 同租户挂接成功(ownerId 与父行一致)", async () => {
    await seed();
    await expect(
      prisma.scheduledPostMedia.create({
        data: { id: "spm-same-tenant", scheduledPostId: POST_A, ownerId: ORG_A, generationId: "gen-x", position: 0 },
      }),
    ).resolves.toMatchObject({ id: "spm-same-tenant" });
  });

  it("TENANT-A7: 跨租户挂接被数据库拒绝(P2003,而非应用层判断)", async () => {
    await seed();
    await expect(
      prisma.scheduledPostMedia.create({
        // B 的行,却挂在 A 的帖子上 —— ownerId 与 scheduledPostId 所属的父行租户不一致。
        data: { id: "spm-cross-tenant", scheduledPostId: POST_A, ownerId: ORG_B, generationId: "gen-y", position: 0 },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

// ── DB-level proof: 嵌套 create 路径(schedule-service.ts 实际写法)也满足复合外键 —
// 父行 ScheduledPost.ownerId 自动填到子行 media,调用方不需要(也不能)自己传 ownerId。
const ORG_NESTED = "tenant-fk-org-nested";
const POST_NESTED = "tenant-fk-post-nested";

describe("TENANT-A7 DB 级:嵌套 create(schedule-service.ts 形状)自动继承父行 ownerId", () => {
  it("TENANT-A7: 嵌套 create 建带 2 条 media 的 ScheduledPost,两行 media 的 ownerId 均等于父行", async () => {
    await prisma.organization.create({ data: { id: ORG_NESTED } });
    await prisma.scheduledPost.create({
      data: {
        id: POST_NESTED,
        ownerId: ORG_NESTED,
        projectId: ORG_NESTED,
        channel: "instagram",
        caption: "nested create shape",
        scheduledAt: new Date(),
        scheduledTz: "UTC",
        source: "owner",
        media: {
          create: [
            { id: "spm-nested-1", generationId: "gen-nested-1", position: 0 },
            { id: "spm-nested-2", generationId: "gen-nested-2", position: 1 },
          ],
        },
      },
    });
    const rows = await prisma.scheduledPostMedia.findMany({
      where: { scheduledPostId: POST_NESTED },
      orderBy: { position: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ownerId)).toEqual([ORG_NESTED, ORG_NESTED]);
  });
});

describe("TENANT-A7 DB 级:PublishAttempt 复合外键(规格 §3「不做」节留到本片评估的那条)", () => {
  it("TENANT-A7: 同租户挂接成功(ownerId 与父行一致)", async () => {
    await seed();
    await expect(
      prisma.publishAttempt.create({
        data: { id: "pa-same-tenant", scheduledPostId: POST_A, ownerId: ORG_A, state: "APPLYING" },
      }),
    ).resolves.toMatchObject({ id: "pa-same-tenant" });
  });

  it("TENANT-A7: 跨租户挂接被数据库拒绝(P2003,而非应用层判断)", async () => {
    await seed();
    await expect(
      prisma.publishAttempt.create({
        // B 的行,却挂在 A 的帖子上 —— 这正是回填前"应用层记不记得查"决定生死的那种挂接;
        // 回填后数据库自己就能拒绝,不靠任何调用点自觉。
        data: { id: "pa-cross-tenant", scheduledPostId: POST_A, ownerId: ORG_B, state: "APPLYING" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
