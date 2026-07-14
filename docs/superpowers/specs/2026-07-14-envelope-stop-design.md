# 授权信封 + 停按钮 · 图纸（已冻结）

> **性质**：wayfinder 票 **#294（授权信封细则）** 与 **#295（停按钮与人插手）** 的 Resolution 喂 to-spec 产物。**已冻结**（founder 2026-07-14 晚过目授权：「可以，你认为可以就行」+ control plane 对账复核通过）；schema 类实施 PR 仍按 AGENTS.md founder-only 类别处理。日期 2026-07-14。
> **判决真源**：①repo `docs/research/GRILL-VERDICTS-2026-07-03.md` 2026-07-14 追加节（:259 审批粒度、:260 暂停/接管）②issue #294/#295 的 Resolution 评论（founder 拍板 2026-07-14）③外部档案 `research/GRILL-2026-07-14-VERDICTS.md`（判决 8-5/8-6 原始记录）。
> **机器对照（只读）**：`apps/web/lib/approval-content-hash.ts`（指纹机器）、`apps/web/lib/otto-actions.ts`（铸卡/核对/TTL）、`packages/otto/src/approval-tools.ts`（受闸工具匹配器）、`apps/web/components/otto/PackCard.tsx` + `pack-credit-math.ts`（打包总价）、`docs/superpowers/specs/2026-07-12-b3-block-spec.md`（B3 批次与钱路不变量）。
> **纪律**：**零发明**——每条设计可指回判决原文或既有代码；拿不准的进 §五 留白待裁。语言华语（宪法 9）；界面文案英文 sentence case（founder 设计罗盘）。
> **去向**：两章同批实现于**第一笔钱主链 UX / B3 批3 界面接线**（#294/#295 Resolution「去向」条）。

---

## 人话对照表（先看这张）

| 术语 | 人话 |
|---|---|
| 授权信封 | 用户点一次头时批下的那个「封套」：里面写死**恰好哪些产出、恰好多少钱**；封外任何事都要回来再问（#294） |
| 指纹（contentHash） | 把批准对象的关键内容算成一串不可伪造的号码；内容变一个字，号码就对不上，机器硬拒（既有 `approval-content-hash.ts`） |
| 指纹保鲜 | 信封不是按时间变质，而是按内容变质：价格/素材/清单任一漂移 → 指纹失效 → 整封作废重批（#294「保鲜期 = C」） |
| 72h 兜底 | 批了 72 小时还没开工 → 信封自动过期（防「上个月批的今天才跑」）；**开跑后不再过期**（#294） |
| 追加三触发 | 中途唯一需要再问的三件事：追加花钱 / 对外发布 / 客户承诺（判决 8-5） |
| APPROVAL_CARD | 既有的审批卡（聊天流里那张「批/拒」卡），payload 已带 contentHash + expiresAt（缝 8 五道缝已过） |
| PackCard | 既有的打包卡：把同一批 GEN_CARD 归成一组、汇总总价一键批（`PackCard.tsx`） |
| B0-29 ApprovalRequest | 台账里已规划、未落地的审批持久行；代码注释明言落地时载同一 hash（`approval-content-hash.ts:10`） |
| 停按钮 | 每个在跑任务卡上一颗「停」：不开新动作、排队的撤销退款、在跑的诚实跑完（#295） |
| 基线语义 | 停下去发生什么，无选项：已完成留下 / 在跑一颗诚实跑完（供应商不可撤）/ 排队全退（#295） |
| 对象级插手 | 用户碰哪件，Otto 把手从那件上拿开，其余照常；先例 = 客服区人插手对话停该对话（判决 7-8） |
| routine 四件套 | routine 创建时的预授权配套：预算上限 + 范围声明 + kill switch + 事后摘要（07-03 O-02/O-05）；**全局停的归宿在这里**，不在本期 |
| 报价=预留=结账 | 钱路三数一致不变量（W-B3-E-P 正在证明）：确认页显示的、账上冻结的、最终扣掉的是同一个数 |
| REFUND 行 | 既有账本退款行：失败/撤销自动退，消费明细可见（宪法 3③；`refundReservation`） |
| 六态 | B0 发布契约六级状态 `spec-ready→code-complete→sandbox-verified→review-submitted→live-verified→release-certified` |
| 缝 1~9 | 九条扩建缝（`docs/review/EXPANSION-SEAMS.md`）；任何新东西必须走缝，绕缝直连 = 审查一票否决 |

