"use server";

import { prisma } from "@fikirtive/db";
import { requireOwner } from "./auth-guard";

async function ownedProject(projectId: string, ownerId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
}

/**
 * Per-thread activity for one project: a thread is "pending" when it has an in-flight
 * GenJob (QUEUED/GENERATING) or a pending CanvasNode. Read-only, owner+project scoped.
 */
export async function listProjectThreadActivity(
  projectId: string,
): Promise<{ threadId: string; pending: boolean }[] | { error: string }> {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  if (!(await ownedProject(projectId, gate.ownerId))) return { error: "Project not found." };
  const { ownerId } = gate;

  const [threads, jobs, nodes] = await Promise.all([
    prisma.chatThread.findMany({ where: { ownerId, projectId, deletedAt: null }, select: { id: true } }),
    prisma.genJob.findMany({
      where: { ownerId, projectId, status: { in: ["QUEUED", "GENERATING"] }, threadId: { not: null } },
      select: { threadId: true },
    }),
    prisma.canvasNode.findMany({
      where: { ownerId, projectId, status: "pending", threadId: { not: null } },
      select: { threadId: true },
    }),
  ]);

  const pending = new Set<string>();
  for (const j of jobs) if (j.threadId) pending.add(j.threadId);
  for (const n of nodes) if (n.threadId) pending.add(n.threadId);

  return threads.map((t) => ({ threadId: t.id, pending: pending.has(t.id) }));
}
