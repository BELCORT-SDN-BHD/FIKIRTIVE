# OTTO 运行框架与 Flight Simulator 设计草案

> 日期：2026-07-13
>
> 性质：**founder 已批 Phase 1 开工（2026-07-14，票 #300，条件=research 闭合+锁输入+验收矩阵）；Phase 2+ 仍按本文件各 phase Done 门与项目治理逐步放行；本文件仍不是部署/花费授权。**
>
> 代码快照：本独立 worktree HEAD **449145e9971e3ac8860d23d7edae697f4f8bd0af**。rebaseline 对表：research T289（2026-07-14，11/11 OBSERVED 成立、与冻结契约零冲突）。
>
> 目的：在不打扰 Route B 主控制面的前提下，把 OTTO 的完整运行框架、模型策略、Skill 体系、失败闭环、评测方法与低成本生产镜像测试场先写清楚。

## 0. 先讲结论

OTTO 应该是：

> **一个聪明的 Operator，由经过验证的上下文、确定性 Skills、同一动作层、审批、执行后验证、诚实失败与持续 Eval 严格约束。**

它不是一个只会照流程的笨机器人，也不是一个可以任意调用全部系统的裸模型。模型负责理解模糊的人话、判断下一步和组合能力；harness 负责限制它看到什么、能做什么、什么时候必须停、结果是否真的发生，以及每一轮值不值得花用户的钱。

本草案的核心选择：

1. **生产运行时只有一个 OTTO、一个主模型家族。** 用户不选模型；跨厂模型只在离线 Flight Simulator 竞争。
2. **V1 不设常驻 Fable / frontier advisor，不设多 agent orchestrator。** 这两层没有 OTTO 自身数据证明前，不值得增加成本、延迟和权限面。
3. **不建第二个 compiler LLM。** 普通用户的模糊输入由同一个 Operator 在正常首轮理解；服务器先提供已验证范围，Skill 的资讯门只问真正会改变结果或风险的一件事。
4. **Skill 不是另一个模型。** Skill 是给 OTTO 的专业工作能力：领域步骤、schema、规则、动作入口、审批边界、验证方法和测试。
5. **Flight Simulator 不复制一套 SimOTTO。** 它让真实入口汇入同一 application runner/finalizer，运行同一 Skills、动作权威与验证代码；只在系统边缘替换模型 runtime、隔离测试身份/凭据、provider adapter 和 trace detail。
6. **“以后可以直接上线”定义为无需重写功能，不等于跳过验证。** 最终 main 对表、完整 staging-live、真实 Skill 认证和一个很小的生产 API canary 仍是硬门。
7. **第一刀很小。** 先统一 runner/finalizer 与 model-billing manifest，再用 fixture/replay 跑一条 authenticated journey；CLI、图形 Flight Deck、跨家比赛都不能阻塞这个最小闭环。

这套设计刻意追求“最小的完整系统”，不是“最多的架构名词”。

---

## 1. 权威状态与使用方法

本文件同时引用法律、当前事实、已冻结契约与新建议。施工时必须区分：

| 标记 | 意思 | 例子 |
|---|---|---|
| **LAW** | 已生效，不由本文件改写 | One Otto、Skill 扩建缝、花钱/对外写前审批、tenant 铁幕、UI/OTTO 同一动作层、效率良心条款 |
| **OBSERVED** | 在上述 HEAD 的代码里已核实 | Anthropic singleton、44 个静态 Skills、prompt cache、529 同家族 fallback、RunState、无工具单步 verdict |
| **FROZEN CONTRACT** | 已经走完治理闭环并进入 Route B `spec-ready`；本文件无权改写 | B9 已冻结的 domains、viewContext、toolsetVersion、零命中/恢复规则与 live-event 契约 |
| **PROPOSAL** | 本文件的新设计，等主任务完成后对表 | ModelDriver、typed RunOutcome、capability-gap 事件、Flight Simulator |
| **DEFERRED** | 只有触发证据出现才建 | runtime advisor、多 agent、复杂 policy registry、云端 subscription runner |

优先级始终是：

1. [BLUEPRINT](../BLUEPRINT.md)
2. 已生效的项目法律与 founder 判决
3. 已冻结的 B9 / Route B 契约
4. 本文件

若主任务结束后的最终接口与本文件冲突，先对表，不能让本文件静默覆盖主任务。

### 当前编排限制

repo overlay 现已 pin **v3.0.3**（SKILL.md SHA-256 **2fdccc10...**，#286 已落 main；T289 对表核实）。依 overlay，本文件不能冒充正式 Tier-1 架构裁决；它是 founder 要求的独立设计 artifact。本文没有联系主 orchestrator、没有修改其状态账、没有 claim 它的工作，也没有授权花费、部署或外部写入。

---

## 2. 人话词典：Skill、Tool、Action 到底是什么

| 名字 | 人话 | OTTO 中的职责 |
|---|---|---|
| **Operator** | OTTO 这个员工 | 听懂目标、判断、选 Skill、组合步骤、对用户负责 |
| **Model** | 员工的大脑引擎 | 理解语言、推理、决定下一次回复或 tool call |
| **Harness** | 员工的工作制度与办公室 | 上下文、权限、循环、状态、成本、验证、追踪、失败边界 |
| **Skill** | 员工学会的一项专业工作 | 领域指导 + typed input + 安全分类 + 动作调用 + 验证/测试 |
| **Tool** | 模型在运行时看到的函数形状 | Skill 被包装给 Agents SDK 后的调用接口 |
| **Action** | 产品真正执行的一项业务动作 | UI 和 OTTO 必须共用的 owner-gated server authority |
| **Port** | Skill 通往 Action / provider 的受控插座 | 把可信身份预先绑定，Skill 不直接拿 DB、密钥或 provider |
| **Receipt** | 做完后的有来源回执 | 证明实际做了什么、花了什么、是否验证、是否可能未确认 |
| **Flight Simulator** | OTTO 的试飞场 | 同一引擎在隔离数据、CLI 模型或测试 provider 上跑真实旅程 |

所以，用户之前说的“tools”并没有错；只是产品设计层更准确地叫 **Skills**。一个 Skill 在 runtime 里会表现成一个或多个 typed tools，但 Skill 还包括规则、审批、动作、验证和测试，不只是函数名字。

---

## 3. Dummy-proof 的用户合同

OTTO 面对 normie 用户时，不应该要求他们学 prompting、选模型、理解 agent、挑 Skill 或写 JSON。

### 3.1 正常旅程

~~~text
用户只说目标
  ↓
服务器附上已验证的当前页面、选择对象、品牌事实、身份与权限
  ↓
同一个 OTTO 理解意图，自动选择相关 Skill
  ↓
缺少会真正改变结果/风险的资讯？只问一个关键决定
  ↓
先给可检查的方案或 read-back card
  ↓
涉及花钱、对外写、不可逆或 authority 未覆盖？明确批准
  ↓
同一动作层执行
  ↓
读取真实状态验证
  ↓
给 receipt；若办不到，诚实停止并给安全替代
~~~

### 3.2 用户只需要理解四个状态

| 用户状态 | 意思 |
|---|---|
| **Working** | OTTO 真的在执行，并显示真实阶段 |
| **Needs you** | 缺一个必要信息或明确批准 |
| **Done** | 已从真实状态验证完成，并有 receipt |
| **Couldn’t safely continue** | 没有继续冒险；说明什么没做、钱/外部影响、下一步 |

内部可以有更细的 failure type，但 UI 不应把工程状态机倾倒给普通用户。

### 3.3 一个问题的原则

OTTO 只在答案会改变以下任一项时追问：

