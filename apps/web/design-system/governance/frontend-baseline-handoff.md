# 前端基线交付与接手入口 — 2026-09-02

> **Founder 授权：** 2026-09-02，要求将本任务的详细交接与前端基线整理成 PR，剩余接线和磨合由 Founder 的后续任务接手。本授权涵盖当前 feature branch 的提交、push 与 PR，不涵盖 merge、部署或生产操作。
> **交付性质：** 已批准设计与前端实现的基线交接；不是完整 production convergence、backend completion 或 beta launch approval。
> **本文件是本次交付快照和阅读入口。** 后续实时差异只更新 [runtime convergence](../information-architecture/runtime-convergence.md)，变更方法只维护在 [前端接线规范](frontend-integration-handoff.md)，不要另建同内容的进度表或设计系统。

## 1. 接手先读什么

1. 读取根 `AGENTS.md`（实际 owner：`.claude/CLAUDE.md`）、[web 指令](../../AGENTS.md) 与 [产品蓝图](../../../../docs/BLUEPRINT.md)。当前任务授权仍优先，旧交接不授予新的权限。
2. 读取 [设计来源地图](../README.md)、[authority.json](../authority.json) 和 [前端接线规范](frontend-integration-handoff.md)。确认这些源码、文档和 symlink 已真正进入接手分支；只收到一个文档链接不等于收到实现。
3. 读取 [runtime convergence](../information-architecture/runtime-convergence.md)，再只加载本次板块的 spec、批准和验收记录。具体入口见第 3 节。
4. 用接手分支的当前代码和真实接口重新验证缺口，再定本轮 spec。不要把本次 checkpoint 或另一任务的口头“完成”当作接口已存在。

**开工完成条件：** 接手者能够说明本轮改哪个 canonical owner、保留哪个 Founder 决定、接哪个真实接口、如何验证，以及哪些条件尚未满足。

## 2. Git 与交付边界

- 本次沿用 `codex/uiux-frontend`，工作树为 `/Users/winnin/.codex/worktrees/4232/FIKIRTIVE`；没有创建第二条前端分支。
- 打包前 HEAD 为 `a32790b889f7bbe3f2712f775c748a9823707b55`。2026-09-02 fetch 后 `origin/main` 为 `deee12db9013fa3b8a2cefcbb2926246ee7275ed`；此时分支落后 main 47 个提交。PR 提交 SHA、实时 mergeability 和 CI 以 GitHub 为准。
- 本次不把 main 合入旧基线、不 rebase、不合并 PR。先以 **Draft PR** 交接；它不是可直接上线的保证。
- 仓库是公开仓库。不得提交环境文件、账号、session、token、数据库内容或原始凭据。PR 文案与附件同样公开。
- 接手者整合较新 backend 时，逐项保留其权限、幂等、schema 和业务动作修复，同时保留本基线的 UI owner。不能整目录覆盖 main，也不能用某一边的 lockfile 解决所有冲突；依赖冲突按实际 manifest 重新生成并验证。
- 多个旧目录被迁成相对 symlink，不是意外丢失源码。必须同时接收 canonical owner 和 alias；不要把 alias 改成复制目录。可执行核对是 `design-system-source-of-truth.test.ts`。
- 工作树暂保留供溯源。本交付不删除其他任务文件或自动清理 worktree；清理须另行验证干净、合并状态与是否仍被使用。
- 根 `design-qa.md` 与其引用的 artifact 图像是历史迭代证据，含已取代方向；不是当前 spec。正式设计来源仍集中在本 design-system 目录，不能从旧截图反推新的批准。
- 打包时保留完整的已引用证据目录；41 个未引用的本地 audit／截图文件未纳入 PR、未删除，包括 `apps/web/artifacts/design-audit/`、`apps/web/artifacts/frontend-completion-audit-2026-08-31/`、`artifacts/canvas-creation-flow-audit/`、`artifacts/founder-home/` 和少量未引用的 root 截图。它们不是运行依赖；工作树因此仍可显示 untracked files。

