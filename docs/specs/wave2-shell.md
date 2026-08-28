# Wave 2 「换壳」规格书 —— human-first dashboard + Otto 侧栏

> 状态：**已交付 · 归档**（原「定稿」；W2 换壳 2026-08 已上生产，2026-08-28 随《开发作业手册》落地统一状态词汇——历史内容一字未动。原记录：2026-08-18 Founder 经决策 UI 六问全拍板，全部选推荐：Q1-A 五块真数据 Home / Q2-A 共享开工框 / Q3-A 面板首开后记忆 / Q4-A Analytics 并进 Schedule 页签 / Q5-A 不留旧 /otto 全屏页 / Q6-A 三扇门收编不占格）。
> 取证基准：主检出 `/Users/winnin/Desktop/FIKIRTIVE` @ `42cd5fba`（壳相关文件在此提交上全部逐行读过）；
> 钱路文案取自当前工作分支 `claude/otto-chat-free` @ `9a555257`（该分支只动钱路文件，壳文件与主检出一致）。
> 调查手段：`grep` + 直接读文件（worker 在 worktree，按项目法不用 CodeGraph）。
> 判决前提：Founder 2026-08-18 八裁决「引擎好，壳装反 —— 保引擎，换壳」。

---

## 0. 一句话

把产品从「Otto 是首页、十个功能藏在 `/otto?view=` 里」改成「商家自己的七扇真门 + Otto 常驻右侧面板」，
**零数据迁移、零 schema 改动**，只动路由、导航权威与壳组件。

---

## 1. 目标与非目标

### 1.1 V1 目标（= beta 复跑的「全新体验」闸）

| # | 目标 | 判定它做到了没有的那句话 |
|---|---|---|
| G1 | 左导航七格全是**真路由**，URL 栏跟着商家走 | 在 Library 上刷新页面，回来还在 Library |
| G2 | Otto 变成**右侧常驻面板**，不再是一个板块、也不再是首页 | 任何一页都能开 Otto，主内容不被遮住、仍可点 |
| G3 | Otto 的图标与面板**可拖、可缩** | 面板宽度拖过一次，换页仍是那个宽度 |
| G4 | 首页是商家自己的总览（Home），**每个数字都有真实来源** | 空账号看到的是诚实的空，不是假的满 |
| G5 | 移动端整层删除，桌面端代码不再为它分叉 | `global-navigation.tsx` 里没有 drawer/backdrop/matchMedia |
| G6 | CRM 整段消失（导航 + 表面） | 全仓没有任何一条商家可点的路径通向 `/crm` |
| G7 | UI 一律 shadcn/ui 原语 | V1 面上没有手搓的 dialog / tablist / skeleton |
| G8 | 没通电的能力照实说 | 发布关着的时候，没有任何一句话承诺「会发出去」 |

### 1.2 V1 明确**不**做（这些是后续票，不是遗漏）

| 不做 | 为什么 | 触发条件 / 后续去处 |
|---|---|---|
| Brand 地基重设计（BrandKit / BrandRule 数据模型） | 实查确认：`BrandKit`、`BrandRule` 各**只有一个读取点**（`apps/web/lib/memory-actions.ts:114,118`），**全仓零写入点**。重设计要先定数据模型，那是独立里程碑 | Founder 裁决后独立开票；V1 只把现有 Memory/BrandRecord 视图原样搬家 |
| X（Twitter）OAuth | `apps/web/lib/channels/x.ts` 的 `connectUrl` 指向未建的 `/api/x/authorize`；`UNAVAILABLE_PUBLISHING_CHANNEL_IDS`（`channel-meta.ts`）把 X 挡在四个入口外 | V1 只做**版式能容纳多渠道**；OAuth 落地时删 `channel-meta.ts` 里一个 id，四处一起亮 |
| CRM 重建 | Founder 裁决：CRM 整段藏起来 | 触发 = Meta verification 通过 |
| 文字选中引用（highlight-to-quote） | 参考里 Meta AI 有（`ref.json` 0:21–0:24），但要一套跨页选区监听 | V2 |
| 消息级反馈（👍/👎/copy） | 全仓没有落点表，加一张表就不是「换壳」了 | V2 |
| 聊天里内嵌真实图表卡 | Analytics 今天对每个商家都是 `notConnected`（见 §4.6），没有数据可画 | Meta 打通后 |
| 移动端 / 响应式手机版 | Founder 裁决：desktop-only | 不做 |
| Analytics 真数字 | `getAnalytics` 读的是 Meta `me/adaccounts`，Facebook Login 在 app 层关着 | Meta 打通后 |
| Agency 多品牌切换器 | 是真实未来场景，但不是 beta 闸 | V1 只在 URL 形状上留门（`/brand` 而不是 `/brand/me`），代码不预埋 |

### 1.3 一条贯穿全篇的纪律

**`packages/core/src/navigation.ts` 仍然是导航的唯一权威。** 这次改的是那棵树的**数据**，壳只在需要一种新画法时才动。
本规格书里任何一处路径，落地时都不许在壳里再写第二遍。

---

## 2. 信息架构终稿

### 2.1 左导航（顺序即导轨从上到下）

```
┌ Ask Otto  ← 不是板块、不是路由，是打开右侧面板的按钮
├──────────
│ Home            /
│ Create          /create
│ Library         /library
│ Brand           /brand
│ Campaigns       /campaign
│ Schedule        /schedule
├──────────
│ Settings（分组）
│   Billing & credits   /billing
│   Connections         /settings/connections
│   Preferences         /settings
└ Credits 余额行 → /billing
  身份菜单（Profile / Sign out）
```

七格 = Home / Create / Library / Brand / Campaigns / Schedule / Settings。
`Customers` 整格消失（Founder 裁决）。`Workspace` 分组消失（它的六个孩子全部升为顶层或并入邻居）。

### 2.2 路由对照表（旧 → 新）

| 旧地址 | 新地址 | 处置 |
|---|---|---|
| `/`（`redirect("/otto")`，`apps/web/app/page.tsx`） | `/` | **变成真页面**：Home 总览 |
| `/otto`（`OttoApp` 十视图宿主） | `/?otto=1` | 307 重定向 + 自动开面板 |
| `/otto?view=library` / `?view=stuff` | `/library` | 重定向 |
| `/otto?view=edit` | `/library/editor` | 重定向（见 Q6） |
| `/otto?view=memory` | `/brand` | 重定向 |
| `/otto?view=templates` | `/create#templates` | 重定向（见 Q6） |
| `/otto?view=discover` | `/create#ideas` | 重定向（见 Q6） |
| `/otto?view=schedule` | `/schedule` | 重定向 |
| `/otto?view=analytics` | `/schedule/analytics` | 重定向（见 Q4） |
| `/otto?view=connections` | `/settings/connections` | 重定向 |
| `/otto?view=account` | `/settings` | 重定向 |
| `/otto?thread=T&project=P` | `/?otto=1&thread=T&project=P` | 重定向，面板自动打开该会话 |
| `/northstar-immersive` | `/create` | 目录改名 + 永久重定向 |
| `/northstar-immersive/create/canvas` | `/create/canvas` | 目录改名 + 永久重定向 |
| `/library`（今天是 redirect shim） | `/library` | **shim 撤销，变回真页面** |
| `/m`（redirect shim → `/otto`） | — | **删除路由文件**，同时删 `MERCHANT_NAV_REDIRECTS` 里那一条 |
| `/campaign/calendar` | `/schedule` | 保留重定向，只换目标（「一个日历」裁决不变） |
| `/crm` 及其全部子路由（14 个 page.tsx） | `/` | 全部 307 到 Home，文件保留在盘上 |
| `/profile` | `/profile` | 不变（身份菜单进入） |
| `/billing` | `/billing` | 不变 |
| `/campaign*` | `/campaign*` | 不变 |
| `/admin*` | `/admin*` | 不变（Founder-only 壳，本次不动） |

