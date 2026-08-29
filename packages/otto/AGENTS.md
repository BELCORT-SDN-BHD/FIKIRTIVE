# Otto 引擎:屋内说明书

> 治理规格:`docs/specs/otto-engine.md`(引擎蓝图 S1,状态以该文件为准)。本文讲「现在的屋子怎么住」;蓝图讲「要装修成什么样」。两者冲突时,以已冻结的规格为准。

## 用语表(全屋统一,先读这个)

- **skill(技能)= 教打法的知识文件**(markdown)。教 Otto「怎么做好」:促销怎么打、提示词怎么写、产品哪里能做什么。加文件即生效,不碰代码。(这是蓝图规划的「技能文件柜」;截至本文写作,知识还长在 `src/instructions.ts` 单体里,拆柜是施工项。)
- **action(动作)= 类型化工具**(代码)。Otto 真正出手的按钮:铸提案卡、生成(花钱)、排期、查数据。身份、钱、审批的闸全部长在这里。
- **历史包袱**:代码里 action 的旧名叫 "skill"(`defineOttoSkill`、`src/skills/` 目录、`allSkills`、`OttoSkill` 类型)。读到这些标识符时,心里换成 action;施工时逐步正名,正名前两个词并存,以本表为准。
- **关系一句话:skill 指路,action 开门。** skill 文件可以写「这一步用哪个 action」;action 上的闸(身份/钱/审批)永远不因 skill 的任何措辞而解除。

## 三层地图

- **大脑(loop 与知识)**:`src/otto.ts`(组合根)、`src/runtime.ts`(跑一轮)、`src/model.ts`(模型绑定与 529 容灾)、`src/instructions.ts`(现役单体说明书,约 4.3 万字节——蓝图方向是拆成技能文件柜)、`src/run-input.ts`(历史恢复与清洗)。
- **手(动作层)**:`src/skills/`(现役 57 个 action;**怎么新增见 `src/skills/AGENTS.md` 的五步法**)、`src/registry.ts`(唯一注册表)、`src/approval-tools.ts`(审批闭集,由三字段机器推导)、`src/context.ts`(port 缝——action 只经注入的 port 碰外界,port 在服务端预绑身份)。
- **钱**:`src/meter.ts`(`withLlmBudget`:预扣→结算→退款单一通道;11 条不变量在文件头,改任何计费逻辑前先读)。
- **家(入口)**:web 全局停靠面板 + `/api/otto/stream`(流式轮);深研走 worker 队列(`src/research-agent.ts`,独立的第二个 agent)。
- **易撞名**:`src/knowledge/` 目前是 Meta 广告领域知识的 TS 数据模块,与蓝图的「技能文件柜」撞名;建柜时二者必有一个正名,勿混为一谈。

## 未来的人怎么管(三条路,别走错门)

1. **教 Otto 新打法**(新话术、新营销套路、新节日玩法)→ 文件柜建成后:往柜里加一个 skill 文件,首行写一句书脊标签,当天生效。柜子建成前:改 `src/instructions.ts` 等于改全体商家的说明书——动之前先读 `src/instructions.test.ts` 头部的字节冻结规矩。
2. **给 Otto 新能力**(新按钮、接新平台、动新钱路)→ 加 action,严格照 `src/skills/AGENTS.md` 五步法 + 三字段声明(`cost`/`effect`/`reach`);花钱必带幂等键;身份字段出现在参数里,工厂直接抛错。
3. **改引擎本身**(loop、计费、审批、上下文装配)→ 先读 `docs/specs/otto-engine.md`;这是重挡,没有已冻结的规格不动工。

## 硬边界(不许商量)

- 身份只来自服务端 principal(`requireOwner()`);skill 文件与 action 参数永远不携带身份。
- 花钱只有一个通道(reserve→settle);审批名单由三字段机器推导,不存在手维护的第二份名单。
- 可操作 ≠ 可绕审批;文件只能指路,不能开门。
- 历次「靠提示词管住模型」在本仓库全部失败,教训一律改成结构约束——新的管束需求照此办理,别再试提示词。

## 快查

- 57 个 action 总表:`src/skills/CATALOG.md`(生成物,`pnpm --filter @fikirtive/otto run catalog` 重生成,勿手改)。
- 提示词现状快照:`src/__snapshots__/otto-instructions.golden.txt`(字节冻结)。
- 评测集:蓝图规划的 `evals/`(施工项;截至本文,行为评测为零——这是已知缺口,不是遗漏)。
