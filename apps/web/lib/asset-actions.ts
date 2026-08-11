"use server";

import { prisma } from "@fikirtive/db";
import { storageKey, newId, resolveUploadMime, MEDIA_SNIFF_BYTES, GEN_IMAGE_ASPECTS } from "@fikirtive/core";
import { requireOwner } from "./auth-guard";
import { storage, kindOf, extFromFilename } from "./storage";
import { redactProviderNames } from "./provider-secrecy";

export type GenerationDTO = {
  id: string;
  projectId: string;
  url: string;
  urls: string[];
  // Sibling variants aligned to `urls`, each with its OWN generation id (F08) and saved state.
  // The panel must
  // act on the SELECTED variant's id — not the primary `id` — for animate/delete/favorite/edit,
  // or it spends on / mutates the wrong image when a sibling variant is displayed.
  variants: { id: string; url: string; favorite: boolean }[];
  kind: string;
  prompt: string;
  /**
   * #776 —— 引擎自报**它真正跑的那句提示词**,商家可见。
   *
   * null 有两种情形,语义是同一个:引擎没报,或者这是回执落库之前的历史行。两种都叫
   * **未知**,面板据此什么也不说 —— 绝不回落成 `prompt` 冒充引擎的话(那样这个字段就
   * 变成一句永远为真的废话,商家再也看不出两句何时真的不同)。
   *
   * 白标在这里(服务端一处)完成:引擎改写出来的句子可能带供应商指纹词,过
   * `redactProviderNames` 之后才越过这道边界。原文按原样留在库里 —— 那是记账真相,
   * 过滤是展示层的事。
   */
  finalPrompt: string | null;
  favorite: boolean;
  sourceGenerationId: string | null;
  /**
   * #643 T2 —— 这张图**当初就是按这个形状交付的**，取自产出它那一单的规格快照
   * （`GenJob.imageOptions`），不是从像素反推。快照读不到（T1 迁移之前的老图）就是 null，
   * 面板据此如实说「和这张一样的形状」而不是编一个比例出来。
   */
  imageAspect: string | null;
};

export async function getGeneration(
  generationId: string,
): Promise<GenerationDTO | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const gen = await prisma.generation.findFirst({
    where: { id: generationId, ownerId, deletedAt: null },
    select: {
      id: true,
      projectId: true,
      promptText: true,
      finalPromptText: true,
      favorite: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true } },
    },
  });
  if (!gen) return { error: "Not found." };

  // Resolve the source generation ID: find the GenJob that produced this
  // generation and carried a sourceGenerationId (i.e., this was an i2v result).
  const job = await prisma.genJob.findFirst({
    where: { generationIds: { has: generationId }, ownerId },
    select: { sourceGenerationId: true, generationIds: true, imageOptions: true },
  });

  const { asset } = gen;
  const url = storage.url(storageKey(asset.ownerId, asset.contentHash, asset.ext));

  // Resolve sibling variants (id + url) from the producing GenJob's generationIds array
  // (owner-scoped). Kept as an aligned {id, url}[] so the panel can act on the SELECTED
  // variant's own generation id, not just show its url (F08).
  let variants: { id: string; url: string; favorite: boolean }[] = [{ id: gen.id, url, favorite: gen.favorite }];
  if (job && job.generationIds.length > 1) {
    const siblingIds = job.generationIds.filter((id) => id !== generationId);
    const siblings = await prisma.generation.findMany({
      where: { id: { in: siblingIds }, ownerId, deletedAt: null },
      select: { id: true, favorite: true, asset: { select: { ownerId: true, contentHash: true, ext: true } } },
    });
    const siblingMap = new Map(siblings.map((s) => [s.id, s]));
    // Preserve the original generationIds order; each entry carries its own id (a missing
    // sibling — soft-deleted — is dropped as a whole {id,url} pair, so id/url never misalign).
    variants = job.generationIds.flatMap((id) => {
      if (id === generationId) return [{ id, url, favorite: gen.favorite }];
      const sib = siblingMap.get(id);
      if (!sib) return [];
      return [{ id, url: storage.url(storageKey(sib.asset.ownerId, sib.asset.contentHash, sib.asset.ext)), favorite: sib.favorite }];
    });
    if (!variants.some((v) => v.id === generationId)) variants = [{ id: gen.id, url, favorite: gen.favorite }, ...variants];
  }

  return {
    id: gen.id,
    projectId: gen.projectId,
    url,
    urls: variants.map((v) => v.url),
    variants,
    kind: kindOf(asset.ext),
    prompt: gen.promptText,
    finalPrompt: merchantFinalPrompt(gen.finalPromptText),
    favorite: gen.favorite,
    sourceGenerationId: job?.sourceGenerationId ?? null,
    imageAspect: snapshotImageAspect(job?.imageOptions),
  };
}

