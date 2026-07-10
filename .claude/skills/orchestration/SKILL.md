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
| **Founder（决策面）** | 产品实质、品牌、不可逆架构、重要 PR、生产、花钱与对外动作的最终裁决 | 不被 agent 的“推荐”替代 |
| **Codex（唯一控制面）** | 以可用最高 effort 维护真实状态、拆任务、派 worker、组织独立顾问、综合分歧、验证与恢复；在生效规则内合并普通 PR | 不推 main、不合并自己参与编写的 diff、不越权处理 founder-only 类别 |
| **Fable 5（判断联署人）** | 对所有判断级工作独立给产品/架构/设计/写作意见，攻击论纲并找盲区 | 不承载长工程主循环，不改代码，不以 Opus fallback 冒充 Fable |
| **Worker（执行面）** | 在有界工单内研究、施工、测试或审查 | 无最终决定、合并、部署、真实花费或对外写权限 |

“共同 orchestrator”只表示 **Codex 负责连续编排，Fable 联署判断**。不可同时设两个控制面；仓库、PR、测试与状态账永远胜过会话记忆。

## 2. 先分层，再决定谁参与

一句话判据：**做错后能否只在分支里完整撤回，而且外界没人看见？** 拿不准就升一级。

### 一级 · 三方裁决（Founder + Codex + 已验证的 Fable 5）

适用：产品身份与范围、品牌定稿、不可逆架构、修改本协议或 merge law、founder-only PR、生产部署、真实花费、真实平台写入、凭据/权限、删除数据、钱路或租户红线。`docs/BLUEPRINT.md` 仍只可由 founder 按修宪流程修改。

要求：Codex 交同一份证据包；Fable 独立作答；Codex 呈上共识与分歧；founder 明确拍板。缺任何一方，不得定稿。

### 二级 · 双脑判断（Codex + 已验证的 Fable 5）

适用：分支内可撤回、但会改变**用户可见行为/承诺、领域或数据模型、跨模块公开接口、质量闸结论、任务范围或执行顺序**的判断，例如新模块接口、数据模型草案、舰队总工单、第四闸缺陷裁定、旗舰体验方向。既定方向内的变量名、测试分组、普通文案/间距、机械 bug triage 属三级。

要求：Fable 必须被真实咨询；同一阶段相互依赖的二级问题合成**一个证据包**，不逐项开会。Codex 可继续无争议的只读取证与机械工作，但未获 Fable 意见前不得把判断标成完成。把结果集中在下一次 founder 大局报告中，除非它升级为一级。

### 三级 · 有界执行（Codex 调度 worker）

适用：既定方案内的代码、单测、URL 验活、清单、格式、CI 重跑、机械研究与可逆修复。无需打扰 founder，也无需让 Fable 为变量名或命令空转。

执行中出现范围漂移、用户体验取舍、数据模型变化、钱路/租户/生产风险时，立即升二级/一级。

普通 PR merge 不是“可撤回的三级判断”，而是 founder 预先授权的受闸主干操作：只能在底层判断已完成、且第五节全部条件同时成立时执行。

## 3. Fable 咨询协议

每个一级/二级判断使用**短、干净、只读的新会话**，不要把长期工程历史、凭据或整份 transcript 塞给 Fable。Fable 必须在启动参数显式请求 `--model fable --effort max`；默认 `high` 或用户设置里的 `xhigh` 都不算履行本协议。控制面同样使用当前 runtime 可提供的最高 orchestrator effort；截至 2026-07-11，本机 `gpt-5.6-sol / ultra` 是已核验的 runtime 配置，不把这个私有标签外推为公开 API 契约。

证据包固定包含：

1. 要决定的问题与用户结果；
2. 可查证 ground truth（SHA、PR、测试、代码/文档路径、未知项）；
3. 蓝图/法律/钱路/租户/生产约束；
4. 真实选项与代价；
5. Codex 的暂定论纲另存，不在第一回合展示；Fable 先独立作答，第二回合才展示论纲让它攻击；
6. 要求 Fable 输出：独立答案、对抗攻击、盲区、险牌、信心与未知项。

咨询后必须从 CLI/API 元数据或 session transcript 核对**实际应答模型**与 fallback 记录，禁止让模型自报身份。分开记录 `requested effort` 与 `observed/applied effort`；若 client 没暴露 applied 字段，只能写 `applied effort unknown`，不得从启动参数反推已经实际应用。归档标签只允许：