## 3. 本次包含什么，后续从哪里接

以下是代码导航，不是第二份实时完成表。设计批准、implementation 检查与 authenticated acceptance 必须分别阅读。

| 板块 | 设计／决策入口 | 正式代码／接手入口 |
|---|---|---|
| 品牌、tokens、基础组件 | [来源地图](../README.md)、`brand/`、`foundations/`、`primitives/` | `app/globals.css`、`components/ui` 等 alias 指向同一 owner；组件体系是当前 shadcn Base UI |
| Sitemap 与 application shell | [IA](../information-architecture/README.md)、[surface contract](../information-architecture/surface-contract.md)、[core flows](../information-architecture/core-flows.md) | `packages/core/src/navigation.ts`、`patterns/application-shell/`；准确路径与 labels 不再在页面重写 |
| Home／Analysis | [Phase 2 spec](../information-architecture/frontend-convergence-phase-2-home-spec.md)、[验收记录](../information-architecture/frontend-convergence-phase-2-home-acceptance.md) | `app/(home)/page.tsx`、`app/analysis/page.tsx`、`components/home/`、`lib/home-marketing-health.ts`；持久化、context reader 和完整数据仍看 closure seams |
| Create／Canvas／Otto | [Phase 3 spec](../information-architecture/frontend-convergence-phase-3-create-canvas-spec.md)、[验收记录](../information-architecture/frontend-convergence-phase-3-create-canvas-acceptance.md)、`patterns/canvas/`、`patterns/otto-panel/` | `app/create/`、`components/canvas/`、`components/otto/`；沿用真实 Canvas 和动作层，不新建生成引擎 |
| Library／官方 Avatar | [Library pattern](../patterns/library/README.md)、[接口核对与接线配方](../patterns/library/backend-handoff-contract.md) | approved fixture 在 `patterns/library/`；正式 `app/library/page.tsx` 仍组合 `OttoStuff`。先满足真实 contract，再抽取必要展示层接入 |
| Brand／Otto IQ | [Brand pattern 与 engine 边界](../patterns/brand/README.md)、根 `CONTEXT.md` | approved fixture 在 `patterns/brand/`；正式 `app/brand/page.tsx` 仍组合 `OttoMemory`。Otto IQ engine 由后续 backend 任务提供 |
| Settings | [Phase 4 spec](../information-architecture/frontend-convergence-phase-4-settings-spec.md)、`patterns/settings/` | `components/settings/`、`app/profile/`、`app/settings/`、`app/billing/`；已使用现有能力，仍需登录后的完整验收 |
| Login／Auth | [access journey spec](../patterns/auth/access-journey-spec.md)、`patterns/auth/` | `components/auth/`、`app/login/`、signup、verify-email、forgot-password、reset-password；界面批准不代替账号／邮件／callback 实测 |
| Otto `@` reference | [interaction contract](../information-architecture/reference-picker-contract.md)、[Phase 5 spec](../information-architecture/frontend-convergence-phase-5-reference-picker-spec.md) | `patterns/reference-picker/` 是已验收 review；production composer 接入须先满足 search／resolver／provenance gate，不复制 fixture 数据 |

本次还包含旧业务界面的基础组件、反馈与文案一致性迁移；这不表示 Campaign、Schedule 或 CRM 重新进入 beta 范围。beta 入口和停放范围以当前 navigation contract 为准。

### 必须单独审查的前端邻接 server 改动

此 PR **不是零 server-side 改动**。除界面外，还包含已有能力的邻接修改：

- `lib/data.ts`、`cowork-fetch.ts`、`dto.ts`、`types.ts`：会话分页读取和 older-message 数据接口。
- `lib/memory-actions.ts`、`brand-record-actions.ts`：现有软删除／恢复／重复操作的处理。
- `lib/stuff-items.ts`：Library 列表中同一生成结果的去重。
- `packages/otto/src/instructions.ts`：与主导航一致的 Otto 导航说明，连同相应测试／snapshot。

