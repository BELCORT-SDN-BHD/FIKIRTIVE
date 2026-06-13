"use server";
/**
 * Artlio cowork actions. v1 skills: draft a storyboard from an idea, and ✨
 * Enhance a prompt — each runs through the model-neutral cowork transport (mock
 * in dev, fal LLM in prod) and the per-skill runner. Drafting creates shots with
 * the SAME shot model a user's "Add shot" would, appended after any existing
 * scenes so it never clobbers work.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import {
  coworkRequest, enhanceRequest, MAX_ENHANCE_TEXT, newId, FOUNDER_OWNER_ID,
  createTransport, runSkill, draftStoryboardSkill, enhancePromptSkill,
  modelFamily, deriveMode,
} from "@artlio/core";
import { getEnhanceDirective } from "./cowork-knowledge";

const OWNED = { ownerId: FOUNDER_OWNER_ID, deletedAt: null } as const;
const transport = createTransport();

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
    plan = await runSkill(draftStoryboardSkill, idea, transport);
  } catch (e) {
    return { error: `Cowork couldn't draft that — ${e instanceof Error ? e.message.slice(0, 140) : "please try again"}.` };
  }
  if (!plan.scenes.length) return { error: "Cowork returned an empty plan — try a more specific idea." };

  // Append after existing scenes/numbers (never clobber the user's work), retried
  // on a unique collision (@@unique([projectId, number])): a concurrent "Add
  // shot"/cowork grabbing a number must NOT make this throw past the {error}
  // contract or roll back the whole draft (#5). Each attempt re-reads fresh.
  for (let attempt = 0; attempt < 4; attempt++) {
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
    try {
      // shots + the audit event in ONE transaction: a failure can't leave shots
      // created while the action returns {error} (or vice versa)
      await prisma.$transaction([
        prisma.shot.createMany({ data: rows }),
        prisma.actionEvent.create({
          data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.draft", payload: { scenes: plan.scenes.length, shots, via: transport.name } },
        }),
      ]);
      revalidatePath("/", "layout");
      return { ok: true, scenes: plan.scenes.length, shots, via: transport.name };
    } catch (e) {
      if (attempt < 3 && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") continue;
      return { error: "Couldn't save the draft — please try again." };
    }
  }
  return { error: "Couldn't allocate shot numbers — please try again." };
}

/** "✨ Enhance" — rewrite the composer's rough prompt into a vivid one. Pure
 *  transform (no DB write); mock in dev ($0), fal LLM in prod. The UI re-chips
 *  any @-named entities the model kept intact. */
export async function enhancePrompt(
  raw: unknown,
): Promise<{ ok: true; text: string; via: string } | { error: string }> {
  const parsed = enhanceRequest.safeParse(raw);
  if (!parsed.success) return { error: "Write a prompt first, then ✨ Enhance." };
  const { projectId, text, model, kind, conditioned, hasSource, hasTail } = parsed.data;
  // owner-domain guard like every paid action (single-tenant today, multi-tenant-ready)
  const project = await prisma.project.findFirst({ where: { id: projectId, ...OWNED } });
  if (!project) return { error: "Project not found." };

  // Phase 1: server-derive (family, mode) from the gen-shape and read the tuned
  // directive. Best-effort — a knowledge-read hiccup degrades to the family-neutral
  // base prompt and NEVER blocks Enhance. Mode is server-derived (R3), never a
  // client mode string.
  const family = model ? modelFamily(model) : undefined;
  const mode = family ? deriveMode({ kind: kind ?? "image", conditioned, hasSourceImage: hasSource, hasTailImage: hasTail }) : undefined;
  let directive: string | undefined;
  try {
    if (family && mode) directive = await getEnhanceDirective(family, mode);
  } catch { /* knowledge read is best-effort — fall back to the base prompt */ }

  try {
    // clamp to the downstream generate cap so an over-long rewrite can't fail genRequest
    const out = (await runSkill(enhancePromptSkill, text, transport, { directive })).trim().slice(0, MAX_ENHANCE_TEXT);
    if (!out) return { error: "Enhance came back empty — try again." };
    try {
      // audit the paid LLM call (records usage for the future cost/credit ledger)
      await prisma.actionEvent.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, projectId, type: "cowork.enhance", payload: { via: transport.name, chars: out.length, family: family ?? null, mode: mode ?? null, directiveApplied: !!directive } },
      });
    } catch { /* audit is best-effort — never lose a paid result on a log-write hiccup */ }
    return { ok: true, text: out, via: transport.name };
  } catch (e) {
    return { error: `Couldn't enhance that — ${e instanceof Error ? e.message.slice(0, 140) : "please try again"}.` };
  }
}
