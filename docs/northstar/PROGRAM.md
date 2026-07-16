# 北极星原型计划(North Star Prototype Program) — 历史记录

> **文件性质(2026-07-16 sanitation):历史设计与 Founder 判词转录,不是当前施工计划、
> 作业队列、批准台账或 status 真源。** 2026-07-07 设想的“原型建造 + 逐页拍板”流程
> 没有按本文件执行;`APPROVALS.md` 保持空表。有效 UI 证据可由当前任务按需引用,但不能
> 自行产生 scope 或 approval。
>
> 当前 UIUX 范围与验收来自 Blueprint、GitHub #334 的 Founder 决定及已对齐的 Route-B 计划;实时
> 任务/依赖在 GitHub。以下正文原样保留其历史语境,其中现在时、队列、并行关系和
> “design contract”措辞都只能按当时记录理解。发生冲突时回到当前 authority 链,不得
> 更新本文件来制造第二套现行计划。

## 人话对照表(工作规矩②)

| 内部代号 | 人话 |
|---|---|
| North Star Prototype / 北极星原型 | 把最终构想的每一页先建成"能点、不通电"的样板间 |
| design contract / 设计契约 | founder 拍板后有约束力的施工图 —— 后台施工不得改它的外观与交互 |
| 原型优先级 P0 / P1 / P2 | 先翻新现有页 / 再画收钱主线的新页 / 最后画未来区 |
| @nsPage 元数据 | 每张原型页文件头部的"门牌"注释(哪个区、哪页、批没批、依据是啥) |
| 点亮 | 原型页毕业成真页:接后台、通电、进导航 |
| staging 第一级 | 全 mock、不花钱的测试环境(`docs/runbooks/staging.md`) |
| 缝 7 | 单一设计系统的施工配方(`docs/review/EXPANSION-SEAMS.md` Seam 7) |
| 设计规则 | `docs/design-system/design-rules.md`(色板/字阶/间距/动效/live reflection 的唯一规范) |

---

## 一、计划性质(founder 判决,2026-07-07)

> **founder 判决(2026-07-07 口述授权,要点忠实转录;合并本 PR = 入档确认)**:
> 1. 把最终构想(蓝图第一章 ALL-IN-ONE 全景)的**每一页**都先建成**可点击的非功能页面** —— 整座城,含未来区。
> 2. founder **逐页过目、逐页拍板**。
> 3. 拍板通过的页面 = **有约束力的施工图(binding design contract)**。
> 4. **全面翻新授权,包括现有主线页面**(full revamp authority)。
> 5. **UIUX 必须无可挑剔,且受保护** —— 后台施工不得改动已批准页面的 UIUX;要改,必须回到 founder 重新设计审批。
> 6. **收钱主线并行继续**,不受本计划阻塞。

### 1.1 原型 = 设计文件,不接后台

每张原型页是**设计文件**,不是功能:

- **零 server action、零数据库、零 auth、零队列、零真实数据** —— 一切展示数据硬编码为示例数据(示例数据也要像真的:马来西亚商家场景、MYR、真实尺寸的图占位)。
- 推论一:**不触发第九缝**(没有 action、没有页面数据读取,parity manifest 无物可登记)。
- 推论二:**不违反双模原则**(宪法 7 审的是功能面;原型是图纸,不是功能面 —— 双模两问在"点亮"时对真页适用)。
- 推论三:**永不碰钱路**(没有任何可触发花费的代码路径)。
- 原型页内的按钮**可以点**:点了走页面内静态跳转/状态切换(展示交互形态),绝不发真实请求。

### 1.2 approved 页 = design contract(有约束力的施工图)

- 当时方案设想:Founder 逐页批准后,该页的**布局结构、设计 token 用法、交互模式**成为施工图;该逐页流程实际未发生。
- 当时拟用 `APPROVALS.md` + reviewer 条款看守偏离。该双口径已停用;当前 UIUX acceptance 从 Blueprint、#334 与已对齐计划读取。
- **原型目录只经设计流程修改**:改一张已批原型 = 设计 PR + founder 重新拍板;功能/后台 PR 触碰原型目录 = 挡。

---

## 二、交付形态(staging /preview 入口的实现方案)

