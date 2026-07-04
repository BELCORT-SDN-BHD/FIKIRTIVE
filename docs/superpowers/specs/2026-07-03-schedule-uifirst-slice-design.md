# Schedule —— UI-first 切片 设计 spec

> **性质**:蓝图 P1½「排期 + Routine」。Buffer 式 IG/FB 排期器,OTTO 驱动。
> **本 spec 范围**:第一切片 = **UI 优先**(founder 拍板)。完整全景见 [`2026-06-30-schedule-design.md`](./2026-06-30-schedule-design.md)(Phase A→B→C),本稿只收敛「先上线什么」+ 吸收 /codex 审出的工作级 schema。
> **扩建缝**:第四缝(Channel foundation,平台可插拔)+ 第一缝(defineOttoSkill)+ 卡片缝(OTTO plan card)。

## 一、founder 已拍的决策(写死)

| 决策 | 选择 |
|---|---|
| 切法 | **UI 优先** —— 先把用户能看能操作的排期界面 + 数据模型建全,**实发布 worker 推迟到 Meta App Review 过了再上** |
| 未审核前的呈现 | **顶部横幅 + 正常排期** —— 用户照常排队,横幅说明「自动发布待 Meta 审核通过后开启,审过自动开始发」 |
| 默认落地视图 | **Plan + 下一队列混合**(codex 建议)—— 落地即见「OTTO 排的本周计划」+「接下来要发的队列」,不是纯日历 |
| 媒体来源 | 复用**已生成**的成片(canvas / My Stuff),排期路**永不新生成、不碰 fal 钱路** |

## 二、为什么 UI 优先安全且不阻塞

- 实发布依赖 `instagram_content_publish` + `pages_manage_posts` 的 Meta App Review(founder 并行提交,~1–4 周)。今天只有 read scope。
- **UI 优先切片全程 $0、不碰钱路**:只建数据 + 界面 + OTTO 起草技能。用户可建/审/排队,**但不真发**(横幅说明)。审核过 → 切片 2 把发布 worker 接上,存量排期自动开始发。
- 数据模型**这次就按工作级 schema 建全**(吸收 codex),这样切片 2 上发布 worker **不用再迁移**。

## 三、数据模型(吸收 /codex 工作级建议 —— 一次建对,免二次迁移)

### `ScheduledPost`(owner-scoped)
```
ScheduledPost {
  id, ownerId, projectId
  channel: "instagram" | "facebook"
  metaTargetId          // 连接的 IG business id / FB page id
  caption: string
  firstComment?: string
  scheduledAt: DateTime // UTC
  scheduledTz: string   // ★codex:IANA 时区(如 "Asia/Kuala_Lumpur"),和 UTC 并存 —— DST/跨区不算错
  status: DRAFT | SCHEDULED | PUBLISHING | PUBLISHED | FAILED | NEEDS_ATTENTION | CANCELLED  // ★codex:+CANCELLED
  publishMode: AUTO | REMINDER
  source: "otto" | "owner"
  approvedAt?: DateTime // null 前不入队;owner 批准 = 发布同意
  metaPostId?: string   // 发布后置;幂等锚点
  lastError?: string
  deletedAt?: DateTime  // ★codex:软删除,不硬删历史
  createdAt, updatedAt
  @@index([status, scheduledAt])   // ★codex:调度轮询走这个索引
  @@index([ownerId, scheduledAt])  // 列表/日历查询
}
```

### `ScheduledPostMedia`(★codex:连接表,不用 `string[]` 数组)
```
ScheduledPostMedia {
  id, scheduledPostId (fk, cascade)
  generationId          // 复用已付费的成片,永不重生成
  position: int         // 轮播顺序(0..9);单图=1 行,轮播=2..10 行
  @@unique([scheduledPostId, position])
}
```
> 为什么连接表:轮播顺序/增删单张媒体要可靠;数组在并发编辑 + 迁移上都脆。

### `PublishAttempt`(★codex:防双发的核心 —— 本切片建表,切片 2 用)
```
PublishAttempt {
  id, scheduledPostId (fk)
  state: APPLYING | APPLIED | FAILED
  startedAt, finishedAt?
  metaPostId?           // APPLIED 时置
  error?
  @@unique([scheduledPostId, state]) partial WHERE state='APPLYING'  // 同一 post 同时只允许一个 APPLYING → 两个 worker 抢 = 只有一个插入成功,另一个跳过
}
```

**防双发三重锁**(切片 2 发布 worker 落地,本 spec 定契约):
1. **APPLYING 唯一插入**:发布前先插 `PublishAttempt(APPLYING)`,唯一约束挡住第二个 worker(镜像 gen worker 的 fail-closed claim)。
2. **每目标限流**:发前查 `content_publishing_limit`(IG 25 条/24h 滚动);到顶 → 延后 + NEEDS_ATTENTION。
3. **错时守卫**:`scheduledAt` 远超过去(如 > N 分钟前)不直接发,标 NEEDS_ATTENTION 让用户再确认(避免积压突发狂发)。
- **幂等**:`metaPostId` 已置 ⇒ 永不重发(resume/重启安全)。

## 四、本切片(UI 优先)交付什么

### A. 数据层(全 schema,含切片 2 才用的字段/表)
- 三张表 + 索引 + 约束(Prisma 迁移)。**money-guard 冻结文件零改动**。

