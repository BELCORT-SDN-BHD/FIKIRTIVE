import { prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";

export function streamTurnErrorId(): string {
  return `OTTO-${newId().slice(-8).toUpperCase()}`;
}

export function streamTurnErrorText(errorId: string): string {
  return `Otto hit a snag - please try again. Reference: ${errorId}`;
}

export async function persistStreamTurnError(args: {
  ownerId: string;
  threadId: string;
  seqAfterUser: number;
  userMessageId: string;
  refId: string;
  errorId: string;
  text: string;
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
      text: args.text,
      payload: {
        errorId: args.errorId,
        refId: args.refId,
        userMessageId: args.userMessageId,
        kind: "stream_run_error",
      },
    },
  });
}
