---
name: orchestration
description: FIKIRTIVE 编排总手册（三合一）—— 总纲：会话主脑=总指挥只编排不铺码，GPT Sol@ultra=对抗顾问，施工交给 Opus/Sonnet/GPT-5.6。凡开舰队、派任何单、选模型、重大决策要双脑对谈，必读本手册。机器闸=settings.local.json 的 orchestrator hook（skill 是手册，hook 是门禁）。
---

# 编排总手册

> **founder 总纲（2026-07-11 亲定，一句话就是全部规矩）**：
> **「你是 orchestrator，GPT Sol Ultra 是你的 advisor，其他剩下的交给 Opus、Sonnet 或 GPT-5.6。」**
> 以下三章是这句话的执行细则。原 fleet-orchestration / model-routing / two-brain 三本合并于此（founder 2026-07-11："为什么需要三个 skill？一个不就好了"）。与蓝图/playbook 冲突时蓝图赢。

# 第一章 · 谁干什么（模型选派）

# 逐能力模型选派表(2026-07-10)

> 铁律:选派**只认试工打分 + 上岗记分**,不听发布会(见 fleet-orchestration 晋升铁律)。本表随新模型入职考更新;每格标"依据"= 试工/档案/性格红线。名单会过时,制度不会。
> 安全前置:**Sol/GPT 家族全岗位默认只读**(METR 实测最高作弊率+越权删资源);要写码=隔离分支+Claude 全 diff 反作弊审+永不 main/prod/DB/钱路。

## 一、逐能力表(能力 → 首选 / 备选 / 禁用)

| 能力 | 首选 | 备选 | 不用 / 红线 | 依据 |
|---|---|---|---|---|
| **掌舵编排**(架构/写工单/终审/拍板对接) | **Fable 5**(主脑亲任) | — | 不外包;Sol 可当对抗预审(只读) | 会话主脑;判断密度最高处 |
| **灵魂施工**(壳/连通/canvas/旗舰页/钱路形态) | **Opus 4.8** | Fable(体验关键件亲导) | Sonnet(曾"盖楼被退货");Sol(写权限红线) | 体验工作实测过硬 |
| **量产施工**(mock/变体/重复件/文档) | **Sonnet 5** | Haiku 4.5 | — | 幻觉/谄媚低于 4.6,同价 |
| **机械大扫**(URL 验活/清单核对/grep 汇总) | **Luna@medium** | Haiku 4.5 · Terra | — | Luna 试工 A(78 URL+143 内链 6 秒) |
| **对抗审查/第四闸**(soul·钱路大 diff 抓真缺陷) | **Sol@xhigh**(只读) | Opus(异族不可得时) | — | Sol 双 A;抓交叉修复 bug 强于分区质检 |
| **全量终审第四闸**(整分支级大 diff) | **Sol@ultra**(只读) | — | — | ultra=判断之巅,只上刀刃(单应答烧万级 token) |
| **效果过堂**(产出实质"站得住"判定) | **Opus 4.8 主审** | Sol 降第二意见对照 | Sol 独任(判断岗忌作弊倾向) | 档案 2026-07 修正 |
| **内容金标准/文案**(提案/hook/周报示范级) | **Fable 5 亲笔** | Opus | Sol 仅作对照样(无文案基准);GPT 多语言零证据 | 现役最强写手 |
| **视觉设计/品味关键件** | **Fable 5 亲导** | Opus | — | 视觉 SOTA 维 |
| **UIUX 前端施工** | **Opus 4.8** | Sonnet 5(量产页) | — | 前端工艺 |
| **后端/系统/数据模型** | **Opus 4.8** | Sonnet 5 | — | 系统维 |
| **测试编写/QA 剧本** | **Opus 4.8**(真浏览器 QA) | Sonnet 5(单测) | — | 场景实测靠判断 |
| **研究/长上下文读盘** | **Opus 4.8** | Gemini 3.1 Pro(仅"只读大脑",绝不编辑) | Grok(暂缓) | 长上下文最可靠 |
| **成色抽审/量产审计** | **Terra@high**(只读) | Luna | — | Terra 试工 A(Gooseworks 抽审,便宜犀利) |
| **长线可验收磨活**(清 ESLint 债/追偶现 bug) | **Sol `/goal`**(护栏:隔离 worktree/永不 main/可验完成条件/预算封顶/产出永不自动合并) | Opus | — | Terminal-Bench SOTA;省 token |

