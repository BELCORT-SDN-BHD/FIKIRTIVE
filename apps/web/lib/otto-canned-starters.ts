/**
 * otto-canned-starters —— 产品**自己写好**、商家一点就发出去的那几句开场白。
 *
 * 根因(#971,beta 录像 01:28):Brand memory 的起手 chip 里有一句
 * 「Let me describe my brand to you — ask me what you need to know.」。商家点一下,那句话
 * 作为他这一轮的消息发出去;新对话拿**第一条消息**当标题,画布再拿对话标题当自己的名字 ——
 * 于是商家的画布在侧栏里叫「Let me describe my brand to you — ask me what you need to know.」。
 * 那不是他写的字,也不是他这块画布在做的事:是我们的文案在冒充他的命名。
 *
 * 所以这几句话必须住在一处、被认得出来:
 *   · Brand memory 的 chip 从这里取(界面上出现的就是这一份,不另抄一份);
 *   · 建对话时的标题、以及画布沿用对话标题时,都拿 `isCannedStarter` 过一遍。
 * 抄成两份,守卫认得的和界面发出的就会先后漂移,而漂移的那一天没有任何测试会红。
 *
 * 纯常量 + 纯函数:没有 React、没有 prisma、没有 server-only,所以客户端组件、server action
 * 与路由处理器读的是同一份。
 */

/** 新对话在还没有名字时叫什么。历来就是这个字面量(`clip-actions` 建对话时也用它)。 */
export const UNTITLED_CHAT_TITLE = "Untitled";

/** Brand memory 起手 chip —— 界面渲染的就是这一份。 */
export const BRAND_MEMORY_STARTERS: { label: string; prompt: string }[] = [
  { label: "Describe my brand", prompt: "Let me describe my brand to you — ask me what you need to know." },
  { label: "My ideal customer", prompt: "Help me define my main customer groups." },
  { label: "My brand voice", prompt: "Help me pin down my brand voice." },
  { label: "Research my site", prompt: "Research my website and save what you learn — brand facts, products, and current offers. My URL: " },
];

/** 比对用的归一化:去首尾空白、把连续空白压成一个空格、转小写。
 *  商家点 chip 发出的字与常量逐字相同,归一化只是让「多一个空格」这类无意义差异不算数。 */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

const CANNED_PREFIXES = BRAND_MEMORY_STARTERS.map((c) => normalize(c.prompt));

/**
 * 这句话是不是产品自己写的开场白(而不是商家自己的话)。
 *
 * 用 `startsWith` 而不是全等,是因为有一句 chip 本身就是个开头(「… My URL: 」,商家在后面
 * 补网址)。一条以我们的整句开场白起头的消息,开头那一段仍然是我们的文案,拿它当商家的
 * 命名同样不对。反过来不会误伤:要命中,商家得**恰好**以那四整句之一开头。
 */
export function isCannedStarter(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return CANNED_PREFIXES.some((p) => t.startsWith(p));
}

/**
 * 新对话的标题 = 商家这一轮**自己**打的字(截到 80),但产品自己的开场白不算他的字 ——
 * 那种情况退回默认名,让对话与画布之后被真正的内容命名,而不是被我们的文案命名。
 */
export function newThreadTitle(firstMessage: string): string {
  if (isCannedStarter(firstMessage)) return UNTITLED_CHAT_TITLE;
  const clean = firstMessage.trim().slice(0, 80);
  return clean || UNTITLED_CHAT_TITLE;
}
