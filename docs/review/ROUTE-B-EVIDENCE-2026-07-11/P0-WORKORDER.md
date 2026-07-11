# P0 工单 —— 创作楔子·先证一元(Gate 1 已批)

> 2026-07-11。founder 批「走 P0,不等回馈继续推进」+ 防呆闸。基线 main@b5a48d0f。
> **只读侦查已把 council 的 P0 step1 三项收窄——两项基本溶解,只剩一项真 bug。** 详见下。

## 侦查更正(诚实收窄,控制面亲核)

council(Sol+Fable)的 P0 step1 基于我 matrix 里「宣传却画 4 variants / Otto 静默失败」的描述。亲核代码后:

1. **「4 变体」不是 app 里的虚假承诺**。`rg "4 variant"` 在 apps/web 只命中测试。登录页三条卖点(`apps/web/app/login/page.tsx:61-63`)诚实:"ready-to-post ad pack"=Otto proposePack(2-4 图,真)、"只在生成完成才扣费"=真、"direct publish is coming soon"=对 L1 未上线的诚实标注。**「4 variants」只在北极星宣传图(营销素材=founder 域),不在产品**。→ **无 app 文案要改**。可选:把后端已支持的 canvas 4 变体接出来(小 UI 接线),但那是产品/UX 判断,归 founder,且可能触防呆闸「新表面」,本轮不做。
2. **导出能用**。`DetailPanel.tsx:743-750` 有 `href={displayUrl} download` 下载按钮。仅需先开详情面板才可下载(canvas 节点上没有直接下载入口)。**不是坏的**;可选 UX:节点上加下载键(小,非阻断)。
3. **Otto「静默失败」不是漏报错——错误路径本就存在**。`route.ts:305` 在任何 run 失败(含 AI_LoadAPIKeyError)时写 `data-error`;`OttoChatStream.tsx:1106-1112` 会渲染 `streamError`。**所以走查里的静默转圈是某个特定情况下错误没浮出来的更微妙 bug,必须先复现定位,不能盲加报错。** ← 这是 P0 step1 唯一的真代码活。

## 修订后的 P0(比 council 假设更小)

### 第 0 步(先决,部分需 founder)
- **Sentry 接生产**(agent,免费):web `apps/web/instrumentation.ts` + worker `apps/worker/src/index.ts` 已有 SENTRY_DSN no-op 骨架,只需生产配 DSN(env=founder/控制面)。
- **一次 commit 可溯部署**(founder/控制面,手动 railway up)——终结「用户摸到哪版代码无人知」。
- **$1-2 Stripe live 收款冒烟**(founder 域 + 宪法 2 花费请示):因审计发现 Stripe 从没真收过一笔钱。**待 founder 批花费上限。**

### 第 1 步(agent,唯一真代码活)
- **诊断并修复 Otto 静默失败**:系统性复现(本地无 key 复刻走查场景)→ 定位 data-error 为何没浮到用户 → 最小修复。**不盲改**。属 systematic-debugging。
- 隔离 worktree、小 PR、只碰 Otto 错误呈现链、不碰 L1/发布链;merge 走 founder/FIK-1,作者不自合。
- **等 FIK-1 碰撞回复**(已问:Otto stream route 是否与其在跑的活重叠)再动编辑;复现诊断(只读)可先做。

### 第 2-3 步(founder)
- 招 1 个真实商家(Saranghaeyo 或圈内 SMB;创作区不需平台钥匙,登录+点数即可)自己走 brief→生成→改→导出;录屏+三问(每周用它做什么/缺什么/愿付多少)。
- 第 7 天招不到人 → 自动切纯访谈备选。

## 成功指标(冻结,事前锁定)
1 个非 founder 用户独立走完+导出(Sentry 无静默失败);≥1 笔真实支付(金额不限);三问录音入 repo 当 Gate 0 空白的第一批真答案。走不完/不肯付=一等证据,不算失败。

## 硬门(不变)
生产部署=手动/founder/控制面;真实花费=宪法 2 逐笔请示(P0 上限待批,建议 ≤$20-50);代码走 PR/CI 绿/作者不自合;与 FIK-1 协调防碰撞;防呆闸=3 份需求物证前不建新表面。

## P0 step1 Otto bug —— 进展(2026-07-11 20:xx)

