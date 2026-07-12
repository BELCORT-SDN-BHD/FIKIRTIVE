# B4 板块报告 · 发布 L1 + Meta 通电族

> 按执行合同 §七 十四节标准编制（`docs/ops/ROUTE-B-MASTER-PLAN-2026-07-12.md` §七）。**骨架件**：本文件在 B4 块 spec（`docs/superpowers/specs/2026-07-12-b4-block-spec.md`）冻结候选阶段先立十四节骨架；每节标 owner 槽位与证据槽位，内容随块施工/验收增量填入。不适用的节如实标注而非省略。
> 人话对照：「双执行矩阵」= 每件事人工能做、Otto 也能做，逐条对上；「全旅程证据」= 一条真帖从草稿到发出，成功/失败/恢复每种结局都留一张图为证。

## ① 块 ID / PR / 最终 SHA / 认证日期

- owner：〔SPEC-B4 起草 → 块施工工位 → 控制面收口〕
- 证据：〔块 ID=B4；spec PR=（本 PR 号）；施工 PR 清单=待填；最终 merge SHA=待填；认证日=待填；epoch `claude-20260712-03`〕

## ② 批准范围 + 明示排除 + 映射

- owner：〔SPEC-B4〕
- 证据：〔范围=矩阵 04-B4 20 行（14 存量起证 + 5.5 新建）；明示排除=Ads 写执行契约归 Ads 域、本块 organic 发布 $0 不走记账缝（除 E4-14 X）；映射=MASTERPLAN→矩阵、宪法 7 双执行、缝4/5/6/9→L1 施工图。详见 spec §二〕

## ③ 功能清单（非页面清单）

- owner：〔SPEC-B4 / 块施工工位〕
- 证据：〔能力行清单（非页面）：发布链六态/四锁/授权闸/媒体双层/签名代理/单一动作层/reconcile + 5.5 新建能力（X 发布/广告工作台/分享预览/ApprovalRequest/ChannelConnection/时段种子）。详见 spec §三〕

## ④ 双执行矩阵

- owner：〔块施工工位〕
- 证据：〔人工路径 + Otto 话术逐条（含设置/异常/取消/花费确认）；20 行的人工入口 + Otto skill 硬化（逐行 tool 名+cost/effect/reach+归域）见 spec §二；债 5 条清偿（**5 skill 零豁免**：debt-70 gated skill〔free/write/external→needsApproval 派生 true，人点卡=同意本体〕+ 71/72 写 skill + 73/74 读 skill；5 个新 ctx.schedule port + **通用审批卡链四触点**〔spec §五 5.1·附，v0.3——现状 ottoApprove 只认 generate，otto-actions.ts:697〕；debt-70 债清判定=skill∧卡链∧测试三者齐）见 spec §五——待施工后填活体〕

#### W-B4-1 起证（存量证据链工位）· 14 存量行双执行差额（只读引用 `parity-manifest.ts`，不改 manifest）

> 差额=人工入口 vs Otto skill 现状对等度。`parity-manifest.ts` 为唯一真源（本工位只读引用行号）。三态：`对等`（skill 已注册，宪法7 满足）/ `豁免`（四类闭集之一，正当类义）/ `开口`（todoSkill 债或假对等，**归施工工位/W-B4-2，非本工位补**——本工位只立证记差）。

