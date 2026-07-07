# Otto 引擎升级设计:Prompt Caching(Phase 1)+ 技能分域装载(Phase 2)

> **性质**:P0.5 引擎升级的施工图(华语,宪法 9)。来源判决 = 2026-07-07 判决④("最好的全都做,先修引擎后还债",见 GRILL-VERDICTS 追加判决节)+ 效率良心条款(宪法 5:margin 赚在倍率上、永不赚在浪费上;GRILL-VERDICTS 定价终案节效率工单①)。
> **本 spec 待 founder 过目后才动工**(蓝图第五章:图纸先行)。碰计量/钱路的部分全程 `money-safety-review`。

---

## 一、现状与问题(2026-07-07 审计核实,全部带出处)

| # | 事实 | 出处 |
|---|---|---|
| 1 | Otto 运行时 = @openai/agents,经 `aisdk()` 适配 @ai-sdk/anthropic;主模型 claude-sonnet-4-6,529 过载时同级降级 claude-sonnet-4-5(`withOverloadFailover` 在 LanguageModel 层包装) | `packages/otto/src/model.ts:16-19, 57-85` |
| 2 | **25 个技能全部静态挂载**到 Agent —— 每一步请求都携带全部 25 个 tool schema | `packages/otto/src/otto.ts:20`(`tools: allSkills.map((s) => s.tool)`);`packages/otto/src/registry.ts:30-55` |
| 3 | **固定 prompt 前缀 ≈12.4k tokens/步**:tool schemas ≈7.7k + instructions ≈4.7k(instructions 为内联 TS 常量,20,343 字节) | 2026-07-07 审计实测;`packages/otto/src/instructions.ts`(204 行) |
| 4 | 每轮最多 **10 步**(OTTO_MAX_STEPS)→ 同一前缀一轮最多全价重发 10 次;多轮对话再乘轮数 | `packages/core/src/otto-budget.ts:8` |
| 5 | **Anthropic prompt caching 未启用**(全库无 cache_control/providerOptions 引用;harmony-04 §四·2 已证伪早期"caching 压低 settle"的猜测) | 2026-07-07 审计 grep 复核;`docs/design/2026-07-03-harmony-04-costing-model.md` §四·2 |
| 6 | **计量已 cache-read-aware**:`mapOttoUsage` 读 `requestUsageEntries[].inputTokensDetails.cached_tokens`;价表已有 `cachedInputPerToken`(sonnet $0.30/M) | `packages/otto/src/meter.ts:35-55, 64-76`;`packages/core/src/llm-prices.ts:13, 21` |
| 7 | **计量缺 cache-write 处理**:`LlmPrices` 无 cacheWrite 字段,`actualCostInternal` 公式无 cache-write 项 —— 开缓存前必须补,否则写溢价(1.25×)漏账 | `packages/core/src/llm-prices.ts:10-14`;`packages/otto/src/meter.ts:64-76`;harmony-04 §四·2 与 GRILL-VERDICTS 效率工单① 的前置条件 |
| 8 | **预扣口径已被现实击穿**:每步预扣按 input ≤12,000 tokens 假设(OTTO_CONTEXT_CAP_TOKENS),但事实 3 的固定前缀**单独就 ≈12.4k** —— 每步真实 input 必然超预扣假设;`settleCredits` 的 clamp(A = min(actual, reserved))把超额**静默吞掉 = 平台自吃**(harmony-04 §四·2 已知敞口,本工程顺带收窄) | `packages/core/src/otto-budget.ts:4, 19-27`;`packages/db/src/credits.ts:71-72` |

**一句话**:每一步都全价重发一段恒定不变的 12.4k 前缀,10 步/轮 —— 这正是宪法 5 效率良心条款定义的"臃肿上下文"缺陷;cache 读价 $0.30/M vs 全价 $3/M,**COGS 与用户账单同降 ~90%(前缀部分)**,不是涨价替代品而是义务。

---

## 二、Phase 1 —— Prompt caching

### 2.1 设计目标
- system prompt(instructions)+ tools schema 组成的**恒定前缀**打上 Anthropic `cache_control`;一轮内第 2-10 步、以及 5 分钟窗口内的后续轮,前缀走 cache read($0.30/M)。
- 计量、定价、明细全部如实反映 cache write/read(计费透明,铁律①)。
- 一个 env 开关可整体回滚,off = 与今日行为逐字节一致。