### B. Schedule 页 —— 三视图,默认 = Plan+Queue 混合
- **共享头**:「Schedule」+ 连接的渠道 chips(渠道注册表;无连接则 Connect 卡)+ **OTTO 自动发布开关**(OwnerSettings `autoPublish`,本切片开关可点但发布未接,横幅说明)+ 视图切换器。
- **★顶部横幅**:「自动发布待 Meta 审核通过后开启 —— 现在排好的队,审核过了会自动开始发。」
- **(1) 默认:Plan + 下一队列混合**
  - 上半:**OTTO 排的本周计划**卡(「OTTO 给你排了本周 N 条」)—— 每行 日/时 · 渠道 · 缩略图 · 文案 + **Tweak**;粘性 **全部批准 N**(+ 单行批准/改)。「说 go 之前什么都不会发。」
  - 下半:**下一队列** —— 时间序、按日分组(今天/明天/日期)、渠道筛选,每行 缩略图 · 渠道 · 时间 · 文案预览 · 状态。
- **(2) 日历** —— 月/周/日 粒度切换 + 上下页 + Today;月grid(每天紧凑 post chips + 溢出 +N)、周(7 列较详卡)、日(按小时时间线)。每卡:渠道图标 · 时间 · 缩略图 · 状态药丸。空格「+」→ composer。
- **(3) 队列** —— 同上下半那个队列的全屏版。
- **Composer**(任意视图 + 或编辑 post 打开):媒体选择器(从 canvas/My Stuff 现有成片,**无新花费**)· 文案(手写或「问 OTTO」)· 渠道(注册表;post 类型按渠道 capabilities 门控)· 日期+时间+**时区** · first comment。存 **Draft** 或 **批准并排期**。

### C. OTTO 起草技能 `schedulePosts`(defineOttoSkill,fail-closed)
- `cost:free / effect:write / reach:internal` → **不 gated**(内部写,$0)。只建 **DRAFT** ScheduledPost(+ media 行),**从不发布、从不花钱**。
- 用户说「每天发/一周 3 条」→ OTTO 起草一周 DRAFT,合理时间,呈现为 plan card(复用现有 `OttoPlanCard` 模式)→ 用户 全部批准/逐条改。

### D. 状态机(纯 helper,单测)
```
(OTTO 提议 | owner 建)      → DRAFT
owner 批准                  → SCHEDULED (approvedAt 置)
owner 取消                  → CANCELLED
[切片 2] scheduler claim    → PUBLISHING → PUBLISHED(metaPostId,+first comment)
                                        ↘ 瞬时失败→重试→NEEDS_ATTENTION
                                        ↘ reminder→NEEDS_ATTENTION(通知)
```

### 本切片**不含**(推到切片 2 / 后续)
- 实发布 worker(`apps/worker/src/jobs/publish.ts`)+ IG/FB Channel 发布 adapter 的**实网调用** —— 待 App Review。
- Reels/Stories、best-time AI、IG/FB 以外渠道、多人审批角色、提醒投递渠道。
- 说明:发布 worker 的 claim/状态机/限流/防双发**契约本 spec 已定死**;切片 2 只是把它接上真 Meta client(切片 1 可用 mock client 先把状态机 + claim 逻辑单测跑通,零实网、零花费)。

## 五、money / 安全

- **排期路 $0**:媒体复用已付费成片;发布(切片 2)是免费 Meta API。**不碰任何冻结钱路文件**。
- **公开内容需明确同意**:`approvedAt` 为空 ⇒ 永不入队/发布(每条或每批批准 = 发布同意)。
- **多租户**:所有 action `requireOwner` + session-derived owner,`metaTargetId` 必须属于该 owner 的已连接渠道,绝不信客户端 id。
- **不捏造**:OTTO 起草的文案基于品牌记忆/用户输入;拿不到就问,不编。

## 六、测试(TDD)

- 状态机转移(纯 helper)。
- `schedulePosts` skill:只建 DRAFT、从不发布/花费;门控断言(needsApproval=false);media 行顺序正确。
- ScheduledPostMedia:position 唯一、轮播 2..10、级联删除。
- **PublishAttempt APPLYING 唯一约束**:两个并发 claim → 只有一个插入成功(防双发,mock 验证)。
- Composer server actions:requireOwner、metaTargetId 归属校验、非法媒体拒绝。
- UI:默认视图渲染 Plan+Queue、横幅在位、批准前无发布。

## 七、切片 2 触发条件(蓝图升级票纪律)

| 票 | 内容 | 触发 |
|---|---|---|
| U-SCH-1 | 实发布 worker + IG/FB adapter 真网调用 + 自动发布开关生效 | **Meta App Review 通过**(`instagram_content_publish`+`pages_manage_posts`) |
| U-SCH-2 | Reels/Stories + 提醒兜底(音乐/贴纸不能自动发) | 切片 2 稳定后 |
| U-SCH-3 | best-time AI / cadence 自动填充打磨 / 批量 | 用量信号 |

## 八、实现落地顺序(plan 阶段细化)

1. 三张表 + 索引 + 约束(Prisma 迁移)+ 生成 client。
2. 状态机 helper(TDD)。
3. `schedulePosts` OTTO 技能(TDD)+ registry + catalog。
4. server actions:建/改/批准/取消/列出(requireOwner,TDD)。
5. Schedule 页三视图 + 默认 Plan+Queue + 横幅 + Composer。
6. 全量验证扫 + money-guard 审计(空)+ runtime QA(截图给 founder)+ draft PR。