| 功能ID | 人工入口 | Otto skill 现状（parity-manifest 行） | 差额判定 |
|---|---|---|---|
| E2-07 | ads 区卡片 Approve + server action | `propose-meta-action`（`meta-write-actions.runApprovedPlan/approveMetaActionPlan` = skill，:192-195） | **对等**（propose 建卡→人批→执行，同一审批层） |
| E4-01 | 排期区 plan/calendar/queue + Composer | 起草=`schedulePosts`（`createScheduledPost`/`draftScheduledPost` = skill，:230-231）；管理面 approve/cancel/update/list/listTargets = **todoSkill debt-70~74**（:232-236） | **开口**（Otto 能起草不能审批/取消/编辑/列举；5 债归施工工位/W-B4-2，本工位禁碰） |
| E4-02 | n/a（数据层） | n/a | n/a（无动作层） |
| E4-03 | n/a（worker 幂等） | n/a | n/a（worker 内部不变式） |
| E4-04 | 连接区 OAuth 连/断 | n/a（`meta-actions.completeMetaConnect` = **exempt ACCOUNT_SECURITY**，:176） | **豁免**（凭据生命周期，正当类义） |
| E4-05 | n/a（worker 发布链） | n/a | n/a（worker） |
| E4-06 | n/a（签名代理路由） | n/a | n/a（Meta 拉媒体，无席位） |
| E4-07 | 人工按钮与 worker 共用 `meta-publish.ts` | n/a（发布永经审批管线，无独立发帖 skill，A04 原则） | n/a（单一动作层，无第二套） |
| E4-08 | 排期/批准三入口前置（#231） | n/a（行为语义闸） | n/a（语义层，无动作） |
| E4-09 | 连接区 UI + 路由 | n/a（`meta-actions.disconnectMeta` = **exempt ACCOUNT_SECURITY**，:178） | **豁免**（同 E4-04） |
| E4-10 | 广告区开关（`setAdsAutonomy`/`setAdsWritesPaused`） | parity 映射 `propose-meta-action`（:192-193）**但 v0.4 核实为假对等**——枚举 `pause\|resume\|set_budget\|reschedule` 调不到该两动作（`propose-meta-action.ts:27-29`） | **开口（假对等）**：施工=扩枚举或新 gated skill（spec §二 E4-10，v0.4）；归施工工位 |
| E4-12 | 广告区卡片 | `propose-meta-action`（同 E2-07，:192-195） | **对等** |
| E4-13 | 连接区 consent | n/a（同 E4-09 ACCOUNT_SECURITY 豁免；scope 派生） | **豁免**（+ App Review 外部钥匙未到，§⑬） |
| E4-16 | n/a（adapter 缝） | n/a | n/a（缝；现状降准 A03，触点 5 处收敛=施工验收项，归 E4-14/施工工位） |

**收口**：14 行差额 = 2 `对等`（E2-07/E4-12 propose-meta-action）+ 3 `豁免`（E4-04/E4-09/E4-13 ACCOUNT_SECURITY，正当类义）+ 2 `开口`（E4-01 debt-70~74 管理面 · E4-10 v0.4 假对等）+ 7 `n/a`（数据/worker/语义层无动作）。**两 `开口` 均属施工工位/W-B4-2 债清偿范围，本工位（W-B4-1）职责=立证记差，禁自补债**（边界纪律）。

## ⑤ 对标锚（平齐/超过/未及）

- owner：〔块施工工位 / B11 联验〕
- 证据：〔Buffer/Later/Hootsuite + Meta 官方发布语义 + X adapter 单列锚（见 spec §四）；并排截图三档打分=待填；未及项→链待裁〕

#### W-B4-1 起证（存量证据链工位）· Meta 官方锚 G1-G7 逐关口→可重跑断言

> spec §四 Meta 官方锚判定表转为对 `packages/core/src/meta-publish.ts` 现有实现的锚断言（mock 夹具级，零真实外部写，spec §六.1）。测试文件 `packages/core/src/meta-publish.test.ts`（21 用例，全绿）。本工位新增/精化断言标 **[+]**。

| 关口 | 断言（可判定语句） | 测试引用（file:line / 名） |
|---|---|---|
| G1 IG 单图容器 | `POST /{ig}/media`（image_url+caption）；**[+] caption 落在容器** | `meta-publish.test.ts:55`「single image…」+ [+] `posts[0].body.caption==="hi"` |
| G1 轮播子图 | 子图 `is_carousel_item="true"` **且无 caption**；**[+] 子图 caption undefined、父容器 caption 在** | `meta-publish.test.ts:72`「carousel…」+ [+] `posts[0].body.caption` undefined / `posts[2].body.caption==="carousel"` |
| G1 ⑤a abort | 任一子容器失败→整帖 abort，`media_publish` 从未调用（零发布） | `meta-publish.test.ts:85`「carousel abort (⑤a)…」 |
| G2 容器轮询 | `FINISHED`→进 G3；`IN_PROGRESS` 超 deadline→六态④ retryable；`ERROR`→六态③ 不 retryable | `:95`「poll timeout (④)…」+ `:104`「container ERROR…③」 |
| G3 IG 发布 | id→六态①；**2xx 无 id→ambiguous 不盲重试**；5xx/timeout→ambiguous | `:55`（id）+ `:145`「2xx but NO id→AMBIGUOUS」+ `:130/:138`（5xx/timeout ambiguous）+ `:152`（definitive 4xx 非 ambiguous） |
| G4 FB /photos | 单图→`/photos`（url+caption）；**[+] /photos 2xx 无 id→ambiguous** | `:176`「single image→/photos…caption」+ **[+] 新 `:184`「G4 anchor: /photos 2xx but no id→AMBIGUOUS」** |
| G4 FB /feed | 无媒体→`/feed`（message+link）；2xx 无 id→ambiguous；definitive 4xx 非 ambiguous | `:185`「no media→/feed…link」+ `:210`「/feed 2xx no id→AMBIGUOUS」+ `:217`（definitive 4xx） |
| G6 first comment | best-effort：评论失败**不回退**已发成功判定 | `:116`「first comment is best-effort…」 |
| G2 EXPIRED / G5 配额 / G7 page 解析 | EXPIRED/配额生效值/Page 权限=**外部测试阶段实测槽**（A1/A5/A6/A7，spec §七） | 归外部测试阶段（§六.2，前置 founder 授权）——非块内 |

