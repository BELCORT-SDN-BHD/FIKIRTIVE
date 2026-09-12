/**
 * docs/specs/share-preview.md（已冻结 · v1）的**后半**验收占位。
 *
 * 规格一份，施工两票：#1381 做媒体代理收口（SHARE-A1–A4、A12，已落地，测试在
 * `app/api/media/pub/__tests__/` 与 `lib/__tests__/media-proxy-access.test.ts`），
 * #1382 做 token 出网址、撤销即断、注释改实话（SHARE-A5–A9、A11）。
 *
 * M3 闸要求引用规格的**每一个**验收编号都在测试树里有落点，所以后半在这里用
 * `it.todo` 占位——手册明写这是 S4 早期的合法形式（`.claude/CLAUDE.md` 开发流程第 7 条）。
 * **#1382 落地时请把对应的 todo 删掉，换成真测试**；这份文件里一条 todo 都不剩的时候，
 * 整个文件应该一起删掉。
 *
 * SHARE-A10（跨租户媒体 token）不在这里：它已经有真测试，见
 * `app/api/media/pub/__tests__/route.test.ts`。
 */
import { describe, it } from "vitest";

describe("share-preview 后半验收（#1382 的写集，占位待实现）", () => {
  it.todo("SHARE-A5 —— 分享后改文案，客户刷新旧链接看到新文案，且页面有 `Content may have changed since this link was shared.`");
  it.todo("SHARE-A6 —— 客户打开链接后地址栏不含 token，浏览器遥测里的任何 URL 也不含 token");
  it.todo("SHARE-A7 —— 商家点 Revoke 后，客户复制走的图片地址当场 404（不是十分钟后）");
  it.todo("SHARE-A8 —— 撤销后刷新预览页仍是同一句 This preview isn't available，与过期／伪造无从区分");
  it.todo("SHARE-A9 —— 匿名连拉同一预览媒体 100 次，credits 账本与交易表行数一字不变");
  it.todo("SHARE-A11 —— 代码注释与测试声明如实写明 token 可读出 ownerId／postId／到期／storage key");
});