- 花费；
- 外部受众或发布范围；
- 客户承诺；
- 商店/品牌/项目范围；
- 合规、同意与隐私；
- 可逆性；
- 最终产物的关键目标。

低风险、可逆的偏好采用可见默认值，例如：“我会使用你最后批准的品牌套件；要改可以告诉我。”
多个相关缺口放在一张小 readiness card，不连续审问用户。

### 3.4 “compiler” 的决定

**不建独立 compiler service，也不额外调用一次 LLM 来先翻译用户。**

- 服务器用确定性代码解析身份、当前页面、已选对象、权限、pending approval。
- 同一个 Operator 在正常首个 model step 内理解口语、错字、rojak 和不完整目标。
- 简单任务直接做，不生成隐藏 plan。
- 复杂任务可以在同一轮形成一个短 **Task Frame**，或调用现有的 $0 proposal Skill，内容只有目标、范围、约束、关键未知与建议步骤。
- Skill 的 requires/preflight 是最后一道资讯门。

这样既保留模型的智能，也不为“先理解一次、再工作一次”重复付费。

---

## 4. 不能动的边界

### 4.1 LAW

1. 一个 app、一个 OTTO、一个动作层。
2. 新 OTTO 能力走 Skill seam，不造第二套 agent 产品。
3. identity 来自可信 session / job，不来自 model input。
4. 所有 owner-scoped 数据必须在服务端按 ownerId 验证。
5. 花钱，或 external write，至少需要宪法审批；更严格的 authority 可以追加，不能放宽。
6. 钱路 exactly-once、fail-closed、reserve/settle/refund 可对账。
7. UI 能做的业务能力，OTTO 必须通过同一 action authority 做；四类宪法豁免除外。
8. 结果必须从真实状态验证；不能让模型自己宣布“done”。
9. 效率是产品义务：冗余 token、多余步骤、重复 context 和没有价值的 LLM call 都是缺陷。
10. 用户不选择模型，不需要知道 Skill 名称。
11. 生产客户凭据、OAuth token、secret、跨租户资料永不进入 eval artifact。
12. 线上不能自动修改或生成新 Skill 后立即使用；改动必须 review + eval + promotion。

### 4.2 明确不建

- 第二个通用 chat agent；
- 常驻 Fable/frontier advisor；
- 每轮 critic/reflection LLM；
- 动态跨十家 provider router；
- 用户模型选择器；
- persona swarm；
- runtime 自修改 Skills；
- 把全部数据库、全部历史或全部 44 个 Skill 永久塞进每一步；
- 一个叫“thinking”的泛化 Skill；
- 用 CLI 自己执行 OTTO Skills 的第二套 harness；
- 用真实用户账户做无隔离的发布/发信/广告测试。

---

## 5. 当前代码地面真相

以下是 **OBSERVED**，防止后续施工照抄旧文件：

| 面 | 2026-07-13 当前事实 | 缺口 |
|---|---|---|
| Model | [model.ts](../../packages/otto/src/model.ts) 显式绑定 Anthropic Sonnet 4.6；同 family 4.5 只在结构化 529 时 fallback；prompt cache 已启用 | 没有把 model binding、billable model、usage mapping、cache 能力与 pricing 原子绑定的 runtime seam |
| Agent | [otto.ts](../../packages/otto/src/otto.ts) 是 module singleton | Simulator 无法只替换 model binding |
| Skills | [registry.ts](../../packages/otto/src/registry.ts) 当前 **44 项**，全部静态挂载（T289 复核：44 项实数成立） | 旧 B9 25-Skill 清单与 token 数已漂移，必须重测 |
| Skill gate | [skill.ts](../../packages/otto/src/skill.ts) 已有 cost/effect/reach、审批推导、identity-key 禁止、spend idempotency 声明、requires | Skill output 仍是 unknown；idempotency 声明本身不执行 |
| Context | [context.ts](../../packages/otto/src/context.ts) 每 run 重建可信 identity 与大量 ports | viewContext / Selection 与 bundle resolver 未落地；context bag 很大 |
| Human parity | 新一批管理/排期/媒体 Skills 已经通过 ports 调同一 owner-gated action | 仍需最终 parity 审计，不能只信字符串映射 |
| RunState | [run-input.ts](../../packages/otto/src/run-input.ts) 可安全拒绝损坏 state；图片和旧 system 被清理 | 没有 toolset/bundle version；尚无 pair-aware history compaction |
| Approval | web 侧已有 interruption、hash-time consent、TTL、CAS consume、resume | 必须加入 simulator 真实回放用例 |
| Worker verdict | 已经是 **无 tools + 单 step**，不是旧审计所说的 44/25 tools × 10 steps | 不应重复立项 |
| Failure | stream error 有 TURN_ERROR + reference；生成链有 specialized receipt | 没有统一 typed RunOutcome、capability gap 与安全恢复分类 |
| Simulator | generation MockProvider 只模拟媒体 provider；stream.test 只证明最小 Agent 可注入 ModelProvider | 没有真实 OTTO + CLI + Skills 的 production-mirror 测试场 |

### 5.1 B9 已冻结；输入数据需要重测

[B9 v0.9 文本](../superpowers/specs/2026-07-12-b9-engine-interface-freeze.md) 的标题仍保留其起草时的 “freeze candidate” 字样，但 Route B [B9 状态账](../ops/route-b/matrix/09-B9.md) 与 [D-026](../ops/route-b/DECISION-LOG.md) 已记录：冻结文本经 #260 落 main 后生效，相关行迁入 `spec-ready`。因此其 domains、viewContext、toolsetVersion、零命中全量、恢复轮全量和 live-event 规则都是 **FROZEN CONTRACT**。

仍需重测的是其旧输入：成员表与 token 落数以 25 项为基线，而当前 registry 是 44 项。主任务完成后，施工前必须：

1. 以最终 main 重数 Skills，重测每域 schema/instruction tokens；
2. 在已冻结的 `Domain[]`、确定性意图映射、零命中全量与恢复轮全量规则内给全部现存 Skill 归域；
3. 跑 V5/V6/V7 与 approval/resume 兼容测试；
4. 若 44 项现实无法满足冻结阈值或语义，停手提出 founder-only 正式修订，不能由本文件静默换协议。

---

## 6. 目标架构：一个 kernel，两种 model runtime

~~~mermaid
flowchart TD
    U["User / UI / Eval case"] --> H["Real HTTP/session or worker entry"]
    H --> A["Shared OTTO application runner + finalizer"]
    A --> C["Verified context resolver"]
    C --> B["Skill bundle resolver"]
    B --> R["@openai/agents Runner"]
    R --> M["Atomic model runtime manifest"]
    M -->|Production| API["API binding + billing/usage/cache"]
    M -->|Flight Simulator| CLI["Fixture / qualified subscription CLI / API canary"]
    R --> S["Selected OTTO Skills"]
    S --> P["Typed ports"]
    P --> X["Same owner-gated actions"]
    X --> E["DB / queue / providers"]
    E --> V["Deterministic verification + receipt"]
    V --> A
    R --> T["Sanitized trace + eval sink"]
    S --> T
    V --> T
~~~

### 6.1 只允许四类边缘差异

| 依赖 | Production | Flight Simulator |
|---|---|---|
| Model runtime manifest | API binding + billable model + usage/cache/pricing | fixture、通过资格测试的 subscription CLI，或 API canary；都声明不可计费/实际计费 manifest |
| Auth/data inputs | 真实 session/RBAC + tenant data | 同一 auth authority 签发的 test session + seeded test tenant |
| Provider edge | production adapter + production credentials | 同一 Action 下的 recording/sandbox/test adapter + test/private credentials |
| Trace sink | privacy-minimal production telemetry | detailed sanitized JSONL/terminal；图形 Flight Deck 后置 |