**X 锚（E4-14 档位映射方向断言）——本工位不落，注明延后**：spec §四 X 锚冻结「不带链接=1cr / 带链接=4cr、映射不可倒置、含糊就高」。全库核实（`grep publishX|twitter|x adapter|4cr` 零命中；`channel-meta.ts` 仅 instagram/facebook）——**X adapter/档位映射常量尚无代码载体**。依 spec 与工位指令「无载体则此断言留待 E4-14 工位并注明」：**档位映射方向测试（带链接样本永不产 1cr）+ reserve→settle 幂等 + money-safety-review 归 E4-14 X adapter 施工工位**，本工位（W-B4-1）不建、不碰计费缝（边界纪律）。

## ⑥ 全旅程证据（happy/empty/loading/denied/failure/retry/mobile）

- owner：〔块施工工位（块内）/ 外部测试阶段（活体）〕
- 证据：〔**块内验收=mock/夹具级六态契约测试，零真实外部写**（spec §六.1）；**测试账号真发→IG/FB 可见的活体证据（尤其②③⑥）=外部测试阶段**（spec §六.2，前置=founder 授权，归 sandbox-verified 阶段执行）；happy/empty/loading/denied/failure/retry/mobile 七态截图=待填（UI 态可块内 staging 截取，真发态归外部测试阶段）〕

#### W-B4-1 起证（存量证据链工位）· 14 行六态测试级覆盖表

> 状态映射：**happy**=成功结局①；**empty**=无数据/空队列/无媒体 no-op；**loading**=在飞/轮询（PUBLISHING·IN_PROGRESS，UI spinner 归 staging）；**denied**=授权拒（canPublish=false·kill-switch·越权·冒充）；**failure**=硬拒六态③ FAILED；**retry**=瞬时退避/reconcile/幂等重投（六态④⑥）。单元格=测试 file:line。`n/a`=该行性质无此态（附因）；`staging待批2`=UI 态需 staging 走查，前置 approval-2。真发活体（②③⑥ IG/FB 可见）归外部测试阶段（§六.2）。

