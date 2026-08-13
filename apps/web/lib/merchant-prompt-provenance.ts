/**
 * merchant-prompt-provenance —— 「商家原话」的**进程内**通道(#914 r6,判官 r5 P2)。
 *
 * ── 这个文件为什么存在 ───────────────────────────────────────────────────
 * 生成回执要回答两句话:「你写的是这一句」「我们送出的是那一句」。前者原本作为
 * `genRequest.requestedPrompt` 随请求走 —— 而 `startGen` / `startCoworkGen` 都是可以被
 * 浏览器**直接调用**的 Server Action,于是任何调用者都能提交一份与实际输入无关的
 * 「商家原话」,把回执写成一份看起来像证据的假账(判官 r5 P2,与 #882 approvedEntities
 * 同一课:「批 A 做 B」不能靠调用方自证)。
 *
 * 修法与 #882 同构 —— **不收客户端值,服务端自己推导**:
 *   ① `genRequest` 里**没有**这个字段了。schema 是 `.strict()`,所以任何请求带上它都在
 *      花钱之前被整单拒收(不是悄悄剥掉:多一个字段说明调用方在试图写这条记录,应当当场
 *      失败而不是静默降级);
 *   ② 唯一能产生这条事实的地方是**真的做了拼装**的那一步(`coworkGenerate` 的
 *      `composePrompt`):它手上同时握着拼装前与拼装后的两句话,这个「同一处产生的一对」
 *      正是这条记录的全部意义。它把商家原话绑在**它自己交给下一层的那个对象**上;
 *   ③ `startCoworkGen` 读回来,放进它自己那份可信记录(`TRUSTED_COWORK_REQUESTS`,与
 *      报价、审批身份同一条通道),`startGen` 只从那份记录取值落库。
 *
 * ── 为什么绑在对象上就伪造不了 ───────────────────────────────────────────
 * WeakMap 按**对象身份**取值,而 Server Action 的入参是跨网序列化过来的**新**对象:
 * 浏览器无论提交什么形状的 JSON,都不可能让它成为这张表里的键。而这个模块本身不是
 * "use server" 文件,`bindMerchantPrompt` 因此根本不是一个可被调用的 action —— 客户端
 * 连「先注册再调用」这条路都没有。同一条推理已经写在 `gen-actions.ts` 的
 * `TRUSTED_CANVAS_REQUESTS` 注释里,这里只是把它用在第三件事实上。
 */
import { MAX_GEN_PROMPT } from "@fikirtive/core";

const MERCHANT_PROMPTS = new WeakMap<object, string>();

/**
 * 把「商家原话」绑在**这一个**在途请求对象上,并原样交回它 —— 调用点因此读起来就是
 * 「带着这份出处往下传」。只有服务端代码能调到这里(本模块不是 action 表面)。
 *
 * 空串不绑:一句空的「商家原话」不是事实,是一个填不上的模板。
 */
export function bindMerchantPrompt<T extends object>(request: T, merchantPrompt: string): T {
  if (merchantPrompt.length > 0) MERCHANT_PROMPTS.set(request, merchantPrompt);
  return request;
}

/**
 * 取回绑在这个在途请求对象上的商家原话。取不到 = 这一单没有可分家的两句话(它的
 * `prompt` 本身就是商家写的那句),**不是**「未知」。
 *
 * 长度上限在这里再核一次:通道两端都是我们自己的代码,但记账字段不该因为上游某天改了
 * 校验就变成一个能撑爆列的输入 —— 超长即当作没有这条事实(降级方向是少一条记录,不是
 * 让一个记账字段有能力否决一次已经付过钱的交付)。
 */
export function readMerchantPrompt(request: unknown): string | undefined {
  if (request === null || typeof request !== "object") return undefined;
  const found = MERCHANT_PROMPTS.get(request as object);
  if (found === undefined || found.length === 0 || found.length > MAX_GEN_PROMPT) return undefined;
  return found;
}
