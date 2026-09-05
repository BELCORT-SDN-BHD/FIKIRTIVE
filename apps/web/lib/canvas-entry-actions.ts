"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@fikirtive/db";
import { CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import {
  dedupeReferenceRefs,
  isEntityReferenceType,
  isReferenceType,
  type ReferenceRef,
} from "@fikirtive/core/reference-ref";
import { requireOwner, resolveUserPrincipal } from "./auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { newThreadTitle } from "./otto-canned-starters";
import { MAX_GEN_ENTITIES } from "@fikirtive/core/gen";
import { MAX_OTTO_COMPOSER_REFERENCES } from "./canvas-chat-reference";
import { DEFAULT_CANVAS_NAME } from "./canvas-title";
import { libraryMediaKindForExt } from "./library-types";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CANVAS_NAME = 80;
const MAX_CREATE_PROMPT = 4000;
/** Ids are `newId()` values; anything longer than this is not one of ours. */
const MAX_REFERENCE_ID = 128;
const CANVAS_START_FAILED = "Couldn't start that Canvas — please try again.";

/**
 * 起步页带进画布的引用,是**类型化 ID**,不是裸字符串(规格 §7.3⑨,沿用 §7.3③ 引用选择器的
 * `{type, id}` 形状)。两类都收:
 *   · 实体类(`product` / `character` / `official-avatar` / `location` / `brandmark`)——
 *     商家在输入框里 `@` 出来的那些,进画布首轮的 `entityIds`;
 *   · 媒体类(`generation` / `upload`)—— 起步页上传或从 Library 挑的那些。本仓库里上传也是
 *     一行 `Generation`(`lib/upload-actions.ts` 的 `finalizeCandidateUploads`),所以这个 id
 *     指向的行两种类型是同一张表;`upload` 与 `generation` 的分别是 Library 的**视图分桶**
 *     (`Generation.source`),单凭一个 id 校验不出来,也不是首轮要的信息,故两种一视同仁。
 */
export type CanvasHandoffReference = ReferenceRef;

/**
 * `null` = 这份引用列表**不是我们发出的形状**,整笔按失败处理(fail closed)。空数组 = 没带引用。
 * 客户端可以自报 id,但自报不等于拥有 —— 归属在读回那一刻按 ownerId 重新查
 * (`getCanvasConversationHandoff`),这里只管形状。
 *
 * 上限分两本,与画布 composer **同一个口径**(判官 #1242 P1-2):
 *   · 媒体(上传／Library 挑的)`MAX_OTTO_COMPOSER_REFERENCES` = 8 —— 画布那一侧的 8 件
 *     也只罩媒体(`upsertComposerReference`),实体不计入;
 *   · 实体(`@` 出来的)`MAX_GEN_ENTITIES` = 8 —— 画布首轮送到 `/api/otto/stream` 时,
 *     `entityIds` 也是按这一条卡的(`packages/core/src/cowork.ts`)。
 * 从前这里是**合计** 8:商家挂 3 张图再 `@` 6 件实体(两边各自都没超),起步页整笔被拒、
 * 屏幕上只有一句通用的「请再试一次」,而再试永远不会成功。那是本页新造的一条口径,不是
 * 画布的口径,现在两边一致。
 */
function parseHandoffReferences(raw: unknown): CanvasHandoffReference[] | null {
  if (raw === undefined || raw === null) return [];
  // 去重之前先给这一笔封个顶,免得一份超长(哪怕全是重复项)的数组白跑一遍循环。
  if (!Array.isArray(raw) || raw.length > MAX_OTTO_COMPOSER_REFERENCES + MAX_GEN_ENTITIES) return null;
  const refs: CanvasHandoffReference[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { type, id } = entry as { type?: unknown; id?: unknown };
    if (typeof type !== "string" || !isReferenceType(type)) return null;
    if (typeof id !== "string" || !id || id.length > MAX_REFERENCE_ID) return null;
    refs.push({ type, id });
  }
  const deduped = dedupeReferenceRefs(refs);
  const entityCount = deduped.filter((ref) => isEntityReferenceType(ref.type)).length;
  if (entityCount > MAX_GEN_ENTITIES) return null;
  if (deduped.length - entityCount > MAX_OTTO_COMPOSER_REFERENCES) return null;
  return deduped;
}

function identities(requestId: string) {
  return {
    projectId: `canvas_${requestId}`,
    threadId: `thread_${requestId}`,
    handoffId: `handoff_${requestId}`,
  };
}

function canvasName(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, MAX_CANVAS_NAME);
}

type CanvasConversationResult =
  | { projectId: string; threadId: string; handoffId: string }
  | { error: string };