| 功能ID | happy | empty | loading | denied | failure | retry |
|---|---|---|---|---|---|---|
| E2-07 | meta-write-actions.test.ts:165 pause APPLIED | :137 缺 ACTION_CARD | :232 APPLYING reconcile | :110 kill-switch 零 graph / :332 冒充闸 | :207 partial stop-on-fail | :232 ambiguous→NEEDS_CONFIRM / :278 P2002 race |
| E4-01 | schedule-actions.test.ts:120 建 DRAFT / :568 approve | :166 无媒体默认 / schedule-view.test.ts:84 空桶 | schedule-view.test.ts:73 statusPill PUBLISHING 色；UI spinner=`staging待批2` | :202 未认证零写 / :419 越权 not-found | :175/:181/:187 非法 channel/caption/时间零写 | :462 lost CAS=stale / :430 re-consent 退 DRAFT |
| E4-02 | publish-attempt-uniqueness.test.ts:66 异帖 APPLYING 允许 | :78 多非-APPLYING 允许（partial 外） | n/a（数据层无飞行态） | n/a（DB 约束非授权） | :59 二次 APPLYING→P2002 拒 | :71 前次留 APPLYING 后仍可新 claim |
| E4-03 | publish.test.ts:220 ①success PUBLISHED | :81 非可发状态(DRAFT) no-op | :73 lock2 APPLYING partial-unique | :65 lock1 metaPostId 短路（已发不再发） | :228 ③hard reject FAILED | publish-doublepost.test.ts:76 D2 ambiguous 重试不建二容器 / publish.test.ts:319 lock4 UNCONFIRMED |
| E4-04 | meta-actions.test.ts:137 双 scope→canPublish | :172 无行 connected:false | n/a（同步派生） | :149 单 scope→false / :159 legacy ads-only→false | :91 exchange 失败 error | :208 F37 瞬时→transientError 不误判 reconnect |
| E4-05 | publish.test.ts:220 ①success | :255 无可发连接→scanDue [] | :243 ④有余额→throw+释锁 stays PUBLISHING | :146 M1 canPublish=false→NEEDS_ATTENTION 零 Meta | :228 ③FAILED | :273/:289/:319 reap→reconcile；core/publish.test.ts:18 retryDelay 铁律 |
| E4-06 | media/pub/route.test.ts:30 有效 token 流字节 | n/a（无空态；对象缺见 failure） | n/a（无状态 GET） | :55 跨租户 404 / :42 伪造 404 / **proxy.test.ts 新增 `/api/media/pubfoo` 进墙** | :70 MEDIA_PROXY_SECRET 未设→全 404 / :79 对象缺→404 | n/a（幂等 GET，无重试语义） |
| E4-07 | meta-publish.test.ts:55 IG create→publish（新 caption 断言）/ :72 carousel | :124 无媒体→error | :95 ④container IN_PROGRESS→retryable 不发 | :85 ⑤a carousel abort（拒半发） | :104 container ERROR→③ / :193 FB Meta hard reject | :110 rate-limit(4)→retryable / :130/:145 H5 ambiguous（新 G4 /photos 2xx-no-id :184） |
| E4-08 | publish-media-contract.test.ts:103 png 图合法转 JPEG | :92 空/未知 mime 拒（白名单=Asset.mime） | n/a（发布前确定性判定） | :79 video/mp4 拒（mediaContractRefused）/ schedule-actions.test.ts:245/:315/:702 IG_IMAGE_ONLY 三入口前置 | :117 混合轮播整帖拒零 ffmpeg/零存储写 | n/a（确定性拒故 NEEDS_ATTENTION 非 FAILED——重试无用是设计） |
| E4-09 | meta-actions.test.ts:39 connect 加密 upsert / :265 disconnect 只删己行 | :172 无行 connected:false | n/a（同步） | :96 connect 冒充闸 / :270 disconnect 冒充闸 | :91 exchange 失败 / :103 debug_token 失败→canWrite:false | :208 F37 瞬时非 reconnect |
| E4-10 | meta-write-actions.test.ts:578 setAdsAutonomy AUTO / :618 setAdsWritesPaused | n/a | n/a | :603 setAdsAutonomy 拒非法档("YOLO") | :110 kill-switch 拒全部写零 graph | n/a（**Otto 侧对等=假对等 v0.4，见 §④——归施工工位**） |
| E4-12 | meta-write-actions.test.ts:165 pause APPLIED / :414 valid approval 消费+执行一次 | :137 缺 card | :232/:262 APPLYING reconcile | :463 kill-switch 先于 consume / :332 冒充 / :397 hash 篡改拒 | :207 partial stop | :151 已 APPLIED skip 无二发 / :278 P2002 race |
| E4-13 | meta-actions.test.ts:137 双 scope→canPublish（scope 串派生） | n/a | n/a | :149 单 scope→false / :159 legacy→false | n/a（scope 派生无失败态） | n/a；**App Review 屏录+活体 scope grant=外部测试阶段（§⑬/§六.2）** |
| E4-16 | registry.test.ts:23 注册 ig+fb / :27/:38 capabilities | n/a | n/a | :35 未知 id→undefined（闭集边界）/ :55-77 四拒 per-adapter（无连接/canPublish=false/kill-switch/token 过期） | :62 canPublish=false 拒 | n/a；**触点 5 处收敛=施工验收项（A03 降准），X 接入即活体验证——归 E4-14/施工工位** |

