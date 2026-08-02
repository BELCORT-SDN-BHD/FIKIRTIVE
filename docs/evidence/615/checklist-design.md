# Onboarding checklist · 设计存档(#615 裁决:先藏,待重做)

Founder 2026-08-02 裁决:六路线中唯一有产品价值的思路。路由本次移除(藏),
重做触发 = 发布 / CRM 功能解锁(递延台账 #359)。本文存档设计思路,供重做时起步。

## 原实现找回处

原组件代码在本 PR 首个 commit 的前一个 commit(main @ `c3d96095b53aa5239d417b414aa4d0fc64c68e63`)可整文件找回:

```
git show c3d96095:apps/web/components/northstar/immersive/misc/onboarding-checklist.tsx
git show c3d96095:apps/web/app/northstar-immersive/onboarding/checklist/page.tsx
```

整页截图:本目录 `checklist-full.png`。

## 四步内容(原案)

| # | 步骤 | 文案(原文) | CTA 指向(原案) |
|---|---|---|---|
| 1 | Connect a channel | Link Instagram, Facebook, TikTok or WhatsApp so Otto can post for you. | 账户 · 连接页 |
| 2 | Add a product | Tell Otto what you sell — it becomes the brand memory behind every post. | 品牌资料(brand kit) |
| 3 | Make your first post | Draft a caption, pick a channel and schedule it — start with one. | 排期 composer |
| 4 | See your numbers | Once posts go out, your reach and engagement land here. | 分析总览 |

页头:`Welcome, <店主名>` + `Four quick steps to get <店名> posting. Do them in any order.` + `n / 4 done` 计数。

## 值得保留的交互

- **进度条 + 计数 pill**:完成度即时反馈(width 过渡 300ms),0–100% 与 `n / 4 done` 同步走
- **步骤行结构**:圆圈(icon → 完成后打勾)+ 标题(完成后划线降灰)+ 一句话说明 + 每行独立 CTA,任意顺序可做
- **「连接渠道」步完成态由连接状态派生**,不可手动勾 —— 真实状态驱动,不许自欺(原案已有此纪律,只是数据源是样板)
- **收尾双态**:全做完 → `Start creating`(主按钮进画布);没做完 → `Skip for now`(次按钮,引导永不锁人)+「You can come back to this anytime」
- 零 coral(引导按钮走 INK),§N6 页头 / §D4 hairline 行的区质量模板

## 重做时的硬要求(裁决口径)

1. **接真身份**:页头 Welcome 用认证会话里的真店主名/工作区名(先例:PR #614 的 `NorthstarShellEntry` → `ShellIdentity`),绝不显示样板商家名
2. **接真连接态**:「连接渠道」完成态从真实连接数据派生(真 API/DB 经受控 adapter,fence 之外),不是样板 store
3. **接真按钮**:每步 CTA 指向真实存活的产品路由(原案四个目的地在 #609/#614 后均已退场,重做时按当时的真路由重定);完成态勾选若保留手动模式,必须落真持久化,不是本地演示 state
4. 触发条件:发布 / CRM 功能解锁后再上(#359 递延台账有登记)
