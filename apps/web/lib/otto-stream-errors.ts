import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { OTTO_TRANSIENT_FAILURE_SENTENCE, type OttoErrorData } from "./otto-stream-bridge";

export function streamTurnErrorId(): string {
  return `OTTO-${newId().slice(-8).toUpperCase()}`;
}

/** 瞬时失败那一句 ＋ 支持把手。句子本身读单源(#1224 判官 P2-3),这里只挂 Reference。 */
export function streamTurnErrorText(errorId: string): string {
  return `${OTTO_TRANSIENT_FAILURE_SENTENCE} Reference: ${errorId}`;
}

export async function persistStreamTurnError(args: {
  ownerId: string;
  threadId: string;
  seqAfterUser: number;
  userMessageId: string;
  refId: string;
  errorId?: string;
  error: OttoErrorData;
}): Promise<void> {
  const lastMsg = await prisma.chatMessage.findFirst({
    where: { threadId: args.threadId, ownerId: args.ownerId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  await prisma.chatMessage.create({
    data: {
      id: newId(),
      threadId: args.threadId,
      ownerId: args.ownerId,
      role: "AGENT",
      kind: "TURN_ERROR",
      seq: Math.max(args.seqAfterUser, lastMsg?.seq ?? 0) + 1,
      text: args.error.text,
      payload: {
        ...(args.errorId ? { errorId: args.errorId } : {}),
        refId: args.refId,
        userMessageId: args.userMessageId,
        kind: "stream_run_error",
        // Preserve the exact typed failure returned on data-error so a remount can
        // rehydrate the same notice and affordance instead of guessing from copy.
        error: args.error,
      },
    },
  });
}
