import "server-only";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { prisma } from "@fikirtive/db";
import {
  ACTOR_LIBRARY,
  ACTOR_LIBRARY_ASSET_DIR,
  ACTOR_CATALOG_VERSION,
  actorPresetBlocks,
  newId,
  resolveUploadMime,
  MEDIA_SNIFF_BYTES,
  type ActorCard,
  type ActorImage,
} from "@fikirtive/core";
import { storage } from "./storage";

/**
 * **把演员库五人放进一个 org 的 Library**(CREATE-A10;规格 `docs/specs/creation-engine.md` §8.1③)。
 *
 * 商家开工的第一分钟就该有人可拍。真人脸走 A9 的诚实拦截,而拦截给的出路是「从你的
 * Library 里挑一位」—— 那句话要成立,库里必须**已经**站着五个人。所以这件事挂在 org
 * 引导上(`bootstrapPersonalOrg`),不是一个商家要去点的按钮。
 *
 * ── 租户边界 ────────────────────────────────────────────────────────────────
 * **每租户各播各的**(Founder 2026-09-02 拍板)。这里写下的每一行 —— Asset、Entity、
 * ReferenceImage —— 都带调用方给的 `ownerId`,存储键也在 `u/<ownerId>/…` 命名空间里。
 * `catalogKey` 只是一个**标记**(「这是演员库里的哪一位」),不是新的权限维度:没有任何
 * 查询按它跨 org 读,两个 org 的同一位演员是两行互不可见的数据(CREATE-A10 逐条钉)。
 * `ownerId` 只能来自服务端已解析的 principal —— 本模块不接受任何客户端字段。
 *
 * ── 像素完整性铁律(Founder 2026-08-30)────────────────────────────────────────
 * 血统信任的标记在**像素**里:视频端认的是 Seedream 原始产物的字节,同一张图裁剪之后
 * 就会被拒「may contain real person」。所以这条入库路径上**没有任何图像处理**:
 *   仓库里的 `.bin` 原字节 → `storage.put` → `Asset`(内容寻址,键里就是这串字节的 sha256)。
 * 中间不缩放、不转格式、不再压缩,连一个图像库都不 import。入库前先拿人物卡上钉死的
 * sha256 核一遍字节(`readActorImage`),对不上就**这一位不入库**——宁可少一个演员,
 * 也不把一张会被供应商拒收的图放进商家的库里。
 *
 * ── 幂等 ────────────────────────────────────────────────────────────────────
 * 幂等压在数据库的 `(ownerId, catalogKey)` 唯一约束上,不是「先查后建」:两个请求同时给
 * 一个新 org 引导时,先查后建会双双查空、双双插入,商家的库里就出现十个人。这里先查是
 * **省事**(命中就跳过,连文件都不读),真正的防线是插入撞上 P2002 之后当作「别人已经
 * 播好了」跳过。`storage.put` 本身内容寻址,重跑不会产生第二份字节。
 *
 * ── 绝不抛 ──────────────────────────────────────────────────────────────────
 * 引导一个 workspace 的关键路径上(org、membership、开户赠额)不能因为一张图读不到就整体
 * 失败 —— 那会让商家连注册都完不成。所以本函数吞掉自己的异常、回报一份清单,由调用方
 * 记日志。方向是刻意的:这里既不碰钱也不碰租户边界,fail closed 的代价是拒绝一次注册,
 * 而 fail open 的代价只是这个 org 的库暂时空着(存量 org 由
 * `scripts/ops/seed-actor-library.ts` 补播)。
 */

/**
 * 定妆原件目录的绝对路径 —— **两个静态候选**,不是往上爬。
 *
 * 这个模块有两个调用方,cwd 不同:Next 的 server 跑在 `apps/web/`,ops 补播脚本
 * (`scripts/ops/seed-actor-library.ts`)跑在仓库根。所以两条路径都写死列出来:
 *   · 仓库根出发 → `assets/actor-library/v1`
 *   · apps/web 出发 → `../../assets/actor-library/v1`(与 `./storage` 的 LOCAL_ROOT 同一跳)
 *
 * **为什么不是「从 cwd 往上找」**:那一版 `next build` 会报「the whole project was traced
 * unintentionally」——Turbopack 的文件追踪看到一个完全动态拼出来的根,就把整个工程拖进
 * 产物清单(2026-09-02 实跑撞到)。官方给的解法就是把路径静态钉在某个子目录上,
 * 所以这里每一段前缀都是字面量,只有末尾的文件名是变量。
 *
 * 写死层数曾经也踩过另一个坑:只有 `../..` 那一条时,ops 脚本会去 `.claude/assets/…`
 * 找文件,五位演员全部落进 `failed`。两条候选同时列出来,两条路都对。
 *
 * 找不到就返回 null —— 调用方据此把这一位记进 `failed` 并留一条日志,而不是抛出去
 * 把一次注册变成失败(见文件头「绝不抛」)。
 */
function resolveAssetDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "assets", "actor-library", "v1"),
    path.join(process.cwd(), "..", "..", "assets", "actor-library", "v1"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

export interface ActorLibrarySeedResult {
  /** 本次真的入了库的 catalogKey。 */
  seeded: string[];
  /** 已经在库里、这次跳过的 catalogKey。 */
  skipped: string[];
  /** 出了问题、这次没入库的 catalogKey(下次引导或 ops 脚本会再试)。 */
  failed: string[];
}

/**
 * 读一张定妆图的原字节,并用人物卡上钉死的 sha256 核对。
 *
 * 核对失败就抛 —— 调用方把这一位记进 `failed`。这道闸防的是「仓库里的原件被谁顺手
 * 压过一遍」:那种改动在肉眼上看不出来,但会让这张图在供应商那边从「过门」变成「拒收」,
 * 而症状要等到商家出片失败才出现。
 */
async function readActorImage(image: ActorImage): Promise<Uint8Array> {
  const dir = resolveAssetDir();
  if (!dir) throw new Error(`actor-library: ${ACTOR_LIBRARY_ASSET_DIR} not found from ${process.cwd()}`);
  const bytes = new Uint8Array(await readFile(path.join(dir, image.file)));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== image.sha256) {
    throw new Error(`actor-library: ${image.file} bytes do not match the pinned sha256`);
  }
  return bytes;
}

