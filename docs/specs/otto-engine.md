# Otto 引擎 规格书（S1）

> 状态: 已冻结 · v1
> 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1099 Founder 评论「S1 批准 otto-engine.md」(2026-08-29)
> 规格前缀: ENGINE（验收编号 = ENGINE-A1、A2…）

## 0. 一句话

Otto 的引擎重组为「技能文件柜大脑 + 类型化动作 + 可测质量」：商家因此得到一个画布上直接对话、每一版都能用分数证明更聪明、没交付就不收钱的 Otto。

## 1. 九问（S1 grill 的答案，2026-08-29 Founder 逐项拍板）

1. **商家做什么动作、看到什么结果？**
   商家与 Otto 对话完成营销任务。本规格给商家的三个直接变化：① 画布输入框就是 Otto 对话（Grok Imagine 形态，Founder 2026-08-29 裁决；今天画布输入实为直接生成——这是现状与「Canvas 即对话」裁决之间的缺口，本规格补上）；② 对话轮跑到上限被截断、什么都没交付时全额退款（原为按实际用量收费，Founder 2026-08-29 裁决改退款）；③ 其余为质量提升，以评测分数逐版证明，不靠观感。

2. **入口在哪里？（列全，含深链）**
   不新增入口。现有入口维持：全局停靠面板（除画布外每一面，`OttoPanelMount`）；`/otto` 重定向表；深研走 RESEARCH_CARD。变化只有一处：画布的输入框从直接生成升级为 Otto 对话，花钱动作仍走卡片确认。

3. **四态：空、加载、错误、成功各长什么样？**
   对话面板四态沿用现状。画布 Otto 化的四态在施工稿（S2）细化，蓝图级口径：空＝画布引导语；加载＝流式回复＋步骤条；错误＝诚实报错、钱按退款语义处理；成功＝回复/卡片落对话，产物物化为画布节点（沿用 `syncOttoCanvasNodes`）。

4. **数据从哪来、写到哪去？**
   - **用语表（本规格的统一用语）**：**skill（技能）＝文件柜里的知识文件**（教打法与手艺，加文件即生效）；**action（动作）＝现有 57 个类型化工具**（调产品功能、过审批、动钱的代码）。skill 指路，action 开门；skill 里可写「这一步用哪个 action」。代码里 `defineOttoSkill` 等旧命名实为 action，施工时逐步正名（不作为验收行）。教新打法＝加 skill 文件；接新平台或新钱路＝加 action（走正常开发流程）。
   - 技能文件柜：仓库内只读文件（build 期打包；不落租户数据，商家不可写）。Otto 的领域知识从 4.3 万字节单体提示词拆成按需加载的 skill 文件；哪些文件、何时加载由上下文装配器（承接 #879 step 2）决定。目录形态（施工稿可细化）：
     ```
     packages/otto/
     ├── skills/(现役 57 个 action，代码，不动；施工时正名)
     ├── knowledge/          ← 技能文件柜（markdown skills）
     │   ├── _core.md        ← 常驻：Otto 是谁、口吻、铁律（薄，每轮必带）
     │   ├── craft/          ← 手艺（seedream/seedance 提示词、文案）
     │   ├── playbooks/      ← 打法（促销、节日、排期策略…）
     │   └── product-map/    ← 产品地图（导航、卡片与审批规矩）
     └── evals/              ← 评测集（tasks/ 一题一文件 + judge.md 判分标准）
     ```
     取用三规则：① 每个 skill 首行是一句「书脊标签」，Otto 每轮只见全部标签（便宜）；② 任务对上标签才把该文件全文装入本轮，用完不带入下一轮（按需加载）；③ 教新打法＝加一个文件，不动引擎与动作层。
     注：现有 `src/knowledge/` 是 Meta 领域 TS 数据模块，与文件柜撞名，施工时正名。引擎屋内说明书（用语表＋三层地图＋管理三条路）在 `packages/otto/AGENTS.md`，随本规格同 PR 交付。
   - 对话记忆：`ChatThread.ottoState` 沿用；启用 `rollingSummary` 死列做旧轮摘要，历史纳入 token 预算闸（今天无截断、历史无界增长——本规格关闭这个洞）。
   - 评测集：仓库内文件（任务＋判分标准），跑分档案落仓库或 CI 工件。
   - 每轮调试档案：该轮加载了哪些技能、走了几步、调了哪些工具（今天零观测——本规格补上；只记结构事实，不记商家内容明文）。

5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   碰，三处，全部沿用现有 reserve→settle 单一通道与既有幂等键（`refId`、卡片幂等键），不新增键：
   ① 截断轮退款：`usageOnError` 路径从「按实际用量结算」改为「全额退款」，成本平台吸收（每轮预扣上限内，≈4 显示 credits）。
   ② 模型价格表补全：`llm-prices.ts` 现仅 2 行且按子串猜价——改为查无此型号拒绝启动，绝不猜价（今天若换错型号会静默错收或亏本）。
   ③ `RESEARCH_METER_MODEL` 硬编码副本消除，回到单一真相源。

6. **权限与租户边界是什么？**
   不变，且列为设计不变量：身份只来自 `requireOwner()`；技能文件不携带、不接触身份；**文件只能指路，开门永远在类型化动作层**（构造期身份键禁令、机器推导 needsApproval 闭集、port 闭包预绑身份全保留）。可操作 ≠ 可绕审批。

7. **参考对照：抄哪家？（Mobbin 截图或链接，稿上注明）**
   - 技能文件柜：Claude Code / Claude Agent SDK 的 skills-as-files 形态（知识文件＋类型化工具的组合）；eve 的组织法（skills-as-files/evals/approvals——只偷组织法，不搬 eve，2026-08-29 顾问结论）。
   - 画布对话：Grok Imagine（Founder 指定参考五家之一）。

8. **胃口：轻／中／重挡，为什么？**
   重挡：碰钱路（三处）＋退役单体提示词组织方式＋画布行为变化。

9. **Otto 怎么协助这个功能？或明写「不适用」。**
   本规格的对象就是 Otto 自身：评测集任务由 Otto 执行来测分；引擎改造本身无 Otto 协助路径（不适用）。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| ENGINE-A1 | （工程侧演示）跑评测命令 | 评测集 v0 ≥10 个营销任务逐个判分＋总分档案输出；基线分数入档 |