/**
 * 起步页在**挂第一件参考之前**先把这块画布开出来,并返回它的 id。
 *
 * 为什么非开不可:`finalizeCandidateUploads` 落一行 `Generation` 必须有 `projectId`
 * (`lib/upload-actions.ts` 开头就 `project.findFirst`),而起步页此刻还没有画布 —— 规格
 * §7.3⑨ 点了这个问题的名,没给解法,本刀取的是「先建 project 再上传」。
 *
 * 代价说清楚:商家点了 Upload image、传完又不发送,画布史上就多一块空画布(名字是
 * `DEFAULT_CANVAS_NAME`)。它不是幽灵 —— 商家的那张图真的落在里面 —— 但确实是一块他
 * 没打算开的画布。登记在 `docs/specs/frontend-baseline.md` §5。
 *
 * 幂等靠的是同一个 `requestId`:起步页整场只生成一次 UUID,所以这里开的画布与随后
 * `createCanvasConversation` 收编的是同一块,不会开出第二块。
 */
export async function ensureCanvasDraft(raw: unknown): Promise<{ projectId: string } | { error: string }> {
  if (!raw || typeof raw !== "object") return { error: CANVAS_START_FAILED };
  const { requestId } = raw as { requestId?: unknown };
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return { error: CANVAS_START_FAILED };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<{ projectId: string } | { error: string }> => {
    const { ownerId } = gate;
    const ids = identities(requestId);
    try {
      const existing = await prisma.project.findFirst({
        where: { id: ids.projectId, ownerId, deletedAt: null },
        select: { id: true },
      });
      if (existing) return { projectId: existing.id };
      await prisma.project.create({
        data: { id: ids.projectId, ownerId, name: DEFAULT_CANVAS_NAME },
        select: { id: true },
      });
      return { projectId: ids.projectId };
    } catch {
      return { error: CANVAS_START_FAILED };
    }
  });
}

/**
 * The one production entry from Create into a new Canvas.
 *
 * The browser supplies a UUID for retry identity, never an owner or record id. The server derives
 * all three durable ids from it, scopes every replay to the authenticated tenant, and commits the
 * Canvas, empty Conversation and first-turn handoff together. No generation or credit action runs
 * here; the existing Otto stream consumes the handoff after navigation.
 */
export async function createCanvasConversation(raw: unknown): Promise<CanvasConversationResult> {
  if (!raw || typeof raw !== "object") return { error: CANVAS_START_FAILED };
  const input = raw as { prompt?: unknown; requestId?: unknown; references?: unknown };
  const prompt = typeof input.prompt === "string" ? input.prompt.replace(/\s+/g, " ").trim() : "";
  if (!prompt) return { error: "Describe what you want to create." };
  if (prompt.length > MAX_CREATE_PROMPT || typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId)) {
    return { error: CANVAS_START_FAILED };
  }
  const references = parseHandoffReferences(input.references);
  if (references === null) return { error: CANVAS_START_FAILED };

  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const principal = await resolveUserPrincipal(gate);
  return runAsUser(principal, async (): Promise<CanvasConversationResult> => {
    const { ownerId } = gate;
    const ids = identities(input.requestId as string);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const prior = await tx.actionEvent.findFirst({
          where: { id: ids.handoffId, ownerId, type: "canvas.create-handoff" },
          select: { projectId: true, payload: true },
        });
        if (prior) {
          const payload = prior.payload as { threadId?: unknown } | null;
          if (prior.projectId !== ids.projectId || payload?.threadId !== ids.threadId) {
            return { error: CANVAS_START_FAILED } as const;
          }
          const [project, thread] = await Promise.all([
            tx.project.findFirst({ where: { id: ids.projectId, ownerId, deletedAt: null }, select: { id: true } }),
            tx.chatThread.findFirst({ where: { id: ids.threadId, ownerId, projectId: ids.projectId, deletedAt: null }, select: { id: true } }),
          ]);
          if (!project || !thread) return { error: CANVAS_START_FAILED } as const;
          return ids;
        }

        // 这块画布可能已经被 `ensureCanvasDraft` 用**同一个 requestId** 开过了 —— 商家在起步页
        // 先挂了一张参考图,上传要有 projectId 才落得下去。那种情况下这里是把草稿收编成正式的:
        // 名字直到此刻才第一次有内容可写。没有草稿就照旧新建;要么改名要么新建,不会开出第二块。
        const draft = await tx.project.findFirst({
          where: { id: ids.projectId, ownerId, deletedAt: null },
          select: { id: true },
        });
        if (draft) {
          await tx.project.update({
            where: { id_ownerId: { id: ids.projectId, ownerId } },
            data: { name: canvasName(prompt) },
            select: { id: true },
          });
        } else {
          await tx.project.create({
            data: { id: ids.projectId, ownerId, name: canvasName(prompt) },
            select: { id: true },
          });
        }
        await tx.chatThread.create({
          // FRONT-A14:画布入口开的对话登记成 `canvas`,侧栏面板就不会在别的页面上把它
          // 当成「你刚才在聊的那条」自动摊开(`lib/otto-thread-surface.ts`)。
          data: { id: ids.threadId, ownerId, projectId: ids.projectId, title: newThreadTitle(prompt), surface: "canvas" },
          select: { id: true },
        });
        await tx.actionEvent.create({
          data: {
            id: ids.handoffId,
            ownerId,
            projectId: ids.projectId,
            type: "canvas.create-handoff",
            // 展开成字面量再写:`ReferenceRef` 是 interface,Prisma 的 JSON 入参只收带索引
            // 签名的形状 —— 这一步不是复制,是把类型化引用铺成 JSON 能存的样子。
            payload: {
              prompt,
              threadId: ids.threadId,
              ...(references.length
                ? { references: references.map((ref) => ({ type: ref.type, id: ref.id })) }
                : {}),
            },
          },
        });
        return ids;
      });
      if ("error" in result) return result;
      revalidatePath(CREATE_NAV_HREF);
      return result;
    } catch {
      return { error: CANVAS_START_FAILED };
    }
  });
}