关于 `/northstar-immersive` 改名的成本实查：生产代码只有 **2 处**引用这个字符串
（`packages/core/src/navigation.ts` 的 `CREATE_NAV_HREF`/`CANVAS_HREF`，以及 `apps/web/components/canvas/NorthstarShellEntry.tsx`），
其余 41 处全在测试文件里（最重的是 `northstar-shell-purge.test.ts` 23 处）。
所以这是**一次目录移动 + 两行常量 + 测试里的路径字面量**，不是重构。
理由：`northstar-immersive` 是内部代号，它出现在商家的地址栏里本身就是一处「说的与做的不一致」。

### 2.3 navigation.ts 的具体改动

**① `MERCHANT_NAV` 重写为七格**（数据改动，形状不变）：

```ts
export const MERCHANT_NAV: readonly MerchantNavNode[] = [
  { key: "home",     label: "Home",      href: "/",         does: "See what is waiting for you, what you made lately, and what goes out next." },
  { key: "create",   label: "Create",    href: "/create",   does: "Start something new and open it on a canvas — every canvas you have lives here." },
  { key: "library",  label: "Library",   href: "/library",  does: "Find every image and video you have already made." },
  { key: "brand",    label: "Brand",     href: "/brand",    does: "Keep what Otto should remember about your brand and the things you sell." },
  { key: "campaign", label: "Campaigns", href: "/campaign", does: "Plan a campaign, edit its plan entries and their dates, and approve what may be made." },
  { key: "schedule", label: "Schedule",  href: "/schedule", does: "The one calendar: everything waiting to be posted, when it goes out, and your approval before it does." },
  { key: "settings", label: "Settings", items: [
      { key: "billing",     label: "Billing & credits", href: "/billing",              does: "Buy credits, and read what your credits have gone on." },
      { key: "connections", label: "Connections",       href: "/settings/connections", does: "Connect or disconnect the accounts you post from." },
      { key: "preferences", label: "Preferences",       href: "/settings",             does: "Set your spend cap and posting defaults." },
  ]},
];
```

注意两处诚实修正（`simulated-features.json` 已实证，此次一并修掉）：
- `preferences.does` 删掉 “notifications”——通知开关早已删除，没有任何邮件或站内渠道读它。
- `analytics` 的 “See how what you posted actually performed” 不再作为导航承诺出现（它读的是 Meta 广告账户，不是自然帖表现）。

**② `OTTO_ASSISTANT` 不再是一条 href。** 它现在是面板，不是地址。

```ts
/** Otto —— 面板，不是地址。它没有 href：任何一页右侧都是它。 */
export const OTTO_ASSISTANT = {
  key: "otto",
  label: "Ask Otto",
  does: "Ask Otto to do any of this with you — Otto sits on the right of every page, and is never a section of its own.",
} as const;
```

连带改动：
- `everyNavDestination()` 只返回真链接（助手不在内）。
- `merchantNavMap()` / `describeNavLink()` 给助手单独一行，写清「它在右边，按 Otto 按钮或 Cmd+J 打开」，不给 URL。
- `navPath()` / `navLabel()` 对 `otto` key 的分支保留（Otto 仍要能说出自己的名字）。
- `packages/core/src/navigation.test.ts:122`「但它确实是一个真能点开的目的地」这条断言需按新事实改写为「助手不是一个地址，但它有名字且地图里说得清怎么打开」。
- `packages/otto/src/__snapshots__/otto-instructions.golden.txt` 会变（地图变了），属预期。

**③ `MERCHANT_NAV_REDIRECTS` 扩充。** 现有类型是 `{from, to, why}`，只能表达整路径重定向。
新增一份 query 映射，作为围栏的第二个枚举源：

```ts
/** 旧 /otto?view=X 的去处 —— 每一个 view 都必须在这里有一行，否则围栏红。 */
export const OTTO_VIEW_REDIRECTS: Readonly<Record<string, string>> = {
  otto: "/?otto=1",
  library: "/library",
  stuff: "/library",
  edit: "/library/editor",
  memory: "/brand",
  templates: "/create#templates",
  discover: "/create#ideas",
  schedule: "/schedule",
  analytics: "/schedule/analytics",
  connections: "/settings/connections",
  account: "/settings",
};
```

**④ `isMerchantSurface` / `MERCHANT_SURFACE_PATHS` 自动跟随**（它已经是从 `merchantNavLinks()` 派生的）。
唯一要手加的仍是 `/profile`。`/crm` 从此不在这份名单里——这正是「CRM 表面消失」的机器含义。

### 2.4 `/otto` 这条路由的新身份

`/otto` **不再是页面**，它变成一张重定向表：读 `?view=`、`?thread=`、`?project=`，按 §2.3 ③ 的映射送人。
文件从 `apps/web/app/otto/page.tsx`（128 行数据加载 + `<OttoApp>`）缩成十几行 `redirect()`。

为什么不留一个全屏聊天页：留着就是**第二个 Otto**——这个仓库最贵的一课就是两套东西各自漂移
（两个导航、两个日历、两个创作入口，`ia.json` 全部记在案）。面板要更大空间时用面板自己的 **Expand** 控件
（参考里 Meta AI 面板头部就有这颗，`ref.json` 0:09），不用第二条路由。见 Q5。

### 2.5 深链兼容

- 每一条旧地址都 **307**，永不 404（`MERCHANT_NAV_REDIRECTS` 的老纪律照旧）。
- `?project=` 与 `?thread=` 在重定向后保留，面板按它开对应会话。
- `apps/web/proxy.ts` 里那段 `isStaleOttoThreadActivityAction`（按 `pathname === "/otto"` + action id 挡陈旧 server action）
  在 `/otto` 变成纯 redirect 后失去对象，随切换总票一并删除。

---

## 3. Otto 侧栏面板规格

### 3.1 形态