## 二、多语言警戒(SEA 关键)

华语/马来语/rojak:**GPT 家族零公开证据**。用它产 SEA 内容前必先过自测小卷;首选 Fable/Opus。

## 三、成本纪律

- Codex 计费走 founder ChatGPT plan(非逐笔钱路,但大量后台跑吃 plan 限额)→ 重活/长跑先打招呼,ultra 大单与长跑错峰派。
- Fable 的 token 只花在判断密度最高处;读盘/机械一律下沉便宜档。
- 每类活记分(成本/被采纳率/误报率/返工)入 MODEL-DOSSIER,定期用固定基准复考,证据驱动升降档。

## 四、地平线(约考候补)

Gemini 3.1 Pro(只读大脑候选)· 开源三强(Qwen/V4,自托管压成本备胎)· Grok 4.5(暂缓)。新模型 public → research 真长处 → 标准试工 → 成绩定档 → **本表 + fleet-orchestration 分档表同步更新**。

# 第二章 · 舰队怎么开（编排手册）

# 舰队编排(fleet-orchestration)

> 性质:FIKIRTIVE 多 agent 作业的**官方施工手册**(华语,宪法 9)。来源 = founder 永久指令"Fable 编排策略"(2026-07-09)+ 历次舰队实战教训。任何模型的会话要开舰队,照本手册执行;与蓝图/playbook 冲突时蓝图赢。

## 一、分档用工表

| 角色 | 谁 | 干什么 |
|---|---|---|
| 总指挥 | 会话主脑(Fable 时必须亲任) | 只做四件事:架构/流程设计、**写流程级工单**、终审关键 diff、和 founder 拍板。**不亲自铺代码**;例外:**内容金标准与视觉品味关键件由 Fable 亲笔/亲导**(档案 2026-07:金标准要最强写手;视觉 = Fable 现役最强维) |
| 灵魂工人 | Opus 4.8 | 体验关键件(壳/连通/canvas/旗舰页/钱路形态),拿完整施工图;**效果审/判断岗首选**(判断岗忌高作弊倾向模型);研究/长上下文读盘首选 |
| 量产工人 | **Sonnet 5**(钉版本,幻觉/谄媚低于 4.6) | 读盘/审计文档/mock 数据/重复变体/文档/清单;机械档备选 **Haiku 4.5**(与 Luna 并列) |
| 编外对抗队 | Codex(`codex exec`,GPT-5.6 家族,2026-07-10 试工升档) | **Sol@xhigh**(试工双 A):第四闸对抗审查/独立效果审/内容工程金标准样张/顶班 —— 实测在"交叉修复互相打架"类缺陷上强于 5.5 与分区质检;**Terra@high**(试工 A):成色抽审/量产审计;**Luna@medium**(试工 A:78 URL 验活+143 内链核对 6 秒完赛,正确展开模板构造):机械大扫/清单核对/URL 验活首选,白菜价;**/goal**:可机器验收的长线磨活(护栏:独立 worktree/永不碰 main/目标带可验完成条件/预算封顶)。**进不了 Workflow 舰队**,由总指挥经 Bash 单独派单;模型旗标 `--model gpt-5.6-sol|terra|luna`(裸名 gpt-5.6 不通) |
| 质检官 | Opus(不降档) | 逐区打分 A/B/C + 逐条 file+issue 缺陷;founder 定过"不要掉质量" |