| ENGINE-A2 | （工程侧演示）查看任一对话轮的调试档案 | 能看到该轮加载了哪些技能文件、走了几步、调了哪些工具；不含商家内容明文 |
| ENGINE-A3 | 商家在画布输入框发消息 | 得到 Otto 对话回复（非直接生成）；花钱动作仍走卡片确认 |
| ENGINE-A4 | 商家的对话轮被截断且无任何交付 | 该轮全额退款；消费历史可见对应退款行 |
| ENGINE-A5 | （工程侧演练）把模型 manifest 指到价格表没有的型号 | 拒绝启动并报明原因，而不是按猜的价格计费 |
| ENGINE-A6 | 商家进行长对话（历史超过预算） | 旧轮被摘要收拢、对话继续；新一轮成本不随历史无限上涨 |
| ENGINE-A7 | （工程侧演示）技能文件柜替换单体提示词后重跑评测 | 总分不低于 ENGINE-A1 基线（拆分不回退质量） |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- **不换 loop 框架**：现 OpenAI Agents SDK 栈保留（恢复丢上下文、静默失败、过载容灾等多轮实战加固不重开）。换脑触发条件：评测集证明现框架卡住质量上限。
- **不定具体模型档位、不锁厂商**：模型是可插拔槽（含 GPT 系候选，Founder 2026-08-29 要求纳入考虑）；档位与厂商由评测集跑分另场裁决。本规格只做三雷拆除（九问 5）与槽位解耦。
- **不做 MCP 化**：Founder 2026-08-29 裁决降级——仅当我们自己用得到再议（触发条件：自家工具链或换脑后原生需要 MCP 时）。
- **不动三条边界的构造**：身份、钱、审批的既有形状约束原样保留。
- **不做外部 agent 接入、不做个人级 actor 归因**：维持既有 deferred。
- **14 个 skill 绕 port 直连 prisma 的收编**：施工内递进处理（围栏 WARN→FAIL 时机由施工稿定），不作为本规格验收行。

## 4. 异议栏（AI 必填）

- 最大风险：闭门设计。评测集 v0 是自拟任务（混合起步，Founder 2026-08-29 拍板），商家真实用法尚未进来——本次冻结的是方向、边界与验收口径；任务内容在见到真实商家后逐个替换，替换不算改签。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-02 | **素材理解时效目标未定义**(上传后多久被 Otto 认识)。现值=扫描器 25 件/分钟建行 + UNDERSTAND_CONCURRENCY=2(2000 张≈80 分钟),沿用平台自付时代保守值,不对应任何承诺;供应商请求闸门是平台共享参数(官方并发 10,生成侧用 1),调整须同时看 Creation。钱引擎顾问复审场(Founder 2026-09-02)判定此事归 Otto 引擎而非钱引擎;待 beta 真实上传量后定时效目标,再调两常量 | |
| 2026-09-05 | **①段（ENGINE-A5）落地登记（三件与 §7.2① 写法不同之处，均按现码做）**：(a) `OTTO_FALLBACK_MODEL = "claude-sonnet-4-5"` 从前靠子串猜价才拿到 sonnet 价，猜价删掉后它必须自己进价目表，故 `packages/core/src/llm-prices.ts` 的表从两行加到三行（同档价，$3/$15）；(b) 开机检查的「型号必须已定价」判的是两个**代码常量**而非 env 变量，warn 免疫资格因此挂到 `EnvProblem.moneyInvariant` 上（`ENV_CONTRACT` 的 spec 标记仍只有 `OTTO_LLM_MARGIN`），并给 `CheckEnvOptions` 加一个只为可测而存在的 `pricedModelIds` 缝；(c) `packages/otto/src/meter.ts:5`（不变量 #5「Unknown model → sonnet pricing」）、`:158`、`packages/otto/src/runtime.ts:80` 三处注释在本段之后已失真，但这两个文件属②④⑤⑥段写集，本段未动——请⑤段（或先合并到这两个文件的那一段）顺手改成「未定价即抛」。另记：`runtime.ts:258` 的 `prices: mr.pricing(mr.billableModelId)` 对 `paid:false` 的夹具 manifest 也照查价（本段把夹具的 `pricing` 改成自带 sonnet 价目以适配），是否改成只在 paid 时查价，留给⑤段判断 | |
| 2026-09-05 | **②段施工登记(ENGINE-A2,按现码落地的三处)**:(1) §7.2② 写「`orgId` 外键＋租户约束照 `ActionEvent` 同形」,但 `ActionEvent` 的租户列叫 `ownerId`,而运行时守卫**注入**的正是 `ownerId` 这个字面列名 —— 一张 `orgId` 表登记进 `TENANT_MODELS` 会把它打坏(`packages/db/src/tenant-guard.ts` 有 2026-09-02 实测)。故按现码:列名保持规格写的 `orgId`(它就是账本 `reserve:<refId>` 的那把钥匙),登记进 `ORG_SCOPED_TENANT_GUARD_EXEMPT`,租户边界由外键 CASCADE ＋ 读写口显式带 orgId 承担,双租户测试 `packages/db/src/otto-turn-trace-tenant.test.ts`。(2) `settledInternal` 由**入口侧**读账本填(引擎包不直连 prisma,与其他 port 同一条规矩);只有 RESERVE 无终结行时写 null。(3) `steps` 取自 SDK 的轮计数,截断时它是 maxSteps+1(先自增再判上限),测试按「≥ maxSteps」钉,不钉 SDK 内部时序。(4) 写集比 §7.5 A 表②段那一行多一个文件:`packages/otto/src/index.ts`(仅新增导出,零行为),表未列。(5) 落修轮留下的一件,下一次碰这段的人接:`ottoTurn` 与 `ottoApprove` 两门今天只有代码接线、没有回归测试(变异实证:拆掉这两门的 trace,`apps/web/lib/__tests__/otto-actions.test.ts` 全绿;拆掉流式那门则立刻红),补两条断言 `recordOttoTurnTrace` 被调用且 surface 为 "action" / "approve-resume" 即可 | |

## 6. 改签记录

- 无

## 7. S2 施工稿（设计阶段产出；S1 正文 §0–§6 一字未动，§5 只追加登记行）

> S2 状态: 已批准 · 2026-09-04
> S2 批准: https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/1162#issuecomment-5540891212 Founder 评论「S2 批准 otto-engine.md」(2026-09-04)；该评论同时批准 §7.0 的三项拍板与 §7.6 的异议增补

### 7.0 范围、量尺与本稿拍板

- **本稿只覆盖 S1 §2 已冻结的七条验收 ENGINE-A1–A7**，不新增验收编号。七条按依赖切**七段、三批**：
  **批 I（可即刻开工，零前端依赖）**＝①型号价目 fail closed、②每轮调试档案、③评测基线骨架、④长对话摘要；
  **批 II（依赖批 I）**＝⑤截断轮退款（钱路）、⑥技能文件柜替换单体；
  **批 III（等在飞前端基线 PR 合入）**＝⑦画布输入即对话。
  合计约 **17.5 人日**（切段表 §7.1 逐段列）。
