"use server";
/**
 * Artlio cowork actions. v1 skill: draft a storyboard from an idea — cowork
 * plans scenes + shots (via the CoworkProvider: mock in dev, fal LLM in prod)
 * and creates them with the SAME shot model a user's "Add shot" would, appended
 * after any existing scenes so it never clobbers work.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import { coworkRequest, newId, FOUNDER_OWNER_ID } from "@artlio/core";
import { createCoworkProvider } from "@artlio/generation";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;
const provider = createCoworkProvider();

export async function coworkDraftStoryboard(
  raw: unknown,
): Promise<{ ok: true; scenes: number; shots: number; via: string } | { error: string }> {
  const parsed = coworkRequest.safeParse(raw);
  if (!parsed.success) return { error: "Tell cowork what to make (a short description)." };
  const { projectId, idea } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  let plan;
  try {
    plan = await provider.planStoryboard(idea);
  } catch (e) {
    return { error: `Cowork couldn't draft that — ${e instanceof Error ? e.message.slice(0, 140) : "please try again"}.` };
  }
  if (!plan.scenes.length) return { error: "Cowork returned an empty plan — try a more specific idea." };

  // append after existing scenes/numbers (never clobber the user's work)
  const lastScene = await prisma.shot.findFirst({ where: { projectId, ...OWNED }, orderBy: { scene: "desc" }, select: { scene: true } });
  const lastNum = await prisma.shot.findFirst({ where: { projectId }, orderBy: { number: "desc" }, select: { number: true } });
  let scene = lastScene?.scene ?? 0;
  let number = lastNum?.number ?? 0;
  let shots = 0;
  const rows = [];
  for (const sc of plan.scenes) {
    scene += 1;
    for (const sh of sc.shots) {
      number += 1;
      shots += 1;
      rows.push({
        id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, number, scene,
        description: sh.prompt,
        promptDoc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: sh.prompt }] }] },
      });
    }
  }
  await prisma.shot.createMany({ data: rows });
  await prisma.actionEvent.create({
    data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.draft", payload: { scenes: plan.scenes.length, shots, via: provider.name } },
  });
  revalidatePath("/", "layout");
  return { ok: true, scenes: plan.scenes.length, shots, via: provider.name };
}