- **已复现 + 诊断(编排官亲手,系统化调试 Phase 1)**:本地无 ANTHROPIC_API_KEY 复刻走查场景。**根因不是漏报错**:服务端 `route.ts:305` 正确发 `data-error`(raw fetch 抓到 SSE 原始字节确认),流也到达客户端;**bug 在客户端——data-error 到了但 UI 没显示**。onData(`OttoChatStream.tsx:241`)+ asErrorData(`otto-status-helpers.ts:43`,有单测)逻辑看似对,故疑 AI SDK v6(`ai@6.0.208`)的 onData/data-part 集成层。
- **已派 Opus worker**(隔离 fix worktree `wt-otto-fix`,分支 `claude/otto-silent-failure-fix`,基 origin/main 64d43701):带完整证据,任务=确认 SDK v6 根因→最小修复→测试→运行时自证;文件边界锁定(只碰 Otto stream/helpers/bridge/route,避开 FIK-1 的 OttoSchedule/northstar/actions/upload-actions);不 merge/不 push。
- **待编排官验收**:worker 回来后浏览器运行时复验(无 key 时错误是否浮出)+ 读 diff 确认最小、对齐 v6、无越界。过后走 PR,merge=founder/FIK-1。
- **花费**:本 bug 修复全程 $0(无真实供应商调用)。P0 累计真实花费仍 $0(上限 $25)。

## 创作楔子·硬化 backlog(审计导出,有序,防散弹;均 gate-compatible=硬化非新表面)

> 原则:只硬化「创作→(付费)」这条已建成的流,不铺未建大陆。每项标碰撞风险 + 是否需 founder。

| # | 硬化项 | 价值 | 碰撞 FIK-1? | 需 founder? | 谁做 |
|---|---|---|---|---|---|
| H0 | Otto 静默失败 | 核心聊天诚实 | 否 | 合并需 | ✅ 已 PR #234 |
| H1 | **生产接 Sentry**(prod DSN)+ 一次可溯部署 | 失败可见 + 版本可溯(审计一级运营缺口) | 否 | **是**(env/部署=founder/控制面动作,非 agent 码) | founder/FIK-1 |
| H2 | ~~其余创作流失败面是否也静默~~ | 已侦查 | — | — | ✅ **无需修**:画布生成失败=toast.error 可见;节点失败/超时/丢失=FailedBody 明确态+重试(F21 已修);上传失败=toast。创作流唯一静默处=Otto 聊天,已 #234 修。**创作楔子失败诚实性=齐** |
| H3 | `research.ts` 漏 sanitizeError(裸 e.message 落库,可能泄 URL) | 安全一致性(唯一漏网 job) | 否(research.ts 不在 FIK-1 清单) | 否 | ✅ **PR #237**:Sonnet 修,裸 e.message→sanitizeError(对齐其他 5 job),保留 MaxTurns 文案;编排官亲验 diff+13 测试绿(新测试断言 URL 被 scrub、签名不泄)+零钱路;已推、交 FIK-1 管线;**FIK-1 确认 CI 三绿 + 与切片 1 零重叠**,评审排 #236 之后,过后进 founder 下一批放行清单 |
| H4 | Otto `TOOL_STEP_LABELS` 缺 6 个 skill(流式 UI 无步骤提示) | 创作流 UX 打磨 | 否 | 否(但需确认「有意静默 vs 遗漏」) | 待派 |
| H5 | GM-05 文档谎(northstar 文档称已建 vs main 只欢迎浮层) | 诚实建造 | **纠缠 A′**(A′ 正落 northstar 页,可能使其变真) | 否 | **暂缓**(等 A′ 落定再对齐文档) |

**下一步执行序**:H1 需 founder(Sentry DSN + 部署时机)——等你点。H2/H3/H4 是可并行的 agent 硬化:H2 最贴创作楔子先做(只读侦查→派修);H3 先与 FIK-1 核碰撞;H4 需确认设计意图。H5 暂缓避开 A′。**未获 founder 明确"整个产品都建"前,不碰 L0/L1 上线/CRM 等未建区(防呆闸)。**

## 待 founder / 待协调
- [待 founder] P0 真实花费上限(收款冒烟 $1-2 + 客测生成)。
- [待 founder] 生产部署时机(P0 修复合入后需部署才能给客测)。
- [待 FIK-1] Otto stream 文件碰撞回复。
- [founder 招募] 真实商家。
