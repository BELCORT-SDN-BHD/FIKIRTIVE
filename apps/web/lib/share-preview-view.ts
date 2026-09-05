import "server-only";
import { prisma } from "@fikirtive/db";
import { storageKey } from "@fikirtive/core";
import { SCHEDULE_CHANNEL_CAPS, isScheduleChannel } from "@fikirtive/core/schedule-draft";
import { signMediaToken, verifySharePreviewToken } from "@fikirtive/token-crypto";
import { verifySharePreview } from "./share-preview";
import { consumeSharePreviewDoor } from "./rate-limit-gates";
import { PUBLIC_MEDIA_TTL_MS, publicMediaPath } from "./media-public-link";

/**
 * share-preview-view — the READ side of the seat-less share link (B0-28), and the ONLY module the
 * public preview page is allowed to get data from.
 *
 * The link has existed since B0-28: `sharePostPreview` mints it, Otto hands it to the merchant,
 * and the merchant sends it to a client. What never existed was the page it points at, so the
 * whole two-layer verification below it (share-preview.ts) had no caller — a promise handed out
 * in writing that resolved to a 404. This module is that missing caller.
 *
 * ── WHAT AN ANONYMOUS VIEWER MAY SEE, EXACTLY ────────────────────────────────────────────────
 * The token attests ONE (ownerId, postId) pair, so this module reads exactly that one post's
 * display fields and that one post's own media. There is no list, no search, no "recent", no
 * count, no name of the workspace, and no id of anything. The attested `ownerId` is a SCOPE on
 * every query and is never returned — the caller cannot learn whose post they are looking at
 * beyond what the caption itself says.
 *
 * ── EVERY REFUSAL IS ONE SHAPE ───────────────────────────────────────────────────────────────
 * Forged token, tampered token, expired token, revoked link, deleted post, a post that never
 * existed, `SHARE_PREVIEW_SECRET` unset — all return `{ state: "unavailable" }`. A viewer (and
 * anyone sweeping links) cannot tell "no such post" from "not yours" from "turned off", because
 * those three answers are the same object. `busy` is the ONE other state, and it is reachable
 * only by a caller whose token already passed the HMAC — it tells them nothing they did not
 * already hold.
 *
 * ── ORDER OF WORK (same reasoning as the media proxy, apps/web/app/api/media/pub/[token]) ─────
 * ① pure crypto, zero database: a forged or expired token dies here, so an unauthenticated GET
 *    can never be turned into database work; ② the public-door rate gate; ③ the two-layer
 *    verify (HMAC ∧ live mint row); ④ the one post read; ⑤ that post's own media.
 * Step ① repeats the HMAC that step ③ does again inside `verifySharePreview`. That is deliberate
 * and costs one HMAC: the alternative is either putting the counter in front of the crypto
 * (which builds the cheaper attack the media proxy's comment names) or splitting the authority
 * layer open so its two halves can be called separately, which would leave a way to check the
 * HMAC and forget the row.
 */

/** How long the media URLs handed to a viewer stay fetchable. Minutes, not the link's own days:
 *  the browser fetches them the moment the page paints, and a URL that outlives the page view is
 *  a copy of the merchant's image that keeps working after the link is revoked.
 *
 *  第二个消费者(素材面板的 Copy link)出现后,这个数字与 URL 模板搬到了唯一源头
 *  `lib/media-public-link.ts`;这里保留原来的名字与那句理由,值改成引用。 */
const PREVIEW_MEDIA_TTL_MS = PUBLIC_MEDIA_TTL_MS;

export type SharePreviewMedia = {
  /** A signed media-proxy URL for THIS post's image/clip. Nothing about storage is exposed. */
  readonly src: string;
  readonly kind: "image" | "video";
  readonly width: number | null;
  readonly height: number | null;
};

export type SharePreviewPost = {
  readonly state: "post";
  /** "Instagram" / "Facebook" / "X" — the channel the post is written for. */
  readonly channelLabel: string;
  readonly caption: string;
  readonly firstComment: string | null;
  /** Epoch ms — the slot the merchant picked, rendered in `scheduledTz`. */
  readonly scheduledAtMs: number;
  /** IANA zone the merchant picked the slot in, so a reviewer abroad reads the merchant's time. */
  readonly scheduledTz: string;
  /** Epoch ms — when this link stops working, straight off the token's own claim. */
  readonly linkExpiresAtMs: number;
  readonly media: readonly SharePreviewMedia[];
  /** True when the post HAS media but none of it could be handed over (e.g. no media secret on
   *  this server). The page says so plainly rather than silently showing a caption-only post. */
  readonly mediaWithheld: boolean;
};