| 属性 | 值 | 依据 |
|---|---|---|
| 默认形态 | **右侧停靠（docked）**，挤压主内容而不是盖住它 | `ref.json` uxNotes ①「Dock, don't cover」；Shopify Sidekick 与 Meta AI 两个参考都是这样 |
| 默认宽度 | `clamp(360px, 25vw, 560px)` | 参考实测 ~20–25%（Meta AI ~290px/1280px = 23%） |
| 最小 / 最大宽度 | 320px / `min(720px, 50vw)` | 320 以下审批卡塞不下；50vw 以上主内容就没意义了 |
| 缩放手柄 | 面板左边缘，命中区 6px（hover 12px），`cursor: col-resize` | — |
| 折叠 | 面板头部 X → 收成浮动图标 | `ref.json` 0:06「简单开关，不是常驻家具」 |
| 快捷键 | `Cmd/Ctrl + J` 开合 | — |
| Expand | 面板头部一颗按钮，把宽度临时推到 `min(960px, 60vw)`，再按回落 | `ref.json` 0:09 |

### 3.2 拖动语义（Founder 明令：图标和聊天框都要 draggable + 可伸缩）

两种模式，一个状态机：

```
docked（默认）
  ├─ 拖面板头部 → 脱离，进入 floating
  └─ 拖左边缘  → 改宽度（仍是 docked）

floating（自由窗）
  ├─ 拖头部     → 移动；四角/四边可缩放
  ├─ 拖到右边缘 48px 内松手 → 回到 docked（松手前画一条 2px 的落点提示线）
  └─ 视窗缩小时把窗体夹回可视区（clamp），永不飞出屏幕
```

- floating 尺寸约束：最小 `320 × 360`，最大 `720 × 90vh`。
- floating 时主内容**不再被挤压**（它是浮窗），但面板半透明边框 + 阴影，确保下面看得见。
- 浮动图标（launcher）：48px 圆形，`OttoAvatar`，默认右下 `(right:24, bottom:24)`。
  可任意拖动；**松手吸附到最近的左/右边缘**，保留 y。面板打开时图标隐藏。
  今天 `apps/web/components/northstar/immersive/immersive-shell.tsx:100-110` 已经有一颗
  `fixed right-4 bottom-4 size-12` 的 Otto 按钮（一个 `<Link href="/otto">`），V1 把它换成这颗 launcher，
  并从「跳转」改成「开面板」。

### 3.3 持久化

**localStorage，不落库**，键 `fikirtive:otto-panel:v1`：

```json
{ "mode": "docked", "open": true, "width": 420,
  "float": { "x": 980, "y": 120, "w": 420, "h": 640 },
  "launcher": { "edge": "right", "y": 0.72 } }
```

理由（要向 Founder 说清）：面板几何是**这台设备**的事实，不是这个工作区的事实——13 吋笔电和 27 吋显示器想要的数字不一样。
落库会带来一次 schema 改动、一条迁移和一个跨设备打架的新 bug 类别，换来的好处是零。
（对照：spend cap、posting defaults 这类**工作区**事实，今天走 `setOwnerSetting` 落 `Organization.settings`，那是对的。）

读取时机：服务端渲染不知道 localStorage，所以首帧按默认值渲染，挂载后一次性套用存值，
并给面板容器 `data-otto-panel-hydrated` 属性 —— 避免宽度跳一下（用 CSS transition 只在 hydrated 之后开启）。

### 3.4 面板结构（自上而下）

```
┌─────────────────────────────────────┐
│ ☰  Otto        ⤢ Expand   ✎ New  ✕ │  ← 头部：历史 / 放大 / 新会话 / 关闭
├─────────────────────────────────────┤
│ ⌖ On this page: Raya promo       ✕ │  ← 上下文 chip（可关）
├─────────────────────────────────────┤
│                                     │
│        会话流（OttoChatStream）      │
│        审批卡 / 计划卡 / 结果卡      │
│        生成进度（narrated）          │
│                                     │
├─────────────────────────────────────┤
│ [Plan a campaign] [Make a video]    │  ← 快捷 chips（随页面变）
│ ┌─────────────────────────────┐ ↑  │
│ │ Ask Otto anything…          │    │
│ └─────────────────────────────┘    │
│ Chatting with Otto costs credits…   │  ← CHAT_SPEND_NOTE，唯一措辞
└─────────────────────────────────────┘
```

- **☰ 历史**：打开会话列表，按日期分组 + `New chat`。这份列表今天在 `OttoNav.tsx`（674 行的第二条导轨）里，
  V1 把**列表本身**搬进面板（新组件 `OttoThreadList`），把**导轨**删掉。项目（project）分组保留。
- **上下文 chip**：面板知道当前路由与当前对象 id。V1 只做「路由 + 对象名」这一层，
  例如在 `/campaign/abc` 上显示 `On this page: Raya promo`；在 `/library` 上显示 `On this page: Library`。
  可关闭；关闭后本次会话不再自动带上下文。
- **快捷 chips**：3–4 颗，按页面给。例：Home 给 `Plan a campaign` / `What should I post this week?` /
  `Make something from my products`；Schedule 给 `Fill next week` / `Move this to Friday`。
  这些 chips 复用 `OttoFrontDoor.tsx` 已有的四个 goal tiles 机制（`goalKey`），不是新发明。
- **审批卡在面板内**：这是 V1 的真活。今天聊天面宽 `clamp(360px, 38%, 520px)`（`OttoView.tsx:319`），
  `OttoApprovalCard` / `OttoPlanCard`（`OttoPlanCard.tsx` 500+ 行）是按那个宽度画的。
  面板最窄 320px，要走一次窄版式：卡片内的双列改单列、按钮组换行、金额与 credits 数字不许换行截断。
- **生成进度**：复用现有 `activity` / `pending` 状态，把干巴巴的 spinner 换成会变的短句
  （`ref.json` uxNotes ⑤：`Getting started…` → `Considering best practices…`）。
  V1 用**已有的**回合阶段（planning / calling model / settling），不新造阶段。

### 3.5 十条参考原则的 V1 / 后续分配

| # | 原则（`ref.json` uxNotes） | V1 | 说明 |
|---|---|:--:|---|
| 1 | Dock, don't cover | ✅ | 强制项，G2 |
| 2 | 轻量开关，不是目的地 | ✅ | 顶部 Otto 按钮 + `Cmd+J` + 浮动图标 |
| 3 | 真会话记忆（按日期分组 + New chat） | ✅ | 已有数据，搬位置 |
| 4 | 读得到用户正在看什么 | 🟡 | V1 只做路由/对象 chip；**文字选中引用 → V2** |
| 5 | 用人话叙述等待 | ✅ | 复用已有阶段，只改文案 |
| 6 | 结构化、可扫读的回答 | ✅ | 提示词侧，`packages/otto` 已部分做到 |
| 7 | 聊天里内嵌真实数据卡 | 🟡 | V1 = 现有审批/计划/结果卡；**图表卡 → Meta 打通后** |
| 8 | 自由输入 + 快捷 chips | ✅ | 复用 goal tiles |
| 9 | 谦逊语气 + 逐条反馈控件 | 🟡 | V1 保留 beta 诚实开场白；**👍/👎/copy → V2**（无落点表） |
| 10 | 支持附件作为上下文 | 🟡 | V1 = 从 Library 选（已有 picker）；**OS 文件上传 → V2** |