### 方案 A(推荐)—— apps/web 内静态路由组 `/northstar`

**形态**:`apps/web/app/northstar/` 一个路由组,按区分目录(`/northstar/create/canvas`、`/northstar/crm/contacts`…),外加一张 `/northstar` 总目录页(全城地图,逐页链接 + @nsPage 状态角标)。全部页面是纯静态 React 组件 + 硬编码示例数据。

**门禁**(仿 skin-preview 先例,`apps/web/app/skin-preview/page.tsx` 的 production `notFound()`):

- 布局层一行闸:`if (process.env.NODE_ENV === "production" && process.env.NORTHSTAR_PREVIEW !== "1") notFound();`
- 当时方案拟在全 mock staging 设 `NORTHSTAR_PREVIEW=1` 供逐页审阅。旧环境 URL/变量状态不得沿用;任何 live 状态须现场查询。
- 本地 dev 永远可见(设计施工的日常预览)。

**零后台依赖的保证是结构性的,不靠自觉**:

- **import 围栏**:`app/northstar/` 内禁止 import 任何 `lib/*-actions`、`@fikirtive/db`、auth/guard、队列与 provider 模块;只许 import `components/ui/*`(shadcn 组件)、lucide 图标与本目录内文件。随第一批原型页 PR 加一条 grep 级 CI 检查(仿 `scripts/check-skill-imports.sh` 的形态),不在本 docs-only PR 内。
- 页面全部静态可渲染;不新增任何 API 路由。

**取舍(为什么推荐 A)**:

| 维度 | A:apps/web 路由组 | B:独立静态站 |
|---|---|---|
| 设计系统 | **真 token 真组件**(`.gb` + shadcn 直接用)—— 原型即施工图,像素级不失真 | 必须复制 token/组件 → 设计系统分叉,违背缝 7"单一设计系统"精神 |
| 点亮成本 | 毕业时组件/布局代码可直接搬进真页 | 全部重写一遍 |
| 漂移风险 | token 改动全城同步(globals.css 单一来源) | 两处同步,必漂移 |
| 部署 | 复用现有 staging,零新管道 | 要新开一条部署管道、新域名 |
| 隔离 | 靠 env 闸 + import 围栏(结构性,可 CI 看守) | 物理隔离(天然彻底) |
| 主线影响 | 同仓库同 build(路由级代码分割,首屏不受影响;build 时间略增) | 零影响 |

**结论:推荐方案 A。** 它唯一的实质代价(build 时间略增)远小于方案 B 的设计系统分叉 —— 原型的全部价值在"所见即施工图",复制出去的 token 做不到这一点。方案 B 的物理隔离优势,A 用 env 闸 + import 围栏 + playbook 看守可等效达成。
(交付形态属实现取舍,依授权范围本计划直接采用 A;founder 若另有偏好,改一行本节即可,不影响清单与流程。)

### 已批准页的"活样板"位置

- 页面未点亮前,`/northstar` 是它唯一的家;点亮后原型页**保留**为对照基准(审查员比对真页 UIUX 是否偏离的标尺),总目录页标"已点亮"。

---

## 三、舰队施工流程

### 3.1 法律与基准

1. **设计规则是法律**:`docs/design-system/design-rules.md`(现行 v2,2026-07-07)。北极星批次若需补充规则(新页型的空态/表格/看板等模式),按该文件 §11 变更协议升级(升级版即 v3)—— 无论版本号,**该文件的最新 founder 认可版就是法律**;每张原型页必须 100% 落在其 token/字阶/间距/圆角/阴影/动效/live-reflection 规范内,零新造值。
2. **设计审六条**(`docs/design/2026-07-03-harmony-06-uiux-gamification.md` §一)逐页适用 —— 原型页也要**三态齐全**:空态、加载态(骨架)、错误态都画出来(静态展示即可,可用页内切换器演示)。
3. **coral 法**:coral 只属于 Otto;原型页里凡展示"Otto 做了/正在做"的时刻,按 design-rules §8 的四个 live-reflection 模式画(sweep/landing/叙述条/dock)。
4. **Otto dock 常驻**(宪法 11 ④):每张原型页都带 dock(收起态即可),它是全城骨架的一部分。

### 3.2 每页一 agent,一页一 PR