**晋升铁律**:任何模型(含未来新模型)进哪个档,不听发布会,只看**试工打分** —— 同一张工单、同一质检官、同一把尺;量产件拿 A 进量产档,灵魂件拿 A 才碰体验件。("Sonnet 盖楼被退货"教训的普适化。)入职考之外,**全维档案 + 上岗持续记分**补盲区(docs/ops/MODEL-DOSSIER-2026-07.md;考卷抓不到"压力下作弊倾向"这类性格缺陷)。

**Sol/GPT 家族安全前置(权威落点 = model-routing skill,派单前必查那边细则)**:全岗**默认只读**;确需写码 = 仅隔离分支 + 全 diff 必过 Claude 反作弊审 + 永不碰 main/prod/DB/钱路;效果审 Opus 主审、Sol 降第二意见;/goal 产出永不自动合并;SEA 多语言先自测小卷。本手册只留此摘要,细则与依据以 model-routing 为准(单一权威,防两处漂移)。

**质量三闸**:① 总指挥终审 ② 机器闸(typecheck/围栏/CI)③ founder staging 眼睛。工人失败先升级工单,再考虑升级模型 —— "表面"产出的根因是工单浅。

**评审三层尺(founder 2026-07-09 定,产品面工作的必答三问)**:① 通不通(流程走得完、按钮点得动)② 合不合理(照真商家的脑子长的吗:步骤顺、要填的他知道、下一步在手边)③ **有没有效果(最终标准)** —— 用完这工具生意上真的拿到东西了吗;产出实质(提案/诊断/草稿/hook)拿给真商家和专业标准前站不站得住。FIKIRTIVE 卖的是结果,不是界面;mock 里放空话 = 我们对"好"没概念,照判。

## 二、标准舰队形状(五段)

```
Foundation(串行,承重墙:共享数据/store/壳,后续全员依赖)
  → Zones(并行,一区一 Opus;只动自己区,共享文件只许尾部追加)
  → Integration(1 Opus:跨区缝合+四关全绿 typecheck/fence/tests/build)
  → Audit(并行质检官打分 → <A 派修复队 → 复检一次)
  → Ship(部署+验证+人话手册;soul/钱路 diff 加 Codex 对抗审查第四闸)
```

Workflow 工具要点:`meta` 纯字面量;默认 `pipeline()`,只有真需要全量结果才 `parallel()` 加栅栏;脚本内禁 `Date.now()/Math.random()`;中断后用 `resumeFromRunId` 吃缓存;体验件 `{model:'opus', effort:'high'}`;质检官带 JSON schema(grade/summary/defects[file,issue])。

## 二·五、上线就绪五关(founder 2026-07-09 定制;每次大版本/板块点亮必走)

①**机器闸**(typecheck/围栏/单测/build)→ ②**场景实测**(E2E:人物剧本在真浏览器从头点到尾,盯 console/死按钮/裂图/断头路)→ ③**认知走查**(宕机点三类:还没开始就懵/半路卡/出错慌,产出接法台账)→ ④**效果过堂**(产出实质双镜审:挑剔商家+专业顾问,判"站得住/勉强/站不住" —— 行业标准 QAQC 没有这层,是我们的护城河审法)→ ⑤**founder 验收**(UAT 走城)。Codex 异族审查横切全程;改完必回归(②重跑受影响剧本)。对应行业名:Launch Readiness / Release Quality Gate;③=cognitive walkthrough,⑤=UAT。

## 三、worker 施工样板(写进每张工单)

1. `git fetch origin <branch>` → `git worktree add <scratch>/wt-<name> origin/<branch> --detach`(锁冲突 sleep 5 重试 ×5)
2. `pnpm install --prefer-offline`(失败去掉 flag 重试一次)
3. 必读文档按序列全(总令 → 分区契约 → 设计法 → store 规则),写明路径
4. 铁律写死:目录围栏(只动哪些路径)/一切状态经 store(共享文件**只许尾部追加**并注明区名)/禁 fork useState 持 mock 副本/图片只从已验证目录取
   **凡涉及手感/动效/gesture 的工单(canvas/拖拽/sheet/dock/滑块),必读 `.claude/skills/apple-design/` + design-rules §G 流体手感法**;质检官对这类面加验 §G10 清单(跟手/可中途抓住/速度接力/橡皮筋/origin 锚定)
