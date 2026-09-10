/**
 * quote-version —— 一张确认卡上那份**报价**的稳定指纹（creation-engine.md §5 :170，FSE-012）。
 *
 * 走查现象：确认卡上把张数从 1 改到 2，服务端已经重铸了卡（价 1 → 2 credits），而商家眼前
 * 那颗按钮仍写着 `Generate · 1 credit`、仍然可点。钱不会错——`startCoworkGen` 的 `expectedCredits`
 * 只从**持久化的卡**读——但商家**按下的**那份报价与**被执行的**那份报价可以是两份。
 *
 * Founder 2026-09-10 裁：走**服务器校验报价版本**，旧报价提交即拒绝并刷新；**不锁控件**
 * （2026-09-06 A4 那一轮「重铸进行中不锁控件」的决定不推翻）。
 *
 * 这个函数就是那个「版本」：把**决定价格的那几格**按固定次序拼成一串，再哈希。
 *
 *   · 服务端铸造与校验都用它（唯一一份口径，§7.3）；
 *   · 客户端把它随批准一起交回来，服务端拿**库里那张卡**再算一次，对不上就拒。
 *
 * **它不是钱的授权。** 客户端交回来的永远只是一个「我看到的是哪一版」的说法：报价本身、
 * 预扣金额一律仍旧只从服务端那张卡来（`estimatedCredits` → `expectedCredits` → `pricedGenCredits`
 * 现算对签）。所以伪造一个指纹的收益是零——最坏也只是按**当前**这张卡的价照常成交。
 * 正因如此这里用的是一个普通的非加密哈希（FNV-1a，两轮不同起点拼成 16 位十六进制）：
 * 它要的是「变了就一定不同」，不是抗构造。也因此它必须在浏览器里跑得起来——`node:crypto`
 * 进不了客户端包，这个文件因此零依赖、零 import。
 *
 * **归一化是承重的。** 客户端手上那份 payload 走过两道收窄：DTO（`toChatMessageDTO` 丢掉
 * `model` 与 `reason`，`params` 只留白名单那五格）与 `parsePlanCardPayload`（缺席的 count 被
 * 补成 1、未知字段被丢掉）；服务端手上那份是库里的原始 JSON。两边算出同一串的唯一办法，
 * 就是这个函数自己把三种形状都归一到同一组值——所以这里只读那几格**两边都留得住**的具名
 * 字段，各自带默认值。一格被 DTO 丢掉却算进指纹，代价就是商家刷新之后再也批不动任何一张卡。
 */

/** 决定价格的那几格，按固定次序。次序即哈希的一部分，改动它等于换一套版本号。 */
function quoteParts(payload: unknown): string[] {
  const p = (payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {});
  const params = (p.params && typeof p.params === "object" && !Array.isArray(p.params)
    ? (p.params as Record<string, unknown>)
    : {});
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown, fallback: string): string =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : fallback;
  return [
    str(p.kind),
    // **`model` 不在这里**，而且不能在这里：卡送到浏览器时那一格被 DTO 丢掉（供应商保密，
    // Founder 常令；`apps/web/lib/dto.ts` 的 `toChatMessageDTO`），所以刷新之后客户端手上
    // 那份根本没有型号——把它算进指纹，商家每一次刷新后的批准都会被误判成「价变了」。
    // 型号档在这里由它的两个可见果代表：精修那一格，以及卡面那个数（下面 estimatedCredits）。
    typeof p.fineDetail === "boolean" ? String(p.fineDetail) : "false",
    // 缺席的张数在卡面上被读成 1（`parsePlanCardPayload`），这里同一条口径。
    num(params.count, "1"),
    str(params.aspectRatio),
    str(params.resolution),
    num(params.durationSeconds, ""),
    typeof params.audio === "boolean" ? String(params.audio) : "",
    // 卡面那个数本身。它是上面那几格的果，收进来是为了让「派生规则改了、参数没改」
    // 那一类调价同样换版本——商家按下的那个数才是他同意的那件事。
    num(p.estimatedCredits, ""),
  ];
}

/** FNV-1a 32 位。`offset` 换一个起点就是另一路哈希（两路拼起来降低碰撞）。 */
function fnv1a(input: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 这张卡此刻那份报价的版本串。同一份报价 ⇒ 同一串；任何一格变了 ⇒ 另一串。
 *
 * 读不懂的 payload 照样算得出一串（全部落到默认值）——版本是「我看到的是哪一版」，
 * 不是「这张卡合不合法」，后者是 `planCardGate` 的活。
 */
export function cardQuoteVersion(payload: unknown): string {
  // JSON 化再哈希：分隔与转义都由它负责，任何一格的内容都不可能混进邻格（拿一个字面
  // 分隔符去拼，是「哪个字符一定不出现」这类假设的老地方）。
  const canonical = JSON.stringify(quoteParts(payload));
  return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}`;
}

/** 报价版本对不上时给商家的那一句话。措辞只有这一份（卡面与两条批准路共用）。 */
export const QUOTE_VERSION_STALE =
  "The price changed while this card was open — check the updated quote above, then generate.";