1. **取活**:从 `PAGE-INVENTORY.md` 按优先级取(P0 → P1 → P2;同区可小批并行)。每页(或同区 2-3 页的小批)= 一个 agent 会话 = 一个 PR。
2. **每个施工 agent 必读**(按序):本文件 → 设计规则 → 该页在清单中的行 + 行内来源文档 → 缝 7 配方。**只准建清单里有的元素** —— 来源查证不到的元素一律不画(蓝图第一章解读边界:feature 只来自对标 + 判决,agent 不发明)。
3. **施工纪律**:PR 只动 `apps/web/app/northstar/` 与 `docs/northstar/`,不碰主线任何文件;需要全局 token/组件变更时走 design-rules §11 变更协议单独提案,**不随原型页 PR 顺手改**;CI 全绿;PR 附整页截图(founder 看得见,不依赖 inline widget)。
4. **审查两问**(原型 PR 专用,替代后台清单):①是否 100% 落在设计规则内(逐条对 harmony-06 §一)?②是否只动了原型目录?任一为否 = 挡。

### 3.3 @nsPage 页面元数据(仿设计项目 @dsCard 卡片约定)

每张原型页文件的**第一行**带一条结构化注释(greppable,拍板台账可机器核对):

```tsx
/* @nsPage district="创作区" page="canvas-home" status="draft"
   sources="GOAL§2 A-J; 蓝图区划图·创作区" approvedAt="" pr="" */
```

- `status`:`draft`(未批)→ `approved`(founder 已批)→ `lit`(已点亮)。
- 当时计划的逐页流程(未实际执行):同一个 PR 追加表行并更新页内 `status`/`approvedAt`/`pr`。
- 总目录页 `/northstar` 从元数据渲染全城进度(几页 draft / approved / lit)。

### 3.4 founder 逐页拍板记录表

`docs/northstar/APPROVALS.md` 当时被设计为逐页记录表,但始终为空,从未形成批准 authority。

- "批" = 该页即刻成为 design contract;
- "改" = agent 按批注返工,重新提审;
- "驳" = 该页回炉重画(判决理由留档)。
- 审查员判断"哪些页已批准",以本表 + 页内 `@nsPage status="approved"` 双口径为准(两者不一致 = 文档 bug,先修台账)。

---

## 四、与收钱主线的关系

### 4.1 并行不悖

- 当时方案设想旧主线与北极星舰队并行、文件面隔离;该执行安排已被取代,不能从本段恢复。
- 北极星是**设计支出,不是工程负债**:原型页不进导航、不进 prod、不加后台面,主线的任何审计/审查清单都不因它加长。

### 4.2 点亮 = 该页从原型毕业为真页

某板块按 MASTERPLAN 顺序开工时:

1. 该板块的 **approved 原型页升格为该板块 spec 的 UIUX 章**(施工图)—— spec 照常出(华语、founder 过目,蓝图第五章),但 UIUX 部分不再重新设计,直接引用原型页;
2. **parity / skill / 数据模型 / 后台随板块开工**才建:server actions 出生登记第九缝、配对 skill 走缝 1、新表走缝 5 —— 原型阶段欠的"功能债"在此一次结清;
3. 真页上线时 UIUX 必须与原型一致(布局/token/交互)—— playbook 北极星增补节看守;上线后原型页标 `lit`,保留为对照基准。

### 4.3 现有页翻新(P0)的落地方式

- P0 页(现有 live 面)的原型 = **翻新方案图**。founder 批准后,翻新作为**真页施工**排期落地:走缝 7 + 浏览器 runtime QA + 设计审两关(playbook 协议 #4),与主线节奏由 founder 协调排期 —— 原型先行,不阻塞任何一边。
- 翻新授权覆盖现有主线页面(判决第 4 条),但**翻新落地的每个 PR 照常过全部审查**(北极星授权的是"重画的权力",不是"跳审查的权力")。

---

## 修订记录

| 日期 | 修订 | 批准 |
|---|---|---|
| 2026-07-07 | v1 计划总纲(总审查员起草;依据 = founder 2026-07-07 北极星授权判决 + 蓝图 + 判决记录 + 设计规则 v2) | 待 founder 终审(合并本 PR = 判决入档 + 计划生效) |
