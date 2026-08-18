/**
 * 旧创作面地址搬家时,query 一个字都不能丢(W2-5,规格书 §2.5)。
 *
 * 商家手上的深链是 `?project=…&thread=…&audience=…&persona=…&persona=…` 这种形状 ——
 * 画布正是靠它们开对那一张画布、那一段对话。重定向如果只送到 `/create/canvas`,人到了新
 * 地址却落在别的画布上,那比 404 更糟:它看起来是成功的。
 *
 * `persona` 会重复出现(多张脸),所以数组要逐个 append,不能 join 成一个值。
 */
export type LegacySearchParams = Record<string, string | string[] | undefined>;

export function withLegacySearch(target: string, params: LegacySearchParams): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) next.append(key, one);
    } else {
      next.append(key, value);
    }
  }
  const query = next.toString();
  return query ? `${target}?${query}` : target;
}