---

# 第一章 · 授权信封（#294）

## 1.0 判决锚（本章每条设计的出处池）

- **形态 = A 精确清单式**：批准 = 恰好这些产出、恰好这个总价，内容+价格指纹锁死（复用既有审批指纹机器）；清单外任何事 → 回来再问（#294 Resolution）。
- **保鲜 = C 指纹保鲜**：价格/素材/清单任一漂移 → 指纹失效、信封自动作废、重报价重批；另加 72h 未开工兜底过期；开跑后不再过期（#294 Resolution）。
- **粒度**：一个 request = 一次批准，一张信封盖整单；连环确认按缺陷处理；宪法 4 公式不动，改的是粒度（GRILL-VERDICTS:259）。
- **超支由结构吃掉**：全部产出是配置菜单价，报价=预留=结账三数一致；失败只退不加；Otto 工资按轮计费走宪法 4 例外①（余额即闸），不进信封（#294 Resolution）。

## 1.1 数据形状：信封 = 清单 + 总价 + 指纹 + TTL（零新表）

信封**不是新表**。它是既有 APPROVAL_CARD payload（缝 8 ChatMessage 卡）的**打包升级**——把「一个 request 里所有停下等批的受闸动作」装进一张卡，而不是每个动作各弹一张（连环确认 = 缺陷，GRILL-VERDICTS:259）。

```
EnvelopePayload（落在既有 APPROVAL_CARD payload 上，无新表/无新列）
├─ items[]                     // 精确清单：本 request 停下等批的每个受闸动作
│   ├─ toolName                // 既有受闸集：registry needsApproval=true（approval-tools.ts:16）
│   ├─ ref                     // 既有 per-tool 锚（approvalRefOf，approval-tools.ts:32）
│   ├─ contentHash             // 既有分项指纹（computeApprovalContentHash / refgen / factoryBatch，域标签防撞）
│   └─ quotedCredits           // 该项报价（配置菜单价 server 算出；PackCard 的 estimatedCredits 同源）
├─ totalCredits                // 总价 = Σ quotedCredits（复用 packTotalCredits 口径，pack-credit-math.ts）
├─ envelopeHash                // 信封指纹 = canonical(排序后的分项 contentHash 列表 + totalCredits)
│                              //   —— 「内容+价格锁死」的机器落点：任一分项内容变 或 任一价变 ⇒ 号码对不上
├─ expiresAt                   // 批准前 ask 时效：既有 APPROVAL_CARD_TTL_MS = 24h（approval-content-hash.ts:165，不动）
├─ approvedAt                  // 批准时刻（既有 approve 动作落）
├─ startBy = approvedAt + 72h  // 72h 未开工兜底（#294；新常数，一处定义，founder ack 可调——与 24h 常数同风格）
└─ startedAt                   // 首个分项真正开工（首次 reserve 成功）时刻；一旦非空 ⇒ 永不再过期
```

**与既有机器的复用关系（逐件对上）**：

