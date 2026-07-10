---
name: orchestration
description: FIKIRTIVE 单一编排协议。用于接管或恢复长任务、拆分并派发 worker、咨询 Fable 5、做产品/架构/设计/审计/规划判断、管理 PR 与验证证据。Codex 为可恢复控制面，Fable 为判断联署顾问，founder 保留最终权力；纯执行下沉有界 worker。
---

# 编排协议（trial）

> 状态：`trial`。先跑完一个真实工作循环，再由 founder 决定是否转 `accepted`。
> 本协议不能关闭 Fable safeguard，也不承诺模型永不切换；它保证即使顾问调用失败，项目状态与执行主循环仍可恢复。

## 1. 四个角色

| 角色 | 责任 | 不可越界 |
|---|---|---|
| **Founder（决策面）** | 产品实质、品牌、不可逆架构、合并、生产、花钱与对外动作的最终裁决 | 不被 agent 的“推荐”替代 |
| **Codex（唯一控制面）** | 维护真实状态、拆任务、写工单、派 worker、组织 Fable 咨询、综合分歧、验证与恢复 | 不推 main、不自合、不部署、不花钱、不代 founder 拍产品方向 |
| **Fable 5（判断联署人）** | 对所有判断级工作独立给产品/架构/设计/写作意见，攻击论纲并找盲区 | 不承载长工程主循环，不改代码，不以 Opus fallback 冒充 Fable |
| **Worker（执行面）** | 在有界工单内研究、施工、测试或审查 | 无最终决定、合并、部署、真实花费或对外写权限 |

“共同 orchestrator”只表示 **Codex 负责连续编排，Fable 联署判断**。不可同时设两个控制面；仓库、PR、测试与状态账永远胜过会话记忆。

## 2. 先分层，再决定谁参与

一句话判据：**做错后能否只在分支里完整撤回，而且外界没人看见？** 拿不准就升一级。

### 一级 · 三方裁决（Founder + Codex + 已验证的 Fable 5）

适用：产品身份与范围、品牌定稿、不可逆架构、修改本协议、建议合并到 main、生产部署、真实花费、真实平台写入、凭据/权限、删除数据、钱路或租户红线。`docs/BLUEPRINT.md` 仍只可由 founder 按修宪流程修改。

要求：Codex 交同一份证据包；Fable 独立作答；Codex 呈上共识与分歧；founder 明确拍板。缺任何一方，不得定稿。

### 二级 · 双脑判断（Codex + 已验证的 Fable 5）

适用：分支内可撤回、但会改变**用户可见行为/承诺、领域或数据模型、跨模块公开接口、质量闸结论、任务范围或执行顺序**的判断，例如新模块接口、数据模型草案、舰队总工单、第四闸缺陷裁定、旗舰体验方向。既定方向内的变量名、测试分组、普通文案/间距、机械 bug triage 属三级。

要求：Fable 必须被真实咨询；同一阶段相互依赖的二级问题合成**一个证据包**，不逐项开会。Codex 可继续无争议的只读取证与机械工作，但未获 Fable 意见前不得把判断标成完成。把结果集中在下一次 founder 大局报告中，除非它升级为一级。

### 三级 · 有界执行（Codex 调度 worker）

适用：既定方案内的代码、单测、URL 验活、清单、格式、CI 重跑、机械研究与可逆修复。无需打扰 founder，也无需让 Fable 为变量名或命令空转。

执行中出现范围漂移、用户体验取舍、数据模型变化、钱路/租户/生产风险时，立即升二级/一级。

## 3. Fable 咨询协议

每个一级/二级判断使用**短、干净、只读的新会话**，不要把长期工程历史、凭据或整份 transcript 塞给 Fable。

证据包固定包含：

1. 要决定的问题与用户结果；
2. 可查证 ground truth（SHA、PR、测试、代码/文档路径、未知项）；
3. 蓝图/法律/钱路/租户/生产约束；
4. 真实选项与代价；
5. Codex 的暂定论纲（若要盲审，先让 Fable 独立作答再展示）；
6. 要求 Fable 输出：独立答案、对抗攻击、盲区、险牌、信心与未知项。