- `Fable 5 verified`
- `fallback: <actual model>`
- `advisor unavailable`
- `advisor incomplete: <reason>`

### Fable 不可用时的 clean-room fallback

安全分类 fallback、capacity、连接失败、无进展超时或没有 `end_turn` 都不算 Fable 完成。不要继续使用自动切到的 Opus 回答作为联署意见；改开一个**全新、隔离、只读、不可 resume 的 SOL Ultra session**：

1. 使用 `--ephemeral --ignore-user-config --sandbox read-only`（或当前 harness 的等价隔离）；
2. 只给 founder 原话、法律、raw evidence 与问题，不给 Codex 暂定结论、旧 Fable 输出或预期答案；
3. fallback session 不得写项目、调用生产、合并、部署、花钱或读取凭据；
4. 独立输出后，才由 Codex 并列比较；标签必须是 `independent SOL Ultra`，绝不写成 Fable 共识；
5. 当前 orchestrator 自己不能充当这个 fallback，必须是另一个 fresh session，并记录独立 thread/session ID。

若 clean-room SOL Ultra 也不可用或未完成：一级只可由 founder 明确 override，二级判断排队；无关三级工作可继续。不得连续换第三个模型直到有人给出想听的答案。

### Liveness 与超时

- capacity/refusal 是立即终态，不盲重试同一请求；
- 优先使用可流式记录事件的输出格式；否则只监控 transcript mtime、assistant/tool 记录与结束标记，不靠 UI spinner 判断；
- 连续 5 分钟没有新事件/记录即 graceful terminate，标签 `advisor incomplete: no progress`；
- 单次 clean-room consultation 默认总时限 20 分钟；任务若需更长，必须在派单前写入状态账；
- 有事件增长只表示“健康在途”，只有可核验的最终回答和结束标记才算完成。

每份咨询证明至少记录：session ID、transcript/response 路径、观察时间、requested model/effort、observed model/effort、fallback 数、结束状态与文件 SHA-256。恢复时先重新核对；无法核对就降为 `advisor provenance unknown`。若咨询会产生真实增量费用或使用计量 API，照 `AGENTS.md` 先问 founder；“token 不用担心”不等于真实花费授权。

## 4. Worker 合约

每张工单都写死：

- 目标与用户结果；
- 文件/目录围栏和禁止项；
- 权威输入与已经拍板的决定；
- 可机器验收的完成条件；
- 必跑验证命令与证据格式；
- 分支/worktree、时间或预算封顶；
- 明文禁止：main push、作者自合/auto-merge、生产、真实花费、真实平台动作、删除或清理他人 worktree。

先按 `docs/ops/MODEL-ROUTING-2026-07-11.md` 选 task/model/effort，再用 `docs/ops/MODEL-DOSSIER-2026-07.md` 的试工记录作证据底册；两者冲突时以更新且可复核的 runtime/官方证据为准。Codex 家族产出的判断或 diff，优先由 Claude 家族做异族审查；Claude 工人产出的关键 diff，可由独立 Codex/Sol 做异族审查。审查意见仍需控制面逐条甄别。

## 5. 硬闸

1. 永不直接 push main；所有变更走 PR。
2. 永不 auto-merge，也不启动 merge watcher。Founder-only 类别只由 founder 合并。普通 PR 只有同时满足以下条件才可由 Codex control plane 合并：
   - 本 control-plane session 没有编写或实质编辑该 diff；
   - current-head CI 全绿，无豁免；
   - 独立异族 review 无未解决 P0/P1，意见逐条有 disposition；
   - diff 不含治理、产品身份/品牌、蓝图、不可逆架构、schema/migration、钱路/租户、凭据/权限、生产/部署、对外写入/花费/删除，也没有分层争议；
   - 合并后重新核对 main SHA、PR 状态与部署是否仍未被自动触发。
   PR #228 修改本条，故它本身仍由 founder 合并；新授权只在 #228 落 main 后生效。
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
- 是否零作者自合、零未授权合并、零自动部署、零越界动作；
- 每个一级/二级判断是否都有完整 advisor provenance，并诚实记录 Fable / clean-room fallback / founder override；
- 中断后是否能从状态账与机器事实一次恢复；
- 是否出现错误完成报告或遗失 worker；
- 产品判断质量是否因短 Fable 咨询而提高。

达标后由 founder 将状态从 `trial` 改为 `accepted`；未达标就简化或废止，不把协议养成第二个项目。