| 既有件 | 在信封里的角色 | 动不动 |
|---|---|---|
| `computeApprovalContentHash` / `refgenApprovalHashFromArgs` / `factoryBatchApprovalHashFromArgs` | 分项指纹，原样复用；新受闸 skill 照旧自动进 `APPROVAL_TOOL_NAMES` 闭集 | 不动 |
| `readApprovalConsent`（otto-actions.ts:416）铸卡+approve 双时点重算 | 分项级「内容变了硬拒」照旧；信封层在其上加价格重算比对 | 复用+加一层 |
| `PackCard` + `packTotalCredits` | 清单式渲染 + 总价一键批的 UI 与算钱先例；信封卡以它为模板改造 | 复用改造 |
| `APPROVAL_CARD_TTL_MS`（24h） | 批准**前**的 ask 时效，维持既有语义 | 不动（见 §1.3 两只钟） |
| B0-29 ApprovalRequest 行（已规划未落地） | 信封的未来持久归宿；落地时载同一 envelopeHash（代码注释既定方向） | 不提前建 |
| `pricedGenCredits → 确认 → startGen → 六态` 唯一 spend 权威 | 信封只是**批准的包装**，钱路一条不加不改（零新钱路，B3 spec:419） | 不动 |

**明确不进信封的**：Otto 工资（LLM/search 按轮计费）——宪法 4 例外①余额即闸，另轨（#294 Resolution）；money-in 充值——宪法 7 豁免，Otto 永不代办。

## 1.2 失效谓词（信封何时作废——完整枚举，此外无第三种死法）

| # | 谓词 | 判定时点 | 结果 |
|---|---|---|---|
| P1 | **指纹漂移**：任一分项 approve/execute 时重算 contentHash ≠ 铸卡值，或 server 重算价 ≠ quotedCredits（⇒ envelopeHash 对不上） | approve 时 + 开工前每分项执行时（既有双时点核对模式） | 整封作废；卡翻「内容已变」态；重报价重批（既有拒绝语义 "content changed — re-approve" 推广到封级） |
| P2 | **72h 未开工**：`now > startBy` 且 `startedAt` 为空 | 开工尝试时惰性判定（无需定时器） | 整封过期；重报价重批 |
| P3 | ~~开跑后过期~~ | **不存在**：`startedAt` 非空后 P2 永不触发；P1 也不再于跑中检查——**跑一半不中断**（#294「开跑后不再过期」） | — |

批准**前**另有既有 24h ask 时效（P0，不属信封失效，属「问」的保鲜）：过 24h 未批 → ask 作废重问，机器原样（otto-actions.ts:538）。**两只钟**：24h 管「问→批」，72h 管「批→开工」，互不替代。

## 1.3 追加流程（中途再问，恰好三触发）

**清单外任何事 → 回来再问**（#294）。再问的形态：

1. **触发闭集**（判决 8-5，不得扩列也不得漏）：①追加花钱（清单外任何新 spend，无阈值——精确清单制下不存在「小额免问」）②对外发布（清单未明列的 effect=write ∧ reach=external 动作）③客户承诺（对客户作出清单外承诺）。
2. **追加 = 增量小信封**：只装新增项与增量价，**不重批已批部分**（重批 = 连环确认 = 缺陷）。增量信封走同一数据形状、同一失效谓词（自带 24h ask / 72h 开工钟）。
3. **拒绝增量 ≠ 撤销原封**：原封已开工部分照常跑完；未开工部分照常（原封自身谓词管辖）。
4. 反向不成立：清单**内**的事，跑到哪步都不再问（一个 request = 一次批准）。

## 1.4 六态轨迹

| 能力行 | 当前态 | 目标落点 |
|---|---|---|
| ENV-1 信封铸造（多分项打包 + envelopeHash + 总价） | spec-ready（本稿冻结后） | B3 批3 界面接线 / 第一笔钱主链 UX |
| ENV-2 失效谓词 P1/P2 机器强制 | spec-ready | 同上（P1 分项级今已 live——既有双时点核对） |
| ENV-3 追加三触发增量信封 | spec-ready | 同上 |

## 1.5 UI 状态（信封卡，改造自 PackCard + APPROVAL_CARD）

| 态 | 卡面 | 可点 |
|---|---|---|
| pending | 精确清单（每行：产出描述 + credits）+ 总价 + 「Approve all (N · X credits)」/「Reject」 | 批 / 拒 |
| approved 未开工 | 清单 + 已批注记 + 开工兜底期限 | — |
| running | 进度注记（分项六态各自走） | 停按钮归第二章 |
| invalidated（P1） | "The plan changed since you approved — here's the new quote."（重报价重批入口） | 重批 |
| expired（P2） | "This approval expired before work started — want a fresh quote?" | 重批 |
| rejected / consumed | 既有终态语义 | — |

