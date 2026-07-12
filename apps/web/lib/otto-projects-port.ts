/**
 * makeOttoProjectsPort — the ctx.projects port factory (W-B3-D, debt-03~07, $0; v2 hardening per
 * 小节审 review #271 comment 4952217527).
 *
 * Wraps the SAME owner-gated campaign server actions the human sidebar uses (actions.ts). Identity is
 * NOT threaded into the actions: each re-derives the owner from the verified session via requireOwner()
 * (the session this run executes under), and every action is owner-scoped + fail-closed on a missing
 * or cross-owner id ("Project not found."). The ownerId parameter scopes ONLY the port's own pre-gate
 * read below. $0 by construction — none of these touch startGen / reserveCredits / the provider.
 *
 * remove — the Otto-only EMPTY-PROJECT hard gate (deterministic code, no model self-confirmation):
 * deleteProject is a PERMANENT hard delete that physically destroys the project's Generations
 * (actions.ts tx.generation.deleteMany) — settled PAID media included, with no refund. The human UI
 * fronts that with a type-the-full-name confirm dialog; Otto has no such door, so the port refuses to
 * delete any campaign that still contains a live Generation (deletedAt null count > 0) and directs the
 * user to the UI's by-hand confirm. Only an EMPTY campaign may be deleted through Otto — aligned with
 * the manageCanvas precedent (destructive action touching paid outputs = Otto hard-refuse + UI 亲点专属,
 * 宪法 11). Fail-closed: if the count read fails, refuse — never "couldn't check, delete anyway".
 * The gate deliberately lives HERE, not inside deleteProject: the human UI's legitimate type-to-confirm
 * hard delete is untouched.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover this
 * module (its capabilities are the manifest entries of the wrapped actions).
 */
import { prisma } from "@fikirtive/db";
import { getOrCreateDefaultProject, createProject, renameProject, setProjectPinned, deleteProject } from "./actions";

export function makeOttoProjectsPort(ownerId: string) {
  return {
    getDefault: () => getOrCreateDefaultProject(),
    create: (name: string) => createProject(name),
    rename: (projectId: string, name: string) => renameProject(projectId, name),
    setPinned: (projectId: string, pinned: boolean) => setProjectPinned(projectId, pinned),
    remove: async (projectId: string): Promise<{ ok: true } | { error: string }> => {
      // Deterministic pre-gate (see header): only an EMPTY campaign may be deleted via Otto.
      let liveGenerations: number;
      try {
        liveGenerations = await prisma.generation.count({ where: { projectId, ownerId, deletedAt: null } });
      } catch {
        // Fail-closed: can't verify it's empty ⇒ refuse (never "couldn't check, delete anyway").
        return { error: "I couldn't verify that campaign is empty, so I won't delete it. Please try again, or delete it by hand on the campaigns page." };
      }
      if (liveGenerations > 0) {
        return {
          error:
            "That campaign still contains generated media (paid work would be permanently destroyed with no refund), " +
            "so I can't delete it from here. Please delete it by hand on the campaigns page — it will ask you to type " +
            "the campaign's name to confirm. I can only delete an empty campaign.",
        };
      }
      return deleteProject(projectId);
    },
  };
}