OTTO application runner/finalizer、Engine、Skill definitions、Action authority、approval、RunState、queue、ledger、verification 与 receipt 必须相同。只有经真实 authenticated HTTP/UI 入口跑的 case 才能声称覆盖 UI/session/CSRF/RBAC；直接调用 Runner 的 fixture case 只能声称 engine-level parity。

### 6.2 最小新增 seam

不是重写 runtime，只补 composition root：

~~~ts
type OttoRunProfile =
  | "interactive"
  | "approval-resume"
  | "worker-verdict"
  | "eval";

type OttoModelRuntime = {
  binding: ModelBinding;
  billableModelId: string | "fixture-no-charge";
  resolvedModelPolicy: ResolvedModelPolicy;
  mapUsage: UsageMapper;
  cacheCapabilities: CacheCapabilities;
  pricing: PricingLookup;
};

type OttoRuntimeDeps = {
  modelRuntime: OttoModelRuntime;
  skills: readonly OttoSkill[];
  traceSink: OttoTraceSink;
};

createOttoRuntime(deps, profile)
runOttoTurn(request, verifiedContext, runtime)
finalizeOttoTurn(result, runtime)
~~~

要求：

- production 继续显式绑定现有 API model；model、price lookup、usage mapper、cache 能力和 `withLlmBudget` 参数由同一个 runtime manifest 产出，不能各入口各拿一个常量；
- simulator 才允许 Runner 注入 CLI ModelProvider；
- runtime 只能在 **process composition/bootstrap** 时由 server-owned code 注入，并在进程生命周期内 immutable；production artifact 只含 production API runtime，simulator 用独立 test composition 启动；
- client header、cookie、query、请求 body 和普通可热改 env 都不能选择 `fixture-no-charge`/CLI runtime，也不能改变 billable model；否则就是免计费旁路；
- fresh、stream、approval-resume、worker-verdict 都通过同一 application runner/finalizer；profile 只限制 tools/steps，不复制计费、state 或 receipt 逻辑；
- worker-verdict profile 继续零 tools、一步；
- 不让 env 中一个拼错值悄悄把 production 切到 CLI；
- production build 对 CLI driver 做 import fence，避免订阅凭据进入服务镜像。

---

## 7. OTTO 每一轮的运行合同

### 7.1 输入

~~~ts
type OttoRunRequest = {
  runId: string;
  profile: OttoRunProfile;
  actor: VerifiedActor;
  workScope: VerifiedWorkScope;
  message: UserTurn;
  priorState?: OttoStateEnvelope;
  budget: RunBudget;
};
~~~

**VerifiedActor** 至少区分 tenantId 与真实 actorId。当前 context 把 userId 当 ownerId 的兼容事实不能成为未来多席位审计基础。

**VerifiedWorkScope** 只含服务端已确认属于当前 tenant 的 project、thread、view、selection、pending action 和 active job；客户端 ID 只是待验证线索。

### 7.2 输出：PROPOSAL typed outcome

~~~ts
type OttoRunOutcome =
  | { status: "verified_success"; receiptIds: string[] }
  | { status: "needs_input"; missing: BlockingInput[] }
  | { status: "needs_approval"; approvalIds: string[] }
  | { status: "unsupported_capability"; gapId: string; safeAlternative?: string }
  | { status: "policy_denied"; reasonCode: string; safeAlternative?: string }
  | { status: "transient_failure"; retryable: boolean; retryAfterMs?: number }
  | { status: "failed_safe"; impact: ImpactSummary }
  | { status: "may_have_applied"; reconciliationId: string; impact: ImpactSummary };
~~~

这不是要求马上建八张表。V1 可以先在 application service 与 trace artifact 中形成统一 envelope，再逐步让高风险 action 返回 typed receipt。

### 7.3 状态流

~~~mermaid
stateDiagram-v2
    [*] --> Preparing
    Preparing --> NeedsInput
    Preparing --> Running
    Running --> NeedsApproval
    NeedsApproval --> Running: approved
    NeedsApproval --> Stopped: denied / expired
    Running --> Verifying
    Verifying --> Done: verified
    Running --> Stopped: unsupported / policy denied / failed safe
    Verifying --> Reconciling: external result ambiguous
    Reconciling --> Done: applied / reversed verified
    Reconciling --> Stopped: still unknown
~~~

用户看到的是四态；内部 envelope 保留精确恢复语义。

---

## 8. Context：只给这次工作真正需要的东西

### 8.1 六层上下文

按顺序组装，后层不能扩大前层权限：

1. **Stable identity**：OTTO 的身份、语言、不可违反的 safety floor。
2. **Verified scope**：tenant、actor、页面、选择对象、work item、pending approval、active job。
3. **Relevant memory/evidence**：有来源、有 scope、有 freshness 的品牌/产品/绩效事实。
4. **Selected Skill bundle**：只附这次可能使用的 tool schemas 与 instruction fragments。
5. **Pair-safe recent history**：保留 tool_call/tool_result 配对；旧内容压成事实/决定/未完成动作，不保存图片 bytes。
6. **Current user turn**：用户文字和有上限的本轮附件。

永不默认注入：

- 全部历史；
- 全部 assets/DB rows；
- 未经 owner resolve 的 client IDs；
- 所有 44 个 Skill；
- provider secrets；
- 隐藏 chain-of-thought；
- 与当前 work scope 无关的其他 outlet、客户或员工私密内容。

### 8.2 Scoped loading 的推荐形状

实现路径必须服从已冻结 B9：

- fresh turn 按 `core ∪ viewContext.zone/确定性意图命中的 domains` 装载；
- view/work/pending approval 优先于关键词；
- tool 和对应 instructions 一起装载，不能出现“prompt 叫它用一个不存在的 tool”；
- tool 顺序稳定，利于 prompt cache；
- 意图零命中必须全量装载；
- approval、worker-resume 与任何 RunState 恢复轮必须全量装载，并执行冻结的 `toolsetVersion` 兼容预检；
- 每个域有 schema/instruction token report 与稳定 hash；
- `OTTO_SKILL_SCOPING=off` 保留为冻结的全量回滚开关。

### 8.3 44-Skill 重测不等于重开契约

44 项会使零命中/恢复轮变贵，但当前正确动作是先量真实发生率与成本，并改进确定性 view/意图命中率；不能把已冻结的 fail-open 安全规则降成普通优化选项。

`compact general bundle + typed scope expansion` 可以留作离线研究假设，但只有数据证明收益、V5/V6/V7 与弱模型可靠性过关，并完成 founder-only 正式修订后，才可能进入产品。V1 不实现它，也不建 mega dispatcher。

---

## 9. Skill 框架：专业能力冻在哪里

### 9.1 一个 Skill 应该拥有

1. 用户意图与适用范围；
2. 简洁、准确的模型描述；
3. strict typed input/output；
4. domains/bundle membership；
5. cost/effects/reach 的完整 effect set；
6. 必要 evidence / requires；
7. 它允许调用的 action ports；
8. approval / authority floor；
9. idempotency 和 external ambiguity 语义；
10. 成功后的 deterministic verification；
11. user-facing receipt mapping；
12. unit、tenant、approval、failure、trajectory eval。

### 9.2 Skill 不应该拥有

- tenantId、ownerId、userId model parameters；
- DB/client/provider secret；
- 独立的计费实现；
- UI 之外另一套业务逻辑；
- “相信模型会记得”的安全规则；
- 自己宣布成功；
- 自动改变自己的 prompt/代码；
- 一个无限范围的 execute-anything port。