余额不足守卫照 PackCard 既有行为（`canAffordPack`）：总价 > 余额 ⇒ 批钮禁用 + 差额提示（宪法 3①只显示 credits）。

## 1.6 验收标准（机器可测）

- [ ] 同一 request 内全部受闸动作**只弹一张**信封卡；出现第二张确认（增量三触发除外）= 缺陷。
- [ ] 铸封后任一分项内容漂移或 server 重算价漂移 → approve/execute 硬拒，整封作废，卡翻 invalidated；**不存在部分作废**。
- [ ] `approvedAt + 72h` 未开工 → 执行拒绝、卡翻 expired；`startedAt` 落后任何时点执行**不再做过期检查**。
- [ ] 清单外 spend / 对外发布 / 客户承诺 → 停下出增量信封，**零静默执行**；清单内动作全程零再问。
- [ ] 信封批准的每笔 spend 走既有唯一权威链，报价=预留=结账三数一致（对齐 W-B3-E-P 通过阈值，B3 spec:181）；失败只退不加、partial 只退失败格。
- [ ] Otto 按轮计费在信封存在期间照常走余额即闸，与信封零耦合。
- [ ] 全部新逻辑 vitest $0 可测（MockProvider）；真钱验收照 B3 spec §6.3 只交方案不执行。

---

# 第二章 · 停按钮与人插手（#295）

## 2.0 判决锚

- **不建重机器**：「暂停-存档-接管-续跑」永久砍；只建停按钮 + 人插手即停 + 想继续再说一句话（GRILL-VERDICTS:260）。
- **基线语义（无选项，既有机器）**：已完成留下；在跑一颗诚实跑完（供应商不可撤）；排队全部撤销退款（#295 Resolution）。
- **Q1 粒度 = A 单粒度**：停按钮只长在任务卡上；全局红按钮 over 设计——全局停归 routine 四件套 kill switch（07-03 既定），随 routine 上线再来；平台级急停已在设置/后台层存在（#295 Resolution）。
- **Q2 插手 = A 对象级**：用户碰哪件，Otto 把手从那件上拿开（该对象排队动作撤销退款），其余照常；配一句人话提示；先例 = 判决 7-8 客服对话（#295 Resolution）。

## 2.1 按钮位置：任务卡，单粒度

- 停按钮出现在**每个在跑任务的卡**上（GEN_CARD / 批次卡 / 信封卡 running 态——用户正看着干活的地方），条件 = 既有 `cardState === "working"`（otto-inject-helpers.ts:45）。
- **不建**：全局红按钮、区级停、会话级停。全局停唯一归宿 = routine kill switch（O-02/O-05 四件套），本期不做。
- 停免二次确认：停本身不花钱且只保守化（不开新动作），弹确认反而复制「连环确认」缺陷——见 §五留白 W-4 供 founder 复核。

## 2.2 停语义状态机（基线，无选项）

对被停 request 名下每个工作项（GenJob / 批次格 / 排队中的受闸动作），按其当刻状态分流——**三分流是全部语义，无第四种**：

```
用户点「停」
├─ DONE          → 留下（作品即进度，已扣的不退不删）
├─ GENERATING    → 诚实跑完（供应商不可撤）：不中断、不假装停了；
│                   完成后照常 DONE-with-attach 结算（既有终态纪律，gen.ts:163）
└─ QUEUED        → 撤销 + 退款：REFUND 行落账（复用 refundReservation，消费明细可见——宪法 3③）
另：request 停后零新动作开出（信封剩余未开工分项一并按 QUEUED 撤销退款）
```

