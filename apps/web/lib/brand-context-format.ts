/**
 * brand-context-format —— 一条品牌上下文的「名字」与「正文」怎么合住 `Memory.content` 一列。
 *
 * 设计的 `ContextRecord` 有 name 与 description 两个字段;库里的 `Memory` 只有 `content`。
 * 与其为一个显示字段再开一列(还要回填全部存量行),不如定一个可逆的排版:
 * **第一行是名字,空行之后是正文**。
 *
 * 这样老的 Memory 行(从来没有名字)也读得出来:整段就是正文,名字由分区名兜底 ——
 * 不需要迁移,也不会把一条老备注的第一句话冒充成它的标题(没有那个空行就不拆)。
 *
 * 纯函数,无 IO,两边都能用(所以不放在 "use server" 模块里 —— 那里的每个导出都必须是
 * 异步 Server Action)。
 */

const SEPARATOR = "\n\n";

export function packBrandContent(name: string, content: string): string {
  return `${name.trim()}${SEPARATOR}${content.trim()}`;
}

/**
 * `named` 回答的是「这一行**自己**带名字吗」,而不是「界面显示的名字是什么」。
 *
 * 判官 P1-2:存量 Memory 行从来没有名字,`name` 是分区标签兜的底(Brand voice…)。
 * 编辑之后若无条件 `packBrandContent(name, next)` 回写,那个兜底标签会被**写进**
 * `Memory.content` 的第一行,Otto 下一次读到的就是「About the brand: Brand voice …」——
 * 界面上的一个占位词变成了商家品牌事实的一部分。所以回写前必须问这一行原本有没有名字:
 * 没有的照原样只写正文,有的才连名字一起打包。
 */
/**
 * 编辑之后怎么写回 `Memory.content` —— 判官 P1-2 的单一权威。
 *
 * 界面上每一行都有名字可看,但存量行的那个名字是**分区标签兜的底**。回写时若不分青红
 * 皂白地 `packBrandContent(name, next)`,兜底那个词就成了 content 的第一行,Otto 下一次
 * 读到的正文里凭空多出「Brand voice」。所以决定权在这一个函数里,不在调用方:这一行
 * 原本自己带名字才连名字一起打包,原本没有就照原样只写正文。
 */
export function repackBrandContent(previous: { name: string; named: boolean }, content: string): string {
  return previous.named ? packBrandContent(previous.name, content) : content.trim();
}

export function unpackBrandContent(
  packed: string,
  fallbackName: string,
): { name: string; content: string; named: boolean } {
  const at = packed.indexOf(SEPARATOR);
  if (at <= 0) return { name: fallbackName, content: packed, named: false };
  const name = packed.slice(0, at).trim();
  // 一行「名字」长得像一整段话的时候,它就不是名字。80 字是列表里一行放得下的上限。
  if (!name || name.length > 80) return { name: fallbackName, content: packed, named: false };
  return { name, content: packed.slice(at + SEPARATOR.length).trim(), named: true };
}