/**
 * 首轮要挂的那些引用,已按**服务端**重新查过归属并解成画布首轮认得的三份 id。
 * 空数组 = 这一笔没带那一类引用(不是「不知道」)。
 */
export type CanvasConversationHandoff = {
  prompt: string;
  /** `@` 出来的实体 —— 画布首轮的 `entityIds`。 */
  entityIds: string[];
  /** 图片素材 —— 画布首轮的 `sourceGenerationIds`。 */
  sourceGenerationIds: string[];
  /** 影片素材 —— 画布首轮的 `referenceVideoGenerationIds`。 */
  referenceVideoGenerationIds: string[];
};

/** Read-only server seam used by the Canvas entry. It never trusts ids inside the payload. */
export async function getCanvasConversationHandoff(input: {
  ownerId: string;
  handoffId: string;
  projectId: string;
  threadId: string;
}): Promise<CanvasConversationHandoff | null> {
  if (!input.handoffId.startsWith("handoff_") || !input.projectId || !input.threadId) return null;
  const row = await prisma.actionEvent.findFirst({
    where: {
      id: input.handoffId,
      ownerId: input.ownerId,
      projectId: input.projectId,
      type: "canvas.create-handoff",
    },
    select: { payload: true },
  });
  const payload = row?.payload as
    | { prompt?: unknown; threadId?: unknown; references?: unknown }
    | null
    | undefined;
  if (payload?.threadId !== input.threadId || typeof payload.prompt !== "string" || !payload.prompt.trim()) return null;

  /**
   * 归属在**这里**重查,不在写入那一刻信客户端。起步页交上来的 id 只是一个定位参数:
   * 不是这个租户的、已经删掉的,一律当作不存在 —— 少挂一件参考,好过替商家把别人的东西
   * 塞进他自己那一轮。形状坏掉(不是我们发的那种)整笔当没带引用。
   */
  const refs = parseHandoffReferences(payload.references) ?? [];
  const entityRefIds = refs.filter((ref) => isEntityReferenceType(ref.type)).map((ref) => ref.id);
  const mediaRefIds = refs.filter((ref) => !isEntityReferenceType(ref.type)).map((ref) => ref.id);
  const [entities, generations] = await Promise.all([
    entityRefIds.length
      ? prisma.entity.findMany({
          where: { id: { in: entityRefIds }, ownerId: input.ownerId, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
    mediaRefIds.length
      ? prisma.generation.findMany({
          where: { id: { in: mediaRefIds }, ownerId: input.ownerId, deletedAt: null },
          select: { id: true, asset: { select: { ext: true } } },
        })
      : Promise.resolve([]),
  ]);
  const ownedEntityIds = new Set(entities.map((entity) => entity.id));
  // 图片进 `sourceGenerationIds`、影片进 `referenceVideoGenerationIds` —— 分法与素材库
  // 同一条规则(`lib/library-types.ts` 的 `libraryMediaKindForExt`),不在这里另立一套。
  const mediaKindById = new Map(
    generations.map((generation) => [generation.id, libraryMediaKindForExt(generation.asset.ext)] as const),
  );

  return {
    prompt: payload.prompt,
    // 顺序按商家挂的顺序保留:参考的次序在画布那一侧是有意义的(<Image_1>…<Image_N>)。
    entityIds: entityRefIds.filter((id) => ownedEntityIds.has(id)),
    sourceGenerationIds: mediaRefIds.filter((id) => mediaKindById.get(id) === "image"),
    referenceVideoGenerationIds: mediaRefIds.filter((id) => mediaKindById.get(id) === "video"),
  };
}