- **停不撤已发生的对外写**：已发布的贴文不删不撤（停 ≠ undo；判决只授权「不开新动作」）。
- **幂等**：重复点停 / 停与 worker 取活竞态 → 同一项永不双退（对齐既有 finalizer 单终态纪律与「Retry 不双扣」通过阈值）。
- **QUEUED 撤销的账面表示**：GenStatus 今只有 QUEUED/GENERATING/DONE/FAILED（schema.prisma:389）。建议新增 `CANCELLED` 枚举值（零新表）——「用户停的」与「失败的」在消费明细与卡面是两句不同的诚实话（宪法 3③状态诚实）；复用 FAILED+原因串是备选。工程裁量项，列 §五留白 W-3。

## 2.3 对象级插手判定：什么事件算「碰」

**定义（精确）**：人对**Otto 当前持有排队/计划动作的那个对象**发生一次 **effect=write 的落库操作**（沿用宪法 4 三字段词汇），即为「碰」。该对象上 Otto 的排队动作立即按 §2.2 QUEUED 分流撤销退款，**其余对象照常**；Otto 出一句让位提示（§2.4）。

| 事件 | 算不算碰 | 依据 |
|---|---|---|
| 编辑对象内容（画布元素改动、贴文 caption/排期改动、卡片字段改动） | **算** | #295「用户碰哪件」+ 判决 7-8 先例（人回消息 → 该对话 Otto 停） |
| 删除对象 | **算** | 同上（写操作的极端形式） |
| 对该对象手动触发同类动作（人自己点了 Regenerate/Publish） | **算** | 双模单一动作层——人已亲手接管该步 |
| 查看/浏览/悬停/复制/下载 | **不算** | read 不改状态；把「看一眼」判成插手会把 watch/live reflection 一起误伤（GRILL-VERDICTS:260 明言 watch 照旧建） |
| 选中但未改动、打开编辑面板未保存 | **默认不算**（只认落库写） | 拿不准，列 §五留白 W-1 |
| 编辑**同 request 的另一个对象** | 只停被碰的那件 | #295「其余照常」（对象级，非 request 级） |

- **在跑（GENERATING）的对象被碰**：供应商不可撤 → 该颗照旧诚实跑完，但完成后 Otto **不再对该对象开任何新动作**（手已拿开）；产物照常落库归用户处置。
- **判定点**：写路径统一在 server action 层判定（单一动作层——人工按钮与 Otto skill 走同一 action，天然一处埋点，无需 UI 层监听）。

## 2.4 Otto 让位提示（一句人话，sentence case）

对象级插手（#295 明文「配一句人话提示」）：

> "This one's yours now — I'll keep working on the rest."

停按钮按下后的小结（分流结果诚实汇报；数字为示例）：

> "Stopped. 3 finished pieces are yours to keep. 1 was already rendering and will finish honestly — you only pay for what completes. 4 queued items were cancelled and 12 credits refunded."

在跑单颗、无排队可退时：

> "Too late to stop this one — it's already rendering. Nothing new will start."

文案基调对齐 founder 设计罗盘（专业 + 宕机点被接住 + 人性化不失专业）；credits 永不显示美元（宪法 3①）。

## 2.5 想继续 = 再说一句话

- 无恢复按钮、无存档、无「续跑」概念（重机器已永久砍）。**作品即进度**：留下的 DONE 产物就是断点。
- 用户再说一句话 = **新 request = 新信封**（若含受闸动作则按第一章重新报价重批）。衔接体验的全部设计 = Otto 停后小结末尾自然接一句引导（宪法 3④建议按钮）：
  > "Want to pick this back up? Just tell me what's next."

## 2.6 六态轨迹

| 能力行 | 当前态 | 目标落点 |
|---|---|---|
| STOP-1 任务卡停按钮 + 三分流 + REFUND | spec-ready（本稿冻结后） | B3 批3 界面接线 / 第一笔钱主链 UX |
| STOP-2 对象级插手判定 + 让位提示 | spec-ready | 同上（客服区先例随 M 区自身设计落，本章只定全城原则） |
| STOP-3 停后小结 + 再说一句话衔接 | spec-ready | 同上 |