- **量尺**：每段一个独立 PR、一位跨厂判官、验收编号逐字入测试；批 I 四段写集互不相交，可四路并行（§7.5）。
- **拍板一（手艺文件路径定案）**：手艺文件落 **`packages/otto/knowledge/craft/seedance.md`** 与 **`packages/otto/knowledge/craft/seedream.md`** —— 照 S1 §1 九问 4 已冻结的目录形态（文件柜根 `packages/otto/knowledge/`，`craft/` 是它的子格），不另开第二个包根目录。creation-engine.md §8.0 拍板三的占位路径 `packages/otto/craft/*.md` 由本行取代（该拍板原文明写「otto-engine.md S2 若另定路径，本稿随之改路径，不算改签」）。
- **拍板二（撞名正名的时机）**：现有 `packages/otto/src/knowledge/`（4 个文件，全部叫 `meta-expertise.*`，`packages/otto/src/knowledge/meta-expertise.data.ts` 等）与文件柜撞名（S1 §1 九问 4 已点名）。**在第⑥段同 PR 改名为 `packages/otto/src/meta-expertise/`**——全仓只有 4 个引用方（`packages/otto/src/index.ts`、`packages/otto/src/skills/meta-expert.ts`、`packages/otto/src/diagnosis/diagnose-performance.ts` 与其 `.test.ts`），是一次机械改名，不推迟成永久债。
- **拍板三（文件柜是 build 期产物，不是运行期读文件）**：文件柜必须经**代码生成**变成一个 TS 模块，禁止在运行期 `readFileSync`。依据是仓库既有事实：`packages/otto/src/otto.ts:33-35` 明写单体说明书「Inlined as a TS constant … NOT a runtime file read, so it loads in Next/Turbopack (web), tsx (worker), dist, and vitest」；`packages/otto/tsconfig.json` 的 `include` 只有 `["src"]`，包根的 markdown 本来就不进编译产物。生成器与新鲜度闸照现成的目录总表同形（生成器 `packages/otto/scripts/gen-catalog.ts`，CI 闸 `scripts/ci/quality.sh:995` 的 `otto CATALOG.md freshness`）。
- **机器闸**：每段 PR 带 `Spec: docs/specs/otto-engine.md`；验收编号逐字入测试（M3，`it.todo` 可占位）；第②段两条迁移守形状（M5）；本稿七段不新引入 `BETA_*`／`*_ENABLED` 开关（M4）。

### 7.1 切段表（验收行 · 依赖 · 人日）

| 段 | 内容 | 验收行 | 依赖 | 人日 |
|---|---|---|---|---|
| ① 型号与价目 fail closed | 价目表查无此型号即拒绝启动（不再按子串猜价）；`RESEARCH_METER_MODEL` 硬编码副本消除 | ENGINE-A5 | 无 | 1 |
| ② 每轮调试档案 | 新表按轮记：装了哪些技能文件、走了几步、调了哪些动作；只记结构事实，零商家内容明文 | ENGINE-A2 | 无（②先于④⑤落地，三段共写 `runtime.ts` 与两个入口） | 2 |
| ③ 评测基线骨架 | `packages/otto/evals/` 骨架＋跑分命令＋≥10 题＋判分标准＋基线档案；手艺文件路径按 §7.0 拍板一落位 | ENGINE-A1 | 无（是⑥与 Creation 批 III 的地基） | 3 |
| ④ 长对话摘要与预算闸 | 旧轮折成摘要（`ChatThread.rollingSummary` 现成列，零迁移）＋成对感知的历史裁剪 | ENGINE-A6 | ②（同写两个入口的落盘段） | 2 |
| ⑤ 截断轮退款 | 跑满步数且零交付的一轮改全额退款；平台吸收（钱路，重挡） | ENGINE-A4 | ②（同写 `runtime.ts`） | 1.5 |
| ⑥ 技能文件柜替换单体 | 单体说明书拆成按需装载的知识文件＋生成器＋新鲜度闸；`src/knowledge/` 正名；重跑评测不低于基线 | ENGINE-A7 | ③（没有基线就没有「不低于」） | 5 |
| ⑦ 画布输入即对话 | 画布只留一个输入框，直进 Otto 对话；花钱动作走既有对话审批卡 | ENGINE-A3 | PR #1150、#1151、#1158 三者全部合入主干 | 3 |

### 7.2 各段施工细则（后端对象／契约／迁移／切片顺序）

每段写四件：**要改／要建的对象 → 契约与迁移 → 依赖 → 切片顺序**。人日含测试与判官落修，不含等 Founder 走查的时间。

#### ① 型号与价目 fail closed（ENGINE-A5，估 1 天）

**今天的事实**：`packages/core/src/llm-prices.ts:23-26` 的价目表只有两行（`claude-opus-4-8`、`claude-sonnet-4-6`）；`llmPricesFor`（同文件 :37-45）先试精确匹配，再按子串 `opus` 猜价，**其余一切未知型号一律落到 sonnet 价**（:44 `return DEFAULT`）。换一个更贵的型号进 manifest，代码不会红、不会报，只会按 sonnet 的价收钱——这正是 S1 §1 九问 5②点名的雷。第二处：`packages/otto/src/skills/propose-research.helpers.ts:15` 把 `RESEARCH_METER_MODEL = "claude-sonnet-4-6"` 抄了一份裸字符串（注释自陈是为了不把 SDK 值图拖进前端包），与 `packages/otto/src/model.ts:28` 的 `OTTO_DEFAULT_MODEL` 是两份真相。

**要改的对象与契约**

- `llmPricesFor` 分成两个函数：`llmPricesFor(model)`（查不到 → **抛错**，携带型号名与「把它加进价目表或改回已定价型号」的判词）与 `llmPricesOrNull(model)`（供开机检查自己判定）。子串猜价整段删除——猜价与漏价是同一族事故，方向都不是 fail closed。
- **拒绝启动的落点有两处，缺一不可**：
  1. 组合期：`packages/otto/src/model.ts:197-211` 的 `ottoModelRuntime` 是 `Object.freeze` 的模块加载期常量，`pricing: llmPricesFor`（:211）。在这个对象构造处对 `OTTO_PRIMARY_MODEL`（:19）、`OTTO_FALLBACK_MODEL`（:22）、`OTTO_DEFAULT_MODEL`（:28）三个 id 逐个查价，任一查不到即抛——模块加载期抛错就是「拒绝启动」。
  2. 环境契约：`packages/core/src/env-contract.ts` 的开机判定（web 走 `apps/web/lib/env-boot.ts:12`，worker 走 `apps/worker/src/boot-env.ts:11`）加一条「型号必须已定价」的检查，判词与既有的费率地板判词同形（`OTTO_LLM_MARGIN` 的 `minimum`，env-contract.ts:496-505）。**该检查对 `FIKIRTIVE_ENV_CONTRACT=warn` 免疫**——按钱规格 A2 已立的口径，钱的违规不因 warn 模式转黄。