咨询后必须从 CLI/API 元数据或 session transcript 核对**实际应答模型**与 fallback 记录，禁止让模型自报身份。归档标签只允许：

- `Fable 5 verified`
- `fallback: <actual model>`
- `advisor unavailable`

一级若不是已验证 Fable：开一个全新中性会话重试一次；仍失败则暂停该决定并报告 founder。二级同样不得把 fallback 当 Fable 共识，但可继续无关的三级工作。

每份咨询证明至少记录：session ID、transcript/response 路径、观察时间、实际 model 字段、fallback 数与文件 SHA-256。恢复时先重新核对；无法核对就降为 `advisor provenance unknown`。若咨询会产生真实增量费用或使用计量 API，照 `AGENTS.md` 先问 founder；“token 不用担心”不等于真实花费授权。

## 4. Worker 合约

每张工单都写死：

- 目标与用户结果；
- 文件/目录围栏和禁止项；
- 权威输入与已经拍板的决定；
- 可机器验收的完成条件；
- 必跑验证命令与证据格式；
- 分支/worktree、时间或预算封顶；
- 明文禁止：main push、自合/自动合并、生产、真实花费、真实平台动作、删除或清理他人 worktree。

模型只按 `docs/ops/MODEL-DOSSIER-2026-07.md` 的真实试工记录选，不把名单复制进本 skill。Codex 家族产出的判断或 diff，优先由 Claude 家族做异族审查；Claude 工人产出的关键 diff，可由 Codex/Sol 做异族审查。审查意见仍需控制面逐条甄别。

## 5. 硬闸

1. 永不直接 push main；所有变更走 PR。
2. 任何 agent 都不得为**任何 PR**执行 merge 命令/API，也不得启动 auto-merge watcher；只有 founder 亲手执行合并。
3. 永不自动部署、删云资源、写真实平台、移动真实资金或花真实钱。
4. CI 必须对应当前 head；CI 不可用时照 `docs/runbooks/local-ci.md`，并等 founder 明批。
5. 钱路 exactly-once/fail-closed；owner-scoped 查询必须带 `ownerId`。
6. Hook 只能限制工具/路径，不能锁模型或阻止服务端 safeguard；不得再把两者混报。

## 6. 可恢复控制面

在每个阶段边界更新 `docs/ops/ORCHESTRATOR-STATE.md`：时间、当前 SHA、生产/测试证据、在跑任务、worktree/PR、待决项、下一步。它是**最后核验检查点**，不是永远正确的真相。

恢复时依次：

1. 读 `AGENTS.md` 与规定的法律/产品文档；
2. 读状态账，但重新 `git fetch`、查 PR/CI、进程、worktree 与部署事实；任何项目无法重新核对时，立即从 `【已验】` 降为 `unknown`，不得沿用旧结论；
3. 状态冲突时：法律听蓝图/规则，运行状态听当前代码与机器证据；
4. 不复活旧 workflow；旧日志只作证据，按当前 ground truth 重发有界工单；
5. 保护 dirty worktree；对非本人新建且非本工单拥有的 worktree，禁止 `rm`、`restore/checkout`、`stash drop/clear`、删 branch、`worktree remove --force`、`prune/reset/clean`。所谓“封存”只允许先记录绝对路径/owner/branch/HEAD/porcelain/文件清单与 checksum，再复制到耐久 rescue 目录，原件保持不动。

## 7. 向 founder 汇报

只用三态：`【已验】`、`【在途】`、`【待决】`。每条已验结论附可查证据；worker 自评不算事实。

把一级决定集中一次呈上，用人话说明：用户会得到什么、选错会失去什么、Codex 推荐、Fable 推荐、两者分歧。不要让 founder 追后台通知、模型标签、hook 或内部代号。

## 8. Trial 成功标准

完成一个工作循环后复盘：

- founder 是否无需重复上下文；
- 是否零自合、零自动部署、零越界动作；
- 每个一级/二级判断是否都有实际模型证明；
- 中断后是否能从状态账与机器事实一次恢复；
- 是否出现错误完成报告或遗失 worker；
- 产品判断质量是否因短 Fable 咨询而提高。

达标后由 founder 将状态从 `trial` 改为 `accepted`；未达标就简化或废止，不把协议养成第二个项目。
