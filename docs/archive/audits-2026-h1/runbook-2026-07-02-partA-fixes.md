# Part A Run-book — 修 bug / 清债(先修后建)

> ⚠️ **本文件为 2026-07-02 时点快照,状态列未回填。** 抽查 3 项(F15 / affordability /
> Stripe 分页)均已在后续 PR 修复(#106 等)。以代码与 git 历史为准,不要据此判断"仍未修"。

来源:[audit-2026-07-02-full.md](./audit-2026-07-02-full.md)。这是「先修后建」里的 (A) 半——让现有代码 100% 正确,再谈建新面。

**两条轨道,井水不犯河水:**
- **轨道 1 — 安全轨(spend-path 隔离)**:任何会动花钱路径的修复,单独一个分支、单独 PR、每条**逐条等你点头**才动手,且过 `money-safety-review` skill。清单:`F02 F03 F04 F05 F06 F07 F08 F09 F27 F39 F40`。
- **轨道 2 — 普通轨**:不碰花钱路径的,可以按批并行推进,常规 review 即可。

每条都是 TDD:先写复现测试(红)→ 最小修复(绿)→ 保持既有测试通过。工作量标注 S/M/L。

---

## 轨道 1 — 安全轨(SPEND-PATH,逐条批准 + money-safety-review)

> ⚠️ 下面每一条我都**不会主动开工**,等你对具体某条说「做」。可以一次批一条,也可以一次批一组。

### 批次 S1-A · 预扣泄漏(钱回不来)—— 建议最先
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F02** | RefGenJob 没有 reaper:worker 崩在最后一次投递→job 永远 GENERATING、预扣永不退,还因唯一索引把该 entity 永久锁死不能再生成 | `apps/worker/src/jobs/refgen.ts` + `index.ts` | S |
| **F03** | Otto LLM 预扣(otto-turn/stream/approve/verdict/brand-research/cowork)无 reaper:进程崩在 LLM 调用中途→整笔 turn 预算永久卡住 | `packages/otto/src/meter.ts` + worker reaper | S |
| **F04** | 可恢复重试的 requeue 是无 guard 的裸 update(gen.ts:627)→能把 reaper 已 FAILED+退款的 job 复活,免费交付 | `apps/worker/src/jobs/gen.ts` | S |

**为什么先做这批**:三条都是「钱悄悄回不来 / 免费交付」,且都是小改(镜像已有的 GenJob reaper 模式),风险低收益高。F02 还附带一个用户可见的硬伤(entity 被永久锁死)。

### 批次 S1-B · BytePlus 迁移收尾
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F06** | video poll 5min 超时太短→慢任务超时=退用户款但 provider 仍计费(毛利泄漏);且提示「再试」诱发二次付费 | `packages/generation/src/byteplus.ts` | S |
| **F05** | 多图 pre-charge 失败被聚合成 chargedError→零图产出也可能记为已收费 | `packages/generation/src/byteplus.ts` | S |
| **F39** | 成本记录仍用 fal 价(video $0.2419/s),prod 跑 BytePlus(~2x 便宜)→毛利报表严重高估成本,founder 拿错数字决策 | `packages/core/src/gen.ts` | S |
| **F40** | BytePlus Ark 图片请求没设 `watermark:false`,Ark 默认可能带水印→付费用户拿到带水印图 | `packages/generation/src/byteplus.ts` | S |

### 批次 S1-C · stale-generationId 花错钱
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F08** | DetailPanel 选了 sibling variant 后,Animate 仍花在主图上;crop/reload 后 Delete 删旧、Favorite 星旧 | `apps/web/lib/asset-actions.ts` + `DetailPanel.tsx` | S |
| **F09** | DetailPanel「Edit @composer」startGen 不带当前图 reference→付费产出与用户以为在编辑的图无关 | `DetailPanel.tsx` + `gen.ts` IMAGE 分支 | M |
| **F27** | ChatMessage.seq = read-max-then-insert 无唯一索引→并发写撞号,refId 撞号→第二次 reserveCredits dedup 空操作 | `otto-actions.ts` + `propose-pack.ts` + `meta-propose.ts` | S |

### 批次 S1-D · 队列公平性
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F07** | 串行单飞队列(batchSize:1)+ 25min QUEUED reaper:几个长视频任务就能让后面付费 job 超 25min 被误判失败+退款 | `apps/worker/src/index.ts` + `gen.ts` | M |

---

## 轨道 2 — 普通轨(不碰花钱路径,可并行)

### 批次 T2-A · 无 CI(流程根因,建议尽早)—— P1
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F36** | GitHub 零 CI workflow,只有本机可绕过的 pre-push typecheck;push=auto-deploy prod 无人闸。加一个 `.github/workflows/ci.yml`(frozen-lockfile + typecheck + test + skill-import fence + no-raw-prisma)+ main 分支保护 | `.github/workflows/ci.yml` | S |

> **F36 单独说**:它不是普通 bug,是「为什么会有这些 bug 溜进 prod」的根因(#67 的 lockfile 事故就是它没挡住)。装上后,后面所有修复的 PR 自动被 CI 兜底。建议**在动其他修复之前先装 CI**。

### 批次 T2-B · 客户端静默吞错(P1/P2)
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F23** | OttoChatStream 没有 ACTION_CARD/BUILD_CARD 渲染分支 + bridge 只转发 'propose'→Meta 卡/pack 卡流式期间不显示,只有 reload 后才出现 | `OttoChatStream.tsx` + `otto-stream-bridge.ts` | M |
| **F18** | client 侧 activeVideoModel() 读不到 env→永远算 veo3.1-lite,与 prod byteplus 错位:canvas 视频流按钮静默失灵 | `useCanvasGen.ts` + `DetailPanel.tsx` + server prop | S |
| **F19** | useCanvasGen 三路径 `if('error' in started) return` 吞掉余额不足/守卫拦截→零反馈 | `useCanvasGen.ts` | S |
| **F20** | createNodeWithRetry 只重试 return-shape,throw/reject(真正的瞬时失败类)逃逸;耗尽只 console.warn | `useCanvasGen.ts` | S |
| **F21** | poll 120s 放弃报 failed(视频可合法超 2min);FAILED job 渲染永恒 spinner(卡片无失败态) | `useCanvasGen.ts` + `ImageNode.tsx` | S |

### 批次 T2-C · 安全加固(P2/P3)
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F13** | claimAndCreate 的 P2002 竞态分支只查 APPLIED,PENDING/APPLYING 会被重认领→两 worker 都建 Meta 对象(重复 campaign/双预算) | `meta-build-actions.ts` | S |
| **F14** | 登录后开放重定向:`?from=` 只查 `startsWith('/')`,放行 `//evil.com` | `app/login/LoginForm.tsx` | S |
| **F15** | 冒充态下 stopImpersonation 被 gated 在被冒充者(viewer)角色→staff 可能无法停止冒充 | `tenant-actions.ts` | S |
| **F12** | ad-build 越权:去掉 meta-build-actions.ts 顶层 `"use server"`(与 v1 对齐)。当前不可达(见分歧裁定),但零成本防雷 | `meta-build-actions.ts` | S |
| **F16** | fetchAndExtract 从 'use server' 模块导出且无 auth guard→挪进 `server-only` 模块 | `brand-research.ts` → 新 `fetch-extract.ts` | S |
| **F17** | 密码重置邮件未过 allowlist(被撤销用户仍收到有效链接);v2 审批 hash 未绑定 creative/targeting | `better-auth/server.ts` + `meta-build-spec.ts` | S |

### 批次 T2-D · 体验修复(P2)
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F10** | canAffordPack 浮点下溢:`Math.floor(balanceUsd/0.1)`→$0.30 算 2.999→少算,挡掉本可买的包 | `pack-credit-math.ts` | S |
| **F11** | PackCard.makeAll 中途某卡出错→不调 onApproved,前面已收费的卡永不轮询;全失败还渲染绿色成功页脚 | `PackCard.tsx` | S |
| **F34** | listCreditPacks 用默认 limit 10 无 product 过滤→>10 个 active price 时包列表截断/错乱(money-in 断) | `billing-actions.ts` | S |
| **F37** | Meta 连接器:瞬时失败误报「过期」需重连;列表无分页(>25 静默截断);header 还写「只读 Otto 不能花钱」但下面就是写模式开关 | `meta-actions.ts` + `meta-graph.ts` + `OttoConnections.tsx` | M |
| **F28** | webm(Infinity/NaN 时长)抽帧死路;「用此帧」可能在画好前贴出空白 JPEG | `OttoChatStream.tsx` + `video-frame.ts` | S |
| **F29** | OttoApp seedText 从不清空→旧模板文字自动填进无关新会话 | `OttoApp.tsx` + `OttoFrontDoor.tsx` | S |
| **F24** | RunState.fromString 遇到不支持的 schemaVersion 直接 throw 无 fallback→@openai/agents 升级会砖掉所有旧线程 | `otto-actions.ts` + stream route | S |
| **F25** | Otto 上下文无界增长:cap 只用在 reserve 公式从不真截断;worker verdict turn 不 stripHistoryImages→base64 重发 | `otto-actions.ts` + `otto-budget.ts` + `otto-resume.ts` | M |
| **F35** | apps/web 集成测试无 `*_test` DATABASE_URL 守卫→`pnpm test` 会动真库 | `isolation.test.ts` + `vitest.config.ts` | S |

### 批次 T2-E · 卫生/清债(P3)
| ID | 一句话 | 文件 | 工作量 |
|---|---|---|---|
| **F42** | error.tsx 用 Vapor text-dim(半透白)在浅色 .gb 上→错误页不可读;/login 还映射 NextAuth 错误码;proxy 丢 `?from=` query | `error.tsx` + `login/page.tsx` + `proxy.ts` | S |
| **F26** | Otto 指令让模型调 `proposeMetaAction` 但注册名是 `propose-meta-action`→模型调不到 | `instructions.ts` | S |
| **F30** | OttoFrontDoor.start() 算了 @mention entityIds 但 onStreamStart 只传 {text,goalKey}→首条流式消息丢实体条件 | `OttoFrontDoor.tsx` + `OttoChatStream.tsx` | S |
| **F32** | PR #47 提交了 worktree 垃圾:`.claire/worktrees/.../Avatar.tsx`(108 行重复)还 tracked 在 main | `git rm -r .claire/` + gitignore | S |
| **F38** | describeRefs skill 声明 `effect:'read'` 但实际做 updateMany 写→fail-closed 门的档位错了 | `describe-refs.ts` | S |
| **F41** | 存储缺口:直传不支持时无 fallback(本地盘 driver dev 断);/files presigned 300s 过期断长视频;ingest 校验 fail-open | `upload-actions.ts` + `files/[...key]/route.ts` | M |
| **F01** | Stripe webhook 不处理 `async_payment_succeeded`(当前 MY 支付方式都是即时到账,latent 而非活体) | `stripe/webhook/route.ts` | S |

---

## 建议执行顺序

1. **先装 CI(F36)** — 之后所有 PR 有兜底。
2. **安全轨批次 S1-A(F02/F03/F04)** — 钱回不来,小改高收益;逐条批。
3. 普通轨 T2-B/C/D 可并行推进(常规 review)。
4. 安全轨其余批次(S1-B/C/D)按你节奏逐条批。
5. P3 卫生批(T2-E)零散清理,随手做。

> 这份 run-book 只列 (A) 修 bug/清债。(B) 建新面(Analytics / Schedule 等端态愿景)在审计债清到你满意后再规划。