- `RESEARCH_METER_MODEL` 消除：把它换成从 `@fikirtive/core` 导出的一个**纯字符串常量**（不带 SDK 值图），`packages/otto/src/model.ts` 与 `propose-research.helpers.ts` 同取这一个源。原注释担心的是 bundle 体积，不是不可共享——一个字符串常量导出解决它，不必抄第二份。

**迁移**：无。**依赖**：无。

**切片顺序**：① 价目表函数改 fail closed ＋ 单测 → ② manifest 组合期查价 ＋ 开机检查（含 warn 免疫用例）→ ③ `RESEARCH_METER_MODEL` 收编到单一源。

#### ② 每轮调试档案（ENGINE-A2，估 2 天）

**今天的事实**：可观测性为零。`apps/web/components/otto/OttoTrace.tsx` 是**纯展示**的实时步骤条（文件头自陈「Purely presentational … No data, no spend — display only」），跑完即消失，不落盘。跑完一轮之后没有任何地方能回答「这一轮装了什么、走了几步、调了哪些动作」。

**要建的对象与迁移**

- 新表 `OttoTurnTrace`：`refId`（主键候选，全仓已是每轮唯一的稳定锚）、`orgId`（外键 + 租户约束，照 `ActionEvent`（`packages/db/prisma/schema.prisma:907-918`）同形）、`threadId?`、`surface`（stream／action／approve-resume／worker-research）、`modelId`、`steps`（实走步数）、`toolCalls Json`（动作名 + 次数 + 成败，**只有名字与计数**）、`skillFiles Json`（本轮装入的技能文件名单，⑥段之前恒为空数组）、`truncated Boolean`、`settledInternal Int?`、`createdAt`。索引 `(orgId, createdAt)`。
- **refId 的三种形状（现成，不新造）**：`otto-stream:<userMessageId>`（`apps/web/app/api/otto/stream/route.ts:265`）、`otto-turn:<userMessageId>`（`apps/web/lib/otto-actions.ts:1691`）、`otto-approve:<threadId>:<cardId>:a<n>`（同文件 :1852）。它同时是账本里 `reserve:<refId>` 的键，所以调试档案与钱账天然对得上，无需第二把钥匙。
- **不记商家内容的机器保证**（S1 §1 九问 4 明写）：写入函数只收一个**白名单形状**的结构体（动作名来自 `packages/otto/src/registry.ts` 的注册表、文件名来自文件柜清单），任何自由文本字段在类型层就不存在；配一条围栏测试，断言写入路径上没有 prompt／消息文本／参数值流入。

**契约**：在 `packages/otto/src/runtime.ts` 的 `runOttoTurn`（:311）里累计本轮事实并交给一个注入的 `traceSink` 端口；三个入口（stream route :326、otto-actions :1696 与 :2090）各自提供落盘实现。端口化的理由与 `ctx` 其他端口一致——引擎包不直连 prisma。

**依赖**：无。**读面**：ENGINE-A2 是「工程侧演示」，一条只读脚本 `scripts/ops/otto-turn-trace.ts <refId>` 即可满足；不做商家面 UI。

**切片顺序**：① 迁移 ＋ 表 ＋ 租户约束 → ② `runOttoTurn` 累计与端口 → ③ 三个入口接线 ＋ 无明文围栏 → ④ 只读脚本。

#### ③ 评测基线骨架（ENGINE-A1，估 3 天）

骨架落点、目录形状与给 Creation 的接口写在 §7.3（那一节是本段的施工细则，不重复）。

**依赖**：无。**它是谁的地基**：⑥段的「不低于基线」判定、以及 creation-engine.md §8.3 批 III 的 Creation 评测题与四项机械检查。

#### ④ 长对话摘要与预算闸（ENGINE-A6，估 2 天）

**今天的事实**：`ChatThread.rollingSummary` 列已经在（`packages/db/prisma/schema.prisma:1029`），注释自陈「reserved — folded older-turns summary (generation logic deferred until long sessions)」——**只有列，没有生成逻辑**。历史裁剪同样没有：`packages/otto/src/run-input.ts:44-51` 的 `sanitizeHistory` 只做两件事（丢掉过期 system 消息、剥掉图片字节），文件头明写「Token-budget truncation of the remaining turns is intentionally NOT done here — naively dropping items can split a tool_call/tool_result pair and break the run」。于是长对话的历史无界增长，而每步的成本口径 `OTTO_CONTEXT_CAP_TOKENS = 12_000`（`packages/core/src/otto-budget.ts:4`）只是**预扣时的最坏假设**，不是真闸——真实历史涨过它，只会让实际成本贴着预扣上限跑。

**要建的对象**

- **成对感知的裁剪器**（纯函数，落 `run-input.ts`）：从最旧一端裁，**永远不拆开 `tool_call`／`tool_result` 这一对**（这正是当初推迟它的原因，也是本段唯一有难度的地方）；裁到剩余历史的估算 token 数低于预算为止。
- **摘要生成**：被裁掉的那些轮折进 `rollingSummary`，摘要本身是一次**便宜的小调用**，走 `withLlmBudget` 同一通道计费（不新开钱路、不新增幂等键，沿用本轮的 refId）。
- **回注**：`rollingSummary` 随每轮那条**新鲜的 system 消息**一起前置（`sanitizeHistory` 已经把历史里的旧 system 消息丢掉，回注点就是那一条）。

**迁移**：**零**（列已存在）。**依赖**：②（同写 stream route 与 otto-actions 的落盘段；②先合）。

**切片顺序**：① 成对感知裁剪器 ＋ 穷举单测（拆对、空历史、只有一对、超长单条）→ ② 摘要生成与计费 → ③ 回注与两个入口落盘 → ④ ENGINE-A6 行为测试：连续 N 轮之后，第 N+1 轮的预扣与实结不随历史单调上涨。

#### ⑤ 截断轮退款（ENGINE-A4，估 1.5 天，钱路重挡）

**今天的事实**：`packages/otto/src/runtime.ts:259-262` 的 `usageOnError` 在 `MaxTurnsExceeded` 时**取回真实用量**并返回；`packages/otto/src/meter.ts:564-570` 收到真实用量就走 `settleCredits`——按实际 token 结算，搜索腿一并结。`meter.ts` 不变量 #10 把这条路写在文件头上：「a `usageOnError` settle … charges real tokens and never calls the hook — delivery-less but paid, by design」。S1 §1 九问 1② 的 Founder 裁决把这条 by design 改成**全额退款**。