### 2.2 注入路径(研究结论 + 施工点)
调用链:`otto.ts` Agent → `aisdk(withOverloadFailover(anthropic(...)))`(`model.ts:83-85`)→ AI SDK LanguageModel `doGenerate/doStream(options)` → Anthropic API。

- **首选注入点 A:@ai-sdk/anthropic 的 providerOptions 通道。** AI SDK 支持在 system message 上挂 `providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }`(system 上打点 = Anthropic 侧缓存 tools+system 整个前缀)。**需验证**:`aisdk()` 适配层(@openai/agents-extensions)是否把 Agent 的 instructions 转成可携带 providerOptions 的 system message —— 若不透传,走注入点 B。
- **备选注入点 B(结构上必可行):`withOverloadFailover` 包装器。** 它已经拦截全部 `doGenerate/doStream(options)`(`model.ts:63-78`),对 Agent 与 RunState 完全透明。在这里对 `options.prompt` 的 system 段(和/或最后一个 tool)补 providerOptions 的 cacheControl 标记,即可不碰 SDK、不碰 run() 调用点,fresh-turn / approve / worker-resume 三条路径一次覆盖(与 529 failover 同一哲学)。注意 failover 到 4-5 时价表口径不变(计价按 OTTO_DEFAULT_MODEL,`model.ts:25`),caching 标记对两个模型同样有效。
- cache_control 断点只打在**恒定段**(tools + instructions);每轮变化的历史消息不打点(v1 范围外 —— 历史缓存收益依赖 5 分钟窗口与消息稳定性,留升级票)。

### 2.3 Meter 侧(前置工单,先行 PR)
1. `LlmPrices` 增加 `cacheWriteInputPerToken`(sonnet $3.75/M = 1.25×;opus 同比),数字进 `llm-prices.ts` 价表(config 层,宪法 5)。
2. `mapOttoUsage` 增加 cache-write 映射:读 `requestUsageEntries[].inputTokensDetails` 中的 cache 创建 token 字段(SDK 侧字段名以验证清单 2.5-V1 的实测为准)。
3. `actualCostInternal` 公式扩展:`(input − cached − cacheWrite)×in + cached×cachedIn + cacheWrite×cacheWriteIn + output×out`,维持 ceil + margin 结构不变;cached、cacheWrite 均 clamp 进 [0, input] 一致性护栏。
4. **顺序纪律**:meter PR 先合并(开关仍 off,行为零变化)→ caching PR 后合并。开关无论 on/off,计量侧都正确处理 cache 字段(fail-safe:先会算账,再开新账目)。

### 2.4 预扣口径修正(事实 8)
- caching 开启后,前缀成本降 ~10×,预扣(12k 全价假设)从"低估"变回"高估"(预扣 ≥ 实付,settle 退差额)—— 方向安全,**预扣公式本身不动**。
- 但把事实 8 记入 admin/cost 监控:上线后对比每步 usage.inputTokens 与 12k 假设,若 off 状态长期运行需单独修预扣(独立小 PR,不与本工程捆绑)。

### 2.5 必验清单(动工中逐项打勾,写进 PR 描述)
- V1:一次真实 turn 抓 raw usage,核对 AI SDK/@openai/agents 的 usage 字段口径 —— `inputTokens` 是否已含 cache write/read、cache 创建 token 的确切字段名(Anthropic 原生 usage 里 input_tokens 与 cache_creation_input_tokens / cache_read_input_tokens 三分;SDK 各层可能重新聚合)。**此为真实花费:先问 founder,一笔以内**(宪法 2)。
- V2:aisdk 适配层 providerOptions 透传与否(决定走注入点 A 还是 B)。
- V3:529 failover 路径上 caching 标记仍生效且计价正确。
- V4:worker resume(otto-resume.ts)路径 usage 同口径 —— 两处 mapOttoUsage 共用一个实现,不许分叉。

### 2.6 验收标准(全部满足才算完成)
1. 真实 turn(founder 批的验证花费)`usage.cached_tokens > 0`;同 thread 第二轮 settle 金额相对基线明显下降(贴对比数字进 PR)。
2. `OTTO_PROMPT_CACHE=off` 回退后请求体与现状逐字节一致(测试断言不带 cache_control)。
3. meter 单测覆盖:纯 read、write+read、无 cache 三种 usage 的 actualCostInternal 金额断言;settle ≤ reserve 恒成立。
4. `money-safety-review` 过闸;/admin/cost 与消费明细口径无漂移。
5. CI 全绿;催化剂文件(meter.ts / llm-prices.ts / model.ts)diff 经总审查员按 playbook「钱路核心」+「Otto 包」双清单终审。