---

## 4. 每区 V1 范围

### 4.1 Home `/`

**唯一新页面。** 五块，每块的数据来源都实查过、今天就能读到：

| 块 | 内容 | 真实来源（已存在的函数） |
|---|---|---|
| ① 开场 | `Good morning, {name}` + credits 余额 + 一个「开始做点什么」入口 | `ottoGreetingNameFromProfile` / `getMyAccount()` |
| ② 接着做 | 最近的画布（含更新时间）+ 最近生成的缩略图 | `getProjects(ownerId)` / `getRecentGenerationThumbs(ownerId)` |
| ③ 接下来发什么 | 未来 7 天的排期条目 + 发布状态实话 | `listScheduledPosts()` + `PUBLISH_PREVIEW_COPY.fact` |
| ④ 进行中的战役 | 战役卡片（名称 / 目标 / 状态徽章） | `listCampaigns()` |
| ⑤ 把 Otto 装备好（仅未完成时出现） | 品牌记忆有没有、产品有没有、渠道连没连 | `listMemory` / `listBrandRecords` / `ottoOnboardingFacts`（已存在） |

**Home 上绝对不出现的东西**（这是纪律，不是偏好）：

- 任何 Meta 来的数字。实查：`apps/web/lib/analytics-actions.ts` 的 `getAnalytics` 对**每一个**商家都返回
  `{state:"notConnected"}`——Facebook Login 在 app 层关着（`packages/core/src/schedule-draft.ts:139`
  `PUBLISHING_AVAILABLE = false`）。放一个「本月触达」磁贴，就是编造。
- 任何营收 / 订单 / 客户数。实查：`Contact.totalOrdersMyr` **全仓无写入点**
  （`crm-actions.ts:325` 明确拒写），CRM 又整段藏起来。
- 任何「今日决策队列」式的样板数据。#609 已经因为这个把旧的沉浸式首页砍过一次
  （`NorthstarHome.tsx` 文件头注释逐字记着这件事）——不要犯第二次。

空账号看到的 Home：开场（余额 = 起始 credits）+ 一句 `Nothing here yet — start your first canvas.` + 装备清单。
这就是全部，且它是真的。

### 4.2 Create `/create`（+ `/create/canvas`）

- 画布保持旗舰位（#801 裁决不变），Create **一格直达**，不做成要先展开的分组。
- `/create` = 今天的 `NorthstarHome`（开工输入框 + New canvas + 商家自己的画布列表），原样搬家 + 改名。
- **一屏只有一个「开始做点什么」**：`ia.json` 记录的头号重叠就是两个平行前门
  （Otto 聊天框 vs Create 输入框，两套心智模型）。V1 的收口办法是：
  抽一个共享组件 `<StartSomething/>`，**一份实现、一条动作**（`createProject(name)` → 跳画布），
  Home 和 Create 各摆一次；Otto 面板**永远不静默开画布**，它只提议、商家点了才建。
  （Home 要不要摆那个输入框见 Q2。）
- Templates 与 Discover 见 Q6。若按推荐，它们变成 `/create` 页面下方两个区段（`#templates` / `#ideas`），
  不再各占一个导航格。

### 4.3 Library `/library`（+ `/library/editor`）

- 今天的 `/library` 是个 redirect shim（`app/library/page.tsx` → `/otto?view=library`）。V1 **把 shim 撤了，路由变回真的**。
- 内容 = `OttoStuff`（381 行）原样搬家；`buildStuffItems({entities, history, ads, records})` 的数据组装不动。
- **依赖在飞 PR**：entity type 变更控件来自 `claude/w1-entity-type`。W2-1 必须建在它之上（或它先合）。
- 顺手把两处手搓弹窗换成 `components/ui/dialog`：
  `apps/web/components/otto/stuff/AddAssetDialog.tsx:165-176`、`OttoStuff.tsx:319-330`
  （两处都在自己实现 backdrop-click，焦点陷阱和 ESC 干脆没有）。
- `/library/editor` = 今天的 `EditDesk`（503 行，剪辑台）。它的引擎一直在跑，只是入口在 `?view=edit` 里。
  navigation.ts 原来的注释说得对：「要剪的东西就在那里，两格之间不隔第三样」——所以它跟着 Library 走。

### 4.4 Brand `/brand`

**V1 = 现有视图取消嵌套 + 说实话，不重设计地基。**

- 内容 = `OttoMemory`（450 行）：六个页签 About / Look / Customers / Products / Offers / Rules，
  背后是 `Memory` 与 `BrandRecord` 两张**真有读写**的表。
- 手搓 tablist（`OttoMemory.tsx:373`）换成 `components/ui/tabs`（该原语今天零调用点）。
- 手搓图片选择弹窗（`OttoMemory.tsx:438-444`，连 `role="dialog"` 都没有）换成 `ui/dialog`。
- 页面顶部一句诚实说明（English sentence case）：
  > Brand is where Otto learns your business. Colors, fonts, and logo are not part of this yet — what you write here is what Otto uses today.
- **不碰** `BrandKit` / `BrandRule`：它们各有一个读取点、零写入点，属于「建了没人用」的一类，
  按 Founder「整顿基础框架」常令归入待处置，由地基重设计票决定是接通还是删表。
- Agency 多品牌是真实未来场景 → V1 只保证 URL 形状 `/brand` 能长出 `/brand/[brandId]`，代码不预埋。

### 4.5 Campaigns `/campaign`

- 路由、数据、页面全部**不动**（今天已经是真路由 + 真数据 + 已用 shadcn Card/Badge/Button）。
- 只做两件事：① 导航格改名 `Campaign` → `Campaigns`（它列的是多条）；
  ② 页内 `CampaignNav` 三个页签（list / workbench / trends）换成 `ui/tabs`。
- `/campaign/calendar` 的重定向目标从 `/otto?view=schedule` 改成 `/schedule`。

### 4.6 Schedule `/schedule`（Analytics 见 Q4）

- 内容 = `OttoSchedule`（1675 行，全仓最大的视图组件）原样搬家。它是**唯一权威日历**（真 `ScheduledPost` 表 + worker）。
- 诚实收口（`simulated-features.json` 实证，本次一并修）：
  `OttoSchedule.tsx:1578-1579` 有一颗永久 `disabled` 的 “Ask Otto to write it” 按钮，
  title 写着 “Coming soon — Otto will draft this from your brand memory.”。
  同一个仓库的 `schedule-draft.ts:156` 明写「④ What comes next. Never a date」。**删掉这颗按钮**——
  Otto 面板就在右边，要它写文案直接说就行，不需要一颗死按钮替它承诺。