### 9.3 Skill 与 Action 的关系

**Skill 是模型能理解的工作能力；Action 是系统真正的权威。**

UI 与 Skill 必须进入同一个 owner-gated Action。短期沿用当前 typed ports 即可，不需要先建庞大的 CapabilityRuntime 平台。

新代码规则：

~~~text
UI adapter ─┐
            ├──> same Action authority ──> DB / queue / provider ──> receipt
Skill port ─┘
~~~

若 parity 继续出现“字符串说相同、行为实际不同”，再把 ActionDefinition/ActionHandle 升成统一 factory。不要为了未来可能性一次迁完全城。

### 9.4 Skill 粒度

以下任一项变化就应拆开：

- 用户意图；
- evidence contract；
- authority/approval；
- cost policy；
- idempotency/receipt；
- external ambiguity。

同一用户工作、共享上述边界的多个底层 action 可以合成一个 Skill。不要“一 server action 一个 Skill”，也不要“一个 domain 一个万能 Skill”。

### 9.5 “thinking Skill”与专业 Decision Skill

**不建泛化 thinking Skill。** 思考是 Operator/model 的工作；把“请认真想”包装成 Skill 只会多一次调用。

可重复的专业判断应做成：

- versioned rubric 文件；
- pure deterministic function；
- prompt template / schema；
- 有来源的 evidence requirements；
- golden cases 与 outcome review。

例如广告诊断阈值、发布时段建议、prompt mastery 可以住在所属 Skill 内。只有当这类 policy 数量和校准需求真的变大，再建通用 DecisionPolicy registry / database；V1 不先造平台。

### 9.6 Skill 生命周期

~~~text
真实失败/新需求
  → capability gap / eval case
  → 人类 triage 根因
  → Skill / action / context / provider 修正
  → replay + trajectory eval
  → independent review
  → shadow / staging-live
  → promotion
~~~

不允许 gap 直接触发线上自写 Skill。

---

## 10. Action、审批、验证与 Receipt

### 10.1 Action authority 必须负责

- verified actor 与 tenant scope；
- strict validation；
- 实时权限和 kill switch；
- server-side quote；
- approval grant 的 scope/expiry/单次 consume；
- idempotency key claim + DB backstop；
- execution；
- external result reconciliation；
- receipt。

模型只选择“想做什么”和提供非身份业务输入。价格、owner、权限、审批状态和 idempotency 不能由模型决定。

### 10.2 Approval floor

现行公式原样保留：

~~~text
needsApproval =
  (cost = spend)
  OR (effect = write AND reach = external)
~~~

RBAC、tenant scope、kill switch、不可逆限制和其他 authority/policy 是**独立 gate**：即使用户已批准，它们仍可拒绝执行；但不能各自改写 `needsApproval` 数学，也不能把宪法要求批准的动作放行。

未来 routine 的预授权是“审批发生在 routine 创建时”的独立可检查 envelope：动作类别、对象范围、渠道/受众、预算上限、期限、排除项、kill switch 与事后摘要。它不是“永远相信 OTTO”。

### 10.3 Verification

每种 action 明确自己的验证器：

| Action 类别 | 验证来源 |
|---|---|
| internal DB write | owner-scoped reread + expected state/version |
| queued job | durable job state + ledger finalizer |
| external read | provider response schema + freshness/source |
| external write | provider id + follow-up GET/reconcile |
| media generation | provider result + stored bytes/hash + job/ledger terminal state |
| may-have-applied | 停止重试，进入 reconciliation |

不要用第二个 LLM 当通用 verifier。LLM 可以评审主观创意质量，但不能替代“是否发布、是否扣款、是否写入”的确定性证明。

### 10.4 统一 receipt 视图

V1 不一定新建通用表，但所有 meaningful action 最终要能投影成：

~~~ts
type ActionReceipt = {
  receiptId: string;
  actionId: string;
  actorId: string;
  tenantId: string;
  intended: Json;
  authorizedBy?: string;
  actual: Json;
  verification: "verified" | "not_applied" | "may_have_applied";
  credits: { reserved: number; settled: number; refunded: number };
  externalCost?: Json; // 仅市政厅/admin；永不直接序列化给用户
  evidenceRefs: string[];
  correlationId: string;
  completedAt: string;
};
~~~

用户答案必须根据 receipt 说话，不根据模型“记得自己调用过 tool”说话。

Receipt 必须分成两个 projection：

- **用户面**：spend 只显示 credits；money-in 显示当地法币；第三方通道费透明但走独立账道，不能混进 credits；永不显示美元 COGS、margin 或原始 `externalCost`；
- **市政厅/admin 面**：可看美元成本、margin、provider usage 与 channel-fee reconciliation。

同一个内部 receipt 可以供两面投影，但 API serializer 必须用字段白名单，不能把 admin-only costing object 原样返回用户。

---

## 11. 失败要变成产品学习，不变成 frontier 烧钱

### 11.1 Typed failure

| 内部状态 | 默认恢复 | 用户必须知道 |
|---|---|---|
| needs_input | 只问一个阻断决定 | 缺什么、为什么 |
| needs_approval | 停在 gate | 精确动作、范围、价格/外部影响 |
| unsupported_capability | 不自动换强模型 | 目前办不到、什么没做、安全替代 |
| policy_denied | 不重试 | 哪条边界挡住、可行替代 |
| transient_failure | 只读、确认未应用时最多自动重试一次 | 若仍失败，诚实停止 |
| failed_safe | 不盲目循环 | 没做成；钱/数据/外部状态 |
| may_have_applied | **绝不重放写动作**；先 reconcile | 可能已发生、当前未知、正在/需要怎么确认 |
| verified_success | 结束 | receipt + 下一项真正有价值的选择 |

### 11.2 Capability gap 回后台

这是用户提出的方向，推荐采用。OTTO 不会为了掩盖能力缺口临时叫 frontier model；它会诚实停止，并给开发后台一个 privacy-safe 事件。

~~~ts
type CapabilityGapEventV1 = {
  type: "otto.capability_gap";
  gapId: string;
  occurredAt: string;
  taskClass: string;
  zone: string;
  requestedCapabilityCode: string;
  failureStage: "understand" | "scope" | "skill" | "action" | "provider" | "verify";
  bundleHash: string;
  registryHash: string;
  modelManifest: string;
  safeAlternativeOffered: boolean;
  userImpact: "none" | "blocked" | "partial";
  moneyImpact: "none" | "reserved_refunded" | "settled" | "unknown";
  externalImpact: "none" | "not_applied" | "may_have_applied";
  correlationId: string;
  customerContentIncluded: false;
};
~~~

默认不上传：

- raw prompt / transcript；
- 品牌、产品、客户、图片或 URL 内容；
- tool args/results；
- provider payload；
- secrets、stack、signed URLs；
- hidden reasoning。

后台按 fingerprint 聚合次数、受影响任务、Skill/bundle/model version 和钱/外部影响。开发者先判断根因是：

1. 没有 Skill；
2. Skill 没被装载；
3. context 不够；
4. action/provider 缺能力；
5. model 选错 tool；
6. verification 失败；
7. 用户真实需求不属于产品。

需要全文时，另走明确 support-case opt-in 与脱敏流程，不能让“帮助我们改进”成为默认上传客户资料的借口。

---

## 12. Model 策略：一个生产家族，其他只来比赛

### 12.1 Production V1

