# #615 净化二期 · 取证要点与处置记录

- 取证基线:main @ `c3d96095b53aa5239d417b414aa4d0fc64c68e63`(mock 引擎,零生成花费;dev server + 授权账号走查)
- 裁决权威文本:issue #615 的 2026-08-02 Founder 裁决评论(issuecomment-5155081533)
- 大前提:六条路线全部锁在 `NORTHSTAR_PREVIEW` 门后,生产 404,商家今日不可见 —— 本次是「门开之前清屋」
- 一期背景:#609 / PR #614 已把六门导航收敛,六条路线零入口,但直敲 URL 仍可打开

## 六路线取证要点(裁决前的假象清单)

| 路线 | 取证发现 | 截图 | 裁决 |
|---|---|---|---|
| `/northstar-immersive/global/search` | 假样板语料(NS_SEARCH_ITEMS:Merdeka campaign、croissant 等虚构经营对象)+ 假经营业绩(dormantHighValue / ordersThisWeek 样板派生)+ 搜索结果指向的路由多已退场(点开 404) | `search-full.png`、`search-fake-results-merdeka.png` | 砍(删代码) |
| `/northstar-immersive/global/notifications` | 假审批卡带「This will spend real credits.」空头承诺(实际零花费)+ 虚构客户与订单收入的 Otto 动作时间线 | `notifications-full.png`、`notifications-fake-approval-closeup.png`、`notifications-fake-otto-actions-closeup.png` | 砍(删代码) |
| `/northstar-immersive/onboarding/login` | 假登录表单冒充安全流程(email 魔链纯演示,不发真请求,提交后假 pending 再自动跳转);真登录页已在 `/login` 服役 | `onboarding-login-full.png`、`onboarding-login-fake-pending.png` | 砍(删代码) |
| `/northstar-immersive/cityhall/admin` | 写死的假运维事实:`fikirtive-prod` 环境标识、假故障「prod DEGRADED」、假发布/开关/服务清单 | `admin-full.png`、`admin-fake-env-closeup.png` | 砍(删代码) |
| `/northstar-immersive/global/legal`(含 `/northstar/global/legal`) | 与真法务页平行的过期分叉文本 + 假确认码 `FB-2481-0093`;真法务页(/privacy、/terms、/legal/data-deletion)均存在且最新 | `legal-full.png`、`legal-fake-code-closeup.png` | 砍,改一行跳转真法务页 |
| `/northstar-immersive/onboarding/checklist` | 样板商家身份残留(Welcome, <样板店主>)+「连接渠道」完成态由样板连接数据派生(假连接态);但四步引导本身是唯一有产品价值的思路 | `checklist-full.png`、`checklist-fake-identity-closeup.png`、`checklist-fake-connected-closeup.png` | 先藏(路由移除),设计存档待重做(触发=发布/CRM 功能解锁,另登 #359) |

随票机械项取证:

- 悬浮 Otto 球在 768 宽压住留存页面底部正文:`otto-ball-768-notifications-bottom.png`
- 「This will spend real credits.」出现在 `components/northstar/global/chat-cards.tsx` 假审批卡内(一期点名清零的尾巴)

## 处置执行(本 PR)

| 路线 | 处置 | 验证 |
|---|---|---|
| `global/search` | 路由文件删除(目录随 git 消失)→ 直开 404 | `rg --files` 无该路径;web-build 绿 |
| `global/notifications` | 路由文件删除 → 直开 404 | 同上 |
| `onboarding/login` | 路由文件删除 → 直开 404;壳内 bareLayout 特判随之删除 | 同上 |
| `cityhall/admin` | 路由文件删除 → 直开 404;壳内 hideOttoButton 特判随之删除 | 同上 |
| `global/legal` × 两棵树 | 页面改为一行 `redirect("/privacy")`(/privacy 页内可达 /terms 与 /legal/data-deletion);假确认码与分叉文本随之消失 | 文件内容即证;web-build 绿 |
| `onboarding/checklist` | 路由文件删除(藏);设计存档见本目录 `checklist-design.md` | 同上 |

随票机械项执行:

- `chat-cards.tsx` 假承诺文案块删除;真产品面(`components/otto/*`)的同句文案是真花费确认,如实保留
- 悬浮 Otto 球:壳层内容 pane 挂球时底部让位 `pb-[72px]`(仅动 `immersive-shell.tsx`,不重设计)
- 假审批注入路径(`immersive/_store.ts` 的 `approvals: [...NS_APPROVALS]`)按孤儿原则处理:删除后仍有画廊设计稿页(`/northstar/global/notifications`、`/northstar/global/otto-chat`,均在 fenced 画廊树内、非壳内路线)消费该队列,非孤儿,保留;壳内已无任何表面可达

## 孤儿清理(仅本次删除造成的)

以下组件在删除五条路线后引用数归零,一并删除(逐项 `rg` 复核无存活引用):

- `components/northstar/immersive/misc/immersive-search.tsx`
- `components/northstar/immersive/misc/immersive-notifications.tsx`
- `components/northstar/immersive/misc/onboarding-login.tsx`
- `components/northstar/immersive/misc/onboarding-checklist.tsx`
- `components/northstar/immersive/misc/cityhall-admin.tsx`(misc/ 目录随之消失)
- `components/northstar/immersive/otto-assist.tsx`(仅上两者引用)
- `components/northstar/immersive/schedule-assets-ads/gallery-frame.tsx`(仅沉浸 legal 包装页引用;该页已改 redirect)

确认非孤儿、保留:`global/_data.ts`(画廊树多页 + `_store` 仍引)、`global/search-palette.tsx`(画廊 search 页仍引)、`immersive/_selectors.ts`(crm-inbox/data.ts 与 account-ops/data.ts 仍引)、`immersive/_store.ts`(画廊页与合体测试仍引)。

## 遗留说明

- 画廊设计稿树(`/northstar/global/search`、`/northstar/global/notifications`、`/northstar/global/otto-chat` 等)不在本次六路线裁决清单内,沿一期先例保留(同锁 `NORTHSTAR_PREVIEW` 门后;fence 看守零后端 import)
- `immersive-nav.tsx` 注释中「(如 onboarding/login)」一处举例已过时(行为不变:未登录传 null → 显示 Sign in);为守 claim scope 未顺手改,留待后续路过时清