- 发布关着的实话继续走 `PUBLISH_PREVIEW_COPY` 四句式，一字不改。
- 推荐把 Analytics 做成本页第二个页签 `/schedule/analytics`，理由见 Q4。

### 4.7 Settings 分组

| 路由 | 内容 | V1 改动 |
|---|---|---|
| `/billing` | 余额、买 credits、消费历史 | 不动（已是真路由）。Home 的 credits 行点这里 |
| `/settings/connections` | `OttoConnections`（538 行） | 搬家 + **多渠道版式**：Publishing 分区按 `CHANNEL_META` 逐行渲染（Instagram / Facebook / X），发布开关**按渠道**而不是全局；X 行按 `isConnectableChannel()` 显示 “Not available yet” 且**不画 Connect 按钮**（今天已经这样，保住） |
| `/settings` | `OttoAccount` + `settings/SettingsPage`（spend cap、posting defaults） | 搬家；导航文案删掉 “notifications”（那段早已删除，没有任何渠道读它） |
| `/profile` | 显示名、工作区名、邮箱 | 不动，仍从身份菜单进 |

Connections 页顶部要加一句今天缺的实话（`simulated-features.json` 第 12 条）：
> No Instagram or Facebook account can be connected right now, so nothing here can be linked yet. Your schedule stays real either way.

---

## 5. 删除清单

删除是这张规格书里**最省钱**的一节。逐条带文件与行号。

### 5.1 移动端整层（Founder 裁决：desktop-only）

| 文件 | 删什么 |
|---|---|
| `apps/web/components/global-navigation.tsx` | 浮动 trigger（614-625）、backdrop（627-631）、`<aside>` 的 `translate-x` 抽屉分支与 Close X（633-658）、`mobileOpen` 状态与 `RAIL_IS_PERMANENT` matchMedia effect（734-756）、`GlobalNavigationDrawerContext` / `useOpenGlobalNavigation` / `useGlobalNavigationOpen`（244-263）、`MOBILE_NAV_TRIGGER_INSET`（715）、`showMobileTrigger` 与 `ownsFullHeightWorkspace`（231-233） |
| `apps/web/components/otto/OttoApp.tsx` | `MOBILE_BP`（23）、内联 `<style>` 媒体查询块（604-614）、`otto-mobile-topbar` 整个 div（666-692）、`IconMenu`（80-88）、`drawerOpen` 状态、`Show sidebar` 浮钮（622-636） |
| `apps/web/components/otto/OttoNav.tsx` | `MOBILE_BP`（12）、`.otto-nav` slide-over CSS-in-JS（338-358）、backdrop div（362-376）、`drawerOpen`/`onDrawerClose` props |
| `apps/web/components/otto/otto-nav-collapse.ts` | **整个文件（7 行）**——它只为「移动关抽屉 vs 桌面收侧栏」两种行为存在 |
| `apps/web/components/otto/OttoView.tsx` | `@media (max-width: 680px)` 那整段（254-285） |
| `apps/web/components/northstar/immersive/immersive-shell.tsx` | `<1024` 的 52px 自有顶栏（76-92） |

配套删的测试（共 **~1030 行**）：

- `apps/web/lib/__tests__/mobile-375-layout.test.ts`（156 行；它引用的
  `scripts/tools/mobile-viewport-check.mjs` **在仓库里根本不存在**——一处悬空引用，删得干净）
- `apps/web/lib/__tests__/otto-mobile-nav-handoff.test.ts`（449 行，全部在钉两个汉堡重叠的 #747）
- `apps/web/lib/__tests__/otto-nav-collapse.test.ts`（14 行）
- `apps/web/lib/__tests__/global-navigation.test.ts`（349 行）里的抽屉/BottomNav 断言（文件保留，改写）

### 5.2 第二条导轨

`OttoNav.tsx`（674 行）作为**导轨**整体退场；只有它的**会话/项目列表**以 `OttoThreadList` 的身份活进 Otto 面板。
`otto-nav-model.ts`（81 行）随之简化——它今天的职责是「把 view 键映射成导轨条目」，view 变路由之后这层没有了。

### 5.3 重复的 Workspace 菜单

`MERCHANT_NAV` 里的 `workspace` 分组（7 个孩子）整格消失。
`SectionTabs`（`global-navigation.tsx:365-401`，1024–1279px 的横向页签兜底）随之删除——
新导轨只有**一层**：240px 带标签，商家可手动收成 64px 图标，状态存 localStorage。
按宽度自动换形态的那套（`lg:` 图标 / `xl:` 标签）连同它制造的三处分叉一起删。

### 5.4 死路由

| 路由 | 处置 |
|---|---|
| `apps/web/app/m/page.tsx` | 删文件 + 删 `MERCHANT_NAV_REDIRECTS` 里那一条 |
| `apps/web/app/library/page.tsx`（shim） | 内容替换为真页面 |
| `apps/web/app/page.tsx`（`redirect("/otto")`） | 内容替换为 Home |
| `apps/web/app/otto/page.tsx`（128 行） | 缩成重定向表 |
| `/admin/{content,conversations,cost,credits,directives,knowledge,models,settings,team}` | **不动**（Founder-only 壳，本次不在范围） |

### 5.5 CRM 全面隐藏

- 导航：删 `customers` 那一格（连同它引用的 `MESSAGING_STATUS_MERCHANT` preview）。
- 路由：`/crm` 及 14 个子 page.tsx **文件保留**，各自换成 `redirect("/")`（不 404，测试账号的书签不该撞墙）。
- 7 个 CRM `loading.tsx` 骨架文件随之删除（`crm/{broadcasts,contacts,inbox,reports,segments,templates,workflows}/loading.tsx`
  ——它们正好是 `audit.json` 点名的手搓 skeleton 大户）。
- 4600 行 CRM 引擎、`packages/otto` 的 CRM 技能：**原地保留**，等 Meta verification。
- 加一条围栏：`merchantNavLinks()` 里不许出现任何 `/crm` 前缀的 href。
- 按项目法登记到延期台账 issue #359，触发条件写清「Meta verification 通过」。

### 5.6 shadcn 收口（只限 V1 面）

实查（`grep -rl "components/ui/<name>\"" --include=*.tsx`，排除自身与测试）：

```
tabs: 0   skeleton: 0   sheet: 0   popover: 0   separator: 0   alert: 0   progress: 0
tooltip: 1  dropdown-menu: 1  switch: 6  dialog: 14  card: 23
```

V1 要收口的三类：