5. 自验:围栏脚本 + `tsc --noEmit` 必绿才许 push
6. push 重试循环 ×6:`git pull --rebase && git push --no-verify origin HEAD:<branch>`(--no-verify 仅限 worktree 缺依赖挡 hook 且已自验过;rebase 冲突"尾部追加型"= 两段都保留)
7. `git worktree remove --force` 收尾;最终文本只返回 SHA+改动数+建成清单+自验结果

## 四、教训清单(血泪,一条都不许丢)

1. **部署前必核 SHA**:`git rev-parse HEAD` 与 `origin/<branch>` 完全一致才许部署,打印两者(shipper 曾部署过时代码)。
2. **弃半成品优于抢救**:worker 中途死掉留下未提交文件 → worktree 整个丢弃重跑,不捡。
3. **worktree 清理权威 = gh PR 状态(MERGED)**,不是 git 祖先测试(squash merge 会骗人)。
4. **图片/外链 URL 逐条 `curl -sI` 验 200** 才入库,禁编造(hallucinated Unsplash ID = 全城裂图)。
5. Codex `effort=minimal` 与 image_gen/web_search 冲突报 400,**最低用 low**。
6. 前台 sleep 被禁 → `run_in_background` 或 Monitor until-loop;临时脚本用 python3 一行,少用易错的 `node -e`。
7. 限额/断线打断舰队 → 等 reset 后 `resumeFromRunId` 续跑(已完成 agent 吃缓存);被杀 agent 查分支有无半推,清掉再原单重发(工单里写"push 网络失败重试 ×3")。
8. 并行舰队撞同一文件(MASTERPLAN 行/verdicts 尾/同名测试)→ 临时 worktree 手工合并,保双方意图。
9. **给 founder 的汇报 = 人话 + 可查证据**(部署 SHA、逐页 HTTP 状态、测试输出),不说"我验证过了";禁内部代号。
10. 机器闸不许因赶工跳过;CI 红 = 本地三关复现(见 `docs/runbooks/local-ci.md`)+ founder 批准才可动。
11. **分区质检的结构性盲区 = 跨页状态断层**(A 页改了、B 页读不到:本地 useState 覆盖层不落 store、深链解析不认运行时新对象、同一数据两页两个源)。一区一官的打分抓不到这类;**缝合队工单必须专列"跨页状态连续性"清单逐条点击验证,第四闸(Codex)的五类靶子里它排第一**。(2026-07-09 首战实证:全区 A 之后 Codex 仍抓出 3 High 全属此类。)
12. **借鉴先行律(founder 2026-07-10 常设)**:遇平台政策雷/接口关门/合规红线,第一步=查龙头活法(官方源+龙头自家条款与帮助文档),产出"抄什么/改什么/为什么我们不同"再设计我方解法;**禁止未查先创**。范例:docs/research/LEADER-PLAYBOOK-2026-07-10.md(三颗雷五路研究+证据分级)。

## 五、Codex 派单配方

```bash
codex exec --skip-git-repo-check -c model_reasoning_effort=<low|medium|high|xhigh> "<工单>"
```

**第四闸标准流程(每次大舰队 Ship 前平行点火,实战版 2026-07-09)**:
1. 时机:质检打分收尾后、founder 验收前,与部署收尾**平行**跑(不占关键路径);Bash `run_in_background` 发射。
2. 工单形状(实战验证过的五类靶子,按严重度排):①**状态该写没写**(UI 文案宣称效果但 store 从未落数据 = 表面联通,founder 最恨)②断头链接/不存在的路由与参数 ③引用不存在的 mock id / 写死数字与数据源打架 ④React 正确性(unstable key/依赖缺失/hydration)⑤持 useState 私藏 mock 副本违反 store 单源。
3. 硬约束写进工单:READ ONLY 不许改代码;唯一允许的写 = 把发现输出到指定报告文件;**禁风格意见、禁重构建议**;每条 = file:line + 缺陷 + 用户点击时会踩到的具体失败场景;结尾按严重度计数。
4. 交卷后**总指挥逐条甄别**:真缺陷 → 修复工单(走城/上线前修掉);误报 → 驳回。给 founder 的汇报带"采纳/驳回判决"。

