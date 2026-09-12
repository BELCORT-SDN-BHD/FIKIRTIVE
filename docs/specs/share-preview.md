# 客户预览链接（公开面）收口规格书（S1）

> 状态: 草稿
> 批准: （冻结时填）https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1053 Founder 评论「S1 批准 share-preview.md」(YYYY-MM-DD)
> 规格前缀: SHARE（验收编号 = SHARE-A1、A2…，全仓不得与其他规格撞前缀）

## 0. 一句话

商家发给客户的那条免登录预览链接从此：大文件分段传、限流坏了不放行、口令不进网址、撤销即刻断图、页面如实说「内容可能已更新」——商家敢把它发给真客户，运营不用怕一条链接把进程和流量账单打穿。

## 1. 九问（S1 grill 的答案）

（下列行号以主干 368e9094 为准，2026-09-12 只读核证员逐条实核；worktree HEAD 706d6b49 复核一致。）

1. **商家做什么动作、看到什么结果？**
   - 商家在排期里点 Share preview，拿到一条链接发给客户。客户打开：一张图/一段视频、文案、首评、排期时段，外加一行说明 `Content may have changed since this link was shared.`。
   - 商家改了这条排期的文案，客户刷新旧链接看到的是改后的新内容——**实时，不冻结**（Founder 已裁 2026-09-12（#1359 场②）；旧 B0-28「发出即冻结」契约不复活，省掉快照 schema 迁移）。
   - 商家点 Revoke：客户那一页立刻变成「This preview isn't available」，**客户已经复制走的图片网址也当场失效**（今天还能再用十分钟：`apps/web/app/api/media/pub/[token]/route.ts:38-63` 全程不回查 share 行，撤销只写 `revokedAt`，`apps/web/lib/schedule-actions.ts:643-647`）。
2. **入口在哪里？（列全，含深链）**
   - 铸链：`sharePostPreview`（`apps/web/lib/schedule-actions.ts:628`，今天吐 `/schedule/share-preview?t=<token>`）；Otto 把同一条链接递给商家。
   - 客户面：入口路由 `/s/<token>`（新）→ 换成 HttpOnly cookie 后 303 到干净的 `/schedule/share-preview`（已存在的页面，`apps/web/app/schedule/share-preview/page.tsx`）。旧的 `?t=` 形式继续被受理（已发出的链接不能断），受理后同样换 cookie 再跳干净地址。
   - 媒体：`/api/media/pub/<token>`（已存在，与发布 worker 共用同一道门）。
   - 撤销：排期页现有的 Revoke（`revokeSharePreview`）。
3. **四态：空、加载、错误、成功各长什么样？**
   - 空／错误：沿用今天唯一的两块牌子——`This preview isn't available` 与 `Too many requests right now`（过期、撤销、删除、伪造一律同一句，防扫链）。
   - 加载：页面服务端渲染，媒体逐条加载；媒体拿不到时沿用现有 `mediaWithheld` 文案。
   - 成功：同今天的卡片，**多一行** `Content may have changed since this link was shared.`（English sentence case）。
   - 限流拒绝（媒体）：HTTP 429 带 `Retry-After`，不吐字节。
4. **数据从哪来、写到哪去？**
   - 读：`apps/web/lib/share-preview-view.ts:110-120` 每次请求实时读 `scheduledPost`（保持实时，不加版本字段）；权威行是 `SharePreviewToken`（`packages/db/prisma/schema.prisma:1603-1615`）。
   - 媒体字节：`storage.readStream`（`packages/storage/src/index.ts:66`，今天**没有** Range 参数）需扩成可带字节区间的读；路由改成流式响应，删掉 `storage.get` 整块 → `Buffer.from(bytes)` 的写法（`route.ts:65-79`，`:67-68`；上传上限仍是 2 GB，`packages/core/src/upload.ts:39`）。
   - 撤销联动：预览媒体 token 增加一个 share 行标识声明；`/api/media/pub` 见到该声明就回查 `SharePreviewToken` 当前状态（revoked／过期 → 404）。发布 worker 签的 token 没有这个声明，行为一字不变。
   - 口令搬家：token 不再进 query（`schedule-actions.ts:628`），改 HttpOnly + `SameSite=Lax` + 路径限定的 cookie；`apps/web/lib/sentry-browser.ts:31-41` 今天只切 `#` 之后（`:33`）、不碰 query（`:78` 是全部脱敏逻辑），一并扩成 query 与媒体路径段都脱敏（第二道防线，不是主要手段）。
   - 写：除限流计数与既有 cookie 外，公开面不写业务数据。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   - **不碰**。铸链、看页、拉图三条路径都不写 credits、不调 `grantCreditsTx` / spend，没有幂等键要定。唯一与钱沾边的是**供应商出口流量账单**（整块缓冲 + 限流 fail-open 是被刷流量的路子），那是成本，不是账本。
   - 因为公开面无人认证，仍留一条守恒验收（SHARE-A9）：匿名狂拉媒体，credits 账本一行不动——任何 ledger 写入都视为违背本规格。