1. **手搓弹窗 → `ui/dialog`**：`stuff/AddAssetDialog.tsx:165`、`OttoStuff.tsx:319`、`OttoMemory.tsx:438`
2. **手搓 tablist → `ui/tabs`**：`OttoMemory.tsx:373`、`campaign/campaign-nav.tsx`、（`SectionTabs` 直接删）
3. **手搓 skeleton → `ui/skeleton`**：`app/campaign/loading.tsx`、新的 `/library`·`/brand`·`/schedule` loading
   （7 个 CRM 的随 §5.5 删除；`app/otto/loading.tsx` 随 `/otto` 变重定向一并删）
4. **身份菜单与分组展开的 `<details>/<summary>` → `ui/dropdown-menu`**：
   `global-navigation.tsx` 的 `IdentityMenu`（489-541）与 `NavigationGroup`（428-454）今天没有 ESC 关闭、
   没有点外关闭、`role="menu"` 是手写在一个普通 div 上的

`ui/sheet` **不迁移，直接不用**——它的用途是移动抽屉，而移动抽屉正在被删。

---

## 6. 兼容与迁移

### 6.1 会不会动到数据

**不会。** 这次改动的全部内容是：路由文件、导航权威数据、壳组件、以及测试。
- 零 Prisma schema 改动
- 零 migration
- 零 ledger / reserve / settle / refund 路径改动
- 零 tenant 边界改动（`isMerchantSurface` 派生源不变，只是树变了）

这一点要在 PR 描述里写死：**换壳不碰钱路，也不碰租户**。判官按这条核。

### 6.2 测试账号会遇到什么

| 现象 | 影响 | 处置 |
|---|---|---|
| 书签 `/otto?view=schedule` | 自动跳 `/schedule` | 无感 |
| 书签 `/otto?thread=xxx` | 跳 `/?otto=1&thread=xxx`，面板自动开该会话 | 无感 |
| 书签 `/northstar-immersive/create/canvas?project=P` | 跳 `/create/canvas?project=P` | 无感 |
| 书签 `/crm/contacts` | 跳 `/`（Home） | **会觉得东西没了** → beta 说明里写一句「Customers 这一段暂时收起来了，等 Meta 审核」 |
| 浏览器里存的旧壳状态 | 全仓今天只用一个 `sessionStorage` 键（`fikirtive:stale-server-action-reload-at`），新键全部是加法 | 无感 |
| 首次进入新壳 | 面板按默认值开（见 Q3），宽度 25% | — |

### 6.3 部署策略：**堆叠 PR + 最后一次无开关切换**

推荐做法，理由逐条：

```
Stack A  新路由与旧路由并存        →  可合，导航还没指过去，只有输 URL 才到得了
Stack B  Otto 面板组件建好          →  可合，只挂在新路由上
Stack C  切换总票（一次性）         →  navigation.ts 权威改写 + 旧壳删除 + 重定向 + 测试清理
```

**为什么不用 feature flag**：
1. flag 意味着两套壳同时活着——那正是这个仓库最贵的病（`ia.json` 记录的两个导航、两个日历、两个创作入口，全是这么来的）。
2. 导航是**一份权威数据**，切换成本本来就只有一次数据改写，flag 买不到什么。
3. 实查现状：**未公测、零正式用户**（Founder 2026-08-01 纠正）。大爆炸切换没有迁移风险，这正是换面的窗口。
4. flag 还会污染 `navigation.test.ts` / `creation-nav-flagship.test.ts` 这类围栏——它们钉的是「唯一权威」，
   一加分支就得钉两套形状。

**为什么不是一个巨型 PR**：Stack A 的六条新路由彼此不碰同一个文件，可以六个 worker 并行；
一个巨型 PR 会把它们串成一条线，还会让判官没法逐块核。

**回滚**：Stack C 是单次 revert 可回的（它只改数据与删文件，没有不可逆动作）。
真出事就 revert Stack C，旧壳整套回来，A/B 留在原地无害。

---

## 7. 验收清单

### 7.1 逐区行为测试（这仓的既有做法：纯函数围栏 + `renderToStaticMarkup` + 路由文件枚举）

**导航权威（`packages/core/src/navigation.test.ts`）**
- [ ] `MERCHANT_NAV` 恰好七个顶层节点，key 全不重复
- [ ] 每条 href 都有对应的 `app/**/page.tsx`（枚举核对，不许有「有门没页」）
- [ ] `merchantNavLinks()` 里没有任何 `/crm` 前缀
- [ ] `merchantNavLinks()` 里没有任何 `?view=` 残留
- [ ] `OTTO_VIEW_REDIRECTS` 覆盖旧 `VALID_VIEWS` 的全部 11 个键，一个不少
- [ ] 标签仍过 `NAV_LABEL_ALLOWED_CHARS` 白名单与 sentence-case 断言
- [ ] `OTTO_ASSISTANT` 没有 href，但 `navLabel("otto")` 仍返回 `Ask Otto`，且 `merchantNavMap()` 里说得清怎么打开它

**重定向（新 `route-redirects.test.ts`）**
- [ ] §2.2 表里每一条 `from` 都有真的 route 文件，且 `to` 落在一条真路由上
- [ ] `/otto?view=<每一个旧值>` 都不 404
- [ ] `?project=` / `?thread=` 在重定向后不丢

**壳（改写后的 `global-navigation.test.ts`）**
- [ ] 文件里不出现 `mobileOpen` / `matchMedia` / `translate-x-full` / `lg:hidden` 抽屉族
- [ ] 导轨渲染出七格 + Settings 分组三条 + credits 行 + 身份菜单
- [ ] 当前路由高亮唯一（`/library/editor` 亮 Library，不同时亮别的）

**Otto 面板（新 `otto-panel.test.ts` + `otto-panel-geometry.test.ts`）**
- [ ] 几何纯函数：`clampPanelWidth(280) === 320`、`clampPanelWidth(9999) === min(720, 50vw)`
- [ ] 停靠/浮动状态机：拖头部 → floating；拖回右缘 48px 内 → docked
- [ ] launcher 吸边纯函数：给一个释放点，返回 `{edge, y}`，y 被夹在 `[0,1]`
- [ ] 视窗缩小后 floating 窗被夹回可视区
- [ ] localStorage 键读写：损坏的 JSON 不炸，退回默认值
- [ ] 面板打开时主内容**没有** `pointer-events: none`、没有遮罩（「dock, don't cover」的机器判定）

**Home（新 `home-page.test.ts`）**
- [ ] 五块的数据全部来自 §4.1 表里那些函数（import 枚举核对）
- [ ] 页面里**不出现**任何 analytics/Meta 读取（`getAnalytics` 不在 import 图上）
- [ ] 空账号渲染：不出现任何数字磁贴，出现 `Nothing here yet` 与装备清单
- [ ] 有排期时，发布关着的实话逐字来自 `PUBLISH_PREVIEW_COPY.fact`

**诚实文案（沿用现有 `spend-visibility-seams` 一类的枚举法）**
- [ ] 全仓没有 “Coming soon”（`OttoSchedule.tsx:1579` 那句已删）
- [ ] `preferences.does` 不含 “notifications”
- [ ] Connections 页在 `PUBLISHING_AVAILABLE === false` 时说出「现在连不上」

