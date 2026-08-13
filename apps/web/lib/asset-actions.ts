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
  //
  // #776 r2：`finalPrompt` 同样是**逐张**的。一单多图 = 多次付费调用，引擎可以对每一张改写出
  // 不同的一句，worker 也确实逐行落库；只带主图那一句，切到第二张时面板会拿第一张的话去解释
  // 第二张 —— 一个比「不知道」更糟的答案。所以它跟 id/url/favorite 一样，绑在**这一张**上。
  variants: { id: string; url: string; favorite: boolean; finalPrompt: string | null }[];
  kind: string;
  prompt: string;
  /**
   * #776 —— 引擎自报**它真正跑的那句提示词**,商家可见。
   *
   * 被请求的那一行自己的那句(多图时每张各有各的,见 `variants[].finalPrompt`)。
   *
   * #914:这一列的 null 语义**按 kind 分家**——
   *   · kind:"video" —— null 有两种情形,语义是同一个:引擎没报,或者这是回执落库之前的
   *     历史行。两种都叫**未知**,面板把「未知」**说出来**("Not reported by the engine.")
   *     —— 不知道要长得像不知道,既不能悄悄消失,更不能回落成 `prompt` 冒充引擎的话。
   *   · kind:"image" —— null **恒为真**,不是「这次没报」:图片引擎的官方响应结构上就没有
   *     revised_prompt 这个字段(packages/core/src/refgen.ts 的 GenerationReceipt 注释),
   *     面板据此**整行不渲染**,不再念 "Not reported by the engine." 这句占位话(Founder
   *     裁决,#914,市调见 #909:通行做法是有则显示、无则整行消失)。图片这条路自己的
   *     回执事实改走 `requestedPrompt`(下面)。
   *
   * 白标在这里(服务端一处)完成:引擎改写出来的句子可能带供应商指纹词,过
   * `redactProviderNames` 之后才越过这道边界。原文按原样留在库里 —— 那是记账真相,
   * 过滤是展示层的事。
   */
  finalPrompt: string | null;
  /**
   * #914 r2(判官 r1 P1)—— 这一张在**我们自己的**拼装步骤(coworkGenerate 的
   * composePrompt,给未配专属提示词技能的模型家族追加家族×模式指令词)之前长什么样,
   * 只在那一步真的改了什么的时候才有值。image-only 的面板用它跟 `prompt`(平台实际送出
   * 的那句)逐字比对:相同就说「原样送出」,不同就把 `prompt` 整句亮出来 —— 恒定的
   * "Sent exactly as you wrote it." 与事实冲突,已被判官指出。
   *
   * null 不是「未知」:是「这一单没有可分家的两句话」—— 直接走 composer 的单、走 Otto
   * 对话 generate 技能的单、拼装本来就没变化的单,都落 null,读取端把它当 `prompt` 本身
   * 用即可。这条事实两端都是我们自己的数据(不靠引擎回不回执),所以不必像 `finalPrompt`
   * 那样把「未知」说出口。video 侧不读这一列(视频回执走 `finalPrompt` 那条老路,行为
   * 不变)。
   */
  requestedPrompt: string | null;
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
      requestedPromptText: true,
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
  const primaryVariant = { id: gen.id, url, favorite: gen.favorite, finalPrompt: merchantFinalPrompt(gen.finalPromptText) };
  let variants: { id: string; url: string; favorite: boolean; finalPrompt: string | null }[] = [primaryVariant];
  if (job && job.generationIds.length > 1) {
    const siblingIds = job.generationIds.filter((id) => id !== generationId);
    const siblings = await prisma.generation.findMany({
      where: { id: { in: siblingIds }, ownerId, deletedAt: null },
      // #776 r2：兄弟行也要读回执那一列，否则切换缩略图时面板只能拿主图那一句凑数。
      select: { id: true, favorite: true, finalPromptText: true, asset: { select: { ownerId: true, contentHash: true, ext: true } } },
    });
    const siblingMap = new Map(siblings.map((s) => [s.id, s]));
    // Preserve the original generationIds order; each entry carries its own id (a missing
    // sibling — soft-deleted — is dropped as a whole {id,url} pair, so id/url never misalign).
    variants = job.generationIds.flatMap((id) => {
      if (id === generationId) return [primaryVariant];
      const sib = siblingMap.get(id);
      if (!sib) return [];
      return [{
        id,
        url: storage.url(storageKey(sib.asset.ownerId, sib.asset.contentHash, sib.asset.ext)),
        favorite: sib.favorite,
        finalPrompt: merchantFinalPrompt(sib.finalPromptText),
      }];
    });
    if (!variants.some((v) => v.id === generationId)) variants = [primaryVariant, ...variants];
  }

  return {
    id: gen.id,
    projectId: gen.projectId,
    url,
    urls: variants.map((v) => v.url),
    variants,
    kind: kindOf(asset.ext),
    prompt: gen.promptText,
    // 这一条是**被请求的那一行**自己的那句(= variants 里 id === generationId 的那一条)。
    finalPrompt: primaryVariant.finalPrompt,
    // #914 r2 — 一单里每张图共用同一个 GenJob.requestedPrompt(拼装发生在这单**唯一**的
    // prompt 字段上,不是逐张的),所以不必像 finalPrompt 那样绑到 variants —— 读这一张
    // 自己的列就够,兄弟图会是同一个值。
    requestedPrompt: gen.requestedPromptText ?? null,
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