- 宪法硬线：production Operator 必须是 **cost-efficient、sonnet 级**；Fable/Opus/frontier 只能帮助离线诊断、Skill authoring 或评测，不能成为日常运行前提。
- 同一时刻只启用 **一个 provider family + 一个主 Operator model**。
- 允许同 family、同价阶的 capacity fallback；当前 529 sibling fallback 属此类。
- 不做跨厂实时 router。
- 不让模型自行决定“这题要不要升级到更贵模型”。
- 用户看不到模型选择器。
- 若未来同 family 有 fast/deep 两档，也必须由确定性 task class + eval gate 选择，不按心情。

这样可以保持：

- tool semantics 一致；
- prompt/cache 稳定；
- usage/cost 可算；
- failure policy 简单；
- RunState/approval 可恢复；
- 支持团队容易排障。

### 12.2 Offline challengers

其他 provider 只进入冻结 Flight Simulator：

- 同一 cases；
- 同一 system/Skill/tool schema hash；
- 同一 context；
- 同一 step/output/retry budget；
- 同一 action fixtures；
- 同一 grader 与人工盲评。

每轮只比较：

1. incumbent；
2. 一个 challenger。

不需要同时维护四五个生产模型。生产候选池可以有 Anthropic、OpenAI、Google 或其他 family 的 **cost-efficient tier**，但一次只推进一个，先用 10-case smoke screen，再让胜者跑完整 20–50 cases。更贵 frontier 可以作离线诊断上界；即使它赢了，也只能说明 harness/Skill 仍有可学习空间，不能因此直接晋级 production。

### 12.3 Public research 能做什么

公开 benchmark 只负责缩短候选名单，不能替 OTTO 决策。OTTO 的真正问题包括：

- 华语/English/Bahasa/rojak；
- 模糊商家目标；
- 44+ tool selection；
- approval interruption；
- owner scope；
- exact-once；
- 生成/排期/广告/研究跨域；
- 诚实失败；
- token 成本。

没有一个通用 benchmark 同时覆盖这些。

### 12.4 对 X 上两种策略的裁决