**shadcn**
- [ ] V1 面（Home/Create/Library/Brand/Campaigns/Schedule/Settings）里没有 `role="tablist"` 的手写 div
- [ ] V1 面里没有 `fixed inset-0 ... role="dialog"` 的手搓弹窗
- [ ] V1 面里没有 `animate-pulse` 的手搓骨架

**构建**（本仓血泪教训）
- [ ] 每个 PR 跑**完整** `quality.sh`，含 `next build`——typecheck 绿不算绿
  （`"use server"` 里 `export type {}` 会炸构建、快路径全绿的实证在案）

### 7.2 Founder 「全新体验」走查脚本

在一个**干净的测试账号**上，从头走一遍。每一步都要能一眼看出「壳换了」。

1. 用测试账号登录 → 落地页是 **Home**，不是聊天框。第一眼看到的是自己的名字、余额、和自己做过的东西。
2. Home 上的排期块：如果有待发布，它写着日期和「发布还没打开」的实话；如果没有，它是诚实的空。
3. 点右下 Otto 图标 → 面板从右侧滑入，**主内容被挤窄但仍然能点**（当场点一下 Home 上的一张画布卡验证）。
4. 拖面板左边缘 → 变宽变窄；拖到最窄，确认审批卡还读得下去。
5. 拖面板头部 → 它脱成一个浮动窗；拖着它在屏幕上走一圈；再拖回右边缘 → 吸回停靠。
6. 关掉面板 → 变回浮动图标；把图标拖到左边 → 吸到左缘。
7. 刷新页面 → **图标还在左边，面板宽度还是刚才那个**。
8. 左导航依次点 Create → Library → Brand → Campaigns → Schedule → Settings：
   每一格 URL 都变，每一格刷新都留在原地。
9. 在 Campaigns 里打开一条战役，再开 Otto → 面板顶部的上下文 chip 写着这条战役的名字。
10. 在面板里让 Otto 做一件要花钱的事 → 审批卡在**面板里**画出来，金额与 credits 读得清，按批准之前不扣钱。
11. 打开一个旧书签 `/otto?view=schedule` → 直接落在 `/schedule`，没有 404、没有闪烁。
12. 打开 `/crm/contacts` → 回到 Home，没有半扇门留在导航上。
13. 全程：找不到第二条导轨、找不到第二个「开始做点什么」的输入框、找不到任何一个汉堡按钮。

---

## 8. 开放问题（已全部拍板 2026-08-18：六问全选推荐 A）

### Q1. V1 要不要做 Home 总览？放什么？

- **A（推荐）**：做，按 §4.1 的五块。全部数据今天就读得到，零 Meta 依赖，空账号是诚实的空。
- B：不做，左导航第一格直接是 Create，落地页 = 画布首页。省一张 L 尺寸的票。
- C：只做「接着做」+「接下来发什么」两块，其余留 V2。

推荐 A。理由：Founder 的判决是「human-first」，而落在画布上仍然是 tool-first；Home 是**唯一**能一眼证明壳换了的屏。
成本可控——五块的数据函数一个都不用新写。

### Q2. Home 上要不要那个「开始做点什么」输入框？

- **A（推荐）**：要。抽共享组件 `<StartSomething/>`，**一份实现一条动作**，Home 与 Create 各摆一次。
- B：不要。Home 只放一颗 `New canvas` 按钮 + 一颗 `Ask Otto`，输入框只在 Create 上有。
- C：Home 的输入框直接喂 Otto 面板（打字 = 开对话），不建画布。

推荐 A。B 会让 Home 少一个显然的动作；C 会**复活两套心智模型**——那正是 `ia.json` 记录的头号重叠
（Otto 聊天框 vs 画布输入框，两个前门）。A 的关键是「一份实现」：不是两个框，是同一个框摆两处。

### Q3. Otto 面板默认开还是关？

- **A（推荐）**：**首次登录默认开**（让商家看见它、拖一次它）；之后按上次状态记忆。
- B：一律默认关，只留浮动图标——最干净，但新商家可能永远发现不了它。
- C：一律默认开——每次进来都被挤掉 25% 宽度，老商家会烦。

推荐 A。参考里两家都是「轻量开关」（`ref.json` 0:03/0:06），但它们的用户早就知道助手在哪；我们的商家不知道。
首次开一次是最便宜的教学。

### Q4. Schedule 与 Analytics 合并吗？

- **A（推荐）**：合。一个导航格 `Schedule`，页内两个页签：`Schedule` / `Analytics`（`/schedule` 与 `/schedule/analytics`）。
- B：不合，两个顶层格（导航变八格）。
- C：Analytics 这一格 V1 直接不出现，等 Meta 打通再加。

推荐 A。硬事实：`getAnalytics` 今天对**每一个**商家都返回 `notConnected`（Facebook Login 在 app 层关着）。
给一个 100% 空态的能力一个顶层导航格，就是在导轨上说大话。做成页签既留着入口，又不占一格。
C 更干净但会让「已经写好的 Analytics 页」凭空消失一段时间。

### Q5. 旧的 `/otto` 全屏聊天页留不留？

- **A（推荐）**：不留。`/otto` 变纯重定向；要更大空间时用面板自己的 **Expand**（临时推到 60vw）。
- B：留一个 `/otto` 全屏聊天页，面板与它并存。
- C：留，但只在面板里点「在整页打开」才到得了。

推荐 A。B/C 都会造出**第二个 Otto**：两套会话 UI 迟早各自漂移，这个仓库已经在两个导航、两个日历、
两个创作入口上栽过三次（全部记在 `ia.json` 的 overlaps 里）。Expand 花两天，第二条路由花两个月。

### Q6. Video editor / Templates / Discover 三扇门去哪？

- **A（推荐）**：Video editor → `/library/editor`（要剪的素材就在 Library）；
  Templates 与 Discover → `/create` 页面下方两个区段（`#templates` / `#ideas`）。导航保持七格。
- B：三个都保留成导航格 → 导航变十格，回到今天的样子。
- C：Templates / Discover 直接下线（它们是引流面，不是能力），只留 Video editor 在 Library 下。

推荐 A。理由：七格是 Founder 定的骨架，加回三格等于没换壳；但这三样都是**真能用**的东西
（剪辑引擎在 `packages/core/timeline.ts` + `apps/worker` 一直在跑），下线可惜。
A 把它们放在「商家本来就会去的那一页」上，不占格也不消失。

---

## 9. 拆票草案

### 9.1 依赖图