**要改的对象与契约**

- 判定「有没有交付」的**结构性口径**（不是读文本）：这一轮是否产生了任何**可交付物**——铸出的卡片、落盘的画布节点、写下的消息产物。判定由 `runOttoTurn` 侧的计数器给出（与②段的 `toolCalls` 同一份事实），传进 `withLlmBudget`。
- `usageOnError` 变成：`MaxTurnsExceeded` **且** 本轮零交付 → 返回 `null`（走 `meter.ts:571-580` 的整笔退款分支，并触发既有的 `onRefundedFailure` 只读钩子，让入口对商家诚实说「这一轮没收钱」）；`MaxTurnsExceeded` **且** 有交付 → 维持现状按实际用量结算。
- **搜索腿一并退**：整笔退款分支退的是**整个预扣**，其中含本轮坚实预留的搜索格（`runtime.ts:246-256` 的 `extraHoldUnits`／`onExtraUnitsGranted`）。平台吸收的上限因此是「token 实耗 + 已成功搜索的供应商费」。**算术**：单轮预扣上限 `OTTO_CONVERSATION_TURN_RESERVE_INTERNAL = 40` internal（`packages/core/src/otto-budget.ts:124`）＝4 显示 credits＝面值 $0.40（`CREDITS_PER_USD = 100`、`INTERNAL_PER_DISPLAY = 10`，`packages/core/src/spend.ts:87,90`）；供应商侧最坏＝按 1.05 费率倒推的 token 成本 ≈$0.63 ＋ 5 次 basic 搜索 ×$0.008（`packages/core/src/pricing-config.ts:310-313` 的钉点）＝$0.04，合计 **≤ ≈$0.67 一轮**。这是本段要 Founder 心里有数的那个数。
- **账本形态不变**：`reserve:<refId>` 与 `refund:<refId>` 成对、净变 0——与钱规格 A8 的两种「净变 0」形态逐字同形，不新开第三种。**不新增幂等键**（S1 §1 九问 5 明写）。

**迁移**：无。**依赖**：②（同写 `runtime.ts`，且零交付计数器与②的 `toolCalls` 同源）。

**规格归属（重要）**：本段改的是钱的行为，但 `docs/specs/money-engine.md` 主干状态是「已交付 · 归档」，归档规格只能作轻改引用（repo `.claude/CLAUDE.md` 开发流程第 1 条，Founder 2026-09-02 裁决）。本段 PR 因此引用**本规格**（`Spec: docs/specs/otto-engine.md`，验收 ENGINE-A4）——ENGINE-A4 是已冻结 v1 的验收行，授权充分。落地后另发一个 docs-only PR，在钱规格 §5 变更登记补一行回填「聊天截断轮由按实结算改全额退款，出处 otto-engine.md ENGINE-A4」，交 Founder 追认。

**切片顺序**：① 零交付判定 ＋ 单测（有卡片／有节点／什么都没有 三态）→ ② `usageOnError` 改判 ＋ `meter.ts` 既有分支复用 → ③ 入口诚实文案（「这一轮没有收费」）→ ④ ENGINE-A4 行为测试：截断且零交付 → 账本 reserve/refund 成对、消费历史可见退款行。

#### ⑥ 技能文件柜替换单体（ENGINE-A7，估 5 天）

**今天的事实**：`packages/otto/src/instructions.ts` 是 **48,573 字节**的单体常量（`ottoInstructions`，:91 起），由 `packages/otto/src/runtime.ts:148` 整份塞进每一轮。它被一道**字节冻结**守卫钉着（`packages/otto/src/__snapshots__/otto-instructions.golden.txt`，守卫理由写在 `instructions.test.ts` 文件头：六轮语义判定都被自然英语穿透，最后改成冻结字节）。

**要建的对象**

- **文件柜**（S1 §1 九问 4 的目录形态，路径按 §7.0 拍板一）：
  ```
  packages/otto/knowledge/
  ├── _core.md          ← 常驻：Otto 是谁、口吻、铁律（薄，每轮必带）
  ├── craft/            ← 手艺：seedance.md、seedream.md
  ├── playbooks/        ← 打法
  └── product-map/      ← 产品地图（导航、卡片与审批规矩）
  ```
  每个文件首行一句**书脊标签**；取用三规则照 S1 §1 九问 4 已冻结的口径（只见标签 → 对上才装全文 → 用完不带入下一轮）。
- **生成器 ＋ 新鲜度闸**（§7.0 拍板三）：`packages/otto/scripts/gen-knowledge.ts` 读 `knowledge/**.md`，产出 `packages/otto/src/knowledge-cabinet.generated.ts`（书脊标签表 ＋ 全文常量表）；`package.json` 加 `knowledge` / `knowledge:check` 两个脚本（与现成的 `catalog` / `catalog:check` 同形）；`scripts/ci/quality.sh` 在 `otto CATALOG.md freshness`（:995）旁边加一条 `otto knowledge cabinet freshness`。
- **装配器**：按本轮任务对上的标签装入全文；装了哪些文件写进②段的 `skillFiles`（这正是 ENGINE-A2 那一栏在⑥之前恒为空的原因）。
- **字节冻结守卫的迁移**：`_core.md` 是每轮必带的常驻部分，它继承单体那道**字节冻结**（golden 快照换成对 `_core.md` 与生成产物取快照）；按需装载的 `craft/` `playbooks/` `product-map/` 不再逐字节冻结，改由③段的评测分数把关——这正是 ENGINE-A7 那一行存在的意义。
- **`src/knowledge/` → `src/meta-expertise/` 改名**（§7.0 拍板二），同 PR，4 个引用方。

**迁移**：无（纯代码）。**依赖**：③（基线分数）。

**切片顺序**：① 目录 ＋ `_core.md` ＋ 生成器 ＋ 新鲜度闸（此时单体仍是唯一在用的说明书，零行为变化）→ ② 装配器 ＋ 标签装载 ＋ `skillFiles` 落盘 → ③ 单体逐块搬进柜子、`instructions.ts` 退役、golden 快照迁移 → ④ 重跑评测，与③段的基线档案对分（ENGINE-A7）→ ⑤ `src/knowledge/` 改名。

