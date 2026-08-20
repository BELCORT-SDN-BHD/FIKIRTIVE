/**
 * sharePostPreview — $0 internal-write skill (B0-28, B4 block spec §2.2; NODE-275 收口2/3).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false.
 * Internal, NOT external: minting a share link writes nothing to any outside platform — it writes
 * ONE SharePreviewToken row (the spec-frozen "内部写一行 token 记录": the AUTHORITY layer — audit +
 * revocation) and signs an HMAC (ownerId+postId+exp) token (the TRANSPORT layer) for a SEAT-LESS,
 * read-only preview link. verify = HMAC valid ∧ row live, so a revoked or missing row kills the
 * link even inside its TTL; an unauthorized / expired / tampered token resolves to a fail-closed
 * 404 (spec §2.2, mock risk 14/18 closed). TTL is SERVER-FIXED — the model cannot pass an expiry.
 *
 * revoke:true flips to the inverse write: revoke every active link for the post (same owner-scoped
 * server action layer the human page will use).
 *
 * Reaches the schedule ONLY via ctx.schedule.sharePreview / ctx.schedule.sharePreviewRevoke
 * (injected, owner-closed) — the server verifies the post is the caller's own before signing.
 * Never Prisma / an external API directly.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  scheduledPostId: z
    .string()
    .min(1)
    .describe("Id of the user's scheduled post to make (or revoke) a shareable read-only preview link for."),
  revoke: z
    .boolean()
    .optional()
    .describe("Pass true to REVOKE every active share link for this post instead of creating one."),
});
type Input = z.infer<typeof params>;

export async function executeSharePostPreview(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (input.revoke === true) {
    if (!ctx?.schedule?.sharePreviewRevoke) return { error: "Sharing isn't available right now." };
    return ctx.schedule.sharePreviewRevoke({ scheduledPostId: input.scheduledPostId });
  }
  if (!ctx?.schedule?.sharePreview) return { error: "Sharing isn't available right now." };
  return ctx.schedule.sharePreview({ scheduledPostId: input.scheduledPostId });
}

export const sharePostPreviewSkill = defineOttoSkill({
  name: "sharePostPreview",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Create a seat-less, read-only share link for one of the user's scheduled posts so they can send " +
    "it for external review without giving anyone an account. $0. Give the scheduledPostId; returns a " +
    "time-boxed link (expiry is fixed server-side). The link reveals only that one post and expires on " +
    "its own. Pass revoke:true to instead kill every active share link for that post.",
  parameters: params,
  execute: executeSharePostPreview,
});