## 2.7 UI 状态（任务卡增量）

| 态 | 卡面 | 可点 |
|---|---|---|
| working | 既有进度 + **Stop** 钮（.gb 设计系统次级/危险样式，缝 7） | Stop |
| stopping（瞬态） | Stop 钮禁用 + "Stopping…"（等待分流结算） | — |
| stopped | §2.4 小结 + 引导句；产物区照常显示留下的 DONE | 产物操作 |
| 插手注记 | 被碰对象行内一条让位提示（非弹窗、不可叫停工作流） | — |

## 2.8 验收标准（机器可测）

- [ ] `working` 态任务卡有且仅有一颗停钮；全局/区级停在本期界面**不存在**。
- [ ] 点停后：零新动作开出（信封未开工分项一并撤销）；QUEUED 全撤且每项一条 REFUND 行可见；GENERATING 照常跑完落 DONE；DONE 原样。
- [ ] 停幂等：重复点停 / 与 worker 取活竞态，同一项零双退零双扣（vitest $0 断言）。
- [ ] 对被碰对象：Otto 排队动作撤销退款 + 让位提示恰好一条；**同 request 其余对象零扰动**（断言其队列原样）。
- [ ] read 类操作（查看/复制/下载）零触发插手；watch/live reflection 路径零回归。
- [ ] 停后再说一句话 → 走全新 request/信封链，与被停 request 零状态耦合。

---

## 三、九缝映射（两章合，绕缝直连 = 一票否决）

| 缝 | 本 spec 的走法 |
|---|---|
| 缝 1 Otto 技能 | **零新 skill**；受闸集照旧从 registry `needsApproval` 机器推导（闭集，approval-tools.ts:16）；宪法 4 公式一字不动——改粒度不改公式（GRILL-VERDICTS:259） |
| 缝 3 记账 | **零新钱路零新收费点**；退款全走既有 `refundReservation`/REFUND 行；信封只包装批准，spend 权威链原样 |
| 缝 5 租户 | 信封卡/停动作全在 ownerId 域内（requireOwner 既有纪律）；跨租户零字节 |
| 缝 6 队列 | QUEUED 撤销在 worker 取活前判定；in-flight 永不中断（与既有 reaper/redelivery 单终态纪律同框） |
| 缝 7 设计系统 | 停钮/信封卡走 `.gb` + shadcn；文案 sentence case |
| 缝 8 卡片 | 信封 = APPROVAL_CARD payload 演化 + PackCard 渲染模板；五道缝（持久写/重放/流式/去重/渲染）逐条过 |
| 缝 9 Parity | 新 server action（信封批/拒沿用 ottoApprove/ottoReject；停为新 action）**必登记 Parity Manifest**；停是否给 Otto 对等 skill 见留白 W-5 |
| 缝 2/4 | 不触碰（无新模型无新渠道） |

## 四、假设台账

| # | 假设 | 若不成立 |
|---|---|---|
| A-1 | 既有 24h ask 时效（APPROVAL_CARD_TTL_MS）与新 72h 开工兜底是**两只钟**，前者维持不变 | 若 founder 意在以 72h 取代 24h，改一处常数即可，形状不变 |
| A-2 | 「配置菜单价」口径 = pricedGenCredits 配置层价（宪法 5 永不硬编码），铸封时 server 算、approve/执行时重算比对 | 若有非菜单价产出混入 request，该项无法入封 → fail-closed 单独问 |
| A-3 | 信封本期落卡 payload；B0-29 ApprovalRequest 行落地时同 hash 平移，不提前建表 | 若批3 前 B0-29 先落地，信封直接铸在该行上，本 spec 形状不变 |
| A-4 | 「对外发布在清单内则一次批覆盖」——信封盖整单包含明列的发布动作（一个 request = 一次批准的题中义） | 若 founder 要发布永远单独批，把发布项从可入封集合剔除即可 |
| A-5 | 本 spec 管**产品内用户**的批准；开发/验证阶段真实供应商花费照旧宪法 2 逐笔问 founder，两层互不替代 | — |
| A-6 | 插手判定埋点在 server action 层（单一动作层保证人/Otto 同路），无需前端事件监听 | 若存在绕 action 的写路径，先按缝 8/审查规矩修那条路，不为它加监听 |

