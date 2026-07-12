/**
 * manageCanvas — $0 canvas skill (W-B3-A, parity debts 33-37 + 60 / E1-01).
 *
 * Lets Otto see and arrange the project's creative canvas: view every node (with status,
 * prompt, and derivation links), place text notes or ALREADY-generated media, edit text
 * notes, stamp a node's terminal display state, and remove nodes.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected
 * `ctx.canvas` port — thin closures over the SAME owner-gated $0 server actions the human
 * canvas UI uses (canvas-actions.{list,create,updateText,resolve,delete}CanvasNode and the
 * display-only otto-canvas-bridge.syncOttoCanvasNodes). This skill never touches Prisma or
 * the web action files directly (CI fence rule).
 *
 * $0 by construction: no action here creates a GenJob, reserves credits, or calls the
 * provider. Placing an image/video node only REFERENCES a generation that was already
 * produced and charged; making NEW media is the `generate` skill's job (spend, gated).
 * Removing a node never refunds or cancels the underlying job — so a still-generating paid
 * card is UI-only to remove: Otto hard-refuses and directs the user to remove it by hand on
 * the canvas (v2, codex TR1 item 2 — no model self-confirmation; 宪法 11 protective rail).
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext, CanvasNodeView } from "../context.js";

/** Cap the node payload returned to the model (a busy canvas can hold hundreds of nodes). */
export const VIEW_NODE_CAP = 60;

const DEFAULTS = { media: { w: 320, h: 320 }, text: { w: 240, h: 120 }, x: 80, y: 80 } as const;

const params = z.object({
  action: z.enum(["view", "place", "edit_text", "resolve", "remove"]),
  // place — what to put on the canvas:
  type: z
    .enum(["text", "image", "video"])
    .optional()
    .describe("place: node kind. image/video REQUIRE generationId (already-generated media only)."),
  text: z.string().max(4000).optional().describe("place(type=text) content, or edit_text new content."),
  prompt: z.string().max(2000).optional().describe("place: the prompt that produced the media (display metadata)."),
  generationId: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("place: id of an EXISTING owned generation to show. resolve: the generation that settled a node."),
  sourceNodeId: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe("place: the node this one derives from (draws the source→result link)."),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().max(4000).optional(),
  h: z.number().positive().max(4000).optional(),
  // edit_text / resolve / remove — which node:
  nodeId: z.string().min(1).max(80).optional().describe("edit_text/resolve/remove: the target node id (from view)."),
  // resolve — terminal display state:
  status: z
    .enum(["done", "failed", "timeout", "missing"])
    .optional()
    .describe("resolve: terminal display state. done also requires generationId."),
});

type ManageCanvasInput = z.infer<typeof params>;

/** Trimmed node view for the model: drop pixel metadata the agent doesn't act on. */
function toModelNode(n: CanvasNodeView) {
  return {
    id: n.id,
    type: n.type,
    status: n.status,
    x: n.x,
    y: n.y,
    w: n.w,
    h: n.h,
    text: n.text,
    prompt: n.prompt,
    generationId: n.generationId,
    sourceNodeId: n.sourceNodeId,
    hasMedia: !!n.url,
  };
}

/** Mirror of the human UI's in-flight-paid-gen delete guard (useCanvasGen.isInFlightPaidGen):
 *  an image/video node with no media yet and a non-terminal status may be a PAID job still
 *  running — deleting it hides the card without refunding or stopping the job. */
export function isInFlightPaidNode(node: Pick<CanvasNodeView, "type" | "status" | "url">): boolean {
  if (node.type !== "image" && node.type !== "video") return false;
  if (node.url) return false;
  return node.status === "pending" || node.status === "timeout";
}

