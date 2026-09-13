# FIKIRTIVE 项目指南

> 本文件只记录这个产品独有、每次开发都必须知道的事实。它不是编排系统、审批系统或项目状态数据库。

## 开始工作

1. 先遵守当前用户指令与运行环境。
2. 阅读 `docs/BLUEPRINT.md`，理解长期产品方向。
3. 只加载与当前任务直接相关的代码、ADR、spec 和 `docs/references/` 资料。
4. 用 live Git、当前代码、数据库和测试确认事实；旧计划、报告、handoff 与 issue 只作参考。

## 产品基础

- **Money exactly-once**：付费动作必须有稳定幂等键；reserve、settle、refund 与 ledger 保持单一权威并 fail closed。用数据库唯一约束和行为测试证明，不能靠文档声明。
- **Tenant isolation**：tenant 身份只能来自已认证的 server principal；不得相信客户端传入的 `ownerId`、`orgId` 或角色。查询和关系必须带 tenant 约束，并有双租户测试。
- **Permission-based access**：授权检查具体 capability 与 resource scope。一个人可以拥有多个角色；角色只是权限组合，不能因角色名称本身制造禁止。
- **Database safety**：schema 变化必须有 migration、约束与 fresh-database 验证。现有数据需要转换时，迁移必须可解释、可测试，并在生产执行前另行确认备份与恢复方案。
- **Shared actions**：人工 UI 与 Otto 操作同一业务动作层；不要复制第二套业务实现。
- **Pricing truth**：价格集中配置并满足产品毛利底线；不要把价格字面量散落在业务或 UI 中。

## 工作方式

- 不直接 push 到 `main`；通过分支与 PR 交付。
- 只修改当前目标所需内容，优先使用真实行为测试、类型检查和 production build 验证。
- required CI 绿色才代表当前提交通过自动验证；CI 不可用不等于绿色。
- 产品方向、身份、用户行为和验收改变由 Founder 决定。实现细节在不改变这些决定时由开发者按最简单可靠方案处理。
- specs 与工程文档使用华语；UI copy 使用 English sentence case。

## 开发流程（Founder 2026-09-13 裁决：废止 2026-08-28《开发作业手册》，流程全走 mattpocock 技能族）

1. 循环 = grilling → to-spec → to-tickets（跨 session 的场用 wayfinder 地图）→ tdd / implement → code-review。地板在全局家规 §7.4：重挡先有规格、Founder 批准后动工、中途想法进规格「变更登记」节等 Founder 批裁。
2. 规格存 `docs/specs/`（模板 `docs/specs/TEMPLATE.md`），只在主干上有效——先以 docs-only PR 合进主干再开工。批准记录 = 规格文件里一行带日期的「批准:」行，注明 Founder 点头的出处（对谈或 issue 链接）。存量规格的「状态: 已冻结/已交付」行是历史记录，读作已批准；状态词汇不再维护。
3. 规矩冲突记录（全局家规 §7 要求，范围=本仓库，勿再作 drift 上报）：2026-09-13 Founder 裁决删除《开发作业手册》全套机器——process-gates.yml（M1 规格引用/M2 冻结形状/M3 验收编号进测试/M4 开关失效日期/M5 目录守形）、process-heartbeat.yml（自毁开关）、S1–S5 阶段词汇、GitHub 签名冻结三步、「轻改:」「闸门改动:」PR 行；主干 ruleset 的 required checks 同日改为 quality + e2e。全局家规 Harness 节点名的 spec-reference 与 acceptance-to-test-mapping 两道 required checks 随之下线，为 Founder 有记录的例外。验收仍逐条对照规格验收表（全局 §7.4），由 agent 与 code-review 把关，不再由 CI 强制。

## 里程碑制（Founder 2026-09-09 裁定；决策记录 = 整理地图 https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/1285 及其子票）