export type SharePreviewView =
  | SharePreviewPost
  | { readonly state: "unavailable" }
  | { readonly state: "busy" };

const UNAVAILABLE = { state: "unavailable" } as const;

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);

/**
 * Resolve a share-preview token into the one post it authorizes, or a refusal.
 *
 * `requestHeaders` is only ever used to identify the caller for the rate gate.
 */
export async function loadSharePreview(
  token: string,
  requestHeaders: Headers,
): Promise<SharePreviewView> {
  if (!token) return UNAVAILABLE;

  // ① TRANSPORT, pure crypto, zero database work.
  if (!verifySharePreviewToken(token, process.env.SHARE_PREVIEW_SECRET ?? "")) return UNAVAILABLE;

  // ② The public door. After the crypto on purpose (see the header note).
  if (!(await consumeSharePreviewDoor(requestHeaders))) return { state: "busy" };

  // ③ AUTHORITY: HMAC ∧ live mint row. Null on revoked / missing / expired.
  const access = await verifySharePreview(token);
  if (!access) return UNAVAILABLE;

  // ④ THE ONE POST. `ownerId` scopes the read and is never returned.
  const post = await prisma.scheduledPost.findFirst({
    where: { id: access.postId, ownerId: access.ownerId, deletedAt: null },
    select: {
      channel: true,
      caption: true,
      firstComment: true,
      scheduledAt: true,
      scheduledTz: true,
      media: { select: { generationId: true }, orderBy: { position: "asc" } },
    },
  });
  if (!post) return UNAVAILABLE;

  const media = await previewMedia(
    access.ownerId,
    post.media.map((m) => m.generationId),
  );

  return {
    state: "post",
    channelLabel: isScheduleChannel(post.channel) ? SCHEDULE_CHANNEL_CAPS[post.channel].label : post.channel,
    caption: post.caption,
    firstComment: post.firstComment && post.firstComment.length > 0 ? post.firstComment : null,
    scheduledAtMs: post.scheduledAt.getTime(),
    scheduledTz: post.scheduledTz,
    linkExpiresAtMs: access.exp,
    media,
    mediaWithheld: post.media.length > 0 && media.length === 0,
  };
}

/**
 * Signed URLs for THIS post's media, in the post's own carousel order.
 *
 * The ids come from the post row that was already scoped to the attested owner — they are never
 * caller-supplied — and the read is scoped to that owner again. The URLs go through the existing
 * signed media proxy (`/api/media/pub/<token>`), which is the product's one built door for
 * "our private object, shown to somebody with no session who holds a signed authorization"; it
 * re-checks the key sits in the signed owner's namespace and 404s on anything else. No storage
 * host, bucket or key ever reaches the page.
 *
 * Fails QUIET, never loud: with no `MEDIA_PROXY_SECRET` on this server there is nothing to sign,
 * so the list comes back empty and the page says the images are not being shown.
 */
async function previewMedia(ownerId: string, generationIds: string[]): Promise<SharePreviewMedia[]> {
  const ids = generationIds.filter((id) => typeof id === "string" && id.length > 0);
  const secret = process.env.MEDIA_PROXY_SECRET ?? "";
  if (ids.length === 0 || !secret) return [];

  const gens = await prisma.generation.findMany({
    where: { id: { in: ids }, ownerId, deletedAt: null },
    select: {
      id: true,
      asset: { select: { ownerId: true, contentHash: true, ext: true, width: true, height: true } },
    },
  });
  const byId = new Map(gens.map((g) => [g.id, g]));

  const expMs = Date.now() + PREVIEW_MEDIA_TTL_MS;
  const out: SharePreviewMedia[] = [];
  for (const id of ids) {
    const gen = byId.get(id);
    // Defense in depth: the asset must live in the SAME owner's namespace the token attested,
    // or the key we would sign is not this owner's to show.
    if (!gen || gen.asset.ownerId !== ownerId) continue;
    const ext = gen.asset.ext.toLowerCase();
    const key = storageKey(gen.asset.ownerId, gen.asset.contentHash, ext);
    out.push({
      src: publicMediaPath(signMediaToken(ownerId, key, expMs, secret)),
      kind: VIDEO_EXTS.has(ext) ? "video" : "image",
      width: gen.asset.width,
      height: gen.asset.height,
    });
  }
  return out;
}
