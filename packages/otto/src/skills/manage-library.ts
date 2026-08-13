/**
 * manageLibrary — $0 Library skill (W-B3-D, parity debts 29/30/50 / E1-14).
 *
 * Lets Otto browse the owner's Library the SAME way the human Library does: page through the full
 * generation history (every source: cowork, canvas, upload, crop), read one generation's detail, or
 * star/unstar a generation.
 *
 * Single action layer (宪法 7 / Seam 9): every operation goes through the injected `ctx.library`
 * port — thin closures over the SAME owner-gated server actions the human UI uses
 * (library-actions.getGenerationHistory, asset-actions.getGeneration / setFavorite). This skill never
 * touches Prisma or the web action files directly (CI fence rule).
 *
 * $0 by construction: history/detail are reads; set_favorite is a $0 preference write. Nothing here
 * creates a GenJob, reserves credits, or calls the provider — it only reads/flags already-produced
 * generations that were charged when they were made.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";
import type { RunContext } from "@openai/agents";
import type { OttoContext, LibraryItemView } from "../context.js";
import { navLabel } from "@fikirtive/core";

/** Cap the history payload returned to the model (the port already keyset-pages at ~60). */
export const HISTORY_ITEM_CAP = 40;

const params = z.object({
  action: z.enum(["history", "detail", "set_favorite"]),
  // history — filters:
  search: z.string().max(200).optional().describe("history: only generations whose prompt contains this text."),
  favoriteOnly: z.boolean().optional().describe("history: only starred generations."),
  cursor: z.string().max(120).optional().describe("history: the nextCursor from a previous page (to read the next page)."),
  // detail / set_favorite — which generation:
  generationId: z.string().min(1).max(80).optional().describe("detail / set_favorite: the generation id."),
  // set_favorite — star state:
  favorite: z.boolean().optional().describe("set_favorite: true to star, false to unstar."),
});

type ManageLibraryInput = z.infer<typeof params>;

/** Trimmed library item for the model (the port already drops media urls/asset ids). */
function toModelItem(i: LibraryItemView) {
  return {
    id: i.id,
    projectId: i.projectId,
    kind: i.kind,
    prompt: i.prompt,
    // #776 r2:引擎自报「它真正跑的那句」。detail **总是**带这个键(null = 引擎没报 = 未知),
    // history 根本不查这一列所以键缺席。两种「没有」原样透传,不合并成一种 —— 模型据此说
    // 「引擎没告诉我」还是「我没查」,而不是拿商家自己那句话去解释上一轮结果。
    ...("finalPrompt" in i ? { finalPrompt: i.finalPrompt ?? null } : {}),
    favorite: i.favorite,
    ...(i.createdAt ? { createdAt: i.createdAt } : {}),
  };
}

export async function executeManageLibrary(
  input: ManageLibraryInput,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<unknown> {
  if (!runContext) throw new Error("OttoContext required");
  const ctx = runContext.context as OttoContext;
  const library = ctx.library;
  if (!library) return { ok: false, error: `The ${navLabel("library")} isn't available right now.` };

  switch (input.action) {
    case "history": {
      const page = await library.history({
        ...(input.search !== undefined ? { search: input.search } : {}),
        ...(input.favoriteOnly !== undefined ? { favoriteOnly: input.favoriteOnly } : {}),
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      });
      if ("error" in page) return { ok: false, error: page.error };
      const items = page.items.slice(0, HISTORY_ITEM_CAP).map(toModelItem);
      return {
        ok: true,
        count: items.length,
        truncated: page.items.length > HISTORY_ITEM_CAP,
        items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    }
    case "detail": {
      if (!input.generationId) return { ok: false, error: "detail needs `generationId`." };
      const r = await library.detail(input.generationId);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, item: toModelItem(r) };
    }
    case "set_favorite": {
      if (!input.generationId) return { ok: false, error: "set_favorite needs `generationId`." };
      if (input.favorite === undefined) return { ok: false, error: "set_favorite needs `favorite` (true or false)." };
      const r = await library.setFavorite(input.generationId, input.favorite);
      return "error" in r ? { ok: false, error: r.error } : { ok: true, favorite: r.favorite };
    }
  }
}

export const manageLibrarySkill = defineOttoSkill({
  name: "manageLibrary",
  // $0 Library surface: reads generation history/detail and flips a $0 favorite. free + write +
  // internal ⇒ needsApproval=false — same as the human Library, which stars without a confirm dialog.
  cost: "free",
  effect: "write",
  reach: "internal",
  description:
    `Browse the user's ${navLabel("library")} — every image/video they've made — $0, never generates or spends. ` +
    "history: a page of their generation history, newest first (optional search text, favoriteOnly, and a cursor to page). " +
    "detail: one generation's prompt/kind/favorite, plus finalPrompt — what the engine actually ran, " +
    "which is often not word-for-word what the user asked for and is the honest way to explain a result " +
    "(null means the engine didn't report it: say you don't know, never quote `prompt` in its place). " +
    "Needs generationId. " +
    "set_favorite: star or unstar a generation (needs generationId + favorite). " +
    "To CREATE a new image/video, use generate instead — this only looks at what already exists.",
  parameters: params,
  execute: executeManageLibrary,
});

export const manageLibrary = manageLibrarySkill.tool;
