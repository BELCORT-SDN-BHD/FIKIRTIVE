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

export function unpackBrandContent(packed: string, fallbackName: string): { name: string; content: string } {
  const at = packed.indexOf(SEPARATOR);
  if (at <= 0) return { name: fallbackName, content: packed };
  const name = packed.slice(0, at).trim();
  // 一行「名字」长得像一整段话的时候,它就不是名字。80 字是列表里一行放得下的上限。
  if (!name || name.length > 80) return { name: fallbackName, content: packed };
  return { name, content: packed.slice(at + SEPARATOR.length).trim() };
}
