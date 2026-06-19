"use server";
/**
 * Admin actions for the cowork knowledge base (Phase 0B). R7: every handler
 * re-asserts auth() + the email allowlist INSIDE the handler, independent of the
 * opt-in middleware wall (proxy.ts / AUTH_ENABLED).
 * P3: admin actions write PLATFORM CONFIG + audit stamped to the FOUNDER org (the acting
 * context for platform staff). They are cross-tenant by design and EXCLUDED from the
 * requireOwner() tenant scoping — gated by User.role (requireRole), never Membership.role.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@artlio/db";
import { newId, FOUNDER_OWNER_ID, modelDirectiveInput, DIRECTIVE_SEED, runtimeConfigInput, isKnownModelId, roleSchema } from "@artlio/core";
import { requireRole } from "./auth-guard";

/** Upsert one (family, mode) directive cell + append a revision snapshot (R6) +
 *  audit, atomically. A founder edit takes effect on the next Enhance (the read
 *  is uncached, R6). Omitting `rules` preserves the stored rules (Prisma treats
 *  undefined as "leave unchanged" on update). */
export async function saveModelDirective(
  raw: unknown,
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("knowledge", "mutate");
  if ("error" in gate) return gate;
  const parsed = modelDirectiveInput.safeParse(raw);
  if (!parsed.success) return { error: "That directive is out of bounds." };
  const { family, mode, directive, rules, notes, confidence, enabled, source } = parsed.data;
  const rulesJson = rules ?? undefined; // undefined → unchanged on update / null on create

  try {
    await prisma.$transaction(async (tx) => {
      // upsert returns the real row id (race-safe vs computing an id up front)
      const row = await tx.modelDirective.upsert({
        where: { ownerId_family_mode: { ownerId: FOUNDER_OWNER_ID, family, mode } },
        create: { id: newId(), ownerId: FOUNDER_OWNER_ID, family, mode, directive, rules: rulesJson, notes, confidence, enabled, source },
        update: { directive, rules: rulesJson, notes, confidence, enabled, source },
        select: { id: true, directive: true, rules: true, confidence: true, enabled: true, source: true },
      });
      await tx.modelDirectiveRevision.create({
        data: { id: newId(), directiveId: row.id, ownerId: FOUNDER_OWNER_ID, directive: row.directive, rules: row.rules ?? undefined, confidence: row.confidence, enabled: row.enabled, source: row.source, editedBy: gate.email },
      });
      await tx.actionEvent.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "directive.edit", payload: { family, mode, confidence, enabled, via: gate.email } },
      });
    });
  } catch {
    return { error: "Couldn't save the directive — please try again." };
  }
  revalidatePath("/admin/directives");
  return { ok: true };
}

/** Sync the research seed: INSERT cells that are still absent, and REFRESH cells
 *  that are still pristine seed (source "research" AND no founder revision) to the
 *  current DIRECTIVE_SEED text. Never clobbers a founder edit — a founder save sets
 *  source!="research" and always writes a revision, so edited cells are skipped.
 *  This is what lets improved research directives reach prod without a migration. */
export async function seedResearchDirectives(): Promise<{ ok: true; inserted: number; refreshed: number } | { error: string }> {
  const gate = await requireRole("knowledge", "mutate");
  if ("error" in gate) return gate;
  try {
    const res = await prisma.modelDirective.createMany({
      data: DIRECTIVE_SEED.map((c) => ({
        id: newId(), ownerId: FOUNDER_OWNER_ID, family: c.family, mode: c.mode,
        directive: c.directive, rules: c.rules ?? undefined, notes: c.notes,
        confidence: c.confidence, enabled: true, source: "research",
      })),
      skipDuplicates: true,
    });
    // refresh pristine cells (never founder-touched) to the latest seed. The pristine
    // guard is INSIDE the updateMany WHERE, so it re-checks atomically — a founder save
    // landing mid-refresh writes a revision, the WHERE stops matching, count is 0, no
    // clobber. A founder save can keep source="research" (admin UI), so the revision
    // check (not source) is the load-bearing guard. Updates all seeded fields, not just text.
    let refreshed = 0;
    for (const c of DIRECTIVE_SEED) {
      const upd = await prisma.modelDirective.updateMany({
        where: { ownerId: FOUNDER_OWNER_ID, family: c.family, mode: c.mode, source: "research", revisions: { none: {} } },
        data: { directive: c.directive, rules: c.rules ?? undefined, notes: c.notes, confidence: c.confidence },
      });
      refreshed += upd.count;
    }
    await prisma.actionEvent.create({
      data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "directive.seed", payload: { inserted: res.count, refreshed, via: gate.email } },
    });
    revalidatePath("/admin/directives");
    return { ok: true, inserted: res.count, refreshed };
  } catch {
    return { error: "Couldn't seed defaults — please try again." };
  }
}

