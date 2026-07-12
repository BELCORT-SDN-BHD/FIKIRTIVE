/**
 * makeOttoProjectsPort — the ctx.projects port factory (W-B3-D, debt-03~07, $0).
 *
 * Wraps the SAME owner-gated campaign server actions the human sidebar uses (actions.ts). Identity is
 * NOT threaded here: each action re-derives the owner from the verified session via requireOwner()
 * (the session this run executes under), and every action is owner-scoped + fail-closed on a missing
 * or cross-owner id ("Project not found."). deleteProject is additionally guarded (refuses while a
 * generation runs, refunds queued jobs). $0 by construction — none of these touch startGen /
 * reserveCredits / the provider.
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover this
 * module (its capabilities are the manifest entries of the wrapped actions).
 */
import { getOrCreateDefaultProject, createProject, renameProject, setProjectPinned, deleteProject } from "./actions";

export function makeOttoProjectsPort() {
  return {
    getDefault: () => getOrCreateDefaultProject(),
    create: (name: string) => createProject(name),
    rename: (projectId: string, name: string) => renameProject(projectId, name),
    setPinned: (projectId: string, pinned: boolean) => setProjectPinned(projectId, pinned),
    remove: (projectId: string) => deleteProject(projectId),
  };
}
