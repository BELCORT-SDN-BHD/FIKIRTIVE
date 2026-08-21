import { redirect } from "next/navigation";
import { OTTO_VIEW_REDIRECTS } from "@fikirtive/core/navigation";
import { parseViewParam } from "@/components/otto/otto-view-param";
import type { LegacySearchParams } from "../northstar-immersive/legacy-search-params";

export const dynamic = "force-dynamic";

/**
 * 目标地址可能自带 query(`OTTO_VIEW_REDIRECTS.otto` 是 `"/?otto=1"`)或锚点
 * (`templates`/`discover` 落在 `/create#templates`、`/create#ideas`)。商家带来的
 * `?project=`/`?thread=` 等参数要接在原有 query **之后**,锚点要留在**最后**——
 * 直接拼接 `${target}?${query}` 在已经带 query 的目标上会拼出两个 `?`。
 */
function mergeRedirectTarget(raw: string, incoming: LegacySearchParams): string {
  const hashIndex = raw.indexOf("#");
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const qIndex = withoutHash.indexOf("?");
  const path = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = new URLSearchParams(qIndex >= 0 ? withoutHash.slice(qIndex + 1) : "");
  for (const [key, value] of Object.entries(incoming)) {
    // `view` 已经被消费掉去选目标了 —— 原样带去新地址没有意义(`/library?view=edit`
    // 这种形状不属于任何人)。
    if (key === "view" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) query.append(key, one);
    } else {
      query.append(key, value);
    }
  }
  const qs = query.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash}`;
}

/**
 * `/otto` —— 纯重定向表(换壳切换总票 W2-11,规格书 §2.3 ③、§2.5)。
 *
 * 旧的整屏 Otto 壳已经拆完:助手是导轨之上的一颗按钮,不是一条地址(`OTTO_ASSISTANT` 从
 * W2-11 起没有 `href`)。但商家手上的旧书签、Otto 自己说过的旧链接(`/otto?view=X`)
 * 一个都不许撞墙(§2.5「旧地址一律 307,永不 404」)——这一页把每一个旧 view 送到它今天
 * 真正的家。`?project=`/`?thread=` 跟着走:少数目的地会读它(剪辑台按 `?project=` 挑
 * 项目),其余目的地不认识这两个参数,忽略即可,总比丢在半路强。
 *
 * 权威名单是 `OTTO_VIEW_REDIRECTS`(packages/core),这里不再抄第二份 view→地址的表;
 * 没给 `?view=` 或给了一个产品不认的值,`parseViewParam` 落回 `"otto"`,同一张表接住。
 *
 * 这一页不再 import auth、DB 或任何取数动作 —— 它不画任何东西,只决定去哪。
 */
export default async function OttoRedirect({
  searchParams,
}: {
  searchParams: Promise<LegacySearchParams>;
}) {
  const sp = await searchParams;
  const rawView = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view = parseViewParam(rawView);
  redirect(mergeRedirectTarget(OTTO_VIEW_REDIRECTS[view], sp));
}
