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
| 2026-09-05 | **③段（评测基线骨架）落地时的四处登记**：①**验收映射表的家**——本段引用本规格，M3 因此要求 7 条验收编号全部在测试树里有落点，而今天只有一条有真身；照 `packages/core/src/creation-acceptance-map.test.ts` 的先例建了映射表，但放在 `packages/otto/evals/acceptance-map.test.ts`（不在 `src/`）——§7.5 表 A 给本段的写集就是 `evals/` 与 `knowledge/craft/`，放 `src/` 既越写集、也会让并行的批 I 四段在同一个文件上撞车；后续各段把自己那一行的 `it.todo` 换成真身即可。②**写集溢出一个文件**：新增 `packages/otto/tsconfig.evals.json`（只做类型检查、不产出任何文件，`include: ["evals"]`），并把包的 `typecheck` 脚本改成两个 project 都跑——§7.3 要的是「evals 不进 `tsconfig.json` 的 include、不进 dist」，那一条原样成立；但「不编译」不该等于「不检查」，否则这几百行的类型错误要等到真花钱那一趟才现形。③**`scripts/ci/quality.sh` 本段未动**（它列在 §7.5 表 A 本段的写集里，本段选择不用）：`evals:check` 会**真的重跑一遍**评测——那是要花钱、要钥匙、要出网的动作，装进 CI 等于每个 PR 都掏一次钱包并且没有钥匙就红。它的正确位置是人手里（⑥段落地后跑它一次，就是那一段「不低于基线」的判据）。④**被测对象的口径**：runner 每题一次调用，system＝`instructions.ts` 的说明书 ＋ 一段固定不变的台架后缀（说明这一轮没接工具、请照实说会调哪几个工具与字段），user＝题目那句商家人话；⑥段换掉的正是那份说明书、后缀一个字不动，所以两次跑分比的是同一件事 | |
| 2026-09-05 | **规格与现状不符一条（按现码做，登记不改 §7）：§7.7 说「`ANTHROPIC_API_KEY` 已在主检出 `.env.local` 与 `apps/web/.env.local` 两处就位」，但那一行自己写明「只核了变量在位与长度，未读值、未发真调用」——2026-09-05 实发一次零 token 的探针，那把钥匙是 401**。证据：`GET https://api.anthropic.com/v1/models?limit=1` 带主检出 `.env.local` 的 `ANTHROPIC_API_KEY` → `http_status=401`、`error_type=authentication_error`、`error_message=API key is invalid.`（形状：108 字符、`sk-ant-` 开头、无引号无空白、文件里只有一行；该文件的 `ANTHROPIC_BASE_URL` 值就是 `https://api.anthropic.com` 本身）。**后果**：③段的基线**跑不出来**，`packages/otto/evals/baselines/engine.json` 本 PR 里不存在，本段实际花费 **$0.0000**（探针不烧 token，评测一次调用都没发出去）。骨架、10 题、判分标准、机械检查、预算闸与 mock 判分器的行为测试都已交付并全绿——缺的只是那一次真跑。**解闸只要一件事**：Founder 换一把有效的 Anthropic 钥匙进主检出 `.env.local`，然后 `set -a; . .env.local; set +a; env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals`（一次全跑的预估花费 $1.7–$6.3，硬上限 $10，见 §7.7），把写出来的档案单独一个 docs 提交入库。**在那之前**：⑥段的「不低于基线」没有比较对象，`evals:check` 会明说「没有基线可比」并非零退出（不会假绿） | |
| 2026-09-05 | **③段判官落修轮的四处登记（P1 与 P2 逐条）**：①**两条线共用一个 runner 已补齐**：原稿把线写死成 `engine`（`packages/otto/evals/runner.ts` 旧 :39），与 §7.3「Creation 只需要加文件，不改 runner」以及本段自带的两份 README 正相反——已改成 `--line=engine|creation`（缺省 engine），题目目录与档案路径都由它推出，并补一条测试钉住「`--line=creation` 指向 `tasks/creation` 与 `baselines/creation.json`」；同处补上「题的 `line` 必须与所在目录一致，否则当场炸」，免得一道 creation 题掉进 `tasks/engine/` 被静默记进另一条线的档案。②**`evals:check` 的守卫顺序改正**：原稿先真跑一整趟（真花钱）才说「没有基线可比」；已把守卫提到开跑之前，一分钱不花就非零退出。③**`SEGMENT_BUDGET_USD`（$20）是记账口径，只印不拦**——代码里没有任何地方据它停跑，真闸只有单次全跑的 $10；README「预算」一节与开跑那一行的措辞已改成实话（不接真闸：本段的实际风险由 $10 那一道兜住）。④**最坏情况估算对华语不再乐观**：`estimateTokens` 原来用英文口径 4 字符 1 token，而闸的输入端是整份华语 `judge.md`；已按 CJK 每字 2 token 分档估，计费仍只用真实用量。 | |
| 2026-09-05 | **③段落修轮的三条「不在本段动」登记**：①**写集溢出一个文件**（`packages/otto/tsconfig.evals.json`）请编排者/Founder 追认：判官已核过它与并行的批 I 三段零碰撞，理由是「evals 不进 dist ≠ 不做类型检查」；若从严，改法是把它挪进 `packages/otto/evals/tsconfig.json` 并改 `package.json` 的路径。②**`packages/otto/AGENTS.md` 的「快查」节已过期**：它写着「行为评测为零——这是已知缺口」，而 `packages/otto/evals/` 今天已存在、行为测试全绿；该文件**不在 §7.5 表 A 本段的写集里**，所以本段不改，请⑥段（写集含 `packages/otto/knowledge/`，同一次改说明书）顺手改成「engine 线 10 题骨架已在 `evals/`，基线待跑」。③**`engine-1` / `engine-6` 的 `forbids:Campaigns` 有误判风险，须在基线定版前看一眼**：说明书本身（`packages/otto/src/instructions.ts`）就写着「别把商家指去 Campaigns」，所以 Otto 诚实答一句「这里没有 Campaigns 那种页面」是**对的**，却会被这条禁词判成不通过。检查跑在产物上、不跑在系统提示上，所以不是必然误判。**处置**：Founder 换钥匙后的第一趟真跑出来，先读这两题的 artifact；真误判就把禁词收窄成动作短语（如 `forbids:go to Campaigns`）或把这一维从机械检查挪进 rubric——**必须在档案定版之前做完**，否则这条噪声会长进「不低于基线」的判据里。 | |
| 2026-09-05 | **②段施工登记(ENGINE-A2,按现码落地的三处)**:(1) §7.2② 写「`orgId` 外键＋租户约束照 `ActionEvent` 同形」,但 `ActionEvent` 的租户列叫 `ownerId`,而运行时守卫**注入**的正是 `ownerId` 这个字面列名 —— 一张 `orgId` 表登记进 `TENANT_MODELS` 会把它打坏(`packages/db/src/tenant-guard.ts` 有 2026-09-02 实测)。故按现码:列名保持规格写的 `orgId`(它就是账本 `reserve:<refId>` 的那把钥匙),登记进 `ORG_SCOPED_TENANT_GUARD_EXEMPT`,租户边界由外键 CASCADE ＋ 读写口显式带 orgId 承担,双租户测试 `packages/db/src/otto-turn-trace-tenant.test.ts`。(2) `settledInternal` 由**入口侧**读账本填(引擎包不直连 prisma,与其他 port 同一条规矩);只有 RESERVE 无终结行时写 null。(3) `steps` 取自 SDK 的轮计数,截断时它是 maxSteps+1(先自增再判上限),测试按「≥ maxSteps」钉,不钉 SDK 内部时序。(4) 写集比 §7.5 A 表②段那一行多一个文件:`packages/otto/src/index.ts`(仅新增导出,零行为),表未列。(5) 落修轮留下的一件,下一次碰这段的人接:`ottoTurn` 与 `ottoApprove` 两门今天只有代码接线、没有回归测试(变异实证:拆掉这两门的 trace,`apps/web/lib/__tests__/otto-actions.test.ts` 全绿;拆掉流式那门则立刻红),补两条断言 `recordOttoTurnTrace` 被调用且 surface 为 "action" / "approve-resume" 即可 | |
| 2026-09-05 | **④段施工登记(ENGINE-A6,按现码落地的六处)**:(1) **规格与现码不符一条,按现码做**——§7.2④ 写「摘要调用走 `withLlmBudget` 同一通道计费,沿用本轮的 refId」。照字面**再调一次** `withLlmBudget(同一 refId)` 会在账本 `reserve:<refId>` 的唯一索引上 no-op(与 F27 同一个旧伤),于是真正那一轮跑在**零预扣**上,结算也 no-op —— 那是钱洞不是计费。故落地成:折叠调用放在**本轮 `withLlmBudget` 的 `fn` 体内**(`packages/otto/src/runtime.ts` 的 `foldRollingSummary`),它烧的 token **加进本轮 usage 一起 settle**。同一通道、同一 refId、零新幂等键三条逐字成立,且 `settleCredits` 仍然 clamp 到已持有额(meter.ts 不变量 #2),所以这一笔只可能少收、不可能多收。(2) **预算的数值 §7.2④ 没给**,本段定为 `OTTO_HISTORY_BUDGET_TOKENS = OTTO_CONTEXT_CAP_TOKENS`(12,000,`packages/otto/src/run-input.ts`):那正是一轮**被定价**的那个数,把唯一无界的输入(历史)钉在它上面,「实结不随历史上涨」才成立。它**不是**「整份提示词 ≤12,000」的意思——单体说明书自己就约这么大,那是⑥段的活,常量注释里写明了。(3) **摘要不是一次性的**:越过预算之后每一轮都会折一次(每轮掉最旧的一点)。单次折叠**输入硬顶 24,000 字符、输出硬顶 400 token**,所以稳态是「主轮(有界)+ 折叠(有界)」,不是新的无界项。(4) **`ottoApprove` 那一门本段未接**,是刻意的:恢复轮喂给 `run()` 的是一个 `RunState`(历史在 SDK 自己手里),不是本段裁的那个 item 数组;§7.2④ 点名的也正是「两个入口」(流式路由 + `otto-actions` 的 `ottoTurn`)。恢复轮的历史裁剪要动 SDK 状态,形状与本段不同,留给之后单独立项。(5) **写集比 §7.5 A 表④段那一行多两个文件**:`packages/otto/src/index.ts`(仅新增导出,零行为,与②段同因,表未列)、`packages/otto/evals/acceptance-map.test.ts`(只把 ENGINE-A6 那一行 `it.todo` 换成指向真身的话——③段那份文件自己写明「后续各段把自己那一行的 `it.todo` 换成真身即可」)。(6) **`packages/otto/AGENTS.md` 今天有两处过期**(三层地图把 `src/run-input.ts` 写成「历史恢复与清洗」,已不含本段的预算闸;「快查」节仍写着「行为评测为零」),但该文件不在 §7.5 表 A 本段的写集里,本段不改——③段已请⑥段顺手改「快查」那句,这里把地图那句一并托给⑥段 | |
| 2026-09-05 | **④段判官落修轮的登记（ENGINE-A6，五条）**：(1) **裁剪切点新增一条谓词：`kept[0]` 必须是 `user` 消息**（`packages/otto/src/run-input.ts` 的 `isUserMessage`）。原稿只防「拆对」，不防「切在 assistant 上」——裁过的 `kept[0]` 就是 provider 的 `messages[0]`，而 Anthropic 的 Messages API 要求首条必须是 user（`system` 那一条由 ai-sdk 适配器提到 `system` 参数，不进 `messages`），所以切在 assistant 上的一刀会让整轮被 provider 当场拒掉：退款、不写 `ottoState`、下一轮重裁到同一个切点，是**确定性复现**的死对话，比本段要治的「越聊越贵」更糟。多裁掉的那一点由折叠吸收。(2) **夹具 Model 从此校验请求形状**（`packages/otto/src/runtime-history-budget.test.ts` 的 `assertProviderMessageShape`）：上一版夹具什么都收，于是 15 轮验收测试第 5–15 轮每一轮都以 assistant 打头却全绿；现在拆掉 (1) 那条谓词，这条断言当场红。(3) **两个入口的接线补上回归测试**：`apps/web/lib/__tests__/otto-actions.test.ts` 与 `apps/web/lib/__tests__/otto-stream-route.test.ts` 各三条（历史裁到预算内、折叠端口真的带着旧轮进引擎、摘要落盘带 ownerId、线程已有摘要逐字回注）——此前删掉两处 `rollingSummary: rollingSummaryPort,` 或把 `buildContextSystemMessage(ctx, priorRollingSummary)` 改回单参数，264 条测试全绿。流式那份是 DB-free 的，为此在测试里给 `tryRestoreRunState` 与 `saveRollingSummary` 装了替身（`where` 子句的断言留在 `otto-actions.test.ts`）；这两个测试文件是 §7.5 表 A ④段那一行两个入口的伴生文件，表只列实现文件。(4) **`saveRollingSummary` 的 `where` 补 `deletedAt: null`**（`apps/web/lib/otto-actions.ts`），与两个入口**读**线程时的 OWNED 口径逐字一致——软删的对话不再被改写摘要。不是租户漏洞（`ownerId` 一直显式在 `where` 里）。(5) **两件按现码登记、本轮不改**：①**折叠调用复用 manifest 自己的主型号**（`packages/otto/src/runtime.ts` 的 `model: runtime.modelRuntime.binding`），不引第二个型号常量；§7.2④「摘要本身是一次便宜的小调用」由两端硬顶（输入 24,000 字符、输出 400 token）＋ `settleCredits` 的 clamp 承担，不由更小的型号承担。②**CJK 每字 2 token 是刻意保守的上界，不是实测值**：它对 Claude 的中文分词是偏高估，所以华语长对话会比 12,000 的字面预算更早开始靠摘要；方向是故意选的（高估＝早裁＝不会有意外账单），代价落在产品侧而不是钱侧。要改成实测值需要一次 `count_tokens` 真调用，留待钥匙可用后重钉 | |
| 2026-09-05 | **⑤段施工登记(ENGINE-A4,截断轮退款)**:(1) **零交付的判定口径按现码定形**——§7.2⑤ 说「由 `runOttoTurn` 侧的计数器给出」,而引擎里没有任何一处能在工具跑的**当下**数数(工具在 SDK 内部执行,非流式那一门连事件流都没有)。故计数器是**折出来的**:`collectTurnDelivery` 走的是与②段 `toolCalls` 逐字同一份事实(`RunState._generatedItems`),在 `usageOnError` 被调用的那一刻折一次。「交付」= 停在审批位上的调用(铸出的卡片)+ **完成**的写动作;写动作的名单不是手抄的,取自注册表里每个技能自己声明的 `effect: "write"`(`packages/otto/src/skill.ts`),挂在 runtime 上叫 `deliveringActionNames`,与 `actionNames` 同折自一份 `deps.skills`。一次成功的**读**(搜网页、查产品)不算交付 —— 轮子死了商家手里什么都不剩,这也正是「搜索腿一并退」的前提。(2) **入口诚实文案没有独立单源**:§7.5 表 A 给本段的写集只有三个文件,`apps/web/lib/otto-error-copy.ts`(既有的「一句话单源」)不在其中,而降级句 `I got a bit tangled up — try asking again.` 今天本来就是流式门与 `otto-actions.ts` 各抄一份的字面量。故本段把退款那半句**并进同一条降级消息**(`… This turn wasn't charged.`),不新开第二条只活一瞬的提示;把这两句收进 `otto-error-copy.ts` 的活留给下一次同时碰这两门的段。(3) **`ottoApprove` 那一门的诚实话还没接上**:它早有 `chargedNothing`(接的就是同一个 `onRefundedFailure`),但它的 `MaxTurnsExceededError` 分支(第 4 支,`apps/web/lib/otto-actions.ts:2407`)不读它 —— 现在那一门的截断零交付轮也退钱了,商家却读不到「没收钱」。`otto-actions.ts` 不在本段写集,故只登记:下一次碰那个文件的段顺手接一句。(4) **①段登记点名的三处失真注释已改**:`meter.ts` 不变量 #5 与 `prices` 字段、`runtime.ts` 的 `PricingLookup` 都改成「未定价即抛」;同处①段留的那个判断题——`prices: mr.pricing(...)` 对 `paid:false` 的夹具也照查价——**维持现状不改**:让每一份 manifest 都必须自带真价目,是 fail closed 的方向,改成「只在 paid 时查价」等于给不查价开一条路。(5) **写集之外只多两类文件,都是测试**:新增 `apps/web/lib/__tests__/engine-a4-truncated-turn-refund.test.ts`(真库行为测试的家 —— `packages/otto` 今天没有真库测试配置,而验收行的后半句「消费历史可见退款行」要的 `buildSpendHistory` 住在 apps/web),以及被本次行为改动打红的既有测试(`packages/otto/src/runtime.test.ts`、`apps/web/lib/__tests__/otto-actions.test.ts`、`otto-stream-route.test.ts`)与两份验收映射表。(6) **验收映射表今天有两份**(`packages/otto/src/otto-acceptance-map.test.ts` 自称「别处不再另立第二份」,而③段又建了 `packages/otto/evals/acceptance-map.test.ts`)。本段两份都改了 ENGINE-A4 那一行,但**没有合并它们** —— 合并要动③段的写集,留给下一次碰 `evals/` 的段(⑥段)一并收口 | |
| 2026-09-05 | **⑤段判官落修轮登记(ENGINE-A4,两条 P1 与三条 P2)**:(1) **交付判词换了取证处(P1-A)**:上一版从 SDK 的 `RunState._generatedItems` 上数「status 是 completed 的写动作」,而 SDK 对 function tool 的结果**一律**写 `completed`(`@openai/agents-core` 的 `getToolCallOutputItem` 两条返回路径都写死),于是三种失败的写全被算成交付 —— `execute` 抛错(我们没给 `tool()` 传 `errorFunction`,SDK 的 `defaultToolErrorFunction` 把错误折成一句普通文本当返回值)、`requires` 闸的 `{ needMoreInfo }`、以及技能自己的 `{ ok:false, error }`(`packages/otto/src/skills/manage-canvas.ts` 一连串就是这个,也正是「Otto 拿错参数反复重试直到跑满步数」那条最典型的死胡同)。改法:落盘的证据只能在**工具返回值**那一层取,故在 `createOttoRuntime` 里给每个 `effect:"write"` 的技能包一层(`countingDeliveryTool`),它真的落盘时在**这一轮自己的计数器**上记一笔;计数器按 `OttoContext` 对象分账(`WeakMap`,与 `ctx.research.searchSlots` 同一种「随 run 走」的形态,记在 WeakMap 而不是 ctx 字段上,只因 `packages/otto/src/context.ts` 不在本段写集)。判不出来就当没落盘,方向是退钱。卡片仍从 state 上数(那一半 SDK 没有说谎)。(2) **恢复轮的起点(P1-B)**:`RunState.fromString` 把上一轮的 `_generatedItems` 整条带回来(SDK 侧 `generatedItems = preStepItems.concat(newStepItems)`,序列化/反序列化都原样保留),里面就有上一轮那张 `tool_approval_item` —— 那张卡的钱早在**别的 refId** 下付过。上一版从 0 数起,`ottoApprove` 那一门因此在一步都还没跑的时候就已经「有交付」,本条验收在那条钱腿上等于没落地。改法:`ottoBudgetArgsFor` 先折一次起点(`turnBaselineItemCount(request.input)`,数组/字符串输入天然是 0,两条对话门不受影响),只数这一轮新长出来的那一截。**并据此更正本段上一条登记的 (3)**:那一行写「现在那一门的截断零交付轮也退钱了」是**不实**的 —— 落修之前那一门一次也没退过;落修之后它才真的会退,所以「商家读不到没收钱」这个缺口从此刻起才成立,`apps/web/lib/otto-actions.ts:2407` 那句诚实文案仍待下一次碰那个文件的段接上。(3) **`ottoTurn` 那一门同样缺这句诚实话(P2-2)**:`apps/web/lib/otto-actions.ts:1913` 用的是裸 `meter: withLlmBudget`(没挂 `onRefundedFailure`),:1916 的降级句写死 `I got a bit tangled up — try asking again.`;它的 refId 是 `otto-turn:<userMessageId>`,零交付截断轮现在也整笔退,商家同样读不到「没收钱」。与 :2407 并列登记,让下一次碰 `otto-actions.ts` 的段一次接两处。(4) **流式门的钩子改成先转调再置旗(P2-3)**:`apps/web/app/api/otto/stream/route.ts` 原来用对象展开硬盖 `onRefundedFailure`;今天引擎侧不产出这个字段所以无害,但将来会被静默吞掉,已改成 `budgetArgs.onRefundedFailure?.()` 之后再置旗。(5) **写集溢出那一行仍待追认(P2-1)**:`packages/otto/evals/acceptance-map.test.ts:30`(③段写集)本段改了一行,③段已在主干、无活冲突,请编排者/Founder 一句追认,或留给⑥段合并两份映射表时一并收口 | |
| 2026-09-05 | **③段 ENGINE-A1 基线首跑入档 ＋ 评测尾巴 P2-8/P2-9/P2-10（Founder 换钥匙后）**：**(0) 基线已入档**——`packages/otto/evals/baselines/engine.json`：日期 `2026-09-05T04:41:45.920Z`、commit `2cb54e2d`（＝本次 `origin/main`，也正是被测的那份 `instructions.ts`；本 PR 不动它、不动题目、不动 `checks/`、不动判分算式，所以这份档案就是⑥段「不低于基线」的比较对象）、型号 `claude-sonnet-4-6`（被测与判分同一个）、**总分 65.0%（26.0/40）**、**真实花费 $0.4617**（远低于单次上限 $10 与 §7.7 预估的 $1.7–$6.3——本骨架每题只发一次调用，不跑满 10 步）。逐题：engine-4/5 满分，engine-8 88%，engine-10/6/9 75%，engine-1/7 50%，engine-3 25%，engine-2 13%；掉分集中在「没照台架后缀的要求把工具名与字段说出口」（engine-2/3/7 的 `mentions-all` 未过），那正是⑥段要改善的东西。**(1) P2-8 逐题结论：六条 `forbids` 一条都没有误判，本轮零改动**。证据：全 10 题产物里 `campaign`／`segment`／`inbox`／`extend`／`proposepack`／`proposeresearch` 六个子串**一次都没出现**（大小写不敏感全文扫）；engine-1（`Campaigns`）、engine-3（`proposePack`）、engine-5（`extend`）、engine-6（`Campaigns,Segments,Inbox`）、engine-7（`already researched`）、engine-8（`proposeResearch`）全部通过，且都不是「险过」。**残留风险照实登记，触发条件写死**：这些检查是**裸子串**，判不出「指去 Campaigns」（错）与「这里没有 Campaigns 那种页面」（对）的差别，也判不出 `extend` 与 `extended`／`extension` 的差别；本轮之所以零命中，是因为 Otto 大多先反问两句、没有展开列工具——而⑥段要做的恰恰是让它说得更全，命中概率只会上升。**下次任何一趟跑出「诚实答案被禁词判掉」就立即改**：把该题禁词收窄成动作短语（如 `forbids:go to Campaigns`），或把那一维从机械检查挪进 rubric（engine-6 的 rubric 第二条本来就覆盖同一件事）；不要在没有实证误判时预先放宽——放宽等于送一个永远不会失败的白分，对基线的污染方向相反、程度相同。**(2) P2-9 落地**：`SEGMENT_BUDGET_USD`（$20）从「记账口径、只印不拦」改成**真闸**——开跑之前把 `baselines/` 里每一份档案的 `costUsd` 求和（`recordedSegmentUsd`），加上本次全跑的最坏花费（`worstCaseRunUsd`：每题一次被测调用，有 rubric 的再按判分重试一次算两遍，整体被单次 $10 硬上限截住），超过 $20 就拒跑、一分钱不花、非零退出；`core.ts` 的常量注释与 README「预算」一节同改成实话（此前写着「代码里没有任何地方据它停跑」）。实跑印证：第二趟的开跑行读到「已记 $0.4617，本次最坏 $0.8786」。**(3) P2-10 落地**：`main()` 里的三道守卫（`ANTHROPIC_BASE_URL` 那颗 404 雷、`--check` 没有基线可比、累计预算）抽成纯函数 `preflight()`，由 `guardedRun(verdict, run)` 执行——真跑的那一趟是**传进去的闭包**，守卫不过它根本不会被调用；回归测试用 mock 被测对象与 mock 判分器钉住「守卫没过时两者调用次数为 0」，谁把守卫挪到花钱之后都会当场红（`packages/otto/evals/evals.test.ts` 的「ENGINE-A1 守卫在花钱之前」一组 7 条）。**(4) 本轮没做成的一件，请 Founder 知悉**：本想在 P2-9/P2-10 落地之后**再跑一趟完整的**，好让档案的 commit sha 指向本分支的头，但第二趟开跑即被 Anthropic 挡回 `Your credit balance is too low to access the Anthropic API`——钥匙本身有效（零 token 探针 `GET /v1/models?limit=1` 仍是 `http_status=200`，那是鉴权不是计费），是**账户余额被首跑之后耗尽**。**这不影响基线成立**：P2-8 判定零修正＝没有「受影响的题」要重跑，而 P2-9/P2-10 只动开跑前的守卫与可测性，**没有碰被测对象、题目、机械检查或判分算式**，所以首跑那一份就是「修正后的完整跑」，其 `commit: 2cb54e2d` 恰好精确指向被测的那份说明书。若要一份 sha 落在本分支头上的档案，充值后 `set -a; . .env.local; set +a; env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals` 重跑一次覆盖即可（约 $0.5，注意新的累计闸会把这一份的 $0.4617 一并算进已记花费） | |
| 2026-09-05 | **⑦段落地登记(ENGINE-A3,画布输入即对话)**:(a) **§7.6 处置一已按建议默认值落地**(§7.8 明写 Founder 不另裁即照建议一)——新组件 `apps/web/components/otto/ConversationCostHint.tsx`,常驻在画布 composer 上方那一叠里,与既有的理解／搜索两条同一处;文案明写「Otto checks with you on a card before it makes anything — and the conversation itself is charged for what it uses」＋现算的预扣上限(数值全部由 `CHAT_HOLD_NOTE` 从 `OTTO_CONVERSATION_TURN_RESERVE_INTERNAL` 推,零字面量);门厅(`OttoFrontDoor` 画布形态)此前**一条价目披露都没有**,本段补上对话与搜索两条(理解那一条不挂:门厅没有附件入口,替一条走不通的路报价是另一种不诚实)。billing 页那句「Credits don't expire」本段一字未动。(b) **退役范围比 §7.2⑦ 字面更宽一格,理由与代价写明**:§7.2⑦ 点名撤「工具条 Generate 按钮＋直接生成的 composer」。该 composer 在 `FlowCanvas.tsx` 有**两处渲染**(gb 皮与旧皮),两处调的是同一个 `handleGenerate`;只撤 gb 那一处会在文件里留下第二份同样的直出付费路,「画布上没有直接花钱的控件」这句话就不成立,故两处与 `handleGenerate` 一并删除。**连带撤掉的是那个 composer 自己的四格控件**:张数(#547 A2)、形状(#643 T2)、成组(#777)、**精修(Creation 规格里「高细节 / pro 档」那一格能力)**——它们只长在那个输入条上,别处没有第二个入口。(c) **由此产生一个缺口,请 Founder 裁**:`fineDetail` 这个参数在 `packages/otto/` 里今天**一个字都没有**(全仓只在 `packages/core/src/gen.ts`、`apps/web/lib/gen-actions.ts`、`useCanvasGen.ts` 与画布 composer 之间流动),所以⑦段之后**商家侧暂时没有任何地方勾得到「精修」**。Creation 规格里管这一格的那条**冻结验收本身不受影响**(它判的是服务端「请求未定价的 pro SKU ⇒ 拒绝生成、$0」,真身在 `apps/web/lib/__tests__/creation-routing-ledger.test.ts`,本段一字未动;按 M2 纪律本行不写别家编号,该文件里逐字带着它);受影响的是**商家的可达性**。要不要给 Otto 的确认卡补这一格(以及张数/形状/成组三格由 Otto 在对话里谈定的口径),不是本段能自决的事。随之删除的是 `canvas-image-shape-ui.test.ts` 里两组只测那个 composer 的断言(12 条);同一文件里「再来一张继承本卡形状」那 4 条原样保留。(d) **写集比 §7.5 表 A ⑦段那一行多两处**,均登记:新增 `apps/web/components/otto/ConversationCostHint.tsx`(两个挂载点共用一份文案,写成第二份抄件必然先漂),与随行的测试文件(表 A 从来只列产品代码);(e) `ChatThread.surface` 现在由 `CanvasOttoOverlay` **明写** `"canvas"`,不再靠 `coerceThreadSurface` 的兜底默认值;三把幂等键一把没动 | |
| 2026-09-05 | **尾巴组六落地登记(ENGINE-A4 / ENGINE-A2,`otto-actions.ts` 两门)**:(1) **诚实文案接上了(⑤段登记的两处缺口)**——`ottoTurn` 从前用裸 `meter: withLlmBudget`(不挂钩子)、降级句写死;现按流式门逐字同形挂上 `onRefundedFailure`(`apps/web/lib/otto-actions.ts:1958` 置旗、:1980-1989 先转调再置旗)，:2002 的降级句在整笔退款时变成 `I got a bit tangled up — try asking again. This turn wasn't charged.`。`ottoApprove` 早有 `chargedNothing`(:2131),只是第 4 支(截断)不读它,现已读(:2499)。**不新开第二条提示、不新造第二份字面量**——三门共用同一句,`otto-error-copy.ts` 的单源化仍是后话。顺带把 `ottoApprove` 的钩子也改成先转调再置旗(:2426-2428),它此前是对象展开硬盖,与流式门 P2-3 同一个隐患。(2) **两门的 trace 补上回归网(②段登记留的那一件)**:`apps/web/lib/__tests__/otto-actions.test.ts:3046` 与 `:3090` 各一条,断言 `recordOttoTurnTrace` 真被调用且 `surface`/`threadId`/`refId` 逐字正确(恢复轮那条钉 `otto-approve:<threadId>:<cardId>:a1`)。变异实证:拆掉两处 `trace:` 之后这两条**当场红**(此前整个文件全绿)。(3) **④段登记的 `saveRollingSummary` 的 `deletedAt: null` 已在主干,本组零改动**:证据 `apps/web/lib/otto-actions.ts:1738` 与既有测试 `otto-actions.test.ts:2973`(「摘要落盘,带本对话的 ownerId 与未删除约束」),故跳过。(4) **写集零溢出**:只动 `apps/web/lib/otto-actions.ts` 与它的测试;`packages/otto` 一行未改。 |
| 2026-09-05 | **⑥段（技能文件柜替换单体）落地登记：与 §7.2⑥ 写法不同的六处，均按现码做，§7 未动**。①**「退役」的形态是变成装配器，不是删文件**：`packages/otto/src/instructions.ts` 里 4.3 万字节的单体常量没了，文件本身留下来当**每轮装配器**（`assembleOttoInstructions`），另加 `src/knowledge-cabinet.ts`（纯机制：解析／排序／匹配／渲染）与 build 期产物 `src/knowledge-cabinet.generated.ts`。`ottoInstructions` 这个名字**保留**，含义改成「**整柜**装出来的那一份」——全仓约 150 处存在性守卫（含 `apps/web/lib/__tests__/` 五个文件）问的是「这句话还在说明书里吗」，那是整个柜子的问题；恢复轮（approval-resume）也用它，照 B9 已冻结的「恢复轮全量装载」。②**golden 快照迁移的读法**：§7.2⑥ 说「换成对 `_core.md` 与生成产物取快照」，而把生成产物的**正文**整份冻结＝换个地方继续冻结同一坨字节，与同一句话的后半「按需装载的部分不再逐字节冻结」相冲。落地取：`__snapshots__/otto-core.golden.txt` 冻常驻薄层全文，`otto-knowledge-cabinet.golden.txt` 冻**柜子的形状**（有哪几份／书脊标签／装载关键词），按需装载的正文不冻。加一份文件、改一句书脊、动一个关键词仍会红——那三件都在改「Otto 每轮见到什么」。③**`_core.md` 不是最薄形态（15.7 KB，整柜 49 KB）**：钱、审批、诚实、界面地图四组铁律必须每轮带，挪进按需装载等于给没对上关键词的那些轮次拆掉护栏。实测：没对上标签的一轮 15.6 KB（整柜的 31%），一句「做一张海报」27.7 KB（56%）——原来每轮都是 100%。④**多出第三种文件身份 `reference`**（`when: reference`＝在柜中、有书脊、但永不进上下文）：③段建的两份华语手艺档 `knowledge/craft/seedance.md` 与 `seedream.md` 归此类。三条理由：它们自己写着「代码里的那几份仍是运行期权威，本文是给人读的同一份手艺」，装进上下文＝把两个 action 的 description 抄了第二份；它们是给人读的华语长文，含仓库路径，而 Otto 的铁律正是「你看不见代码」；且它们的 `<名字>` 占位写法里的 `>` 会被 `instructions-nav-map.test.ts` 的导航分隔符检测当成拼路（实测红 8 行）。两份仍在柜中，`evals/checks/glossary.ts` 照旧从 `seedance.md` 解析镜头术语表。⑤**装载口径是确定性关键词匹配**：ASCII 词按词边界（`ad` 不被 `already` 命中）、含 CJK 的词按子串；只对**对话里的话**（`role:"user"|"assistant"`）匹配，**不含我们自己注入的 `role:"system"` 上下文** item——那条 item 带着品牌记忆与素材清单，天然含 image／product／Library，让它参与匹配等于每轮把柜子全打开，且它一变（多一个产品名）装载结果就变、基线不可比。⑥**②段的 `skillFiles` 已在本段收尾时接上**（②段本场合入主干 #1199，本段合并主干后当场接线）：`collectTurnTraceFacts` 多收一个「这一轮装了哪几份」的入参，并与工具名同一条纪律**过白名单**——名单是 build 期的柜子本身（`allKnowledgePaths()`），柜外的字符串无处可落，②段那条「无明文」的结构保证一点没松。②段留的空表断言（`skillFiles` 恒为空）随之改成两条真判据：常驻薄层永远在、列出来的每一份都是真柜文（`src/runtime-turn-trace.test.ts` 与 `apps/web/lib/__tests__/otto-stream-route.test.ts`，后者也是写集溢出的一处）。另导出纯函数 `instructionsForTurn(input)`，与 `runOttoTurn` 内部用的是同一个，入口需要自己算那份名单时用它。**写集溢出九处（请编排者/Founder 追认；判官 r2 [P2-7] 逮到原稿只登记了七处，漏两个）**：`.gitignore`（根目录 `_*.md` 那条会吞掉 `_core.md`，而这个文件名是 S1 §1 九问 4 冻结的柜子形态——加了一行 `!packages/otto/knowledge/_core.md`）；`packages/otto/src/index.ts`（导出上面那道缝）；`packages/otto/evals/runner.ts` 与 `evals/README.md`（被测对象从整份单体改成**这一题装出来的那一份**——否则跑分测的不是商家真拿到的东西；台架后缀一字未动）；`packages/otto/evals/acceptance-map.test.ts`（ENGINE-A7 那一行的说明）；`apps/web/lib/__tests__/crm-honest-preview.test.ts` 与 `creation-nav-flagship.test.ts`（两者**直接读**已被删掉的 `otto-instructions.golden.txt` 文件，改成 import `ottoInstructions`）；`apps/web/lib/__tests__/otto-stream-route.test.ts` 与 `packages/otto/src/runtime-turn-trace.test.ts`（②段那条「`skillFiles` 恒为空」的断言，见上 ⑥）；`packages/otto/AGENTS.md`（③段 2026-09-05 登记点名要⑥段顺手改，已改）；另 `knowledge/craft/seedream.md` 一句里的 `caption-free` 改写成「「不要字幕」的防字幕措辞」——裸词 `free` 触发金额启发式词表；**判官 r2 [P2-7] 补登的第八、第九处**：`scripts/__tests__/quality-legs.test.sh`（闸门自检表新增 `checks|otto knowledge cabinet freshness` 一行；PR 描述的「闸门改动:」那一行已如实说明，但 §5 是长期工件，该在这里也有名字）与 `packages/otto/src/instructions.test.ts`（golden 两条与柜子形状的断言都在这里；写集只列了 `instructions.ts`，没列它的测试）。**另记一处失效指针，不在本段改**：`docs/specs/wave2-shell.md:152` 仍指着本 PR 删掉的 `packages/otto/src/__snapshots__/otto-instructions.golden.txt`——该文件不在⑥段写集，登记待下一次碰 wave2-shell 的那一段顺手改。**ENGINE-A7 的跑分仍跑不出来**：主检出 `.env.local` 的 Anthropic 钥匙 2026-09-05 本段再验一次仍是 **401**（零 token 探针 `GET /v1/models?limit=1` → `http_status=401`），`evals/baselines/engine.json` 因此仍不存在，**本段实际花费 $0.0000**。已实跑确认 `evals:check` 一分钱不花就非零退出（输出「没有基线可比」）。所以 `acceptance-map.test.ts` 里 ENGINE-A7 那一行**仍是 `it.todo`**：机制（柜子／生成器／装配器／新鲜度闸／单体退役）已交付并有 26 条行为测试（`src/knowledge-cabinet.test.ts`），但「总分不低于基线」没有比较对象，把机制测试当成这一行过了就是自欺。**解闸**：Founder 换一把有效钥匙进主检出 `.env.local` 之后跑两趟——先在⑥段之前的主干 commit 上跑一次写基线，再在本段之上 `evals:check` 对分。 | |
| 2026-09-05 | **⑥段判官落修轮登记（P1 一条已修，P2 八条：四条当场修、四条转登记）**。**已修**：①[P1-1] ⑥段唯一的承重接线——每轮装出来的说明书**真的送进模型**——此前零测试覆盖（判官变异实证：把 `packages/otto/src/runtime.ts` 两处 `execution.runAgent(agent, …)` 改回 `runtime.agent`，全套 otto 测试 1482 条一条不红，而每一轮都退回整柜、②段档案却照样记 `skillFiles: ["_core.md"]`——档案会声称一份模型根本没拿到的名单）。已在 `packages/otto/src/runtime.test.ts` 加一组两条：截下真正交给 SDK 的那个 agent，断言新鲜轮 `agent.instructions === assembleOttoInstructions(输入).text`（两句不同的话装出两份不同的说明书，且都不等于整柜），恢复轮 `agent.instructions === ottoInstructions` 且 agent 就是 `runtime.agent` 本身；本轮重跑同一变异**当场变红**。②[P2-1] `skillFiles` 的白名单过滤此前也没有直接围栏（删掉 `runtime.ts` 那行 filter，两处测试仍全绿）——已在 `packages/otto/src/runtime-turn-trace.test.ts` 加一条：直接给公开函数 `collectTurnTraceFacts` 喂一个柜外字符串，断言它落地、且不出现在序列化结果里；重跑该变异当场变红。③[P2-2] #802 ③/④ 两道「源码里一个地名都不许手打」的围栏原本只扫 `instructions.ts` 与 `connection-copy.ts` 的 TS 字面量，而本段把散文整体搬进了 `packages/otto/knowledge/**.md`——扫描面跟着搬：`packages/otto/src/instructions-nav-map.test.ts` 新增两组 `it.each`，量的是 `KNOWLEDGE_CABINET` 每一份的 `f.text`（已剥 HTML 注释、**占位符尚未替换**，所以 `{{navLabel:library}}` 这类小写 key 不会误伤），外加扫描面自检与探针。迁移当时零命中（与判官逐词扫的结论一致），这道围栏是为下一次写柜文的人立的；实测往一份柜文里塞一句「Reconnect it under Connections, then open the Library page.」两条同时变红。④[P2-3] `knowledge/craft/seedance.md` 与 `seedream.md` 的自述句写着自己「对上书脊标签时整份装入本轮」，而两份的身份是 `reference`、永不进任何一轮——已改成实话（有书脊在册、`evals/checks/glossary.ts` 从这里取词、但不进上下文）。两处改动都在 HTML 注释内，`knowledge-cabinet.generated.ts` 零变化（注释不进模型）。⑤[P2-4] 柜子形状 golden 把两份 `reference` 件印成 `when: (always)`（`f.when` 空表掉进兜底分支），复审桌上的工件于是把「永不装载」写成了「每轮必带」——形状行加了 `mode:` 一栏，`vitest -u` 更新快照。**转登记，不在本段动**：⑥[P2-5] `packages/otto/src/model.ts:115` 的注释写着 Otto 的前缀是 **CONSTANT**、`:121` 按「system 块 ~4.7k tokens、5 分钟 TTL 内按缓存价读」推理，而⑥段之后断点 2（leading system message）**不再跨轮恒定**：一轮的话拉进一份新柜文，那一轮就付一次 cache write 而不是 cache read（断点 1 的工具块不受影响，`:119-120` 本来就预判了；轮内 steps 2..N 也不受影响）。**这条登记原本写着「今天装载集单调增，所以付 cache write 的轮次上限是 12 份按需柜文，净账很可能仍是赚的」——那句推理在合入④段之后已经失效，此处改成实话**（判官第二轮 P2-2）：匹配输入是**这一轮此刻真正带着的上下文**（裁剪后的历史 ＋ 滚动摘要 ＋ 本轮刚裁掉的那几轮，见⑦[P2-6]），而摘要每折一次就被整段重写，某个话题从此不再被提起是常态——那份柜文当轮掉出装载集，下一轮商家又提起时再装回来。所以装载集**不单调**，前缀可以反复变，「cache write 的轮次上限 12 份」这条上界不成立。缓存净账是赚是亏**没有数**：装载集的实际抖动频率没测过，§7.7 那句「实测峰值口径约 $0.17/轮」又是按旧缓存假设算的。两个数都要等一次真跑（同一把钥匙，与 ENGINE-A7 的基线同一趟）。`model.ts` 不在 §7.5 表 A ⑥段写集，照①段给 `meter.ts` 注释的先例登记：请下一次碰 `model.ts` 的那一段顺手改注释与数字。⑦[P2-6] **已修，不再是待办**（原稿那句「④段今天不在主干……所以这不是活缺陷」在 2026-09-05 已成假话：④段 PR #1206 当天并入主干 `902da909`，本 PR 合并主干后它就是**活缺陷**，判官已在真合并树上复现）。**病灶**：④把最旧的几轮裁走之后，把某份柜文拉进来的那几个词就从 item 数组里消失，装配器只看裁剪后的历史 → 下一轮该文件掉出装载集，Otto 丢掉一条他两轮前还遵守的规矩，无红无告警。**本刀的处置**（不是「装载集只许增不许减」那种跨轮记忆——那会直接违反取用三规则③）：装配器的匹配输入改成**这一轮此刻真正带着的整段对话**——裁剪后的历史 ＋ 线程的 `rollingSummary`（被折走那部分的压缩形态）＋ 本轮刚裁掉、还没进摘要的那几轮。落地三处：`packages/otto/src/runtime.ts` 新增 `OttoCarriedContext` 与 `joinMatchText`，`instructionsForTurn(input, carried?)` 多收一个入参（`OttoRollingSummaryPort` 天然是它的实现），`runOttoTurn` 把 `request.rollingSummary` 传进去；两个入口的端口判据从「这一轮裁掉了东西」放宽成「裁掉了东西**或**线程上已有摘要」（`apps/web/app/api/otto/stream/route.ts` 与 `apps/web/lib/otto-actions.ts` 的 `planHistoryBudget`）——**折叠与钱路一个字没动**：引擎侧 `dropped.length > 0` 那道判据原样，零裁剪的一轮照旧零模型调用、零落盘。**取用三规则③「用完不带入下一轮」逐字仍成立**：没有任何跨轮状态被保存，每一轮都是从它自己此刻的上下文重算的纯函数；摘要里不再提的事，下一轮照样掉出去（`packages/otto/src/knowledge-cabinet.test.ts` 第三条钉的就是这一点）。**回归测试五条**（变异各自实证：把匹配改回只看裁剪后历史 → 前四条红；把 `runOttoTurn` 的第二个入参删掉 → 第四条红；把两个入口的端口判据改回 `dropped.length > 0` → 第五条各自红）：`packages/otto/src/knowledge-cabinet.test.ts` 四条（裁剪那一轮 / 裁剪之后的每一轮 / 规则③仍成立 / 那条 system 上下文仍不参与匹配）、`packages/otto/src/runtime.test.ts` 一条（端口真的走到装配器）、`apps/web/lib/__tests__/otto-stream-route.test.ts` 与 `apps/web/lib/__tests__/otto-actions.test.ts` 各一条（两个入口）。**本轮新增的写集溢出两处，请追认**：`apps/web/lib/otto-actions.ts` 与 `packages/otto/src/index.ts` 的类型出口 `OttoCarriedContext`（`apps/web/app/api/otto/stream/route.ts` 与两个入口的测试文件此前已在册）。另注 §7.5 给 `runtime.ts` 定的合并序是 ②→④→⑤→⑥，实际落地序是 ②→⑥→④：本 PR 合并主干时按语义合（④的裁剪→折叠→回注链与⑥的装配链都保留，`runtime.ts` 自动合无冲突），并顺带更新 `__snapshots__/otto-core.golden.txt` 一行——那是主干 #1207 改了 `packages/core/src/navigation.ts` 的 `merchantNavMap()`，柜子照旧现算，不是柜文改动。⑧[P2-7] §5 的「写集溢出七处」比实际少两个文件，另有一处仓库内失效指针——已在上一行就地补全（`scripts/__tests__/quality-legs.test.sh`、`packages/otto/src/instructions.test.ts`、`docs/specs/wave2-shell.md:152`）。本落修轮又多两个同类文件：`packages/otto/src/runtime.test.ts` 与 `packages/otto/src/instructions-nav-map.test.ts`（写集只列了 `runtime.ts`/`instructions.ts`，没列它们的测试；`__snapshots__/` 本身在写集内）——一并请追认。⑨[P2-8] **ENGINE-A7 自己的验收行仍未证明，请 Founder 按 §7.5 报告-选择处置**：`packages/otto/evals/baselines/` 下只有 `README.md`，`engine.json` 不存在，所以「重跑评测总分不低于基线」没有比较对象，`packages/otto/evals/acceptance-map.test.ts` 那一行仍是 `it.todo`（M3 允许占位；ENGINE-A7 逐字出现在 28 条测试名里）。堵它的是③段已登记的**同一把 401 钥匙**，这已是第二段卡在这里。⑥段是**带着验收行敞口交付**的。**解闸两趟**：Founder 换一把有效 Anthropic 钥匙进主检出 `.env.local` 后，先在⑥段之前的主干 commit 写基线，再在本段之上 `evals:check` 对分，然后把 `it.todo` 转成实测；跑前先按③段登记核 `engine-1`／`engine-6` 的 `forbids:Campaigns` 误判风险——那条噪声一旦长进基线就洗不掉。**本落修轮实际花费 $0.0000**（未发任何模型调用） | |
| 2026-09-05 | **尾巴组八:四份 PR 的判官 P2 一次收口(ENGINE-A3 与三份画布/引用选择器的尾巴)**:(a) **ENGINE-A3 的披露补到门厅另一支**——`OttoFrontDoor` 的非画布形态(四颗目标格子那一屏;全仓两个挂载点:侧栏面板 `components/otto/panel/OttoPanelConversation.tsx` 与画布覆盖层)从前零价目披露,而按下任一颗格子就把标签本身送出去、开一条按用量计费的对话。补的是⑦段**同一个** `ConversationCostHint`,不写第二份价目(数值仍只有 `lib/credit-format.ts` 一处作者);围栏 `lib/__tests__/engine-a3-front-door-disclosure.test.tsx`(4 条,测试名逐字带 ENGINE-A3):四格渲染时披露在场、两支共用一个组件、组件源码里零手抄钱数(判官 #1211 P2-4／P2-3——P2-3 要的「不许写死价钱」围栏此前只罩着理解与搜索那两条小字,新的第三条不在名单里)。(b) **写集溢出三处,均为一行**:`components/otto/panel/OttoPanelConversation.tsx`(真身在 `apps/web/design-system/patterns/otto-panel/`,`components/otto/panel` 是指向它的 symlink)、`lib/__tests__/otto-turn-cost.test.ts`与 `lib/__tests__/otto-greeting.test.ts` 只是删掉传给 `OttoFrontDoor` 的死参数 `entities`(该 prop 已不被读取,判官 #1158 P2-J3);不删这几处传参,`tsc` 不过。(c) **「没拿到回答」那句话收成单一源**:`Couldn't save that — please try again.` 主干上有八份互相抄写的字面量(画布、排程卡、记忆/排程/品牌三处服务器动作、排程服务层),新增叶子模块 `apps/web/lib/save-failed-copy.ts` 作唯一作者,其余全部 import;围栏 `lib/__tests__/save-failed-copy-single-source.test.ts`(3 条)扫 `app/`、`components/`、`lib/`,第 9 份字面量出现即红(判官 #1197 P2-3)。**写集溢出五处**:`lib/memory-actions.ts`、`lib/schedule-actions.ts`、`lib/schedule-service.ts`、`lib/brand-record-actions.ts`、`components/otto/OttoSchedule.tsx`——各一行,把字面量换成那一个 import,零行为变化;不改它们,「单一源」就还是一句话而不是一道闸。(d) **两份画布/引用选择器的服务端与 a11y 缺口补测**:引用搜索的服务端页上限从前只有客户端那一半有测试(判官 #1158 P2-J1),`lib/__tests__/reference-search.test.ts` 新增真库一条(同一 org 播 12 行,`limit: 32` 仍只回一页上限,并按 cursor 取到下一页、两页零重叠);`lib/__tests__/reference-picker-unified.test.tsx` 新增 `aria-activedescendant` 的真 DOM 断言(判官 #1158 P2-J4:属性指的 id 必须解析到屏幕上真实存在、且标着 `aria-selected="true"` 的那一行,ArrowDown 后跟着挪、Escape 后不留悬空指针)。(e) **两处文字修准,零行为**:`components/canvas/nodes/CanvasNodeFooter.tsx` 抬头注释里「与夹具是同一个序号」那半句已被规格否掉,改成指向 `docs/specs/frontend-baseline.md` §5 差异 ⑦ 的指针(判官 #1194 P2-1);`frontend-baseline.md` §5 两行修准——围栏条数 16→17(实测 grep 计数)、空态那条的「全仓只有那一处」改「生产侧只有那一处(夹具是设计源)」(判官 #1197 P2-2 与 #1158 P2-J2)。**四次变异实证**(逐次实跑并还原):摘掉门厅披露⇒(a) 两条红;把一处 import 换回字面量⇒(c) 红并点名该文件;把 `aria-activedescendant` 指向不存在的 id⇒(d) 红;拿掉服务端的 `Math.min(..., 上限)`⇒(d) 红。(f) **落修轮追记:一处活着的缺口,请 Founder 二选一(本刀未动那一页的码)**——`components/start-something/StartSomething.tsx:55`(`/create` 起步页)按下送出后,`lib/canvas-entry-actions.ts:78` 在同一笔事务里建好 `surface="canvas"` 的对话,`components/canvas/ImmersiveCanvasEntry.tsx:182` 把它连同 `pendingFirst` 一起交给画布,`components/canvas/CanvasOttoOverlay.tsx:44` 因 `activeThread` 已经在而直接走 `OttoChatStream` 那一支(本刀新挂披露的门厅那一支被整个跳过),`components/otto/OttoChatStream.tsx:631-643` 挂载即把第一轮送出去(预扣 `otto-stream:<userMessageId>`)。如实说就是:**第一轮付费对话由画布上的 `pendingFirst` 自动发出,这条路径从按下到扣钱全程零披露**;(a) 补的披露不在这条路上。此前 PR 描述里那句「两者今天不冲突(那一页确实不发轮次)」不成立——按一下就落进同一类,以本行为准。这正是 ENGINE-A3 §7.6 自己点名的失败态(两边都绿、商家的账单照涨)。不擅自改那一页的文案是因为:`docs/specs/frontend-baseline.md` 里 Founder 2026-09-03 裁决五与其冻结验收行明写该页不许出现「Nothing paid starts…」那一句,给商家加一句可见文案是 Founder 的决定。**请 Founder 二选一**:①松开那一格,给 `/create` 补一句与 (a) 同源的披露;②明裁这条路径不披露,并把该裁决记进规格。(g) **落修轮另两条判官 P2 的处置**:围栏 `lib/__tests__/save-failed-copy-single-source.test.ts` 的扫描名单加上 `design-system/`(判官 #1219 P2-3;`components/otto/panel` 那条 symlink 只罩住一个子树,其余 pattern 从前扫不到),并在注释里写明覆盖边界——`apps/web/e2e/` 与 `packages/` 仍不在名单内;变异实证:在 `design-system/patterns/` 放一份手抄字面量⇒当场红并点名该文件(已还原)。判官 #1219 P2-4(`HAND_TYPED_CREDITS` 正则与 `copyLines()` 在三份披露测试里各手抄一份)是仓库既有体例、不影响任何一道闸咬不咬,**登记留给下一刀**收进一个共用的测试工具模块。**落地**:本行对应 PR(分支 `claude/tails-canvas-create-disclosure`),落修轮在同一分支上追加 | |
| 2026-09-05 | **尾巴组五落地登记（Otto runtime 尾巴，ENGINE-A4 / ENGINE-A6，五条）**：(1) **[⑤ P2-a] 纯读动作不再算交付**：六个只查不写的动作住在 `effect:"write"` 的技能里（`manageCanvas.view`、`manageLibrary.history` / `.detail`、`manageMedia.list` / `.load_more`、`draftWorkflows.validateWorkflowRules`），成功时同样返回 `{ ok:true, … }`，落修前一律被 `countingDeliveryTool` 记成一次落盘 —— 于是「只反复看板、列清单直到跑满步数」的死胡同照收钱，与 ENGINE-A4 相反。**修法（现码最小改法）**：判据留在技能自己家里 —— `packages/otto/src/skill.ts` 的 `OttoSkillSpec` 新增可选 `readOnlyActions: { field, actions }`（`field` 必须是 `parameters` 的 key，工厂在定义期 fail-loud），四个技能各自声明；`packages/otto/src/runtime.ts` 的包装层改收整个 skill，调用时从 SDK 边界那串 JSON 实参里读出动作名比对。**方向**：只有确凿读出判别键、且逐字在名单里才算纯读，读不出来一律退回原行为（记一笔）—— 这一刀只把已证明的纯读从账上摘掉，不新造「该收没收」的口子。**`manageProjects.get_default` 刻意不列入**：它的端口是 `getOrCreateDefaultProject()`，真的可能新建一行 Project，不满足「商家手里什么都没多」。测试：`packages/otto/src/runtime.test.ts` 四条（纯读一轮 ⇒ 判词 null ⇒ 退款分支／同一把工具的真写动作 ⇒ 仍计交付／三次看板＋一次真写 ⇒ 仍计交付／生产六个动作由技能自己声明），`packages/otto/src/skill.test.ts` 两条（判别键校验、字段原样挂上）；变异实证：把 `isPureReadCall` 改成恒 false，只有那一条纯读用例变红。(2) **[④ P2-3] CJK token 估算从每字 2 改成 1.3**（`packages/otto/src/run-input.ts` 新增导出常量 `CJK_TOKENS_PER_CHAR`）：旧值约高估一倍，华语对话因此在 12,000 预算里只装得下英文对话一半的字数就开始折叠丢上下文。**取值依据（是假设，不是实测，注释里写明）**：常用汉字/假名/谚文在 BPE 词表里各收成 1 个 token，生僻字回退成 2–3 个字节片，故真值在 1.0 上下；1.3 是在 1.0 之上留的高估余量（方向仍是早裁）。**仍未实测**，钉死它要一次真的 `count_tokens` 调用，与 ENGINE-A1 基线同一把钥匙、同一趟。测试：`packages/otto/src/history-budget.test.ts` 两条（6,000 字华语历史零折叠、12,000 字触发裁剪并交给摘要）＋ 单位换算那一条改口。(3) **[④ P2-1] 折叠型号从调用处写死改成 manifest 上的一个决定**：`packages/otto/src/model.ts` 新增 `OTTO_SUMMARY_MODEL` 常量（沿用现有型号常量的来源，并进 `assertOttoModelsPriced()` 的组合期查价名单）与 `ottoSummaryModel` 绑定，`OttoModelRuntime` 新增可选 `summaryBinding`（缺省＝主绑定，夹具零改动），`foldRollingSummary` 改从 manifest 取。**今天取值仍等于主力型号，不是偷懒而是没有更便宜的一档**：价目表 `PRICED_MODEL_IDS` 只有 `claude-opus-4-8` / `claude-sonnet-4-6` / `claude-sonnet-4-5`，后两个同价。**真的换小型号要 Founder 两个决定，本轮不自决**：①往 `packages/core/src/llm-prices.ts` 加一行 haiku 档（型号 id 与四个真实单价 —— 猜价已被删掉，查不到就拒绝启动，施工方不得凭记忆填价）；②折叠那条腿的**计价**怎么算 —— 它烧的 token 今天并进本轮 usage、按 `billableModelId`（sonnet）结算，跑小型号却按 sonnet 收对商家是多收，不能默默决定。§7.2④「一次便宜的小调用」今天仍由两端硬顶（输入 24,000 字符、输出 400 token）承担。测试：`packages/otto/src/runtime-history-budget.test.ts` 一条（折叠落在 summaryBinding、主轮落在主绑定，各一次不串）＋ `packages/otto/src/model.test.ts` 一条（组合期查价名单含它、manifest 带下去）；变异实证：把折叠改回 `runtime.modelRuntime.binding`，前一条当场红。(4) **[⑥ P2-5] `packages/otto/src/model.ts` 的提示词缓存注释按现码改口**（该登记原话就是「请下一次碰 model.ts 的那一段顺手改」）：删去「Otto 的**恒定**前缀」与 ~4.7k／~7.7k／~12.4k 三个单体时代的 token 数，改成实话 —— 断点 1（工具块）仍跨轮恒定；断点 2（leading system message）⑥段之后**不再跨轮恒定**（说明书每轮现装，拉进一份新柜文那一轮就付 cache write 而不是 cache read；恢复轮整柜装载是例外），④段之后装载集**不单调**（匹配输入是这一轮此刻带着的上下文，摘要每折一次整段重写），故「一场对话最多 12 次 cache write」不成立；缓存净账与 §7.7 那句 $0.17/轮**都没有数**，等同一趟真跑。(5) **[⑦ P2-2] `packages/otto/src/otto-acceptance-map.test.ts` 抬头计数改成与表内一致**：三条 → 四条（补 ENGINE-A3／⑦段）。**本组三条已在主干做掉、据实跳过，零改动**：⑥ P2-1（`priorState` 为 null 时仍带摘要端口）已落在 `apps/web/app/api/otto/stream/route.ts:307-313` 与 `apps/web/lib/otto-actions.ts:1956`；⑥ P2-2（§5 那句「装载集单调增…12 份上限」）已在本表 ⑥段判官落修轮那一行改成实话；#1198 P2-6（`packages/otto/AGENTS.md` 快查节）已由⑥段更新（`src/skills/CATALOG.md` 57 行与 CATALOG 实测行数一致、两份 golden 与 `evals/` 均在位）。**写集零溢出**：全部落在 `packages/otto/**` 与本行 | |
| 2026-09-05 | **尾巴组五判官落修轮登记（P1 一条已修，P2 四条当场修、一条只是回执措辞）**：**[P1-1] 已修**——`packages/otto/AGENTS.md:37` 那句「基线档案 `evals/baselines/engine.json` 待 Founder 换一把有效 Anthropic 钥匙后才跑得出来」是**过期假话**：该档案早已在库（commit `003cebbe`，10 题、总分 65.0%、花费 $0.4617、对应代码 `2cb54e2d`，20,718 字节），`evals:check` 因此**已有比较对象**（没有基线时 `evals/runner.ts:124-125` 会开跑前就拒绝）。上一轮回执自称「逐条核过现状为真」不实：它核的是目录与文件**存在性**，唯独没核这句话本身的真假。改后写实话，并点明真正未转正的是 ENGINE-A7 那一句「⑥段之后重跑、总分不低于基线」的**对比跑**（跑分仍要一把有效钥匙）。**[P2-1] 已修（同一件事实、同一个写集，与 P1-1 同刀）**——`packages/otto/src/otto-acceptance-map.test.ts:29` 的 ENGINE-A1 行仍写着「`packages/otto/evals/` 今天还不存在」，同样是过期话；改成现状（评测集与基线都在库），`it.todo` 形状不动——这一行的**转正**要换成真身测试，仍留给下一次碰 `evals/` 的段。**[P2-2] 已修（口径不变，注释改成实话）**——`packages/otto/src/skills/manage-canvas.ts:211` 从前写「没有任何新东西因这一轮而生」，偏乐观：`view` 前置的 `syncOttoCanvasNodes`（`apps/web/lib/otto-canvas-bridge.ts:152`）**确实会落 `CanvasNode` 行**——商家刚从聊天开工、结算故意不投影的那批**在飞占位卡**。但那是**显示层**节点，只映射已开工／已在 hold 里的批次，不调 `startGen`、不碰供应商、不碰账本，一分钱不会因这一轮多花。故仍不算交付：把它算成交付＝该退不退，与 ENGINE-A4「宁退不收」的方向相反；摘出交付只会让退款更多，钱路对商家只宽不紧。**[P2-3] 已修**——SDK 出处路径错一段：`invoke` 的类型在 `@openai/agents-core@0.11.8` 的 `dist/tool.d.ts:183`，不是 `dist/types/tool.d.ts:183`（该目录下没有 `tool.d.ts`）。签名本身与主张一致，只是引用指不到；`packages/otto/src/runtime.ts:431` 已改。**[P2-5] 已修**——`packages/otto/src/history-budget.test.ts:49` 的上界从 `toBeLessThanOrEqual(1.3)` 改成 `toBeLessThan(2)`：护栏原意是「别退回旧的 2.0（把华语可容纳字数腰斩一半）」，钉死 1.3 会连**向上的实测修正**一起挡红——将来做真 `count_tokens` 实测量出 1.5 也不该是红。**[P2-4] 无需改码**——只是上一轮回执的措辞不准（自述本规格 §5 那行「只出现 A2/A3/A4/A6/A7」，实为 A1/A3/A4/A6）；M2 不受影响，四个都是本规格自己的编号。**仍登记待办（本轮不做）**：① CJK 每字 token 的**实测**——今天 1.3 是假设不是实测，钉死它要一次真的 `count_tokens` 调用；② ENGINE-A7 的对比跑（`evals:check` 重跑、总分不低于基线）待有效钥匙；③ ENGINE-A1 在两份验收映射表里的转正与两表合并。**写集零溢出**：全部落在 `packages/otto/**` 与本行。 | |

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
