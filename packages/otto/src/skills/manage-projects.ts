/**
 * manageProjects — $0 project (campaign) skill (W-B3-D, parity debts 03-07 / B0-10).
 *
 * Lets Otto manage the owner's campaigns the SAME way the human sidebar does: read/bootstrap the
 * default campaign, create a new one, rename it, pin/unpin it, or permanently delete one.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.projects`
 * port — thin closures over the SAME owner-gated server actions the human UI uses (actions.ts:
 * getOrCreateDefaultProject / createProject / renameProject / setProjectPinned / deleteProject).
 * This skill never touches Prisma or the web action files directly (CI fence rule). Owner scope and
 * every fail-closed "Project not found." guard live INSIDE those actions (requireOwner).
 *
 * $0 by construction: nothing here creates a GenJob, reserves credits, or calls the provider. It
 * only manages campaign rows. `delete` is a PERMANENT hard delete — and delete parity is
 * EMPTY-PROJECT ONLY: the ctx.projects port hard-refuses (deterministic live-Generation count gate,
 * fail-closed) any campaign that still contains generated media, because deleting it would physically
 * destroy settled PAID outputs with no refund; that deletion is the user's by-hand, type-the-name
 * confirm in the UI (宪法 11 protective rail — no model self-confirmation, 小节审 #271 处方). The model
 * must also NEVER invent an id: owner scope + not-found guards fail closed on a fabricated id.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext } from "../context.js";

const params = z.object({
  action: z.enum(["get_default", "create", "rename", "set_pinned", "delete"]),
  // create / rename — the campaign name:
  name: z.string().trim().min(1).max(80).optional().describe("create: the new campaign's name. rename: the new name."),
  // rename / set_pinned / delete — which campaign:
  projectId: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("rename/set_pinned/delete: the target campaign id (from context or get_default). delete REQUIRES it — never guess."),
  // set_pinned — pin state:
  pinned: z.boolean().optional().describe("set_pinned: true to pin the campaign to the top, false to unpin."),
});

type ManageProjectsInput = z.infer<typeof params>;

export async function executeManageProjects(
  input: ManageProjectsInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const projects = ctx.projects;
  if (!projects) return { ok: false, error: "Campaign management isn't available right now." };

  switch (input.action) {
    case "get_default": {
      const r = await projects.getDefault();
      return "error" in r ? { ok: false, error: r.error } : { ok: true, projectId: r.id };
    }
    case "create": {
      if (!input.name) return { ok: false, error: "create needs a `name`." };
      const r = await projects.create(input.name);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, projectId: r.id };
    }
    case "rename": {
      if (!input.projectId) return { ok: false, error: "rename needs `projectId`." };
      if (!input.name) return { ok: false, error: "rename needs a `name`." };
      const r = await projects.rename(input.projectId, input.name);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, name: r.name };
    }
    case "set_pinned": {
      if (!input.projectId) return { ok: false, error: "set_pinned needs `projectId`." };
      if (input.pinned === undefined) return { ok: false, error: "set_pinned needs `pinned` (true or false)." };
      const r = await projects.setPinned(input.projectId, input.pinned);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, pinnedAt: r.pinnedAt };
    }
    case "delete": {
      // PERMANENT + EMPTY-ONLY: never delete a fabricated/implicit id — the user must have named a
      // real campaign; the owner-scoped action's "Project not found." fail-closes a wrong/forged id,
      // and it refuses while a generation runs (refunding queued jobs). The port additionally
      // hard-refuses (deterministic count gate, fail-closed) any campaign still holding live
      // generations — settled paid media is UI-only deletion (type-to-confirm door). That refusal
      // surfaces here verbatim; there is no confirm parameter to override it.
      if (!input.projectId) {
        return { ok: false, error: "delete needs the exact `projectId` of the campaign to remove — I won't guess which one." };
      }
      const r = await projects.remove(input.projectId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
  }
}

export const manageProjectsSkill = defineOttoSkill({
  name: "manageProjects",
  // $0 campaign management: reads/writes OUR project rows only (never credits, never the outside
  // world). free + write + internal ⇒ needsApproval=false — same as the human sidebar, which manages
  // campaigns without a confirm dialog. The delete's protection is the guarded owner-scoped action.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "Manage the user's campaigns (projects) — $0, never generates or spends. " +
    "get_default: the user's default campaign id. create: a new campaign (needs name). " +
    "rename: rename a campaign (needs projectId + name). set_pinned: pin/unpin (needs projectId + pinned). " +
    "delete: PERMANENTLY remove an EMPTY campaign (needs the exact projectId; irreversible — only when the user " +
    "clearly asks, and tell them it can't be undone). A campaign that still contains generated media is refused " +
    "here — the user deletes it by hand on the campaigns page, which asks them to type the campaign's name.",
  parameters: params,
  execute: executeManageProjects,
});

export const manageProjects = manageProjectsSkill.tool;