/**
 * #776 —— 引擎自报的那句提示词跨过商家边界时的**唯一**出口。
 *
 * 两件事在这一处做完,所以别处不必各做一遍:
 *   ① 白标 —— 过 `redactProviderNames`,引擎改写时带出来的供应商指纹词到不了商家眼前;
 *   ② 空即未知 —— null / 空串 / 过滤后只剩空白,一律回 null。面板对 null 什么也不说。
 *      「不知道」必须长得像不知道,不能长得像一个空白的答案。
 */
function merchantFinalPrompt(stored: string | null): string | null {
  if (!stored) return null;
  const shown = redactProviderNames(stored).trim();
  return shown.length > 0 ? shown : null;
}

/** 快照里的形状，且必须仍在今天的菜单上 —— 一个已下线的旧形状不得靠这条路回到付费请求里。 */
function snapshotImageAspect(imageOptions: unknown): string | null {
  if (imageOptions === null || typeof imageOptions !== "object" || Array.isArray(imageOptions)) return null;
  const aspect = (imageOptions as { aspectRatio?: unknown }).aspectRatio;
  return typeof aspect === "string" && (GEN_IMAGE_ASPECTS as readonly string[]).includes(aspect)
    ? aspect
    : null;
}

/**
 * Ingest a cropped image (data URL) as a derived Generation row.
 * No paid model is called — this is a pure upload/ingest path.
 */
export async function saveCroppedGeneration(
  sourceGenerationId: string,
  dataUrl: string,
): Promise<{ id: string } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  // Verify ownership of the source generation
  const source = await prisma.generation.findFirst({
    where: { id: sourceGenerationId, ownerId, deletedAt: null },
    select: { projectId: true, promptText: true },
  });
  if (!source) return { error: "Not found." };

  // Parse the data URL: data:image/<ext>;base64,<data>
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!match) return { error: "Invalid data URL." };
  const base64Data = match[2];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data) || base64Data.length % 4 !== 0) {
    return { error: "Invalid data URL." };
  }
  const bytes = Uint8Array.from(Buffer.from(base64Data, "base64"));
  if (bytes.byteLength === 0) return { error: "Invalid data URL." };

  // Build a File so we can reuse the ingestFile path via storage.put directly
  // (ingestFile is not exported, so replicate its logic inline)
  const ext = extFromFilename(`cropped.${match[1]}`);
  const { contentHash } = await storage.put(ownerId, bytes, ext);

  const assetCreate = {
    id: newId(),
    ownerId,
    contentHash,
    ext,
    // 工单 F: byte-derived mime — the data URL's declared image/<ext> is a client claim; the bytes
    // decide. A crafted data:image/png;base64,<mp4> lands as application/octet-stream, not image/png.
    mime: resolveUploadMime(bytes.subarray(0, MEDIA_SNIFF_BYTES), ext),
    sizeBytes: BigInt(bytes.byteLength),
    originalFilename: `cropped.${ext}`,
    source: "UPLOAD" as const,
  };

  let newGenId = "";
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.upsert({
      where: { ownerId_contentHash: { ownerId, contentHash } },
      // resurrect AND realign to the byte-derived canonical values (repairs a poisoned prior row)
      update: {
        deletedAt: null,
        ext: assetCreate.ext,
        mime: assetCreate.mime,
        sizeBytes: assetCreate.sizeBytes,
        originalFilename: assetCreate.originalFilename,
      },
      create: assetCreate,
    });
    const gen = await tx.generation.create({
      data: {
        id: newId(),
        ownerId,
        projectId: source.projectId,
        shotId: null,
        assetId: asset.id,
        source: "UPLOAD",
        promptText: source.promptText || "cropped",
        entitySnapshot: { entities: [] },
      },
    });
    newGenId = gen.id;
  });

  return { id: newGenId };
}

export async function setFavorite(
  generationId: string,
  favorite: boolean,
): Promise<{ favorite: boolean } | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const { ownerId } = gate;

  const result = await prisma.generation.updateMany({
    where: { id: generationId, ownerId, deletedAt: null },
    data: { favorite },
  });

  return result.count === 1 ? { favorite } : { error: "Not found." };
}