/** Write one runtime-config key. Base gate requireRole("model","mutate") (=ops) covers
 *  every NON-modal key. provider=modal is a per-VALUE exception: super-admin only (the
 *  uncensored self-hosted-planner content/ToS surface) AND a write-time credential check
 *  (mirroring the fal check) so getTransport never builds a throwing transport at request
 *  time. Audited; a cowork_provider write records the provider for high-sensitivity audit. */
export async function saveRuntimeConfig(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("model", "mutate");      // ops can write all NON-modal keys
  if ("error" in gate) return gate;
  const parsed = runtimeConfigInput.safeParse(raw);
  if (!parsed.success) return { error: "That setting is out of bounds." };
  const { key, value } = parsed.data;

  if (key === "cowork_provider" && value.provider === "modal") {
    // §① provider=modal is super-admin only (uncensored-planner content/ToS surface)
    if (gate.role !== "super-admin") return { error: "Only a super-admin can switch to the self-hosted (modal) planner." };
    // write-time credential check: never persist a provider the web env can't build
    if (!process.env.MODAL_LLM_ENDPOINT || !process.env.MODAL_LLM_KEY) {
      return { error: "MODAL_LLM_ENDPOINT / MODAL_LLM_KEY are not set in this environment — can't switch to modal." };
    }
  }
  if (key === "cowork_provider" && value.provider === "fal" && !process.env.FAL_KEY) {
    return { error: "FAL_KEY is not set in this environment — can't switch to fal." };
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.runtimeConfig.upsert({
        where: { key }, create: { key, valueJson: value, updatedBy: gate.email }, update: { valueJson: value, updatedBy: gate.email },
      });
      await tx.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "config.edit", payload: { key, ...(key === "cowork_provider" ? { provider: value.provider } : {}), via: gate.email } } });
    });
  } catch {
    return { error: "Couldn't save the setting — please try again." };
  }
  revalidatePath("/admin/settings");
  return { ok: true };
}

/** Enable/disable one typed model in the registry overlay. requireRole("model","mutate")
 *  — P1b scopes section ① to ops. modelId MUST be a known typed model (write-time
 *  validation — the overlay can never disable a phantom). Audited transactionally.
 *  NOTE seedream coupling: disabling "seedream" disables ALL image generation
 *  (gen image + refgen base/sheet/variant) — the UI surfaces this as one toggle. */
export async function saveModelEnabled(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("model", "mutate");
  if ("error" in gate) return gate;
  const v = raw as { modelId?: unknown; enabled?: unknown; notes?: unknown };
  if (typeof v?.modelId !== "string" || !isKnownModelId(v.modelId)) return { error: "Unknown model." };
  if (typeof v?.enabled !== "boolean") return { error: "Invalid toggle." };
  const modelId = v.modelId;
  const enabled = v.enabled;
  const notes = typeof v?.notes === "string" ? v.notes.slice(0, 1000) : "";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.modelRegistryOverlay.upsert({
        where: { ownerId_modelId: { ownerId: FOUNDER_OWNER_ID, modelId } },
        create: { id: newId(), ownerId: FOUNDER_OWNER_ID, modelId, enabled, notes },
        update: { enabled, notes },
      });
      await tx.actionEvent.create({ data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "model.toggle", payload: { modelId, enabled, via: gate.email } } });
    });
  } catch {
    return { error: "Couldn't save the model setting — please try again." };
  }
  revalidatePath("/admin/models");
  return { ok: true };
}

/** Assign a team member's role. §④ Team & access — super-admin only (requireRole).
 *  Self-escalation-proof: a super-admin may NOT change their OWN role (no self-demote
 *  that locks out the team, no vacuous self-grant), and the granting path for
 *  super-admin is this same super-admin-gated action (never reachable by a lesser
 *  role). Target is looked up by id; role validated by the core zod enum. Audited
 *  transactionally with the write. */
export async function saveUserRole(raw: unknown): Promise<{ ok: true } | { error: string }> {
  const gate = await requireRole("team", "mutate");
  if ("error" in gate) return gate;
  const v = raw as { userId?: unknown; role?: unknown };
  if (typeof v?.userId !== "string" || !v.userId) return { error: "Missing user." };
  const parsedRole = roleSchema.safeParse(v.role);
  if (!parsedRole.success) return { error: "Unknown role." };
  const role = parsedRole.data;

  // self-escalation / self-lockout guard: a super-admin cannot change their own role.
  const target = await prisma.user.findUnique({ where: { id: v.userId }, select: { id: true, email: true, role: true } });
  if (!target) return { error: "User not found." };
  if (target.email && gate.email && target.email.toLowerCase() === gate.email.toLowerCase()) {
    return { error: "You can't change your own role." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { role } });
      await tx.actionEvent.create({
        data: { id: newId(), ownerId: FOUNDER_OWNER_ID, type: "rbac.role.set", payload: { targetUserId: target.id, targetEmail: target.email, from: target.role, to: role, via: gate.email } },
      });
    });
  } catch {
    return { error: "Couldn't update the role — please try again." };
  }
  revalidatePath("/admin/team");
  return { ok: true };
}