**注**：`packages/otto/src/skills/` 里 57 个 action 的**代码正名**（`defineOttoSkill` → action 命名）S1 §1 九问 4 已明写「不作为验收行」，本稿不排它；同理 §3 点名的「14 个 skill 绕 port 直连 prisma」维持 WARN 不转 FAIL——今天基线实测就是 **14** 个（`bash scripts/check-skill-imports.sh` 输出「0 spend/provider bypass (hard-clean); 14 direct-Prisma sites (warn baseline)」），转 FAIL 的时机留给下一场。

#### ⑦ 画布输入即对话（ENGINE-A3，估 3 天，等三个 PR）

**今天的事实（比 S1 写稿时更细）**：画布上**同时挂着两个输入**——
1. Otto 对话（`apps/web/components/canvas/NorthstarCanvasWorkspace.tsx:173` 的 `CanvasOttoOverlay` → `OttoFrontDoor` / `OttoChatStream`，`apps/web/components/canvas/CanvasOttoOverlay.tsx:43-77`）；
2. **直接生成的 composer**（`FlowCanvas`，同文件 :164-172 以 `skin="gb"`、`defaultComposerOpen={false}` 挂载）：它藏在右侧工具条的 Generate 按钮后面（`apps/web/components/canvas/FlowCanvas.tsx:267-270`、:1727、:1938-1943），按下就直接花钱出图（`handleGenerate`，:844-912 → `useCanvasGen` 的 `generateImage`），报价小字写在按钮旁（:1839「Charged when you press Generate」）。

**已批准的设计只有一个输入**：夹具 `apps/web/design-system/patterns/canvas/CanvasReference.tsx:419` 底部只有一个 `CreationComposer`；右侧工具条（:421）只有 select／frame select／hand 三枚，**没有 Generate**；确认长在 Otto 当前轮的卡片上（:257-273，`turn.status === "needs-confirmation"` 时出现 `Generate · {credits} credits` 按钮）。

**所以本段的实质是「退役一个实现」**（重挡）：画布只留 Otto 对话那一个输入，直接生成的 composer 与工具条上的 Generate 按钮一并撤下；花钱动作走**既有的对话审批卡**（`apps/web/components/otto/OttoApprovalCard.tsx`，闭集由 `packages/otto/src/approval-tools.ts:14-18` 从注册表机器推导）。

**边界（不做，写明归属）**：把确认**收回画布状态卡**、按设计做出 `needs-confirmation` 状态机（夹具 CanvasReference.tsx:270-273），**不在本段**——frontend-baseline.md §7.1 第⑨段与 §7.5 已把它划为「另立小规格再动」。本段落地后画布状态卡仍是纯标签（`OttoCanvasStatus`，`apps/web/components/otto/OttoTrace.tsx:249`），确认在对话面板里完成；那份小规格由做⑦的那一场在开工前另写、另签。

**依赖（硬）**：PR **#1150**（Canvas 对齐，写 `FlowCanvas.tsx` 与 `OttoChatStream.tsx`）、**#1151**（Create 起步页，写 `StartSomething` / `CreateWorkspace` / `app/create/page.tsx`）、**#1158**（`@` 两套收口，写 `OttoChatStream.tsx` / `OttoFrontDoor.tsx` / `MentionInput.tsx`）**全部合入主干**之后才开工——三者与本段写集完全重叠（§7.5），并行只会互相解冲突。

**切片顺序**：① 撤 Generate 按钮与直接生成 composer（`handleGenerate` 的节点级调用方——变体、动画、改图——保留不动）→ ② 画布 composer 的送出接到 Otto 对话（沿用 `OttoFrontDoor` 的开新线程与 `pendingFirst` 交接）→ ③ 送出前的价目披露（§7.4）→ ④ ENGINE-A3 行为测试与一条端到端旅程。

### 7.3 评测基线骨架（ENGINE-A1）与 Creation 批 III 的接口

**骨架落点**：`packages/otto/evals/`（包根，不在 `tsconfig.json` 的 `include` 里——与 `packages/otto/scripts/` 同样经 `tsx` 跑，不进 `dist`）。

```
packages/otto/evals/
├── README.md              ← 怎么跑、怎么加一题
├── judge.md               ← 判分标准（单一权威；两条线共用一份）
├── tasks/
│   ├── engine/            ← 本规格的 ≥10 个营销任务（ENGINE-A1 基线）
│   └── creation/          ← Creation 的题（creation-engine.md 批 III 自己填）
├── checks/                ← 机械检查（纯函数：一次跑的产物 → 通过/不通过 + 理由）
├── baselines/             ← 跑分档案（JSON：日期、commit sha、型号、逐题分、总分）
└── runner.ts              ← tsx 入口
```

**一题一文件的契约**（front-matter，两条线共用）：`id`（逐字等于验收编号或 `<line>-<n>`）、`line`（`engine` | `creation`）、`prompt`（商家人话）、`checks`（要跑哪几个机械检查的名字）、`rubric`（判分维度，交给 judge.md）。runner 不认得任何业务——它只按 front-matter 调 `checks/` 注册表里的函数，再把产物与 `judge.md` 交给判分。

**跑分与档案**：`pnpm --filter @fikirtive/otto run evals`（写档案）与 `--check`（比对基线，回归即非零退出，与 `catalog:check` 同形）。档案落 `baselines/`，两条线各一份；ENGINE-A1 的验收就是「跑一次、逐题有分、总分入档」，ENGINE-A7 的验收是「⑥段之后重跑，总分不低于这份档案」。

**给 Creation 批 III 的接口（creation-engine.md §8.3 点名依赖的正是这三件）**：
1. `tasks/creation/` 目录与上面的 front-matter 契约——Creation 只需要加文件，不改 runner；
2. `checks/` 注册表——CREATE-A8 的四项机械检查（角色指派完整／分镜为 Shot 编号结构且零时间戳／禁词零命中／镜头词全部命中术语表）各注册一个纯函数进这张表；
3. **术语表的单一真相源**：第四项检查从 **`packages/otto/knowledge/craft/seedance.md`** 的镜头术语表节**解析**取词，不在 `checks/` 里抄第二份（全局法 7.3）。CREATE-A8 的另一半判定「改动 craft/ 文件后重跑本规格的评测基线，总分不低于基线」由上面的 `--check` 直接满足。

**判分的诚实口径**：机械检查先行（确定性、零成本、零模型），只有机械检查过不了的那一部分才交模型判分；judge 的每一次判定连同它读到的产物一起写进档案，好让「分数怎么来的」可以复核。

### 7.4 确认卡片（ENGINE-A3）与钱路的接缝——只引用，不改钱规格

**两级「先披露、后执行」**（画布改成对话之后，商家在一次出图里会碰到两笔钱，两笔都要在动作**之前**看得见）：