/**
 * 一张图:原字节进内容寻址存储,返回一次 `Asset` upsert 需要的那些格。
 *
 * 形状照 `actions.ts` 的 `ingestFile`/`assetUpsert`(#698 的纪律:字节先落内容寻址存储 ——
 * 幂等、可重复;行写在事务里)。mime 由**字节**决定而不是文件名(工单 F),所以这里
 * 走的是同一个 `resolveUploadMime`,不是硬写一个 image/jpeg。
 */
async function ingestActorImage(ownerId: string, actor: ActorCard, image: ActorImage) {
  const bytes = await readActorImage(image);
  const { contentHash } = await storage.put(ownerId, bytes, image.ext);
  return {
    contentHash,
    create: {
      id: newId(),
      ownerId,
      contentHash,
      ext: image.ext,
      mime: resolveUploadMime(bytes.subarray(0, MEDIA_SNIFF_BYTES), image.ext),
      sizeBytes: BigInt(bytes.byteLength),
      originalFilename: `${actor.name}-${image.viewTag}.${image.ext}`,
      // 这些图确实是生成模型的产物(Seedream 纯文生),与 refgen 落盘的参考图同一类。
      source: "GENERATED" as const,
    },
  };
}

/** Prisma 唯一约束冲突。播种撞上它 = 并发的另一次引导已经把这一位放进去了。 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** 把一位演员放进这个 org:两张图 → 两个 Asset → 一个 CHARACTER 实体 → 两张 ReferenceImage。 */
async function seedOneActor(ownerId: string, actor: ActorCard): Promise<"seeded" | "skipped"> {
  const existing = await prisma.entity.findFirst({
    where: { ownerId, catalogKey: actor.catalogKey },
    select: { id: true },
  });
  if (existing) return "skipped";

  // 字节先走存储(内容寻址、可重复),行写在一个事务里 —— 元素与它的图一起活或一起死(#698)。
  const images = [
    { image: actor.closeup, ingested: await ingestActorImage(ownerId, actor, actor.closeup) },
    { image: actor.fullbody, ingested: await ingestActorImage(ownerId, actor, actor.fullbody) },
  ];

  const entityId = newId();
  try {
    await prisma.$transaction(async (tx) => {
      let baseAssetId: string | null = null;
      for (const [position, { image, ingested }] of images.entries()) {
        const { ext, mime, sizeBytes, originalFilename } = ingested.create;
        const asset = await tx.asset.upsert({
          where: { ownerId_contentHash: { ownerId, contentHash: ingested.contentHash } },
          update: { deletedAt: null, ext, mime, sizeBytes, originalFilename },
          create: ingested.create,
        });
        if (position === 0) {
          // 特写是定锚图 —— 与商家自己建元素时「第一张即 base」的不变量同一条。
          baseAssetId = asset.id;
          await tx.entity.create({
            data: {
              id: entityId,
              ownerId,
              type: "CHARACTER",
              name: actor.name,
              catalogKey: actor.catalogKey,
              // 一卡三用:Otto 写提示词、UI 画角色卡都读这一格,不再 import core 重算一遍
              // modest 与族裔的适配规则(那会是第二份真相)。
              descriptionJson: {
                catalog: ACTOR_CATALOG_VERSION,
                catalogKey: actor.catalogKey,
                card: {
                  identity: actor.identity,
                  face: actor.face,
                  hair: actor.hair,
                  heightCm: actor.heightCm,
                  build: actor.build,
                  wardrobe: actor.wardrobe,
                },
                presets: actorPresetBlocks(actor),
              },
            },
          });
        }
        await tx.referenceImage.create({
          data: { id: newId(), ownerId, entityId, assetId: asset.id, position, viewTag: image.viewTag },
        });
      }
      if (baseAssetId) {
        await tx.entity.update({
          where: { id_ownerId: { id: entityId, ownerId } },
          data: { baseAssetId },
        });
      }
    });
  } catch (e) {
    // 并发的另一次引导赢了 (ownerId, catalogKey) —— 这一位已经在库里,不是失败。
    if (isUniqueViolation(e)) return "skipped";
    throw e;
  }
  return "seeded";
}

/**
 * 给这个 org 播种演员库五人。幂等,永不抛 —— 见文件头「绝不抛」。
 *
 * `ownerId` 必须是服务端已经解析出来的 org id(`requireOwner` / `bootstrapPersonalOrg`
 * 的返回值),绝不能是任何请求体里带过来的字段。
 */
export async function seedActorLibrary(ownerId: string): Promise<ActorLibrarySeedResult> {
  const result: ActorLibrarySeedResult = { seeded: [], skipped: [], failed: [] };
  for (const actor of ACTOR_LIBRARY) {
    try {
      result[await seedOneActor(ownerId, actor)].push(actor.catalogKey);
    } catch (e) {
      // 固定类别日志,不带商家内容(#575 日志纪律)。
      console.error(
        `actor-library: seeding ${actor.catalogKey} failed:`,
        e instanceof Error ? e.message : e,
      );
      result.failed.push(actor.catalogKey);
    }
  }
  return result;
}