export async function executeManageCanvas(
  input: ManageCanvasInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const canvas = ctx.canvas;
  if (!canvas) return { ok: false, error: "The canvas isn't available right now." };

  switch (input.action) {
    case "view": {
      // Display-only sync first (materializes chat results as nodes), then the node list.
      const nodes = await canvas.sync();
      if ("error" in nodes) return { ok: false, error: nodes.error };
      return {
        ok: true,
        count: nodes.length,
        truncated: nodes.length > VIEW_NODE_CAP,
        nodes: nodes.slice(0, VIEW_NODE_CAP).map(toModelNode),
      };
    }
    case "place": {
      if (!input.type) return { ok: false, error: "place needs `type` (text | image | video)." };
      if (input.type !== "text" && !input.generationId) {
        // $0 hard line: this skill only PLACES existing media. New media = the gated
        // `generate` skill (spend). Refuse instead of silently creating an empty card.
        return {
          ok: false,
          error: "Placing an image/video needs `generationId` of an existing generation. To make NEW media, use the generate tool instead.",
        };
      }
      const size = input.type === "text" ? DEFAULTS.text : DEFAULTS.media;
      const placed = await canvas.place({
        type: input.type,
        x: input.x ?? DEFAULTS.x,
        y: input.y ?? DEFAULTS.y,
        w: input.w ?? size.w,
        h: input.h ?? size.h,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.generationId ? { generationId: input.generationId } : {}),
        ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
      });
      if ("error" in placed) return { ok: false, error: placed.error };
      return { ok: true, id: placed.id };
    }
    case "edit_text": {
      if (!input.nodeId) return { ok: false, error: "edit_text needs `nodeId`." };
      if (input.text === undefined) return { ok: false, error: "edit_text needs `text`." };
      const r = await canvas.editText(input.nodeId, input.text);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "resolve": {
      if (!input.nodeId) return { ok: false, error: "resolve needs `nodeId`." };
      if (!input.status) return { ok: false, error: "resolve needs `status`." };
      const r = await canvas.resolve(input.nodeId, {
        status: input.status,
        ...(input.generationId ? { generationId: input.generationId } : {}),
      });
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
    case "remove": {
      if (!input.nodeId) return { ok: false, error: "remove needs `nodeId`." };
      // Fail-closed pre-check (v2): the $0 list read must succeed AND name the target,
      // or we refuse — never "couldn't check, delete anyway".
      const nodes = await canvas.list();
      if ("error" in nodes) return { ok: false, error: nodes.error };
      const target = nodes.find((n) => n.id === input.nodeId);
      if (!target) return { ok: false, error: "Node not found." };
      if (isInFlightPaidNode(target)) {
        // In-flight paid cards are UI-only removals (protective rail, 宪法 11): deleting
        // one hides a PAID job without refunding or stopping it. No model self-confirm.
        return {
          ok: false,
          error:
            "That node's generation is still in flight, so I can't remove it — removing it wouldn't refund or stop the job. Please confirm the removal by hand on the canvas; the finished output will still land in your Library.",
        };
      }
      const r = await canvas.remove(input.nodeId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true };
    }
  }
}

export const manageCanvasSkill = defineOttoSkill({
  name: "manageCanvas",
  // $0 canvas surface: writes OUR canvas rows only (place/edit/resolve/remove are DB state),
  // never the outside world, never credits. free + write + internal ⇒ needsApproval=false —
  // same as the human UI, which arranges the canvas without a confirm dialog.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    "See and arrange the project's creative canvas ($0 — never generates media or spends credits). " +
    "view: all nodes with status, prompts, and source→result derivation links. " +
    "place: add a text note, or show an ALREADY-generated image/video (needs generationId; link derivation via sourceNodeId). " +
    "edit_text: change a text note. resolve: stamp a node's terminal display state. " +
    "remove: delete a settled node (a card whose generation is still in flight can only be removed by the user, by hand on the canvas). " +
    "To CREATE new images/videos, use generate instead.",
  parameters: params,
  execute: executeManageCanvas,
});

export const manageCanvas = manageCanvasSkill.tool;