| 级 | 什么时候扣 | 谁定价 | 披露在哪里 |
|---|---|---|---|
| 一 · 对话轮 | 按下发送即预扣 | 供应商成本 ×1.05（`packages/core/src/otto-budget.ts:50`），预扣上限 40 internal ＝ 4 显示 credits（同文件 :124） | 画布 composer 下方的常驻价目小字（与既有的搜索／理解两条同一位置：`apps/web/components/otto/OttoChatStream.tsx:1652` 挂 `SearchCostHint`） |
| 二 · 生成 | 商家在卡片上确认之后才预扣 | `pricedGenCredits`（报价与扣款同一函数） | 审批卡卡面（`OttoApprovalCard`） |

**幂等键：一个都不新增**（S1 §1 九问 5 已冻结）。现役三把，全部沿用：对话轮 `otto-stream:<userMessageId>`（`apps/web/app/api/otto/stream/route.ts:265`）与 `otto-turn:<userMessageId>`（`apps/web/lib/otto-actions.ts:1691`）；批准恢复轮 `otto-approve:<threadId>:<cardId>:a<n>`（同文件 :1852，每次尝试一把）；生成卡片锚在 `cardId`（`packages/otto/src/approval-tools.ts:35`）＋ GenJob 的 `cowork:` 双批准。

**与钱规格既有验收的接缝（引用，不改那份规格）**——按 M2 纪律，表内不写他家编号，接缝逐条说事：
- **卡面冻结价 ≠ 现算价一律拒绝**（钱规格「三条信任通道」那一行）：画布改成对话之后，卡片是画布上唯一的花钱入口，这条闸的覆盖面从「三条通道」变成「全部」，实现不动。
- **两种净变 0 的形态**（花钱前拦截＝零新增行；花钱后失败＝reserve/refund 成对）：⑤段的截断退款走的正是第二种，不新开第三种。
- **聊天搜索单轮上限 5 次与商家侧披露**：画布 composer 的价目小字必须把搜索那一行一起带上——今天它只挂在对话面板里，画布 composer 改成对话入口之后是**新的写点**，⑦段第③刀补挂；数值一律现算，禁字面量（`SearchCostHint.tsx` 文件头已立此规矩）。
- **credits 永不过期的商家可见文案**：不受本稿影响，⑦段不得在重画 composer 时把它挤掉。
- **自动理解的披露口径**（披露先于扣费、按动作时刻价目、我方故障重试不重复计费）：画布 composer 的「+ Add context」上传路径沿用既有披露组件，⑦段只搬位置不改口径。

### 7.5 写集互斥表（Otto 七段内部 ＋ 在飞前端基线 PR，分开列）

**A · Otto 七段之间**

| 段 | 写集 |
|---|---|
| ① 型号价目 | `packages/core/src/llm-prices.ts`、`packages/core/src/env-contract.ts`、`packages/core/src/index.ts`、`packages/otto/src/model.ts`、`packages/otto/src/skills/propose-research.helpers.ts` |
| ② 调试档案 | `packages/db/prisma/schema.prisma` ＋ `migrations/<新目录>`、`packages/db/src/tenant-guard.ts`、`packages/otto/src/runtime.ts`、`apps/web/app/api/otto/stream/route.ts`、`apps/web/lib/otto-actions.ts`、`scripts/ops/otto-turn-trace.ts`（新建） |
| ③ 评测骨架 | `packages/otto/evals/`（新建）、`packages/otto/knowledge/craft/`（新建）、`packages/otto/package.json`、`scripts/ci/quality.sh` |
| ④ 摘要预算闸 | `packages/otto/src/run-input.ts`、`packages/otto/src/runtime.ts`、`apps/web/app/api/otto/stream/route.ts`、`apps/web/lib/otto-actions.ts` |
| ⑤ 截断退款 | `packages/otto/src/runtime.ts`、`packages/otto/src/meter.ts`、`apps/web/app/api/otto/stream/route.ts` |
| ⑥ 文件柜 | `packages/otto/knowledge/`、`packages/otto/scripts/gen-knowledge.ts`（新建）、`packages/otto/src/instructions.ts`（退役）、`packages/otto/src/__snapshots__/`、`packages/otto/src/otto.ts`、`packages/otto/src/runtime.ts`、`packages/otto/src/knowledge/` → `src/meta-expertise/`（改名）、`packages/otto/package.json`、`scripts/ci/quality.sh` |
| ⑦ 画布对话 | `apps/web/components/canvas/FlowCanvas.tsx`、`apps/web/components/canvas/CanvasOttoOverlay.tsx`、`apps/web/components/canvas/NorthstarCanvasWorkspace.tsx`、`apps/web/components/otto/OttoChatStream.tsx`、`apps/web/components/otto/OttoFrontDoor.tsx` |
| 内部交集与规矩 | `runtime.ts`：②→④→⑤→⑥ 依次单线，先合者不解冲突。`stream/route.ts` 与 `otto-actions.ts`：②→④→⑤ 同序。`package.json` 与 `quality.sh`：③→⑥ 同序（③加两个脚本与一道闸，⑥再加两个）。①与③④⑤⑥⑦ 无交集，可全程并行。 |

**B · 与在飞的前端基线 PR（分开列；哪些段必须等哪个 PR 合入）**

| 在飞 PR | 它的写集（与本稿相关的部分） | 本稿哪一段受影响 | 处置 |
|---|---|---|---|
| #1150 Canvas 对齐 | `apps/web/components/canvas/FlowCanvas.tsx`、`apps/web/components/canvas/nodes/*`、`apps/web/components/otto/OttoChatStream.tsx`、`apps/web/design-system/foundations/globals.css` | ⑦ | **⑦ 必须等 #1150 合入**（全面重叠：它正在重画的就是⑦要退役的那个 composer 所在的文件） |
| #1151 Create 起步页 | `apps/web/app/create/page.tsx`、`apps/web/components/start-something/*` | ⑦ | **⑦ 必须等 #1151 合入**（画布对话的入口交接从起步页开始） |
| #1158 `@` 统一 | `apps/web/components/otto/OttoChatStream.tsx`、`OttoFrontDoor.tsx`、`apps/web/components/MentionInput.tsx`、`packages/core/src/index.ts` | ⑦、①（`packages/core/src/index.ts`） | **⑦ 必须等 #1158 合入**；①若导出新符号，与它同写 `core/src/index.ts`，后合并者重贴一行 |
| #1152 / #1159 素材库 | `apps/web/app/library/`、`apps/web/lib/library-*`、`packages/db/prisma/schema.prisma` ＋ 迁移、`packages/db/src/tenant-guard.ts` | ② | 迁移**目录名不同即不冲突**；`schema.prisma` 与 `tenant-guard.ts` 只有一份，**后合并的那段重贴自己的 model 并重跑迁移校验**（照 frontend-baseline.md §7.4 同一条规矩）。②不必等，只需后合并时重贴 |
| #1157 品牌五节 | `packages/db/prisma/schema.prisma` ＋ 迁移、`packages/core/src/memory-sections.ts`、`packages/core/src/index.ts`、`packages/db/src/tenant-guard.ts` | ②、① | 同上：②与它的 `schema.prisma`／`tenant-guard.ts`、①与它的 `core/src/index.ts`，后合并者重贴。均**不必等** |
| #1153 外壳登录 / #1154 Settings·Billing | `apps/web/app/login/`、`app/settings/`、`app/billing/`、`app/profile/`、`packages/core/src/navigation.ts` | 无 | 与本稿七段零交集 |

