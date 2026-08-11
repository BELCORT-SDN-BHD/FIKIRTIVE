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
      // #776:回执里的「引擎真正跑的那句」只在 detail 上有(history 不查这一列)。null =
      // 未知,就**不带这个键** —— 让「不知道」在类型上也是缺席,而不是一个空字符串。
      return {
        id: res.id, projectId: res.projectId, kind: res.kind, prompt: res.prompt,
        ...(res.finalPrompt !== null ? { finalPrompt: res.finalPrompt } : {}),
        favorite: res.favorite,
      };
    },
    setFavorite: (generationId: string, favorite: boolean) => setFavorite(generationId, favorite),
  };
}