[ClaudeDevs thread](https://x.com/ClaudeDevs/status/2074606058128224365) 提出：

1. 便宜 executor 偶尔调用 Fable advisor；
2. Fable orchestrator 把 token-heavy 工作交给便宜 workers。

供应商报告分别来自不同 benchmark：advisor 是 SWE-bench Pro，orchestrator 是 BrowseComp，不能把两个百分比直接当作 OTTO 的通用成本规律。

| 策略 | 对 OTTO 的天然适配 | 本设计 |
|---|---|---|
| Strong advisor | 可能帮助少数高难判断，但会多一次模型费、传更多 context、增加延迟；多数失败其实是缺 Skill/context/action | **V1 不建。** 强模型用于离线 Skill authoring、失败分析和 eval；只有真实 failure cohort 证明 uplift 后才试稀疏 advisor |
| Frontier orchestrator + workers | 适合可并行的大型浏览/研究；OTTO 日常动作通常短、需共享审批/状态/receipt，多 agent 会扩大权限、重复 context | **V1 不进 runtime。** 开发研究可用；未来深度研究任务若 eval 证明收益，再做 bounded worker profile |

### 12.5 什么时候才允许试 runtime advisor

必须同时满足：

1. 一个稳定 task class 在普通 Operator + 正确 Skill 下仍反复失败；
2. 失败不是 context、action、provider 或验证器缺口；
3. 同一 frozen case 上，强 advisor 明显提升 verified success；
4. 增加的成本与 p95 latency 可接受；
5. 只传任务所需的最小 context；
6. 一次最多 consult 一次；
7. advisor 无 action authority，只能给建议；
8. 用户成本/credits 口径透明；
9. API canary 通过。

没有这些证据，advisor 的正确状态就是 **不存在**。

---

## 13. Token 与成本优化

优化目标不是“最少 token”，而是：

> **每个 verified successful outcome 的总成本最低，同时安全与质量不退步。**

### 13.1 优化顺序

1. 删除没有价值的 LLM call；
2. deterministic code / Skill 代替重复推理；
3. 只装相关 Skills + instructions；
4. prompt cache；
5. pair-safe history compaction；
6. 限制附件与 evidence；
7. 模型 concise output；
8. 低风险 transient 最多一次 retry；
9. 只有 eval 证明后才换便宜模型；
10. 最后才考虑 multi-model。

### 13.2 每 run 必量的指标

- input / cached input / output / reasoning tokens；
- tool schema 与 instructions token；
- model steps；
- tool calls；
- external reads/writes；
- retries；
- wall time 与 p50/p95；
- platform COGS；
- user credits reserved/settled/refunded；
- verified success；
- questions asked；
- approval count；
- capability gap；
- false-success / may-have-applied；
- cost per verified success。

### 13.3 初始 RunBudget

V1 继续保留全局硬上限，不先设计几十个动态套餐；新增的只是 profile 级清晰预算：

| Profile | 原则 |
|---|---|
| interactive | 当前硬 step/output cap；能早停就早停 |
| approval-resume | pin 原 action/tool；不做重新规划 |
| worker-verdict | 现有零 tools、一步 |
| eval | 与被测 production profile 完全同 budget |
| fixture/replay | 不允许网络和外部效果 |

真实数据稳定后，才考虑每 bundle 的更低 soft cap。

### 13.4 不能为了省 token 牺牲

- tenant resolve；
- approval；
- receipt；
- external reconcile；
- tool_call/tool_result 配对；
- RunState compatibility；
- 对用户诚实说明失败；
- 关键 evidence。

安全优先于效率；效率优先于漂亮但无价值的语言。

---

## 14. Flight Simulator：同一飞机，不同发动机连接

### 14.1 它要证明什么

1. 模糊用户输入能否被理解；
2. 是否加载正确 Skills；
3. 是否选对 tool、参数和顺序；
4. 审批有没有在正确位置停；
5. resume 后是否只执行被批准动作；
6. action 是否走同一 owner-gated authority；
7. duplicate/retry 是否 exactly-once；
8. provider 失败是否诚实；
9. external ambiguity 是否停止盲重试；
10. receipt 是否与 DB/provider/ledger 对上；
11. token、步骤、延迟与成本；
12. model/Skill/context 改动有没有回归。

### 14.2 不说单一“100%”，逐层证明 parity

“像 prod”必须拆成可验证矩阵，不能用一个 100% 口号覆盖不同入口：

| 层 | 要求 | 可以声称什么 |
|---|---|---|
| source/build | 同一 source SHA；production 代码不 import CLI driver | code parity；不是同一完整 artifact |
| OTTO application | fresh、stream、approval-resume、worker-verdict 汇入同一 runner/finalizer | application-path parity |
| model | fixture/CLI/API 都经同一 `OttoModelRuntime` 合同 | contract parity；CLI/API 语义不等价 |
| auth/UI/HTTP | end-to-end case 经真实 authenticated endpoint、test session、CSRF/RBAC；direct Runner case 不算 | 只有 E2E case 可称 entry-path parity |
| DB/queue/ledger | 同 schema/migrations/transaction/idempotency，数据在 disposable stack | software-path parity；数据/拓扑非 production |
| Action | 同 owner-gated Action/approval/verification/receipt；只换最底层 provider adapter | authority-path parity |
| provider | recording、sandbox、test/private live、production canary 分开 | adapter contract 或 live certification，不是环境等价 |

因此目标不是“整个 simulator 100% 等于 production”，而是：**每个关键层都有明确 parity claim、证据与已登记差异。** 至少仍会有 CLI/API semantics、subscription quota、test tenant、private destination、网络延迟和进程生命周期差异。

所以每次 run 必须保存 **Delta Manifest**，没有登记的差异即测试失败：

~~~json
{
  "entryPoint": "engine-direct|authenticated-http-journey|worker",
  "parityClaims": ["application-path", "authority-path"],
  "modelRuntime": "fixture|qualified-codex-cli|production-api",
  "auth": "same-authority-test-session",
  "data": "synthetic-seeded-tenant",
  "providerMode": "replay|sandbox|staging-live",
  "destinations": "private-test-only",
  "productionApiCanary": false
}
~~~

### 14.3 四个 side-effect modes

| Mode | Model | Actions/providers | 用途 |
|---|---|---|---|
| **replay** | fixture 或 CLI | 同一 Action 运行到底；只有最底层 provider adapter 回放 recordings；DB disposable | 每次改动、最快、$0 |
| **sandbox** | fixture、qualified CLI 或 API | 官方 sandbox/test account；禁止真钱/公开效果 | connector、审批、错误路径 |
| **staging-live** | CLI 或 API | 同一真实 provider adapter + 隔离测试凭据/私密目的地 | 证明 Skill 真的能完成外部动作 |
| **api-canary** | production API | staging-live 的极小代表 case | 关闭 CLI/API 语义差距，晋级前必跑 |

内部 DB/queue/ledger 在四种 mode 都应是真实的 disposable/test stack，不要 mock 成函数返回值。Replay 不能替换 Skill port 或 Action authority，否则会变成第二条动作路。

至少保留两种 case 入口：

- **engine case**：直接调用 shared application runner，快，但不声称覆盖 HTTP/auth/UI；
- **journey case**：通过真实 authenticated endpoint 和 test session 跑，覆盖 session、tenant、RBAC、CSRF、stream/finalizer、approval/resume 与 UI refresh。

### 14.4 CLI driver 的硬合同

CLI 只能扮演 **model**，不能扮演第二个 agent。

每个 model step：

1. OTTO Runner 产生标准 model request；
2. CLI driver 在隔离目录启动官方 CLI；
3. 只传 system、history、当前可见 tool schemas 与预算；
4. CLI 必须只返回 schema-valid 的 assistant message 或 tool call；
5. OTTO Runner 执行 tool；
6. tool result 回到下一 model step；
7. CLI 绝不能直接访问 OTTO DB、Skills、MCP、shell、网络 provider 或生产凭据。

Driver 资格测试：

- 能禁用自身 Skills/plugins/MCP/project rules；
- 能在无交互模式输出 JSON/JSONL；
- 能按 schema 输出一次 model decision；
- 不会自己执行 tool；
- 能报告 requested/resolved model、usage、latency 与 exit status；
- malformed/timeout/partial stream 会 fail closed；
- 不把本机个人 memory 混进 case；
- 同一 frozen case 可重复运行；
- tool call 可无损映射成 Agents SDK ModelResponse；
- vision、streaming、parallel tool calls 等不支持能力会在 manifest 明示。

若某 CLI 做不到，它只能当 **benchmark proxy**，不能叫 production-mirror ModelDriver。

### 14.5 目前各 subscription CLI 的边界（2026-07-13）

| CLI | 能做的 | 不能假设的 |
|---|---|---|
| **Codex CLI** | 官方支持 ChatGPT 登录用于本地工作；codex exec 有 JSONL、output schema、ephemeral/isolated 选项；trusted runner 有 advanced account-auth 路径 | subscription run 不等于 OTTO API；自动化官方仍以 API key 为默认；不能把 auth.json 放进普通云服务 |
| **Claude Code** | 官方支持 headless / structured output | OAuth 是 native/ordinary use；Anthropic 明确禁止第三方产品替用户转发 Pro/Max 凭据，因此不能做产品 backend 或共享云 gateway |
| **Gemini CLI** | headless JSON/JSONL 有 tool_use/tool_result events | Google 明确禁止第三方软件 piggyback Gemini CLI OAuth；未获得明确许可前，不做 subscription adapter，只可独立手动 benchmark 或用 API |

初始推荐：先做一个 **无副作用的 Codex CLI qualification spike**，不是先承诺完整 driver。只有它通过 14.4 全部资格测试，才晋级为 local ModelDriver；失败时它只是 benchmark proxy，Simulator V1 仍由 fixture ModelProvider + 小额 API canary 完成。Claude/Gemini 不因为“也有 CLI”就同时集成。每家条款、quota 与 auth 都是 volatile facts，动工当天再查官方文档。

### 14.6 Local-first 与 cloud-best

#### Phase A：Local Flight Simulator（先做）

- 本地运行与 production 相同的 web/worker；
- Docker disposable Postgres；
- test queue；
- 由同一 auth authority 签发的 test session + synthetic tenant；
- fixture ModelProvider；通过资格测试后才接 official subscription CLI；
- external providers 默认 replay/sandbox；
- 所有 artifacts 留本地。

这是最快、最便宜、最不容易泄漏个人 OAuth 的版本。

#### Phase B：Hybrid cloud（local 稳定后可选）

~~~mermaid
flowchart LR
    CS["Cloud isolated staging: web + worker + DB + queue"] --> Q["Encrypted model request queue"]
    Q --> LB["Local outbound-only CLI bridge"]
    LB --> CL["Official subscription CLI"]
    CL --> LB
    LB --> Q
    CS --> FD["Artifact sink / later Flight Deck"]
~~~

- cloud 里仍运行 production-like stack；
- subscription credential 永远留在本机；
- local bridge 只 outbound 连接，短期 lease、mTLS/session token；
- 只允许 synthetic/staging data；
- bridge 断线时 run 明确失败，不 fallback 到付费 API；
- 不让 cloud 保存 CLI OAuth；
- 只在 Phase A 证明价值后建，避免先为“云端更像”增加一套分布式故障面。

#### 不推荐

把个人 subscription OAuth/token 直接装在 Railway 或一个长期共享 cloud worker，然后让整个团队/产品请求它。这在安全、条款、quota 和可恢复性上都不合格。

### 14.7 真 provider 测试

用户要求 Skill 真正可用，合理。正确做法不是全 mock，也不是拿 production 客户试。

| 类别 | 真测试方法 |
|---|---|
| internal read/write | disposable DB + 两 tenant isolation |
| queue/worker | 真实 queue、kill/restart/redelivery |
| generation | staging-live test project；真实调用前逐笔 founder 批准 |
| social publish | 私密测试 page/account、不可见/可删除测试内容、明确批准 |
| email/message | sink/test inbox 或自有测试号码；永不发真实客户 |
| ads | sandbox/paused draft/test account；不启动真实预算 |
| payments | Stripe test mode；prod live card 只由 founder 单独 canary |
| external reads | test key/rate limit；保存来源与响应 schema，不存 secret |

“Skill 100% works”最后由三件事共同证明：

1. contract/replay 不回归；
2. staging-live 真 adapter 成功；
3. production API 小 canary 没有语义差异。

外部平台会变化，所以这是可重复的 certification，不是一次后永远 100% 的口号。

---

## 15. Trace、实时 Flight Deck 与资料保留

### 15.1 每个 run 的 artifact

~~~text
artifacts/otto-flight/<run-id>/
  manifest.json
  events.jsonl
  result.json
  score.json
  db-diff.json
  receipts/
  screenshots/
  outputs/
~~~

**manifest.json** 至少保存：

- source SHA/build digest；
- case/version/seed；
- CLI/harness version与 auth kind，不含 token；
- requested/resolved model；
- system/Skill/tool schema/bundle hash；
- context fixture hash；
- RunBudget；
- provider mode 与 Delta Manifest；
- started/completed time。

**events.jsonl** 保存：

- run start/end；
- model request/response metadata；
- assistant text；
- tool proposed；
- approval required/granted/denied；
- Skill/action start/end；
- provider call metadata；
- verification；
- receipt；
- failure/retry/reconcile；
- token、latency、cost。

不保存 hidden chain-of-thought。对 synthetic cases 可保存完整 model-visible content；真实 incident 默认只保存 hash/typed metadata，全文需 opt-in。

### 15.2 Flight Deck

V1 只需要 JSONL + read-only terminal tail；不先建 page、warehouse 或新的 observability 产品。以下视图先在 terminal 呈现，证明高频使用后再升级为图形 Flight Deck：

- 当前 step 与 elapsed time；
- model/tool/Skill；
- tool args 的安全字段；
- approval；
- DB/action/receipt diff；
- tokens/cost/latency；
- status/failure；
- case assertion；
- compare incumbent vs challenger。

它消费同一个 JSONL trace sink，不改变 OTTO runtime。

### 15.3 保留原则

永远保留：

- manifest、hash、score、typed outcome、receipt references；
- regression case 与人工裁决；
- capability gap fingerprint。

按政策限期保留：

- synthetic full trace；
- generated test assets；
- screenshots；
- raw provider response。

永不写入 artifact：

- secrets/OAuth/private keys；
- production customer raw content（除明确 support-case opt-in）；
- signed URLs；
- cross-tenant data；
- hidden reasoning。

---

## 16. Eval：怎么知道框架真的更聪明、更省

### 16.1 初版数据集

先建 **20–50 cases**，不是一上来几千条：

- 50% 常见任务；
- 25% edge cases；
- 25% adversarial / approval / tenant / failure。

覆盖：

- English、华语、Bahasa、rojak；
- 极短 normie 指令；
- 错字、模糊代词、“帮我弄好”；
- create/media/brand/schedule/research/ads；
- unsupported capability；
- low balance；
- duplicate click/redelivery；
- approval expiry/deny；
- RunState serialize/restore；
- cross-tenant forged ID；
- provider 429/5xx/timeout；
- charged failure；
- may-have-applied；
- stale UI/context；
- prompt injection in web/provider content。

### 16.2 六层测试

| 层 | 证明 |
|---|---|
| unit/property | Skill schema、gate、policy/rubric、receipt mapping |
| action integration | 同一 UI/Skill action、tenant、idempotency、DB transaction |
| trajectory replay | tool choice/order/args、failure path、no network |
| CLI Flight | model + real Runner + real Skills |
| staging mock/live | UI、web、worker、queue、provider、refresh/resume |
| production API canary | CLI/API/tool semantics 最后差距 |

### 16.3 Hard gates

以下任何一项不是平均分，而是 **零容忍**：

- cross-tenant read/write；
- 未批准 spend/external write；
- duplicate charge/action；
- money ledger 不平；
- 真实失败却说 done；
- may-have-applied 盲重试；
- secret/客户数据进 trace；
- unsupported 却虚构已完成；
- CLI 自己执行 Skill；
- simulator 有未登记 production delta。

### 16.4 Quality 与 efficiency score

每个 case 同时打：

- verified task success；
- tool selection；
- instruction/brand/evidence correctness；
- first useful result；
- unnecessary question；
- approval correctness；
- failure honesty；
- recovery；
- user-facing clarity；
- model steps；
- tokens/cache；
- latency；
- provider calls；
- cost per verified success。

主观质量用 blind pairwise；自动 grader 必须用人工样本校准。不要只问另一个模型“你觉得好吗”。

### 16.5 Model promotion

1. frozen suite；
2. incumbent 与一个 challenger 各跑；
3. hard gates 全过；
4. 关键非确定 case 重复三次；
5. blind pairwise；
6. trace diagnosis；
7. production 候选必须先证明属于 cost-efficient、sonnet 级；frontier 结果只作诊断上界；
8. costing 证明所有收费点毛利仍 ≥45%，且不会把更高 COGS 静默转成更多 user credits；任何重新定价另走 founder/costing 流程；
9. 若 challenger 的 verified success 有实质提升且单位成功成本不明显恶化，或 cost/latency 明显下降且质量不退，才进入 API canary；
10. founder 批准小额真实花费；
11. 5–10 个代表 case 用精确 production model ID/payload/cache 跑；
12. staging-live；
13. 才允许成为唯一 production family。

建议初始晋级阈值（PROPOSAL，不是宪法）：

- 安全 hard gate 0 次违反；
- production tier 必须 cost-efficient；全部收费路径 costing 毛利 ≥45%；用户 credits 口径不因换模型静默恶化；
- 质量路线：verified success 至少 +5 percentage points，且 cost per verified success 不明显恶化；或效率路线：cost per verified success 至少下降 20%，质量关键项不下降超过 2 points；
- 质量关键项不下降超过 2 points；
- p95 latency 在用户合同内；
- 三次重复没有新增高风险不稳定。

### 16.6 Skill 改进评测

每次 Skill/context/harness 改动必须做 A/B：

- model 不变；
- case 不变；
- budget 不变；
- compare Skill old/new 或 Skill on/off；
- 同时看触发准确率、结果质量与 token；
- 新 production failure 加进 regression set。

这比“换更聪明的模型再试一次”更容易形成 OTTO 自己的长期 moat。

---

## 17. 施工顺序：等主任务结束后直接开建

### Phase 0 — Rebaseline，不写功能

1. 以最终 main 新 worktree 复核法律与 B9 状态；
2. 重数 Skills、重测 schema/instruction tokens；
3. 找出与本文件重叠/冲突；
4. 输出一页 reconciliation；
5. founder 批后才动工。

**Done：** 没有 25-vs-44、spec 标题-vs-状态账、旧代码行号混淆；B9 按已冻结契约处理。

### Phase 1 — Behavior-preserving composition seam

1. 列出 fresh non-stream、stream、approval-resume、worker-verdict 全部入口与现有 finalization；
2. 抽 shared application runner/finalizer；所有入口只传 profile，不各写一套 run/meter/state/receipt；
3. 抽 `OttoModelRuntime`，把 binding、billable model、usage mapper、cache、pricing 与 `withLlmBudget` 原子绑定；
4. production 仍使用现有 Anthropic model 与现行价格/usage；
5. 现有 singleton 变成 factory 的 production instance；
6. production build 禁 CLI imports。

**Done：** 四入口 contract matrix 全绿；行为不变；每个 paid 入口的 reserve→run→usage→settle/refund 都使用同一 runtime manifest；fake provider 可经 shared runner 执行安全 Skill。

### Phase 2 — Local Flight Simulator V1

1. tools/otto-flight；
2. 同一 auth authority 的 test session + synthetic seed tenant；
3. disposable DB/queue；
4. 同一 Action authority 下的 recording provider adapters，不替换 ports/actions；
5. JSONL trace/artifact；
6. fixture ModelProvider；
7. engine case + authenticated journey case；
8. approval/RunState replay；
9. 20-case seed suite；
10. 单独跑 Codex CLI qualification spike；通过才接入，不作为 V1 成败前提。

**Done：** 一条完整 authenticated 旅程 user → real endpoint → shared runner → fixture model → real Skill → real test Action → verification/receipt 可回放；若 CLI 通过资格测试，再证明同旅程可只替换 model runtime 重跑。

### Phase 3 — Outcome/failure/gap contract

1. typed RunOutcome envelope；
2. bounded retry matrix；
3. unsupported UX；
4. privacy-safe capability gap；
5. JSONL/terminal grouping；不先建 Flight Deck UI。

**Done：** 所有 failure case 都能回答：什么没做、钱怎样、外部状态怎样、下一步是什么。

### Phase 4 — Scoped Skills 与 state compatibility

1. 按已冻结 B9 为全部当前 Skills 归入 `Domain[]`；
2. scoped instructions；
3. token report；
4. 冻结定义的 `toolsetVersion`；
5. 零命中全量、approval/resume 全量与 V5/V6/V7；
6. `OTTO_SKILL_SCOPING=off` escape hatch；
7. compare current all-tools vs B9 scoped-loading eval；不试验性改写冻结 fallback。

**Done：** 成本/工具误选下降，安全与 task success 不退。

### Phase 5 — Real integration certification

1. sandbox/test accounts；
2. staging mock 全旅程；
3. founder 逐笔批准 staging-live paid calls；
4. private external writes；
5. restart/redelivery/reconcile drills；
6. 30–50 case suite；
7. 按 effect 分类认证，而不是强迫每个 Skill 都调用外部 provider。

**Done：** 每个首发 Skill 都有适合其 effect 的证据：pure proposal/prompt Skill 过 golden + trajectory；internal read/write Skill 过真实 Action + disposable DB/tenant integration；provider/external/spend Skill 才要求 sandbox/staging-live adapter + failure/reconciliation receipt。

### Phase 6 — Model selection

1. incumbent 先过完整 OTTO baseline；
2. 只有明确质量/成本假设时才选一个 cost-efficient challenger；
3. blind eval；
4. trace diagnosis；
5. production API canary（需 founder 花费批准）；
6. costing/margin/credits gate；
7. 选一个 production family。

**Done：** 模型选择来自 OTTO 数据且仍满足 cost-efficient/≥45% margin；若 incumbent 已过门，challenger 不阻塞首发。

### Phase 7 — Release certification

1. 同 build digest 进 isolated staging；
2. UI/mobile/refresh/resume；
3. tenant/money/idempotency；
4. alarms/rollback；
5. known Delta Manifest 清零到 production-allowed；
6. founder final UAT；
7. 走正常 PR/CI/manual deploy。

**Done：** 可以上线；不是“文件写好即上线”。

---

## 18. Launch gates

| Gate | 必须证明 |
|---|---|
| Product | normie 一句话能获得首个可见有用结果；不需选 model/Skill |
| Scope | view/selection/server facts 都 owner-resolved |
| Parity | UI 与 OTTO 走同一 action authority |
| Approval | spend/external write/高风险 authority 全 fail-closed |
| Money | exactly-once；reserve/settle/refund 对账 |
| Recovery | duplicate、restart、timeout、approval resume 全通过 |
| External | may-have-applied 不盲重试；有 reconcile |
| Honesty | 没验证不能说 done；unsupported 说清楚 |
| Model | cost-efficient tier + frozen eval + 必要时 production API canary |
| Efficiency | 44+ Skill 新 token 基线；cost per verified success 可见 |
| Economics | model runtime 与 billing manifest 原子一致；所有收费点毛利 ≥45%；不靠浪费或静默加 credits 补成本 |
| Privacy | trace/capability gap 无 secret/raw customer data |
| Staging | mock + staging-live + failure drills |
| Release | CI green、immutable candidate、rollback/alarms、manual deployment |

---

## 19. V1、Later、Never

### V1 必须

- 一个 Operator；
- 一个 cost-efficient production model family；
- shared application runner/finalizer 覆盖四类现有入口；
- model binding/billing/usage/cache/pricing 原子 runtime manifest；
- Skill/action/approval/verification；
- 已冻结 B9 的 scoped context、domains、零命中/恢复与 `toolsetVersion`；
- 最小 typed outcome/failure + metadata-only capability gap；
- prompt caching；
- JSONL trace；
- 20-case seed eval，首发认证前扩到 30–50 个关键 cases；
- fixture/replay local Flight Simulator，含 engine + authenticated journey；
- Codex CLI qualification spike；若全过则接成条件式 local driver，若不过就明确降为 benchmark proxy；
- 首发 Skill inventory 按 effect 分类认证；只有 provider/external/spend Skills 要求 sandbox/staging-live；
- 凡用 CLI 比较/换 model，必须有 production API canary。

### Later，只有证据触发

- hybrid cloud local CLI bridge；
- Flight Deck 图形 UI；
- 其他 subscription CLI families；
- pair-safe 长历史 compaction（先由 trace 证明需要）；
- fast/deep 同家族两档；
- 跨家 model tournament（incumbent 过门时不阻塞首发）；
- runtime advisor；
- bounded research workers；
- generic policy registry；
- centralized trace warehouse；
- automatic model router。

### Never / 本产品边界

- 外部 agent 直接操作 FIKIRTIVE；
- 用户自装 Skills；
- user model picker；
- 默默上传客户 transcript；
- 线上自修改 Skill；
- 用人格/mascot 掩盖未知结果；
- unlimited agent usage；
- 用更强模型替代缺失 Skill；
- 第二套 simulator harness。

---

## 20. 本草案的推荐默认值

若 founder 暂时不另拍板，动工 planning 可先采用以下 **推荐，不是授权**：

1. local-first，hybrid cloud later；
2. 第一个 subscription 实验只做 Codex CLI qualification spike；通过后才叫 adapter；
3. 初版 20 cases，真实失败驱动扩到 30–50；
4. production 同一时刻一个 cost-efficient model family；
5. 不建 runtime advisor；
6. 不建 multi-agent；
7. capability gap 默认 metadata-only；
8. real external tests 只去 isolated test/private destinations；
9. paid test 每笔仍先问 founder；
10. main 完成后先 rebaseline，再写代码。

需要 founder 以后决定的只有：

- 是否值得建 hybrid cloud bridge；
- 第一个 full challenger family；
- synthetic full-trace 的保留期；
- staging-live 各 provider 的总测试预算；
- 真实外部写测试账户与目的地。

这些决定不阻塞现在把框架写清楚。

---

## 21. 证据与外部资料

### Repo

- [FIKIRTIVE constitution](../BLUEPRINT.md)
- [Founder verdicts](../research/GRILL-VERDICTS-2026-07-03.md)
- [Expansion seams](../review/EXPANSION-SEAMS.md)
- [Reviewer playbook](../review/REVIEWER-PLAYBOOK.md)
- [Original Skill framework](../superpowers/specs/2026-06-26-otto-skill-framework-design.md)
- [Engine caching/scoped-loading design](../superpowers/specs/2026-07-07-otto-engine-caching-scoped-loading-design.md)
- [B9 frozen contract text（文件标题仍保留历史 candidate 字样）](../superpowers/specs/2026-07-12-b9-engine-interface-freeze.md)
- [One Otto experience contract](../superpowers/specs/2026-06-26-otto-ideal-experience-design.md)
- [Sol R4 optimization audit](../strategy/SOL-R4-OPTIMIZE-2026-07-10.md)
- [Staging runbook](../runbooks/staging.md)

### Official / current as checked 2026-07-13

- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- [OpenAI agent eval workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Anthropic headless/programmatic Claude Code](https://code.claude.com/docs/en/headless)
- [Anthropic Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Gemini CLI headless mode](https://geminicli.com/docs/cli/headless/)
- [Gemini CLI terms/privacy](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)
- [ClaudeDevs advisor/orchestrator thread](https://x.com/ClaudeDevs/status/2074606058128224365)

---

## 22. 给未来主任务的最小 handoff

本文件已由 global control plane 于 2026-07-14 收编为正式设计输入（wayfinder #287、票 #289/#300），本节历史使命完成，保留原文于档案库副本。