整合时对照较新 main 逐项审查，并在非生产数据库验证相应权限、恢复与分页行为。本次未新增 schema／migration，也没有代建 Library、Otto IQ、auth 或 creation engine。此声明不豁免已有 server 改动的审查。

## 4. 磨合时怎样保持规则和产品逻辑

具体操作遵守 [前端接线规范第 3–6 节](frontend-integration-handoff.md)。以下只列接手时的判断入口：

- **API 字段不同但体验不变：** 在数据适配边界转换，复用已批准组件。例如真实生成结果有 `processing` 状态，就接到现有 loading 状态，不另造一个生成首页。
- **现有组件缺必要状态：** 先查 canonical primitive／pattern，按风险写 mini spec 或完整 spec，再扩展最小 variant；检查所有消费者。不要在页面复制近似按钮／弹窗。
- **必须改变布局、步骤、页面归属或业务决定：** 写入原 spec 的 change register，解释影响并取得 Founder 决定。接线不能自动批准重设计；新增 UX 还须展示给 Founder 验收。
- **后端能力缺失：** 在对应 handoff 明列缺口。不得用 fixture、localStorage、假 toast、静态 credits 或假延时冒充保存、完成、扣费或权限。

需持续保留的领域边界由 [surface contract](../information-architecture/surface-contract.md)、[Library contract](../patterns/library/backend-handoff-contract.md)、[Brand pattern](../patterns/brand/README.md) 和根 `CONTEXT.md` 负责：Canvas 不是需要 Brief 的 Project；全部生成结果进入 history；收藏／Collection 是整理链接；官方 Avatar 只读；Product 营销事实由 Otto IQ 持有、媒体由 Library 持有；`@` 传稳定对象身份而非只传显示名。不得把这份摘要当作替代原合同。

键位只读取 [web 指令](../../AGENTS.md)，颜色／圆角／间距／动效只读取 design owner，不在交接文档复制数值。确需新参考时按项目要求用 Mobbin MCP；组件 polish 优先 Emil。普通接线不重启无边界设计探索。

这些规则通过项目指令入口、authority map、已有 guard tests、代码审查和 Founder 验收一起落实。文档本身无法保证所有未来改动自动合规，不能把测试绿色解释为已审查所有设计语义。

## 5. 本地查看与验证

