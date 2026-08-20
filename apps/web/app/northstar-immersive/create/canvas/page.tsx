/**
 * 旧画布地址 —— 只剩一条重定向(W2-5,规格书 §2.2)。
 *
 * 商家收藏的画布深链带着 `?project=`、`?thread=`、`?audience=`、`?persona=`,所以这里连
 * query 一起搬过去(见 `../../legacy-search-params.ts`):送到新地址却打开错的画布,比 404
 * 更难发现。
 */

import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { withLegacySearch, type LegacySearchParams } from "../../legacy-search-params";

export const dynamic = "force-dynamic";

export default async function RetiredCanvas({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  redirect(withLegacySearch(SHELL_ROUTES.canvas, await searchParams));
}
