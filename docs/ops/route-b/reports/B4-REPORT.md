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

## ⑤ 对标锚（平齐/超过/未及）

- owner：〔块施工工位 / B11 联验〕
- 证据：〔Buffer/Later/Hootsuite + Meta 官方发布语义 + X adapter 单列锚（见 spec §四）；并排截图三档打分=待填；未及项→链待裁〕

## ⑥ 全旅程证据（happy/empty/loading/denied/failure/retry/mobile）

- owner：〔块施工工位（块内）/ 外部测试阶段（活体）〕
- 证据：〔**块内验收=mock/夹具级六态契约测试，零真实外部写**（spec §六.1）；**测试账号真发→IG/FB 可见的活体证据（尤其②③⑥）=外部测试阶段**（spec §六.2，前置=founder 授权，归 sandbox-verified 阶段执行）；happy/empty/loading/denied/failure/retry/mobile 七态截图=待填（UI 态可块内 staging 截取，真发态归外部测试阶段）〕

## ⑦ 测试全家桶可重跑链接

- owner：〔块施工工位〕
- 证据：〔`publish.test.ts` / `publish-doublepost.test.ts` / `publish-media-contract.test.ts` / `publish-attempt-uniqueness.test.ts` / `core/publish.test.ts` / `registry.test.ts` / `meta-actions.test.ts` / `media/pub/route.test.ts`；本地三关（`docs/runbooks/local-ci.md`）check/test/web-build 全绿链接=待填〕

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
  4. 〔E4-16「零核心改动可插拔」现状不成立（A03 降准）——X 接入触点 4 处收敛为登记式=施工验收项（spec §三 契约6/8）〕
  5. 〔proxy matcher 无边界前缀（`/api/media/pubfoo` 会被放行出会话墙，`proxy.ts:73`）——补边界断言+回归测试=施工验收项（spec §三 契约5）〕
  6. 〔E4-14 X 档位已拍板（GRILL-VERDICTS:215 方案 A）；**就高操作化细则**（短链/裸域名判 4cr）= founder ack（spec §四 X 锚）〕
  7. 〔App Review 外部钥匙未到——founder 侧商业验证/递件在等（spec §六.3）〕
  8. 〔通用审批卡链现状 generate 专用（`ottoApprove` 硬过滤 `toolName !== "generate"`，`otto-actions.ts:697`；卡渲染仅 OttoPlanCard spend 路径）——debt-70 gated skill 的硬性施工触点（spec §五 5.1·附，v0.3）：不建卡链=闸有名无实，债不得转 skill 态〕
  9. 〔排期 UI 六处渠道硬编码（`OttoSchedule.tsx:86-95,287,405,434-435,1123-1135,1199`）——E4-14 触点⑦（v0.3）；E4-16 收敛验收=UI 由 CHANNEL_META 数据驱动〕

## ⑬ 录像时间码 + founder 10 分钟自查脚本

- owner：〔块施工工位〕
- 证据：〔录像时间码 + 截图=待填（真发录像归**外部测试阶段**，spec §六.2；UI 态录屏可块内 staging）；**Founder 自查脚本（10 分钟）**=待填（终验日跑脚本非读散文）——预期步骤：打开排期区看三视图/横幅→跑 `publish.test.ts` 看四锁不双发→看 registry.test.ts 未授权即拒发→看 spec §一 差额核证表逐条有代码证据〕

## ⑭ 定稿后 delta

（合并后触碰本块任何签署对象=重认证；delta 记录从此处追加。）
