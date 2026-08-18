/**
 * otto-canned-starters —— 产品**自己写好**、商家一点就发出去的那几句话。
 *
 * 根因(#979,beta 录像 01:28):Brand memory 的起手 chip 里有一句
 * 「Let me describe my brand to you — ask me what you need to know.」。商家点一下,那句话
 * 作为他这一轮的消息发出去;新对话拿**第一条消息**当标题,画布再拿对话标题当自己的名字 ——
 * 于是商家的画布在侧栏里叫「Let me describe my brand to you — ask me what you need to know.」。
 * 那不是他写的字,也不是他这块画布在做的事:是我们的文案在冒充他的命名。
 *
 * 前门的四个目标格子是**同一个病的第二组样本**:点「Sell a product」发出去的也是我们写的
 * 标签,画布于是叫「Sell a product」。
 *
 * 所以这几句话必须住在一处、被认得出来:
 *   · Brand memory 的 chip 与前门的目标格子都从这里取(界面上出现的就是这一份,不另抄一份);
 *   · 三扇建对话的门(`ottoTurn`、流式路由、`createEmptyCoworkThread`)都拿
 *     `newThreadTitle` 过一遍,画布沿用对话标题时再拿 `isCannedStarter` 过一遍。
 * 抄成两份,守卫认得的和界面发出的就会先后漂移,而漂移的那一天没有任何测试会红。
 *
 * 纯常量 + 纯函数:没有 React、没有 prisma、没有 server-only,所以客户端组件、server action
 * 与路由处理器读的是同一份。
 */

/** 新对话在还没有名字时叫什么。历来就是这个字面量(`clip-actions` 建对话时也用它)。 */
export const UNTITLED_CHAT_TITLE = "Untitled";

/**
 * 一句罐头开场白,以及**怎么认它**。
 *
 * `opensWith` 是这里唯一的判据分叉,而且它说的是这句话本身的性质:
 *   · 不带 —— 这是一句**完整的话**,只在商家发出的字与它归一化后完全相同时才算罐头。
 *     短标签(「Sell a product」)必须走这一档:拿它做前缀会把商家真打的
 *     「Sell a product bundle for Raya」也压成 Untitled —— 那是把守卫变成新的伤害。
 *   · 带 —— 这句话本身就是个**开头**,商家在后面补内容(「… My URL: 」后面是网址)。
 *     那种消息的开头那一段仍然是我们的文案,所以按前缀认。要命中,商家得恰好以我们那
 *     一整句起头。
 */
type CannedStarter = { label: string; prompt: string; opensWith?: true };

/** Brand memory 起手 chip —— 界面渲染的就是这一份。 */
export const BRAND_MEMORY_STARTERS: CannedStarter[] = [
  { label: "Describe my brand", prompt: "Let me describe my brand to you — ask me what you need to know." },
  { label: "My ideal customer", prompt: "Help me define my main customer groups." },
  { label: "My brand voice", prompt: "Help me pin down my brand voice." },
  {
    label: "Research my site",
    prompt: "Research my website and save what you learn — brand facts, products, and current offers. My URL: ",
    opensWith: true,
  },
];

/**
 * 前门四个目标格子的标签 —— 点一下发出去的就是这句话本身(`OttoFrontDoor` 的 `start()`)。
 * 键就是随这一轮上报的 `goalKey`,所以标签与 goalKey 不可能各写一份。
 */
export const FRONT_DOOR_GOAL_LABELS = {
  "sell-product": "Sell a product",
  "announce-sale": "Announce a sale",
  "get-followers": "Get more followers",
  "make-video": "Make a video",
} as const;

export type FrontDoorGoalKey = keyof typeof FRONT_DOOR_GOAL_LABELS;

/** 比对用的归一化:去首尾空白、把连续空白压成一个空格、转小写。
 *  商家点 chip 发出的字与常量逐字相同,归一化只是让「多一个空格」这类无意义差异不算数。 */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 完整的一句 —— 归一化后**全等**才算。 */
const CANNED_EXACT = new Set(
  [
    ...BRAND_MEMORY_STARTERS.filter((c) => !c.opensWith).map((c) => c.prompt),
    ...Object.values(FRONT_DOOR_GOAL_LABELS),
  ].map(normalize),
);

/** 一句开头 —— 商家在后面补内容,所以按前缀认。 */
const CANNED_OPENINGS = BRAND_MEMORY_STARTERS.filter((c) => c.opensWith).map((c) => normalize(c.prompt));

/**
 * 这句话是不是产品自己写的开场白(而不是商家自己的话)。
 *
 * 两种认法各自对应上面 `CannedStarter.opensWith` 说的那件事,没有第三种。
 */
export function isCannedStarter(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return CANNED_EXACT.has(t) || CANNED_OPENINGS.some((p) => t.startsWith(p));
}

/**
 * 新对话的标题 = 商家这一轮**自己**打的字(截到 80),但产品自己的开场白不算他的字 ——
 * 那种情况退回默认名,让对话与画布之后被真正的内容命名,而不是被我们的文案命名。
 *
 * 三扇建对话的门都走这一个函数;前门的乐观标题(还没落库就先画进侧栏的那一份)也走它,
 * 否则侧栏会先显我们的标签、刷新后再翻成 Untitled。
 */
export function newThreadTitle(firstMessage: string): string {
  if (isCannedStarter(firstMessage)) return UNTITLED_CHAT_TITLE;
  const clean = firstMessage.trim().slice(0, 80);
  return clean || UNTITLED_CHAT_TITLE;
}
