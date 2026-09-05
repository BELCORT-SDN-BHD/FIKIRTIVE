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
  favoriteOnly: z.boolean().optional().describe("history: only starred generations, newest-starred first. Cannot be combined with search (or any other history filter) — ask for favorites on their own."),
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
    // #914 r6(判官 r5 P1-2):**我们自己**送出的那句,与上面一条同一条透传纪律。r4 把它
    // 一路接到了端口,却忘了这一层 —— 于是工具描述里写着「detail 带 sentPrompt」,模型
    // 实际收到的却没有这个键:说的与做的又一次失同步。裁剪层不做任何判断,原样递给模型
    // (三态由 asset-actions 在服务端比完:{verbatim:true} / {verbatim:false,text} / null)。
    ...("sentPrompt" in i ? { sentPrompt: i.sentPrompt ?? null } : {}),
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
  // ENGINE-A4:history / detail 只查不写 —— 只翻了几页历史的一轮,商家手里什么都没多。
  readOnlyActions: { field: "action", actions: ["history", "detail"] },
  description:
    `Browse the user's ${navLabel("library")} — every image/video they've made — $0, never generates or spends. ` +
    "history: a page of their generation history, newest first (optional search text and a cursor to page). " +
    "favoriteOnly returns their favorites instead — newest-starred first, and it cannot be combined with search " +
    "or any other history filter (asking for both is refused, so ask for favorites on their own). " +
    "detail: one generation's prompt/kind/favorite, plus finalPrompt — the text the engine reports it " +
    "actually executed, when its contract reports one. This is kind-dependent (#914): for kind:\"video\", " +
    "finalPrompt is a real per-generation fact — non-null means the engine REPORTED the text it ran, which " +
    "may or may not match what the user wrote (compare it to `prompt` yourself before calling it a rewrite " +
    "— don't assume non-null means changed), null means the engine genuinely didn't report one this time " +
    "(say you don't know, never quote `prompt` in its place). For kind:\"image\", finalPrompt " +
    "is ALWAYS null — that's a fixed capability of the image engine, not a one-off failure to report, so " +
    "never say \"I don't know\" or \"it wasn't reported\" for an image: say the image engine doesn't report " +
    "rewritten prompts, or just don't mention it. " +
    "detail also carries sentPrompt (#914) — what WE handed the engine, our own record, so it is answerable " +
    "for images too: {verbatim:true} means we sent exactly what the user wrote, {verbatim:false,text} means we " +
    "sent something else and `text` IS that full text (quote it, don't paraphrase), and null means this row " +
    "is not the product of an engine call at all — it predates the record, or it was uploaded or cropped " +
    "rather than generated — so say nothing about it either way, never guess. Note `prompt` is the " +
    "text the job carried, which for some cards was already assembled by us before it was queued — so when the " +
    "user asks what was actually sent, answer from sentPrompt, not from `prompt`. Needs generationId. " +
    "set_favorite: star or unstar a generation (needs generationId + favorite). " +
    "To CREATE a new image/video, use generate instead — this only looks at what already exists.",
  parameters: params,
  execute: executeManageLibrary,
});