使用仓库声明的 Node／pnpm 版本及现有 lockfile。首次 checkout 安装依赖并生成 Prisma client；这些步骤不等于迁移数据库：

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @fikirtive/web dev --hostname 127.0.0.1 --port 3008
```

若端口已有本任务进程，复用它，不终止其他任务进程。正式 authenticated routes 使用合法的非生产测试账号和环境；不要复制 production session、凭据或关闭认证。

### 不需要真实登录的 review 入口

以下相对路径在本地运行后打开，用于看设计和 fixture interaction，不能据此宣称业务接通：

- `/design-system`、`/design-system/components`、`/design-system/checklist`
- `/product-patterns/founder-home`、`/product-patterns/founder-home/analysis`
- `/product-patterns/create`、`/product-patterns/canvas`
- `/product-patterns/library`；官方 Avatar：`?view=elements&element=official-avatars`
- `/product-patterns/brand`、`/product-patterns/settings`
- `/product-patterns/auth?from=%2Fcreate`、`/product-patterns/reference-picker`

正式 `/login?from=%2Fcreate` 是真实登录入口，不是 review bypass。当前可用账号／邮件环境未完成；不要让 Founder 误以为 production 账号必定能登入 local。

### 已有检查及限制

2026-09-02 的 [回归 checkpoint](../information-architecture/runtime-convergence.md#有边界的前端回归检查--2026-09-02) 记录 32 个文件／187 个测试通过、web typecheck 通过。web build 退出 0，但有 Better Auth secret／base URL 配置报错与警告；**不代表 auth 可用或可部署**。

这 32 个文件可在 `apps/web` 下按下列命令重跑。只跑该前端范围，显式移除测试进程的 `DATABASE_URL`；不要把它扩大成完整数据库 suite：

```sh
env -u DATABASE_URL pnpm exec vitest run \
  lib/__tests__/analytics-design-system.test.ts \
  lib/__tests__/application-shell-reference.test.ts \
  lib/__tests__/auth-pattern.test.ts \
  lib/__tests__/billing-settings-design-system.test.ts \
  lib/__tests__/brand-pattern.test.ts \
  lib/__tests__/canvas-design-system.test.ts \
  lib/__tests__/canvas-feedback-design-system.test.tsx \
  lib/__tests__/canvas-pattern-reference.test.ts \
  lib/__tests__/component-system-reference.test.ts \
  lib/__tests__/connections-design-system.test.ts \
  lib/__tests__/create-design-system.test.ts \
  lib/__tests__/design-system-checklist.test.ts \
  lib/__tests__/design-system-data-patterns.test.ts \
  lib/__tests__/design-system-source-of-truth.test.ts \
  lib/__tests__/feedback-design-system.test.tsx \
  lib/__tests__/founder-home-pattern.test.ts \
  lib/__tests__/home-analysis-pattern.test.ts \
  lib/__tests__/library-design-system.test.ts \
  lib/__tests__/library-pattern.test.ts \
  lib/__tests__/merchant-topbar.test.tsx \
  lib/__tests__/otto-chat-design-system.test.ts \
  lib/__tests__/otto-panel-flow-reference.test.tsx \
  lib/__tests__/otto-work-card-design-system.test.ts \
  lib/__tests__/overlay-design-system.test.tsx \
  lib/__tests__/product-pattern-shell.test.ts \
  lib/__tests__/profile-design-system.test.ts \
  lib/__tests__/reference-picker-interaction.test.tsx \
  lib/__tests__/reference-picker-pattern.test.ts \
  lib/__tests__/schedule-design-system.test.ts \
  lib/__tests__/settings-pattern.test.ts \
  lib/__tests__/spend-state-design-system.test.ts \
  lib/__tests__/storyboard-design-system.test.ts
pnpm run typecheck
pnpm run build
```

本范围主要覆盖结构守卫、纯逻辑和 mocked／DOM 组件行为，不覆盖完整 web suite、真实 auth、数据库、钱路、完整无障碍或跨浏览器体验。required CI 状态另查 PR；没跑、不通过或无法运行都不能写成绿色。

## 6. 后续完成条件与交回方式

Founder 后续任务接手真实接口、production convergence 和联合验收，按 [runtime convergence](../information-architecture/runtime-convergence.md) 逐项收敛，不再开第二轮无边界“设计完成度”工作。

每个接线切片关闭前必须：

1. 对原冻结验收条件逐项说明结果，并把接口／状态变化写回原 owner；所有必要能力真实可用，或把尚未完成项保留为未关闭。
2. 验证真实成功、失败、重试、取消、刷新、深链、返回与权限，适用时验证分页／排序／搜索及持久化；付费和 tenant 检查以对应 backend 行为测试为准。
3. 在非生产 authenticated 环境完成 Home → Create／Canvas → Library／Brand → Settings 等实际旅程，并检查共享组件的受影响消费者。
4. 记录相关测试、typecheck、lint、build、浏览器和 required CI 的真实结果。仍未完成的屏幕阅读器、跨浏览器和目标桌面 viewport 检查不能默默略过。
5. 有 UX 变化就让 Founder 看过并明确接受；工程通过和 Founder 接受分开记录。最后上线仍需要单独 release 检查与部署授权。

**本 UIUX 任务的停止点：** 基线、详细交接与 PR 已交给 Founder；不继续替后续任务实现 engine、联调或上线。若磨合需要新组件／流程变更，使用第 4 节的原有规则，不默认重新开放全部设计。

CodeGraph: not used — 在非持图 worktree 做定向交付核对，证据来自当前文件、Git 与记录的测试运行。