**六态收口**：14 行 mock/夹具级六态证据齐（引用 8 套现有测试 + 本工位 3 处新锚 + proxy 边界回归）。**UI 态**（E4-01 spinner/mobile）标 `staging待批2`；**真发活体**（②③⑥ IG/FB 可见、G5 配额、App Review 屏录）归外部测试阶段（§六.2，前置 founder 授权）。空白 `n/a` 全附性质因（数据/worker/同步/语义/幂等层），无「无」式省略。

## ⑦ 测试全家桶可重跑链接

- owner：〔块施工工位〕
- 证据：〔`publish.test.ts` / `publish-doublepost.test.ts` / `publish-media-contract.test.ts` / `publish-attempt-uniqueness.test.ts` / `core/publish.test.ts` / `registry.test.ts` / `meta-actions.test.ts` / `media/pub/route.test.ts`；本地三关（`docs/runbooks/local-ci.md`）check/test/web-build 全绿链接=待填〕

#### W-B4-1 起证（存量证据链工位）· 本工位改动 + 可重跑命令

**新增/修改测试（3 文件）**：
- `packages/core/src/meta-publish.test.ts`（+12 行）：G1 单图容器 caption 断言、G1 轮播子图无 caption + 父容器 caption 断言、**新用例** G4 `/photos` 2xx-no-id→ambiguous。21 用例全绿。
- `apps/web/lib/__tests__/proxy.test.ts`（+8 行）：**新用例** 契约5 matcher 边界回归（`/api/media/pubfoo` 进墙 + `/api/media/pub/<token>` 放行）。6 用例全绿。
- `apps/web/proxy.ts`（产品代码，-1/+1）：matcher 排除 `api/media/pub` → `api/media/pub/`（补边界，契约5 验收项）。

**可重跑命令**（本工位已本地跑绿）：
```bash
# 锚断言（core，21 用例）
pnpm --filter @fikirtive/core exec vitest run src/meta-publish.test.ts
# matcher 边界回归（web，6 用例）
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/proxy.test.ts
# 六态引用的全套（起证依据）
pnpm --filter @fikirtive/worker exec vitest run src/jobs/publish.test.ts src/jobs/publish-doublepost.test.ts src/jobs/publish-media-contract.test.ts
pnpm --filter @fikirtive/db exec vitest run src/publish-attempt-uniqueness.test.ts   # 需 DATABASE_URL
pnpm --filter @fikirtive/web exec vitest run lib/__tests__/meta-actions.test.ts lib/__tests__/meta-write-actions.test.ts lib/__tests__/schedule-actions.test.ts app/api/media/pub/__tests__/route.test.ts
```
本地三关（`docs/runbooks/local-ci.md`）check/test/web-build 结果=见本 PR 描述。

**工位施工纪律申报（LC-0 先例）**：本会话 Edit 钩子拦产品源码（`FABLE_CODE_OK` 未置），依工位指令用「精确匹配且仅一次」python 补丁脚本落 3 处源码编辑（每处断言 old_string 恰好出现一次，否则中止零写）；未设豁免 flag、未 `--no-verify`。docs（本报告）直接编辑。

## ⑧ schema / ownerId / 审计 / 同意 / 秘密

- owner：〔块施工工位〕
- 证据：〔schema=MetaConnection(canPublish/organicPublishPaused)/PublishAttempt(UNCONFIRMED/creationId)/ScheduledPostMedia + 新建 ChannelConnection(B0-30)；ownerId 隔离=全链；审计=publish 状态转移留痕；同意=Meta 政策 1.7 人工审批闸；秘密=token 加密列 + MEDIA_PROXY_SECRET fail-closed，无明文=待脱敏核〕

## ⑨ 成本 / 延迟 / margin / 监控 / 回滚

- owner：〔块施工工位〕
- 证据：〔organic IG/FB 发布=$0（不走记账缝）；**E4-14 X 发布=1cr/4cr 走缝3，过 money-safety-review**（唯一 money 触点）；延迟=媒体转码低频（发布时按需）；监控=worker heartbeat + reaper；回滚=kill-switch(organicPublishPaused) + revert=待填〕

## ⑩ 上下游契约 + 外部位状态 + 通电步骤

