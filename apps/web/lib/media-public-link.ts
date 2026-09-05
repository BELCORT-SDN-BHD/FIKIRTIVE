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

/** 与 share-preview 一致的 10 分钟:签名链是「现在给你看一眼」,不是永久地址。 */
export const PUBLIC_MEDIA_TTL_MS = 10 * 60 * 1000;

/** 说给商家听的那句时长 —— 与上面那个数字同源,免得屏幕上写 10 分钟、链子活 5 分钟。 */
export const PUBLIC_MEDIA_TTL_MINUTES = PUBLIC_MEDIA_TTL_MS / 60_000;

/**
 * 铸一条签名公共地址(站内相对路径)。`token` 进路径段,所以必须编码。
 * 调用方负责:① 先确认调用者拥有这个 key 所在的命名空间;② secret 缺席时不要调用。
 */
export function publicMediaPath(token: string): string {
  return `/api/media/pub/${encodeURIComponent(token)}`;
}