- 计费走 founder 的 ChatGPT 订阅(priority tier),非逐笔钱路;**重活(整分支审查/长跑)先跟 founder 打一声招呼**,别烧光他的 plan 限额。
- repo 规矩对 Codex 一视同仁:永不推 main、PR+CI 绿灯、playbook 检查单。
- plugin 命令(`/codex:review` 等)需重启会话才注册;CLI `codex exec` 永远直接可用。

# 第三章 · 重大决策怎么谈（双脑制）

# 双脑对谈制(Fable × Sol@ultra)

> 何时开:重大产品/架构/战略决策、设计定稿前、完整性扫描、founder 点名"问问 Sol"。日常工程不开(浪费);小分歧用第四闸对抗审查即可。

## 标准回合结构

1. **Fable 亮论纲**(主脑先押注,给对抗脑一个靶):把自己的完整立场写进 prompt,绝不空手问"你怎么看"。
2. **Sol 四题**(ultra 档,读 repo 只读,唯一写=scratchpad 报告文件):①独立第一性答案(不看论纲先自答)②对抗攻击论纲(禁客气)③unknown unknowns(founder 和 Fable 都漏的)④险牌(每张带成本+止损门槛)。
3. **Fable 逐条裁定**(这是主脑的核心职责,不许外包):采纳/改造采纳/驳回,每条带理由;**它不懂我们的宪法与历史,裁定时补上下文**;它的重大事实主张(竞品动作/条款/数据)必须独立核验至少一条最重的。
4. **归档双件套**:Sol 原稿存 `docs/strategy/SOL-R<n>-*.md`(原文一字不改);裁定写进 `docs/strategy/TWO-BRAIN-MEMO-*.md`(共识/分歧+裁定/险牌+注/给 founder 决策清单)。
5. **founder 拍板**:产出永远是提案;决策清单逐条可单批单毙;触宪法的只标注,修宪案另开 PR founder 亲合。
6. **确定即固化,但带生命周期**(R4 A-04 修正):固化物标状态 `proposal → trial → accepted → deprecated`;产品/策略类假设入法前须带成功指标+过期日+退役条件,**只有安全类法条可跳过 trial 直接 accepted**。共识≠生产证据 —— 别让试验性假设变成昂贵的化石。判决进 GRILL-VERDICTS。
7. **证据包先行**(R4 A-05 修正):多脑作业前,先由一个便宜 agent 产出**不可变证据包**(事实/命令输出/计数/引文/未知项),各脑基于同一包独立设计、禁互读提案 —— 省掉重复考古,引文口径统一。

## 派单口径

```bash
codex exec --skip-git-repo-check --model gpt-5.6-sol -c model_reasoning_effort=ultra "<论纲+四题+repo 路径+唯一写文件>"
```
- 战略/设计题用 **ultra**;代码审查用 xhigh(见 fleet-orchestration 第四闸)。
- Sol 全程只读(写权限红线,权威落点见 model-routing);后台跑,长思考勿催。
- 大单先跟 founder 打招呼(吃他 ChatGPT plan 限额)。

## 教训(append-only)

1. Sol 的判词犀利但**不知道 founder 的开发方法论**(城=非技术 founder 的决策介质、mock 即 spec)——凡涉"该不该建"的判词先过这层滤镜再采纳。
2. 它引用的官方链接可信度高,但**基准/竞品数字必须抽核**(R1 的 Meta Business Agent 经独立核实为真,才升格为战略输入)。
3. 已确定成果:R1=授权-回执脊柱+竞争格局改判;R2=Otto 存在契约(一个 Otto 多份档案/dock 注意力面/认识论动词/试用班);均已裁定归档。
