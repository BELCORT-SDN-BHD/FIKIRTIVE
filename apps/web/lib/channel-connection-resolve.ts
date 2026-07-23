import "server-only";

import { prisma as defaultDb, type Prisma } from "@fikirtive/db";

type DatabaseClient = typeof defaultDb | Prisma.TransactionClient;

export async function resolveActiveProviderConnectionId(
  client: DatabaseClient,
  ownerId: string,
  channelScopeId: string,
  channel: string,
  onConflict: () => never,
): Promise<string | null> {
  const connections = await client.channelConnection.findMany({
    where: { ownerId, channelScopeId, kind: channel, status: "active" },
    take: 2,
    select: { id: true },
  });
  if (connections.length > 1) onConflict();
  return connections[0]?.id ?? null;
}
