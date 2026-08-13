/**
 * makeOttoLibraryPort — the ctx.library port factory (W-B3-D, debt-29/30/50, $0).
 *
 * Wraps the SAME owner-gated Library actions the human UI uses (library-actions.getGenerationHistory,
 * asset-actions.getGeneration / setFavorite). Owner scope lives inside each action (requireOwner). The
 * port maps the rich web DTOs down to the slim views skills see (context.ts LibraryItemView) — no
 * media urls / asset ids cross the package boundary. $0 by construction (history/detail are reads;
 * setFavorite is a $0 preference write).
 *
 * NOT an action surface: no "use server", not *-actions — the parity scanner must not discover it.
 */
import { getGenerationHistory } from "./library-actions";
import { getGeneration, setFavorite } from "./asset-actions";
import type { LibraryItemView, LibraryHistoryView } from "@fikirtive/otto";

export function makeOttoLibraryPort() {
  return {
    history: async (input: {
      search?: string;
      favoriteOnly?: boolean;
      cursor?: string | null;
    }): Promise<LibraryHistoryView | { error: string }> => {
      const res = await getGenerationHistory({
        ...(input.search !== undefined ? { search: input.search } : {}),
        ...(input.favoriteOnly !== undefined ? { favoriteOnly: input.favoriteOnly } : {}),
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      });
      if ("error" in res) return { error: res.error };
      return {
        items: res.items.map(
          (i): LibraryItemView => ({
            id: i.id,
            projectId: i.projectId,
            kind: i.kind,
            prompt: i.prompt,
            favorite: i.favorite,
            createdAt: i.createdAt,
          }),
        ),
        nextCursor: res.nextCursor,
        hasMore: res.hasMore,
      };
    },
    detail: async (generationId: string): Promise<LibraryItemView | { error: string }> => {
      const res = await getGeneration(generationId);
      if ("error" in res) return { error: res.error };
      // #776 r2:回执里的「引擎真正跑的那句」只在 detail 上有(history 不查这一列),所以
      // detail **总是**带这个键,与商家面板同一口径,而 #914 之后这个口径**按 kind 分家**:
      //   · kind:"video" —— 字符串 = 引擎报的那句;null = 引擎没报(或回执落库前的老行)=
      //     **未知**,Otto 据此明说不知道。
      //   · kind:"image" —— null **恒为真**,是图片引擎结构上就没有这个字段的能力限制,
      //     不是「这次没报」;Otto 不该说「不知道」,manage-library.ts 的工具描述里已经
      //     把这句话讲给模型听(#914 r2)。
      // r1 在 null 时把键删掉,于是「引擎没报」和「这条产品链不存在」在 Otto 眼里长得一模
      // 一样 —— 键缺席的语义留给 history(我们**根本没查**这一列),两种「没有」不能混。
      return {
        id: res.id, projectId: res.projectId, kind: res.kind, prompt: res.prompt,
        finalPrompt: res.finalPrompt,
        favorite: res.favorite,
      };
    },
    setFavorite: (generationId: string, favorite: boolean) => setFavorite(generationId, favorite),
  };
}