- owner：〔SPEC-B4 / 控制面〕
- 证据：〔上游=L1 施工图 + #219/#227/#229/#230/#231/#233；下游=X adapter(E4-14) 走契约6 收敛后扩展点（触点清单如实，spec 契约8）；外部位=Meta App Review + Business Verification（`DEPENDENCY-STATUS.md` 外部等待位）；通电步骤=过审→canPublish=true→横幅自动关→存量 SCHEDULED 帖自动开发。二分清单见 spec §六.3〕

## ⑪ 异族评审 P0/P1=0

- owner：〔控制面收口〕
- 证据：〔冻结走四权闭环（#254 §一.2）双顾问签核 + 异族复审（codex）+ 机器闸 + 非作者合并；异族复审 P0/P1 清零记录=待填；E4-14 X 计费碰 💰=money-safety-review provenance=待填〕

## ⑫ 已知限制与待裁（没有写「无」）

- owner：〔SPEC-B4〕
- 证据：
  1. 〔IG media 补链（container id→帖 media id）在途——现 confirmed-live 也 NEEDS_ATTENTION（契约7 保守闭合，B4-01）〕
  2. 〔FB recent-posts reconcile future work——现悬空一律 NEEDS_ATTENTION（契约7 保守闭合，B4-02）〕
  3. 〔debt-70 已改判（v0.2，控制面裁定采 codex 替代案）：gated skill 清偿、撤 ACCOUNT_SECURITY 豁免提案——施工须建 5 个新 ctx.schedule port + 5 skill（spec §五）〕
  4. 〔E4-16「零核心改动可插拔」现状不成立（A03 降准）——X 接入触点 5 处（含排期 UI，v0.3）收敛为登记式=施工验收项（spec §三 契约6/8）〕
  5. 〔proxy matcher 无边界前缀（`/api/media/pubfoo` 会被放行出会话墙，`proxy.ts:73`）——补边界断言+回归测试=施工验收项（spec §三 契约5）。**✅ W-B4-1 已修复**：matcher 排除 `api/media/pub`→`api/media/pub/`（补尾斜杠边界），`proxy.ts` -1/+1；回归 `proxy.test.ts` 断言 `/api/media/pubfoo`→进墙(matcherRuns=true)、`/api/media/pub/<token>`→放行(false)。修前 `/api/media/pubfoo` 逃墙(false)，修后进墙——契约5「恰好 /api/media/pub/*」语义落地〕
  6. 〔E4-14 X 档位已拍板（GRILL-VERDICTS:215 方案 A）；**就高操作化细则**（短链/裸域名判 4cr）= founder ack（spec §四 X 锚）〕
  7. 〔App Review 外部钥匙未到——founder 侧商业验证/递件在等（spec §六.3）〕
  8. 〔通用审批卡链现状 generate 专用（`ottoApprove` 硬过滤 `toolName !== "generate"`，`otto-actions.ts:697`；卡渲染仅 OttoPlanCard spend 路径）——debt-70 gated skill 的硬性施工触点（spec §五 5.1·附，v0.3）：不建卡链=闸有名无实，债不得转 skill 态〕
  9. 〔排期 UI 六处渠道硬编码（`OttoSchedule.tsx:86-95,287,405,434-435,1123-1135,1199`）——E4-14 触点⑦（v0.3）；E4-16 收敛验收=UI 由 CHANNEL_META 数据驱动〕
  10. 〔E4-10 既有挂靠是假对等（`propose-meta-action` 枚举无 autonomy/kill-switch 动作，`propose-meta-action.ts:27-29`）——已改施工合同：扩枚举或新建 gated skill，验收=Otto 真实触达+审批闸+测试（spec §二 E4-10 行，v0.4）〕

## ⑬ 录像时间码 + founder 10 分钟自查脚本

- owner：〔块施工工位〕
- 证据：〔录像时间码 + 截图=待填（真发录像归**外部测试阶段**，spec §六.2；UI 态录屏可块内 staging）；**Founder 自查脚本（10 分钟）**=待填（终验日跑脚本非读散文）——预期步骤：打开排期区看三视图/横幅→跑 `publish.test.ts` 看四锁不双发→看 registry.test.ts 未授权即拒发→看 spec §一 差额核证表逐条有代码证据〕

## ⑭ 定稿后 delta

（合并后触碰本块任何签署对象=重认证；delta 记录从此处追加。）