**一句话结论**：批 I（①②③④）与批 II（⑤⑥）**都不必等任何在飞 PR**，今天就能开；只有 ⑦ 被 #1150 / #1151 / #1158 三个 PR 挡住。

### 7.6 异议栏增补（S1 §4 不动；本稿新增一条）

**S1 §4 已在案的最大风险**（闭门设计：评测集 v0 是自拟任务）不变，并且它正好是⑥段「不低于基线」这条验收的强度上限——自己出的题，考不出自己不知道丢了什么。

**本稿新增的一条真风险 · 第⑦段把画布上最便宜的一条出图路径删掉了，而这件事没有任何一条验收行看着它。**

算术（全部可在仓库核）：今天商家在画布上出一张 lite 图＝**1 显示 credit**（`packages/core/src/spend.ts:277-281`，公式价恰好 1.0000）。⑦段之后，同一张图必须先经过至少一轮 Otto 对话——一轮对话的实测峰值约 **17–18 internal ≈ 1.7–1.8 显示 credits**（`packages/core/src/otto-budget.ts:105` 的口径换算行，1.05 费率下），预扣上限 4 显示 credits（同文件 :124）。也就是说**同一张图的到手价从 1 credit 变成约 2.7–2.8 credits，涨约 1.7 倍**；若 Otto 反问一句再确认，就是第二轮，再加一次。

它为什么不是「顺手就改」的小事：ENGINE-A3 的验收只判「得到对话回复、花钱动作仍走卡片」，**判不到价格**；钱那边的验收判的是「报价与扣款同源」「调价只影响其后动作」，也判不到「同一件事变贵了」。两边都绿，商家的账单照涨。

三条处置，建议 Founder 在批 S2 时一并拍板（不拍也能开工，但⑦段落地前必须有答案）：
1. **接受并披露**（推荐）：⑦段第③刀的价目小字明写「Otto 会先跟你确认，这一轮对话本身按用量计费」，把涨价摆到台面上。理由：这正是「Canvas 即对话」裁决买的东西——一次对话换一次更对的出图，比一张便宜的错图划算；参照 Grok Imagine（Founder 指定的画布参考）也是先对话再出图。
2. **本轮内首次生成的对话轮不收费**：一个新的钱口径，要动 `withLlmBudget` 的调用方与钱规格，成本远大于收益，**不建议**。
3. **保留一条直接生成的快路**：与已批准的设计夹具直接冲突（夹具工具条上没有 Generate），等于自己推翻裁决六那一类的判定，**不建议**。

### 7.7 环境前置与评测预算

- **Anthropic 钥匙**：`ANTHROPIC_API_KEY` 已在主检出 `.env.local` 与 `apps/web/.env.local` 两处就位（本场只核了变量在位与长度，未读值、未发真调用）。
- **`ANTHROPIC_BASE_URL` 是本场最容易踩的一颗雷**：它在主检出 `.env.local` **和** agent 的 shell 环境里都有值。2026-09-03 实证的症状是——agent 起的本机服务里 Otto 一律 404，看起来像「型号不存在」，于是有人去改型号常量（改错方向）。**跑评测与本地跑 Otto 一律用 `env -u ANTHROPIC_BASE_URL <命令>`**，且③段的 runner 不得加载仓库 `.env.local` 里的那一行。这一条写进 `packages/otto/evals/README.md` 第一段。
- **型号常量在哪（③⑥两段与①段都要认这几处）**：`packages/otto/src/model.ts:19`（`OTTO_PRIMARY_MODEL = "claude-sonnet-4-6"`）、:22（`OTTO_FALLBACK_MODEL = "claude-sonnet-4-5"`，只在 529 过载时同档接管）、:28（`OTTO_DEFAULT_MODEL`，计价用的那个 id）、:197-211（`ottoModelRuntime` 冻结清单，`pricing: llmPricesFor`）；价目表在 `packages/core/src/llm-prices.ts:23-26`；步数与上下文口径在 `packages/core/src/otto-budget.ts:4,6,8`（12,000 / 1,500 / 10）。
- **评测跑一次的预算**：一题一轮、10 题起步。按上面的口径换算成**我们自己付的供应商成本**（不是商家面值）：实测峰值口径约 **$0.17/轮 → 一次全跑 ≈$1.7**；最坏口径（每题都跑满 10 步、烧满上下文与输出上限）约 **$0.63/轮 → ≈$6.3**；判分调用再按题量加约 $1。**建议预算闸：单次全跑 ≤$10，本段累计 ≤$20**（与 creation-engine.md §7 实测轮同一量级）。⑥段的验收要跑第二次（拆柜前后各一次），预算照此加倍。
- **本地起动**：③⑥两段只需 Anthropic 钥匙；②④⑤段要数据库（迁移与账本行为测试）；⑦段要 web ＋ worker 全套（照 frontend-baseline.md §7.2 的起动步骤）。

### 7.8 开工闸

- 本节（§7 全文）**需 Founder 在呈批 PR 下评论「S2 批准 otto-engine.md」**，各段方可开工。
- **§7.0 三项拍板随该评论一并生效**：手艺文件路径定在 `packages/otto/knowledge/craft/`（并因此改写 creation-engine.md §8.0 拍板三的占位路径，不算改签）；`src/knowledge/` 在⑥段改名；文件柜走 build 期代码生成。
- **§7.6 的第一条处置（接受并披露）是建议默认值**；Founder 若不另裁，⑦段按建议一落地，并把披露文案纳入该段的验收演示。
- **不在本稿范围**：画布状态卡的 `needs-confirmation` 状态机（另立小规格，见 §7.2⑦）；57 个 action 的代码正名与 14 处直连 prisma 转 FAIL（S1 §3 已明写不作为验收行）；S1 §5 2026-09-02 登记的「素材理解时效目标」（等 beta 真实上传量，本稿不动那两个常量）。