### 2.7 收益量化(前缀部分,按官方价与 12.4k 实测前缀;上线后用真实 usage 回填)

| 场景 | 现状(全价 $3/M) | 开缓存后 | 省 |
|---|---|---|---|
| 单步前缀成本 | 12.4k × $3/M ≈ **$0.0372** | 读:12.4k × $0.30/M ≈ $0.0037;写(每 5 分钟窗口一次):12.4k × $3.75/M ≈ $0.0465 | — |
| 一轮 10 步(前缀部分) | ≈ **$0.372** | 1 写 + 9 读 ≈ **$0.080** | **≈78%** |
| 连续多轮会话(5 分钟窗口内) | 每轮再 $0.372 | 每轮 10 读 ≈ $0.037 | **≈90%** |

用户侧同倍率下降(margin 2.0× 不变,乘的基数变小)—— 这就是"COGS 与用户成本同降"的算术;harmony-04 §5c 的 Otto 轮均值($0.03 假设)将随之显著下修,上量后回填 per-user 模型。

### 2.8 风险与回滚
- cache TTL 5 分钟:间隔长的对话每轮首步付一次 1.25× 写溢价,其后 9 步全读 —— 单轮内即净省,无恶化场景。
- 回滚 = env 开关,一次 deploy,无数据迁移、无 schema 变化。

---

## 三、Phase 2 —— 技能分域装载

### 3.1 设计目标
25 技能(还债后将到 40+)不再全量常驻:每轮按**确定性规则**只装载相关域的技能,tools schema 从 ~7.7k 降到 ~2-3k/轮,并让 P0.75 还债新增的技能不再线性加重每轮前缀。

### 3.2 域划分(registry 加 `domain` 字段,建议初版)
| 域 | 技能(现 25 个的归属建议) |
|---|---|
| core(常驻) | propose、proposePack、generate、updateBrief、setTitle、describeRefs |
| creation | seedreamPrompt、seedancePrompt、proposeStoryboard |
| brand | rememberBrandFact、saveProduct、saveCustomerSegment、saveOffer、lookupProducts、ingestProduct |
| meta | metaInsights、metaAdPerformance、metaExpert、metaListObjects、listMetaPages、proposeMetaAction、proposeAdBuild |
| schedule | schedulePosts |
| research | researchWeb、proposeResearch |

归属是**一行字段**,founder 过目时可改;缝 1 的六处登记扩为七处(+domain)。

### 3.3 选域机制(宪法 10:确定性代码,不靠模型天赋)
`buildOttoContext`(`apps/web/lib/otto-actions.ts:191`)按两个输入用**纯确定性映射表**选域:
1. **viewContext**(上下文桥,宪法 7):当前视图 → 域(canvas/library→creation+brand;analytics/connections→meta;schedule→schedule;…)。
2. **当轮意图信号**:用户文本的确定性关键词表(华/英双语词表,纯字符串匹配,不调模型)命中 → 并集追加对应域。
- 装载 = core ∪ 命中域;**零命中 → 全量装载**(fail-open 到今日行为,宁多勿缺)。
- 映射表是一个可读 TS 常量文件(file-system 宪法:一张表,不是散落的 if)。

### 3.4 需要验证的 SDK 行为(动工前实验,结果写进 PR)
- V5:**RunState 恢复 × 工具集变化** —— `tryRestoreRunState` 恢复的历史含已卸载 tool 的 tool_call/tool_result 时,SDK 是否报错/降级?(playbook 警告:fromString 抛错 = 全线程变砖,F24。)
- V6:**interruption(审批)恢复** —— approve 轮必须装载原 tool 所在域,否则 approval 无法回放。
- V7:**10 步链内跨域** —— 一轮内模型试图调用未装载技能时的失败形态(SDK 报 unknown tool?)。

