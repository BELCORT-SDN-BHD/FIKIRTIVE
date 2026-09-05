/**
 * price-literal-fence —— 「界面不许写死价钱」那道围栏的**唯一**一份判据。
 *
 * 这道闸的体例是「一条商家可读的成本小字一份围栏文件」,今天有四份:
 *   `understanding-disclosure.test.ts`(上传理解)、`money-a10-search-disclosure.test.ts`(网页搜索)、
 *   `engine-a3-front-door-disclosure.test.tsx`(对话轮)、`front-a15-create-start-disclosure.test.tsx`
 *   (`/create` 起步页)。
 * 判据此前在这四份里各手抄一份、逐字相同(判官 #1227 P2-3 ＝ #1219 P2-4)。手抄件不影响任何
 * 一道闸咬不咬,但它是**判据**的复制:哪天要放宽或收紧这条正则、或者改「哪几行算文案」,四处
 * 漏掉一处就是一道悄悄失效的闸。所以判据收到这里,四份围栏只留各自的目标文件与判词。
 *
 * 这个文件不是测试(文件名不含 `.test.`),vitest 的 `include` 不会把它当测试文件跑。
 */

/**
 * 「12 credits」「0.1 credit」这类**手抄的钱数**。
 *
 * className 里的 `text-[0.75rem]` 不会命中(它后面跟的是 rem,不是 credit),命中的只有真把
 * 价钱写死进文案的那种写法。没有 `g` 标志,所以 `.test()` 不带 `lastIndex` 状态,四份围栏
 * 共用同一个正则对象是安全的。
 */
export const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/**
 * 只留**会被商家读到的那部分**:整行注释丢掉。
 *
 * 注释里解释「0.1 credits 是怎么来的」是文档,不是文案,而且它正是我们希望留在源码里的解释;
 * 手抄的价钱如果藏在注释里,一个商家也看不见。行尾注释仍然留在原地 —— 那一层的边界写在
 * `understanding-disclosure.test.ts` 里「按语法树扫,不按文本行」那条判词上,这里不放宽。
 */
export function copyLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());
}