```
        ┌──────────────┐
        │ W2-0 core 常量│（唯一串行前置，S）
        └──────┬───────┘
   ┌─────┬─────┼─────┬─────┬─────┬──────┐
 W2-1  W2-2  W2-3  W2-4  W2-5  W2-6  W2-10   ← 六路并行（不同文件）
Library Brand Sched Settings Create Home  Rail
   └─────┴─────┴─────┴─────┴─────┴──────┘
                     │
        W2-7 面板（独立起跑，L）→ W2-8 会话历史 → W2-9 窄版审批卡
                     │
        W2-13 CRM 隐藏（独立，S）
                     │
                     ▼
        ┌──────────────────────────┐
        │ W2-11 切换总票（最后，L） │
        └──────────────────────────┘
                     │
              W2-12 shadcn 收口（可在切换前后，M）
```

### 9.2 票表

| 票 | 内容 | 尺寸 | 依赖 | 并行安全 | 主要文件 |
|---|---|:--:|---|:--:|---|
| **W2-0** | core 只加不改：新路由常量 + `OTTO_VIEW_REDIRECTS` + 新围栏骨架。`MERCHANT_NAV` **暂不动** | S | — | — | `packages/core/src/navigation.ts` |
| **W2-1** | Library 变真路由 `/library`（+ `/library/editor`）；手搓弹窗换 `ui/dialog` | M | W2-0、**在飞 `claude/w1-entity-type`** | ✅ | `app/library/`、`components/otto/OttoStuff.tsx`、`stuff/*`、`edit/EditDesk.tsx` |
| **W2-2** | Brand 变真路由 `/brand`；tablist 换 `ui/tabs`、picker 换 `ui/dialog`；诚实说明句 | M | W2-0、**在飞 `claude/w1-trust-fixes`**（文案以它为准） | ✅ | `app/brand/`、`components/otto/OttoMemory.tsx` |
| **W2-3** | Schedule 变真路由 `/schedule`（+ Q4 决定的 analytics 页签）；删 “Coming soon” 死按钮 | M | W2-0 | ✅ | `app/schedule/`、`OttoSchedule.tsx`、`OttoAnalytics.tsx` |
| **W2-4** | Settings 真路由 `/settings` + `/settings/connections`；Connections 多渠道版式、发布开关按渠道 | M | W2-0 | ✅ | `app/settings/`、`OttoConnections.tsx`、`OttoAccount.tsx`、`settings/*`、`lib/channels/channel-meta.ts` |
| **W2-5** | Create 改名 `/create` + `/create/canvas`（目录移动 + 两行常量 + 测试路径）；按 Q6 收编 Templates/Ideas | M | W2-0 | ✅ | `app/create/`、`NorthstarShellEntry.tsx`、`immersive-shell.tsx` |
| **W2-6** | Home `/` 真数据五块 | L | W2-0、**在飞 `claude/w1-bug6-p2`**（credits 显示口径） | ✅ | `app/page.tsx`、新 `components/home/*` |
| **W2-7** | Otto 面板：停靠/浮动状态机、缩放、launcher 吸边、localStorage、`Cmd+J`、Expand | L | — | ✅ | 新 `components/otto/panel/*`、`app/layout.tsx` |
| **W2-8** | 会话历史进面板（`OttoNav` 的列表 → `OttoThreadList`）；上下文 chip；页面感知快捷 chips | M | W2-7 | — | `components/otto/panel/*`、`OttoNav.tsx`（拆解） |
| **W2-9** | 窄版审批卡与生成进度叙述（320–560px 版式） | M | W2-7、**在飞 `claude/w1-bug6-p2`**（`approval-card-view.ts` 有改动） | — | `OttoApprovalCard.tsx`、`OttoPlanCard.tsx`、`PackCard.tsx` |
| **W2-10** | 新左导轨：单层 240px + 手动折叠 64px + localStorage；`ui/dropdown-menu` 换掉 `<details>` | M | W2-0 | ✅ | `global-navigation.tsx` |
| **W2-13** | CRM 全面隐藏：导航删格、14 个路由改 `redirect("/")`、删 7 个 CRM `loading.tsx`、加围栏、登记 #359 | S | W2-0 | ✅ | `app/crm/**`、`navigation.ts` |
| **W2-11** | **切换总票**：`MERCHANT_NAV` 权威改写、`OTTO_ASSISTANT` 去 href、`/otto` 缩成重定向表、`/`→Home、删移动端整层（§5.1）、删 `OttoNav`/`OttoApp`/`OttoView` 三件套的壳职责、删 ~1030 行移动测试、`proxy.ts` 清理 | L | 全部 | ❌ 必须最后 | 见 §5 全表 |
| **W2-12** | shadcn 收口扫尾：V1 面剩余的手搓 dialog/tabs/skeleton | M | W2-1…6 | ✅ | 见 §5.6 |

### 9.3 与在飞工作的关系

| 在飞分支 / PR | 与本波的关系 | 处置 |
|---|---|---|
| `claude/w1-entity-type` | Library 的 entity type 变更控件 | **W2-1 建在它之上**；它先合，或 W2-1 rebase |
| `claude/w1-bug6-p2` | 聊天按量计价：`credit-format.ts`、`approval-card-view.ts`、`otto-actions.ts` | W2-6（Home credits）与 W2-9（审批卡）读它的口径，不自己写第二份 |
| `claude/w1-trust-fixes` | 诚实文案 | W2-2/3/4 的 copy 以它为准，冲突时它赢 |
| `claude/w1-email-otp` | 登录/验证流程 | 与壳不冲突；beta 走查第 0 步用它 |
| PR **#971** `claude/m1-asset-idempotency` | 资产详情页付费键，与 Library 同区 | W2-1 起跑前先看它是否已合，避免同文件冲突 |
| 当前分支 `claude/otto-chat-free` @ `9a555257` | 已带 `CHAT_SPEND_NOTE` 新措辞（"costs credits for what it uses"） | 面板底部那句直接引常量，不复制字面量 |

### 9.4 尺寸口径

- **S** ≈ 半天，单文件或纯数据改动
- **M** ≈ 1–2 天，一个面 + 它的测试
- **L** ≈ 3–5 天，新组件族或跨文件切换

总量：S×2 + M×8 + L×3 ≈ **六路并行 4–6 天 + 切换 2–3 天**（不含判官轮次与返工）。

---

## 附：本规格书与证据 JSON 的三处出入（已按仓库实况修正）

1. `audit.json` 说 `mobile-viewport-check.mjs` 是悬空引用 —— **复核成立**，`apps/web` 下确实没有该文件。
2. `audit.json` 的 shadcn 采用数已逐条复核，与今天的仓库**一致**
   （`tabs/skeleton/sheet/popover/separator/alert/progress` 均为 0 调用点；`dialog` 14、`card` 23、`switch` 6）。
   仅一处补充：`switch` 有 6 个调用点（`audit.json` 未列），本规格书按 6 计。
3. `ia.json` 说 `/otto?view=analytics` 的导航文案是 “See how what you posted actually performed” —— 属实，
   但 `simulated-features.json` 同时证明它读的是 Meta **广告账户**而非自然帖表现。本规格书据此把这句话
   从导航权威里撤下（§2.3 ①），不是「搬家」而是「改口」。
