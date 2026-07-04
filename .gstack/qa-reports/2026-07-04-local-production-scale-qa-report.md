# FIKIRTIVE 本地生产规模 QA 报告

日期：2026-07-04  
本地 URL：`http://localhost:3101`  
数据库：`postgresql://artlio:***@localhost:55432/artlio`  
外部供应商：未接真实 Anthropic/Meta/Stripe；生成 provider 使用 mock。  
测试账号：`founder.qa@example.test`、`merchant.qa@example.test`

## 结果

本地生产规模库存 QA 通过。生产/真实付款/真实 Meta 写入/真实 LLM 调用未执行，按要求保持阻断。

## 修复的缺陷

### BUG-001：客户端打包 core barrel 导致 `/otto` 500

影响：P0，登录后主 app 空白，`/otto` 返回 500。  
证据：`screenshots/02-otto-blank-after-login.png`；浏览器/服务端错误为 `packages/core/dist/url-safety.js` 被打入 client bundle，依赖 `node:dns/promises`。  
共因：客户端可达组件/工具从 `@fikirtive/core` 桶导入，桶导出包含 Node-only SSRF/url-safety helpers。  
修复：

- 给 `@fikirtive/core` 增加浏览器安全子路径 exports：`brand-records`、`cowork-directives`、`gen`、`memory-sections`、`model-config`、`refgen`、`spend`、`upload`。
- 将客户端可达导入改为子路径导入。
- 增加 `apps/web/lib/__tests__/client-core-imports.test.ts`，递归追踪 `"use client"` 可达模块，遇到 `"use server"` 边界停止，禁止 client-reachable 模块直接导入 `@fikirtive/core` 桶。

重测：`/otto` 首屏 200，截图 `screenshots/03-otto-canvas.png`，无 browser console error。

## 验证命令

- `pnpm --filter @fikirtive/core run build`
- `pnpm --filter @fikirtive/web run typecheck`
- `env -u DATABASE_URL pnpm --filter @fikirtive/web exec vitest run lib/__tests__/client-core-imports.test.ts`

## 浏览器覆盖

- Auth：登录页、magic link 成功、sign out 成功。
- Founder app：Canvas、sidebar/projects/thread list/history、FlowCanvas 节点、My Stuff、Brand memory、Schedule、Analytics、Account。
- Hidden views：Connections、Library、Templates、Discover。
- Billing：无 Stripe key 时显示 “No credit packs are available right now.”，不创建 checkout。
- Admin：Settings、Directives、Models、Team、Credits、Tenants、Tenant detail、Conversations、Conversation detail、Content、Audit、Cost、System、Knowledge。
- Merchant：商户 `/otto` 仅显示商户 2 个项目和 920 credits；`/admin/settings` 307 到 `/` 再 `/otto`。
- Otto composer：无 `ANTHROPIC_API_KEY` 时请求返回本地错误状态 `Otto hit a snag — please try again.`，未发生真实 LLM 调用。

## 观察项

- 本地缺 `STRIPE_SECRET_KEY` 时 Next dev console 会显示 server warning；UI 已降级为无套餐。这是测试边界内预期。
- Admin 聚合页触发 tenant-guard “possible cross-tenant leak” warning。页面本身 founder-gated 且按产品需要做平台级聚合；建议后续给合法 admin aggregate query 增加显式标记，减少噪音。

## 截图证据

- `screenshots/01-login.png`
- `screenshots/02-otto-blank-after-login.png`
- `screenshots/03-otto-canvas.png`
- `screenshots/04-my-stuff.png`
- `screenshots/05-add-asset-dialog.png`
- `screenshots/06-brand-memory.png`
- `screenshots/07-analytics.png`
- `screenshots/08-account.png`
- `screenshots/09-admin-settings.png`
