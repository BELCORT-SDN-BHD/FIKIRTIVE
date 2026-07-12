/**
 * sharePostPreview — $0 internal-write skill (B0-28, B4 block spec §2.2).
 *
 * Gate: cost:"free" + effect:"write" + reach:"internal" → needsApproval = false.
 * Internal, NOT external: minting a share link writes nothing to any outside platform — it signs an
 * HMAC (ownerId+postId+exp) token for a SEAT-LESS, read-only preview link. So it is not an external
 * publish and does not gate; the link itself is owner-scoped, tamper-evident, and time-boxed, and an
 * unauthorized / expired token resolves to a fail-closed 404 (spec §2.2, mock risk 14/18 closed).
 *
 * Reaches the schedule ONLY via ctx.schedule.sharePreview (injected, owner-closed) — the server
 * verifies the post is the caller's own before signing. Never Prisma / an external API directly.
 */
import type { RunContext } from "@openai/agents";
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { OttoContext } from "../context.js";

const params = z.object({
  scheduledPostId: z
    .string()
    .min(1)
    .describe("Id of the user's scheduled post to make a shareable read-only preview link for."),
});
type Input = z.infer<typeof params>;

export async function executeSharePostPreview(
  input: Input,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  const ctx = runContext.context as OttoContext;
  if (!ctx?.schedule?.sharePreview) return { error: "Scheduling isn't available right now." };
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
    "time-boxed link. The link reveals only that one post and expires on its own.",
  parameters: params,
  execute: executeSharePostPreview,
});

export const sharePostPreview = sharePostPreviewSkill.tool;
