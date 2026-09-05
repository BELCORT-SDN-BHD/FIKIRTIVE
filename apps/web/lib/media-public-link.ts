/**
 * 签名公共媒体地址的**唯一**铸链处(web 侧)。
 *
 * 门早就在了:`app/api/media/pub/[token]/route.ts` —— HMAC 签 (ownerId + storage key + 到期),
 * 验过才流字节,坏签 / 过期 / 跨租户一律 404。以前铸这条链的写法是**抄**的:
 * `share-preview-view.ts:174` 自己拼一次 URL 模板、自己定一个 TTL 常量。第二个消费者一出现
 * (素材面板的 Copy link)就会有第三份,而 TTL 与路径形状是同一条规则的两半 —— 按 §7.3 收到
 * 这一处,两个消费者读同一个函数。
 *
 * **未收进来的那一份**:`apps/worker/src/jobs/publish.ts:297` 有它自己的 `MEDIA_TTL_MS`(发布
 * 给 Meta 抓取用,时长本来就该不一样)。跨 app 边界,不在本票写集,已在规格 §5 登记。
 *
 * 这里是纯函数,没有 "use server" / server-only —— 服务端动作与将来的路由都能引用它,
 * 而它自己碰不到数据库,也不决定谁有资格拿到这条链(那是调用方的 `requireOwner`)。
 */

/** 与 share-preview 一致的 10 分钟:签名链是「现在给你看一眼」,不是永久地址。
 *  Founder 2026-09-05 裁决「同意,但是加上可以自由设定时间」之后,它仍是**默认**档 ——
 *  没人挑时间时铸的就是它,share-preview 那一头行为一个字没变。 */
export const PUBLIC_MEDIA_TTL_MS = 10 * 60 * 1000;

/** 挑得动的四档。屏幕上的字由 `publicMediaTtlLabel` 现算,这里只放毫秒数。 */
export const PUBLIC_MEDIA_TTL_PRESETS_MS: readonly number[] = [
  PUBLIC_MEDIA_TTL_MS,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

/** 下限。低于一分钟的链子等于「复制完就打不开」,那是另一种假成功。 */
export const PUBLIC_MEDIA_MIN_TTL_MS = 60 * 1000;

/**
 * 服务端硬上限 30 天。**越界一律拒绝铸链,不静默夹到上限** —— 商家填了 90 天、屏幕上却
 * 不吭声地给一条 30 天的链子,那正是这条线上要消灭的那种「以为成功了」。
 * 时间是签在令牌里的(`signMediaToken` 的 `exp`),客户端改不动;这个上限所以只需要在
 * 铸链那一处成立,而铸链只有 `media-link-actions.ts` 一个地方。
 */
export const PUBLIC_MEDIA_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 自定义那一格的单位 —— 只有分钟与小时(天数已经有 7 天那一档,再多一个单位没人用)。 */
export type PublicMediaTtlUnit = "minutes" | "hours";

/** 自定义输入 → 毫秒。看不懂的输入回 `NaN`,由 `publicMediaTtlProblem` 统一出那句话。 */
export function publicMediaTtlFromCustom(raw: string, unit: PublicMediaTtlUnit): number {
  const n = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(n)) return NaN;
  return Math.round(n * (unit === "hours" ? 60 * 60 * 1000 : 60 * 1000));
}

/**
 * 这个时长能不能用 —— 能用回 `null`,不能用回**说给商家听的那一句**。
 * UI 与服务端动作读同一个函数:屏幕上先拦一次是体验,服务端再拦一次才是闸(fail closed)。
 */
export function publicMediaTtlProblem(ttlMs: number): string | null {
  if (!Number.isFinite(ttlMs) || !Number.isInteger(ttlMs) || ttlMs % 60_000 !== 0) {
    return "Enter how long the link should work, in whole minutes or hours.";
  }
  if (ttlMs < PUBLIC_MEDIA_MIN_TTL_MS) {
    return `A link has to work for at least ${publicMediaTtlLabel(PUBLIC_MEDIA_MIN_TTL_MS)}.`;
  }
  if (ttlMs > PUBLIC_MEDIA_MAX_TTL_MS) {
    return `A link can work for at most ${publicMediaTtlLabel(PUBLIC_MEDIA_MAX_TTL_MS)}.`;
  }
  return null;
}

/**
 * 说给商家听的那句时长 —— 与铸链用的毫秒数同源,免得屏幕上写 24 小时、链子活 10 分钟。
 * 满两天才说「天」:一天那一档商家自己是按「24 小时」想的(预设那一档就叫 24 hours),
 * 硬翻成「1 day」等于替他换了一个说法。其余整小时说小时,再其余说分钟(输入只到分钟)。
 */
export function publicMediaTtlLabel(ttlMs: number): string {
  const minutes = Math.round(ttlMs / 60_000);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (minutes % (60 * 24) === 0 && minutes >= 2 * 60 * 24) return plural(minutes / (60 * 24), "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

/**
 * 「上次挑的那个时长」记在哪里,由这个文件说了算,所以说给商家听的那句话也放在这里 ——
 * 与变体那一格(`lib/result-pick.ts` 的 `PICK_SCOPE_NOTE`)同一个口径:今天它确实只在这台
 * 浏览器上,措辞不得暗示跨设备同步。升级成账号级要新的持久化列,另立规格。
 */
export const PUBLIC_MEDIA_TTL_SCOPE_NOTE = "Link duration is saved on this browser only.";

const TTL_PICK_KEY = "otto:link-ttl";

/** 读上次挑的时长;没有、坏了、或者越界(上限哪天调小了)一律回 `null` ⇒ 用默认档。 */
export function readTtlPick(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(TTL_PICK_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  if (publicMediaTtlProblem(n) !== null) return null;
  return n;
}

/** 记下这次挑的时长。只在通过校验时调用 —— 存一个用不了的值等于下次开面板就报错。 */
export function writeTtlPick(ttlMs: number): void {
  if (typeof window === "undefined") return;
  if (publicMediaTtlProblem(ttlMs) !== null) return;
  window.localStorage.setItem(TTL_PICK_KEY, String(ttlMs));
}

/**
 * 铸一条签名公共地址(站内相对路径)。`token` 进路径段,所以必须编码。
 * 调用方负责:① 先确认调用者拥有这个 key 所在的命名空间;② secret 缺席时不要调用。
 */
export function publicMediaPath(token: string): string {
  return `/api/media/pub/${encodeURIComponent(token)}`;
}
