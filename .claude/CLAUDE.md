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

## 代码地图（CodeGraph）

- 唯一持图树是主检出（`git worktree list` 第一条 working tree）。orchestrator 做全局调查时在主检出上 CodeGraph-first。
- 主检出会落后 `origin/main`。查图前先核对它的 HEAD，落后就 `git -C <主检出> pull --ff-only`（它历来零本地提交，watcher 随后自动跟上索引）。树新鲜与图新鲜要一起验，缺一不可。
- 查图前必须先跑 `codegraph status` 验明地图身份：输出带 worktree 警告或不是 fresh，就不得用图。`query` 与 `callers` 在未索引的 worktree 里会零警告返回别的树的结果。
- worker 与判官在自己的 worktree 一律诚实回退到 `rg` 与直接读文件；不跑 `codegraph init`，不借主检出的图。
- 主检出以外的目录出现 `.codegraph/` 就是错误，就地删除。
- lock、watchdog 或 sync 报错之后必须重新 `codegraph status` 才能声称 fresh；daemon 还在不等于图是新的。
- 适用调查的交接带一行回执：`CodeGraph: used — query: "<query>"; index: <status>; fallback reads: <files or none>.`；没用图就写 `not used` 加原因。
- CodeGraph 只是辅助调查能力；Git、当前文件和行为测试仍是事实权威。

## 外部边界

未经 Founder 对该次动作明确授权，不部署、不修改生产数据或凭据、不发布外部内容、不删除远端或云端状态。

## 保持简单

- Agent 编排使用运行环境提供的能力；仓库内不建立 orchestration overlay、task claim、model identity、reviewer topology 或 merge-executor harness。
- GitHub issue、PR、worktree、cache、memory 和本地 session 都是工作载体，不是产品或执行权威。
- `docs/references/` 保存产品洞察，但不自动授予范围、优先级或批准。