## 五、留白待裁（呈 founder，本稿不裁）

| # | 待裁问题 | 背景 |
|---|---|---|
| W-1 | 「碰」的灰区：**选中未改动 / 打开编辑面板未保存**算不算插手？ | 本稿默认只认落库写（保守、零误伤 watch）；若 founder 要「摸到即让」的更强体感，扩到面板打开即让 |
| W-2 | 指纹漂移作废是**整封**作废（本稿采：#294「信封自动作废」字面）——是否允许「未漂移分项保留、只重批漂移项」的宽松版？ | 宽松版体验少一次全单重批，但语义偏离「恰好这些产出、恰好这个总价」的整封锁死；本稿按严格版写 |
| W-3 | QUEUED 撤销账面表示：新增 `CANCELLED` 枚举值（诚实话「你停的」）vs 复用 FAILED+原因（零 schema 改动）？ | 工程裁量；宪法 3 状态诚实倾向前者；两案都零新表 |
| W-4 | 停按钮免二次确认（本稿采）是否合意？ | 停只保守化不花钱；但误触会退掉整队排队项（可再说一句话重来，代价 = 重批一次） |
| W-5 | 停是否给 Otto 对等 skill（缝 9）：「停」本质是人对 agent 的控制权动作，本稿倾向登记豁免（类比账户安全类豁免）而非造 Otto 自停 skill | 若 founder 要「叫 Otto 停下」的对话式停法，则需 free/write 停 skill 一枚，语义仍走同一 action |
| W-6 | 72h 兜底常数是否 founder ack 后可调（同 24h 常数惯例），以及是否分产出类型差异化（本稿采：全城统一 72h，不差异化） | #294 只给了 72h 一个数 |

## 六、出处索引（速查）

| 设计条 | 出处 |
|---|---|
| 精确清单式 / 内容+价格锁死 / 指纹保鲜 / 72h / 开跑不过期 / Otto 工资另轨 | issue #294 Resolution（2026-07-14） |
| 一个 request 一次批准 / 三触发 / 公式不动 / 连环确认=缺陷 | GRILL-VERDICTS-2026-07-03.md:259 + 外档判决 8-5 |
| 基线三分流 / 单粒度任务卡 / 全局停归 routine / 对象级+一句人话 | issue #295 Resolution（2026-07-14） |
| 不建暂停-接管重机器 / 想继续再说一句话 / watch 不受影响 | GRILL-VERDICTS-2026-07-03.md:260 + 外档判决 8-6 |
| 人插手先例（客服对话） | 判决 7-8（GRILL-VERDICTS-2026-07-03.md:186） |
| routine 四件套 kill switch | GRILL-VERDICTS-2026-07-03.md:13（O-02+O-05） |
| 指纹机器 / 24h TTL / 双时点核对 / 域标签防撞 | `apps/web/lib/approval-content-hash.ts`、`apps/web/lib/otto-actions.ts:416,538,1041-1068` |
| 受闸闭集机器推导 | `packages/otto/src/approval-tools.ts:16,32` |
| 打包总价先例 / 余额守卫 | `apps/web/components/otto/PackCard.tsx`、`pack-credit-math.ts` |
| 三数一致 / 只退失败格 / 零新钱路 / 真钱验收只交方案 | `docs/superpowers/specs/2026-07-12-b3-block-spec.md:181,301,366,419` |
| 宪法 3/4/5/7/9 引用 | `docs/BLUEPRINT.md`（宪法节） |
| 卡状态机 working 判定 | `apps/web/lib/otto-inject-helpers.ts:45` |
| GenStatus 现状（无 CANCELLED） | `packages/db/prisma/schema.prisma:389` |