6. **权限与租户边界是什么？**
   - 公开面无 session，授权只有两层：HMAC（`packages/token-crypto/src/index.ts:114-118`）∧ 活着的 `SharePreviewToken` 行；两层任一不过一律 404，不给区分。
   - 租户身份只来自 token 里签着的 `ownerId`，绝不取客户端参数；媒体门继续复核「key 落在签着的 owner 命名空间」（`route.ts:38-63` 的 `keyOwnerMatches`），双租户测试（SHARE-A10）。
   - 本规格不改任何登录面权限，不新增角色。
7. **参考对照：抄哪家？** 不适用：加固类规格，无 UI 参照（唯一新增 UI 是一行说明文案）。
8. **胃口：轻／中／重挡，为什么？** 重挡：新增公开路由 `/s/<token>` 且改公开面行为，M1 路径地板本来就要规格引用。胃口两天含测试；超了先砍「短缓存兜底」（SHARE-A4），只留纯 fail-closed，其余不砍。
9. **Otto 怎么协助这个功能？** Otto 复用同一个 `sharePostPreview` 动作，链接形状变了它不用改口径；本规格不给 Otto 新能力。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| SHARE-A1 | 对一个大对象（≥200 MB）的预览媒体地址发 `Range: bytes=0-1048575` | 返回 206 + `Content-Range`，正文正好 1 MiB；进程常驻内存不随对象大小上涨（对照同一请求在旧码上的整块缓冲） |
| SHARE-A2 | 普通浏览器不带 Range 打开预览页 | 图片／视频照常显示，200 流式返回，页面与今天一致 |
| SHARE-A3 | 把限流计数存储打挂，再拉一次合法预览媒体地址 | 429 + `Retry-After`，不吐字节；存储恢复后同一地址立刻恢复 200（Founder 已裁 2026-09-12（场⑦）） |
| SHARE-A4 | 同一客户先成功拉过一次，随即打挂存储，在短缓存窗口内重拉同一地址 | 窗口内仍 200（抖动不误伤正在看的客户），窗口过后 429（Founder 已裁 2026-09-12（场⑦）） |
| SHARE-A5 | 分享后把该排期的文案改掉，客户刷新旧链接 | 看到改后的新文案，且页面有一行 `Content may have changed since this link was shared.` |
| SHARE-A6 | 客户打开商家发来的链接 | 地址栏是不含 token 的干净地址；浏览器遥测（Sentry `beforeSend` 抓到的事件）里的任何 URL 都不含 token |
| SHARE-A7 | 客户复制一条图片地址后，商家点 Revoke，客户立刻重刷那条图片地址 | 当场 404（不是十分钟后） |
| SHARE-A8 | 撤销后客户刷新预览页 | 仍是同一句「This preview isn't available」，与过期／伪造无从区分 |
| SHARE-A9 | 匿名连拉同一预览媒体 100 次 | credits 账本与交易表行数一字不变，无任何计费写入 |
| SHARE-A10 | 拿 owner A 的媒体 token 改成指向 owner B 的 key 再请求 | 404，双租户测试覆盖 |
| SHARE-A11 | 反解一条链接里的 token，对照代码注释与测试声明 | 二者一致：注释如实写明可读出 ownerId／postId／到期／storage key；`share-preview-view.ts:19-24` 那句「no id of anything ... never returned」相反声明已删 |
| SHARE-A12 | 把限流计数存储打挂并保持一段时间 | 「限流存储不可用」告警经 founderAlert 真送达（有送达回执，不是只记日志）；与 SHARE-A3 同一个 PR 落地（Founder 已裁 2026-09-12 场⑦：拒绝＋兜底＋报警三件一体） |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- **不做快照／版本冻结**：Founder 已裁 2026-09-12（#1359 场②）走实时＋明示，旧 B0-28 冻结契约不复活。触发条件：客户投诉「批准的不是这一版」成规模时另立规格。
- **不给 token 加密**：HMAC 已防伪造，未见跨租户升级（票面第 6 条定 P3），加密是新密钥与新迁移。改为把注释与测试的相反声明改成实话（SHARE-A11）。
- **不加人机验证（Turnstile 之类）**：与 sign-in 同口径，留 DEFERRED。
- **不改上传上限（2 GB）、不改发布 worker 侧的 media TTL**：跨 app 边界，不在本写集。
- **不给客户加「批准／评论」按钮**：预览面仍是纯只读。

## 4. 异议栏

- fail-closed 把「限流计数存储抖动」从一个无人察觉的小故障，升级成客户当场看不到图的可用性事故，而仓内**没有**这条存储的可用性指标或告警（未验证到任何相关告警配置）。若实现时不同时加一条「限流存储不可用」的告警，SHARE-A3 会把抖动变成静默的集体 429，我们只会从商家嘴里知道。该告警已立为验收行 SHARE-A12，与 A3 同一个 PR 落地。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|

## 6. 改签记录

- 无