1. 一个版本 = 一个 GitHub 里程碑，顺序固定：里程碑场（`/mattpocock-skills:wayfinder` 出决定票，逐票拍板；开场先把 `idea` 票与到期延后项摆上桌让 Founder 下注）→ 出规格 → 拆票 → agent 施工 → 验收 → 收版。本仓库的两处接缝：`to-spec` = 写 `docs/specs/<名>.md` 按 TEMPLATE，不发 issue，批准照上节「开发流程」；`to-tickets` = 每票带 `Spec:` 行、覆盖的验收编号、当前里程碑、`ready-for-agent`。
2. 人管五样，其余归 agent：方向（`docs/BLUEPRINT.md`、`docs/adr/`、`CONTEXT.md`）、规格批准、下注、验收、规矩（本文件）。要动这五样先问 Founder。
3. 版本号在里程碑场按本轮范围定，agent 推荐一档、Founder 拍板：补丁 = 修补与小功能；小版 = 大节点或新面；大版 = 商业模式级。收版 = 里程碑票全关 + 验收表全勾 → `git tag vX.Y.Z` + GitHub Release + `CHANGELOG.md` 一版一节（交付的规格、关掉的票、链接）。package.json 版本号不动。
4. 不属于任何已批准规格的中途想法进三个柜子（属于某规格的进其「变更登记」节）：`idea` 标签 = 还没决定做不做，不挂里程碑、不标可派，最少三行（一句话构思 / 商家场景 / 来源），idea 场 = 短 grilling 出一张票、不施工；`docs/DEFERRED.md` = 已决定做、等触发条件；`polish` 标签 = 已有功能的打磨，不排期。
5. 交接：有地图或里程碑 issue 的场，那张 issue 就是交接书；记忆库只存指针（工件指针 / 环境陷阱 / Founder 常令），历史现场移出索引。

## 前端接线与设计变更

涉及后端接入 UI、新增／修改前端组件、页面／流程变更或将验收版本接入正式路由时，必须先完整阅读 `apps/web/design-system/governance/frontend-integration-handoff.md`，再按其中指针核对本次设计来源与批准。它规定接线方法，不授予新功能、重设计或发布权限。

## 代码地图（CodeGraph）

- 唯一持图树是主检出 `/Users/winnin/Desktop/FIKIRTIVE`。orchestrator 做全局调查时在主检出上 CodeGraph-first。
- 主检出会落后 `origin/main`。查图前先核对它的 HEAD，落后就 `git -C <主检出> pull --ff-only`（它历来零本地提交，watcher 随后自动跟上索引）。树新鲜与图新鲜要一起验，缺一不可。
- 查图前必须先跑 `codegraph status` 验明地图身份：输出带 worktree 警告或不是 fresh，就不得用图。嵌在主检出目录内的 worktree（`.claude/worktrees/*`）里，`query` 与 `callers` 会零警告返回主检出的结果。
- worker 与判官在自己的 worktree 一律诚实回退到 `rg` 与直接读文件；不跑 `codegraph init`，不借主检出的图。
- 主检出以外的目录出现 `.codegraph/` 就是错误，就地删除。
- lock、watchdog 或 sync 报错之后必须重新 `codegraph status` 才能声称 fresh；daemon 还在不等于图是新的。
- 适用调查的交接带一行回执：`CodeGraph: used — query: "<query>"; index: <status>; fallback reads: <files or none>.`；没用图就写 `not used` 加原因。
- CodeGraph 只是辅助调查能力；Git、当前文件和行为测试仍是事实权威。

## 外部边界

未经 Founder 对该次动作明确授权，不部署、不修改生产数据或凭据、不发布外部内容、不删除远端或云端状态。

## 保持简单

- Agent 编排使用运行环境提供的能力；仓库内不建立 orchestration overlay、task claim、model identity、reviewer topology 或 merge-executor harness。
- GitHub issue、PR、worktree、cache、memory 和本地 session 都是工作载体，不是产品或执行权威；规格的批准记录在规格文件自身的「批准:」行（见「开发流程」）。
- `docs/references/` 保存产品洞察，但不自动授予范围、优先级或批准。
