/**
 * setTitle — $0 tool
 *
 * Sets the conversation title on the active ChatThread. Spends NO money, creates NO GenJob,
 * calls NO fal/generation code.
 *
 * Identity comes exclusively from OttoContext (ctx), never from tool input — the
 * model cannot spoof ownerId or threadId.
 */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------
const setTitleInput = z.object({
  title: z.string().min(1).max(80),
});

type SetTitleInput = z.infer<typeof setTitleInput>;

// ---------------------------------------------------------------------------
// Execute function (DB side) — exported separately for direct unit-testing
// ---------------------------------------------------------------------------

export async function executeSetTitle(
  input: SetTitleInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ ok: boolean }> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;

  await prisma.chatThread.updateMany({
    where: { id: ctx.threadId, ownerId: ctx.orgId, deletedAt: null },
    data: { title: input.title.trim() },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// SDK tool definition
// ---------------------------------------------------------------------------

export const setTitleSkill = defineOttoSkill({
  name: "setTitle",
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Set a concise ≤6-word title for the current conversation. " +
    "Call once early in a new conversation when a good title is clear. " +
    "This is $0.",
  parameters: setTitleInput,
  execute: executeSetTitle,
});

// Backward-compatible bare-tool export (keeps existing imports + tests unchanged).
export const setTitle = setTitleSkill.tool;
