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

## 开发流程（Founder 2026-08-28 批准《开发作业手册》；机器闸在 `.github/workflows/process-gates.yml`）

1. 产品改动先查 `docs/specs/` 对应规格；没有已冻结的 S1 不写产品代码——第一动作是 grill Founder 产出规格草案（模板 `docs/specs/TEMPLATE.md`）。轻挡除外：零商家可见行为变化的改动，在 PR 描述写一行 `轻改: <勾选句>`；钱路／迁移／登录租户／新路由无论自报什么挡，一律要规格引用（M1 路径地板）。
2. 一个 session 只推进一个功能的一个阶段（签 S1、批 S2、或勾 S5），做完即收。
3. 产出物只存 `docs/specs/` 对应文件，规格只在主干上有效——长期分支先把规格以 docs-only PR 合进主干再开工。聊天记录、临时目录、会话记忆都不是权威。
4. 冻结 = Founder 本人（GitHub 账号 `nicksgan-belcort`）在功能 issue 评论「S1 批准」；agent 代记无效，机器闸校验评论作者。
5. Founder 中途新想法只有三个出口：登记进规格「变更登记」节（默认）／明示取消（报废物清单＋旧实现同 PR 删除）／做完再转。禁止任务悄悄变形；方向级推翻须隔夜＋四行推翻单（推翻什么／为什么／报废约多少行／受影响围栏清单）。
6. 验收只认冻结版验收表；表外不满登记后走下一循环。阶段性 commit + push，任何时刻 GitHub 上都有副本。

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
- GitHub issue、PR、worktree、cache、memory 和本地 session 都是工作载体，不是产品或执行权威。唯一例外：Founder 本人在功能 issue 下的「S1 批准」评论，是规格冻结的批准记录（见「开发流程」第 4 条）。
- `docs/references/` 保存产品洞察，但不自动授予范围、优先级或批准。
