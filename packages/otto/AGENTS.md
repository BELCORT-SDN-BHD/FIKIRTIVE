# Otto 引擎:屋内说明书

> 治理规格:`docs/specs/otto-engine.md`(引擎蓝图 S1,状态以该文件为准)。本文讲「现在的屋子怎么住」;蓝图讲「要装修成什么样」。两者冲突时,以已冻结的规格为准。

## 用语表(全屋统一,先读这个)

- **skill(技能)= 教打法的知识文件**(markdown)。教 Otto「怎么做好」:促销怎么打、提示词怎么写、产品哪里能做什么。加文件即生效,不碰代码。(文件柜已建成:`knowledge/**.md`,生成器 `scripts/gen-knowledge.ts` 在 build 期抄成 `src/knowledge-cabinet.generated.ts`;ENGINE-A7,规格 §7.2⑥。)
- **action(动作)= 类型化工具**(代码)。Otto 真正出手的按钮:铸提案卡、生成(花钱)、排期、查数据。身份、钱、审批的闸全部长在这里。
- **历史包袱**:代码里 action 的旧名叫 "skill"(`defineOttoSkill`、`src/skills/` 目录、`allSkills`、`OttoSkill` 类型)。读到这些标识符时,心里换成 action;施工时逐步正名,正名前两个词并存,以本表为准。
- **关系一句话:skill 指路,action 开门。** skill 文件可以写「这一步用哪个 action」;action 上的闸(身份/钱/审批)永远不因 skill 的任何措辞而解除。

## 三层地图

- **大脑(loop 与知识)**:`src/otto.ts`(组合根)、`src/runtime.ts`(跑一轮)、`src/model.ts`(模型绑定与 529 容灾)、`src/instructions.ts`(**装配器**:每轮现装 = 常驻薄层 ＋ 全部书脊标签 ＋ 对上标签的那几份全文;单体常量已退役)、`src/knowledge-cabinet.ts`(柜子的纯机制)、`knowledge/**.md`(知识本身)、`src/run-input.ts`(历史恢复与清洗 ＋ ENGINE-A6 的成对感知裁剪与 token 预算闸)。
- **手(动作层)**:`src/skills/`(现役 57 个 action;**怎么新增见 `src/skills/AGENTS.md` 的五步法**)、`src/registry.ts`(唯一注册表)、`src/approval-tools.ts`(审批闭集,由三字段机器推导)、`src/context.ts`(port 缝——action 只经注入的 port 碰外界,port 在服务端预绑身份)。
- **钱**:`src/meter.ts`(`withLlmBudget`:预扣→结算→退款单一通道;11 条不变量在文件头,改任何计费逻辑前先读)。
- **家(入口)**:web 全局停靠面板 + `/api/otto/stream`(流式轮);深研走 worker 队列(`src/research-agent.ts`,独立的第二个 agent)。
- **撞名已正名**(⑥段,§7.0 拍板二):Meta 广告领域知识的 TS 数据模块从 `src/knowledge/` 改名为 `src/meta-expertise/`;`knowledge/` 从此只指技能文件柜。

## 未来的人怎么管(三条路,别走错门)

1. **教 Otto 新打法**(新话术、新营销套路、新节日玩法)→ 往 `knowledge/playbooks/` 加一个文件:第一行 `# <书脊标签>`,第二行 `<!-- when: 关键词, … -->`(对上任一关键词才整份装入那一轮;`reference` = 只给人读、永不进上下文),然后跑 `pnpm --filter @fikirtive/otto run knowledge` 重生成——CI 有新鲜度闸。改 `knowledge/_core.md` 是另一回事:它每轮必带、字节冻结,动之前先读 `src/instructions.test.ts` 头部的规矩。
2. **给 Otto 新能力**(新按钮、接新平台、动新钱路)→ 加 action,严格照 `src/skills/AGENTS.md` 五步法 + 三字段声明(`cost`/`effect`/`reach`);花钱必带幂等键;身份字段出现在参数里,工厂直接抛错。
3. **改引擎本身**(loop、计费、审批、上下文装配)→ 先读 `docs/specs/otto-engine.md`;这是重挡,没有已冻结的规格不动工。

## 硬边界(不许商量)

- 身份只来自服务端 principal(`requireOwner()`);skill 文件与 action 参数永远不携带身份。
- 花钱只有一个通道(reserve→settle);审批名单由三字段机器推导,不存在手维护的第二份名单。
- 可操作 ≠ 可绕审批;文件只能指路,不能开门。
- 历次「靠提示词管住模型」在本仓库全部失败,教训一律改成结构约束——新的管束需求照此办理,别再试提示词。

## 快查

- 57 个 action 总表:`src/skills/CATALOG.md`(生成物,`pnpm --filter @fikirtive/otto run catalog` 重生成,勿手改)。
- 提示词现状快照:`src/__snapshots__/otto-core.golden.txt`(常驻薄层,字节冻结)与 `otto-knowledge-cabinet.golden.txt`(柜子的形状:哪几份、书脊标签、装载关键词)。按需装载的正文不再逐字节冻结,由评测分数把关。
- 评测集:`evals/`(engine 线 10 题,`pnpm --filter @fikirtive/otto run evals` 真跑一趟)。基线档案 `evals/baselines/engine.json` **已入档**(commit `003cebbe`:10 题、总分 65.0%、花费 $0.4617、对应代码 `2cb54e2d`),`evals:check` 从此有比较对象。仍未转正的是 ENGINE-A7 那一句「⑥段之后重跑、总分不低于基线」的**对比跑**——规格 §5 2026-09-05 登记。