### 3.5 Escape hatch(按 V5-V7 结果落地,原则先钉死)
1. **恢复轮全量**:凡走 RunState 恢复(approve / worker-resume / 中断续跑)的轮次一律全量装载 —— 恢复正确性优先于 token 节省(安全 > 效率,宪法 1)。分域只作用于 fresh turn。
2. **零命中全量**(3.3):意图识别失败永远不会让 Otto"少一只手"。
3. `OTTO_SKILL_SCOPING=off` env 开关 = 全量装载,一次 deploy 回滚。

### 3.6 与 Phase 1 的组合
tools 集合变化 = 不同 cache 前缀。设计约束:域组合数少而稳定(core ∪ 单域为主),tools 顺序固定(registry 顺序),每种组合各自形成稳定 cache 条目 —— 分域**不推翻** caching 收益,只是把"一个大前缀"变成"几个小前缀"。Phase 1 先上线取全量收益,Phase 2 后上线取叠加收益,顺序不可倒。

### 3.7 验收标准
1. 每域组合的固定前缀 token 数报表(PR 里贴 before/after:全量 ≈12.4k → core+单域目标 ≤7k)。
2. fresh / approve / worker-resume 三场景回归测试绿(V5-V7 各有对应断言)。
3. registry/catalog/parity 全链登记齐(缝 1 七处);`pnpm lint:parity`、catalog:check 绿。
4. 真实 turn 每域至少一次功能抽查(mock provider,$0);settle 对比数字贴 PR。
5. `OTTO_SKILL_SCOPING=off` 回退行为与现状一致(测试断言)。
6. 总审查员按 playbook「Otto 包」清单终审(效率良心条款增查项)。

---

## 三点五、明确的非目标(本 spec 不做,别顺手)

1. **不动 OTTO_MAX_STEPS / OTTO_OUTPUT_CAP_TOKENS**:步数与输出上限是产品行为参数,不属本工程。
2. **不换模型**:harmony-04 §四·2 已警告 Sonnet 5 介绍价到 2026-08-31 且新 tokenizer 同文本 +30% tokens(= 变相涨价 30%),留在 4-6;本工程与模型选型解耦。
3. **不缓存对话历史**(只缓存恒定前缀):历史段每轮变化,缓存收益依赖消息稳定性,单独立升级票再议。
4. **不改用户可见 UI**:消费明细类目不变("Otto 对话"金额自然下降 —— 计费透明铁律①的正确形态:少收钱不用解释,多收钱才要);不加任何"已省 X%"营销面。
5. **不动 skill 本体与 3 字段安全声明**:分域只加 domain 元数据,cost/effect/reach/needsApproval 一个都不许碰(playbook「Otto 包」清单:prompt/装载类改动永不触安全字段)。
6. **不做历史 token 截断**:run-input.ts 明文推迟(截断会拆散 tool_call/tool_result 对,F25/playbook 警告),与本工程无关。

---

## 四、施工排期(判决④顺序的落地)

| 步 | PR | 内容 | 前置 |
|---|---|---|---|
| 1 | meter cache-write PR | §2.3(开关 off,行为零变化) | 本 spec 过目 |
| 2 | caching PR | §2.2 注入 + 开关 + §2.6 验收 | 步 1 合并;V1-V4 完成 |
| 3 | 分域 PR(可拆 2 个:registry+选域 / 接线) | §3 全部 | 步 2 合并;V5-V7 完成 |
| 4 | (卸闸)P0.75 还债开闸 | 见 MASTERPLAN 第三章 | 步 3 合并 |

---

## 五、升级票(本工程明确推迟、建票即带触发条件 —— harmony-03 升级票纪律同款)

| 票 | 内容 | 触发条件 |
|---|---|---|
| U-C1 | 对话历史段缓存(增量断点) | Phase 1 上线后 admin/cost 显示历史段仍占单轮 input >40% |
| U-C2 | 预扣口径重标定(OTTO_CONTEXT_CAP_TOKENS 对齐真实前缀) | Phase 2 上线后测得各域前缀稳定值;或 caching 长期 off 运行 |
| U-C3 | instructions 分域瘦身(4.7k 常量按域拆) | Phase 2 上线且域机制稳定一个月 |

---

**本 spec 待 founder 过目后才动工。** 过目要点:①两个 Phase 是否都要(判决④已定"都做",此处确认)②§3.2 域归属表 ③§2.5-V1 需要一笔真实验证花费(一次 turn,按宪法 2 逐笔批)。
