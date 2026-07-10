# FIKIRTIVE 编排状态账

> 性质：可恢复控制面的最后核验检查点，不替代 git、PR、CI、部署与进程事实。
> 状态：`trial`。更新时间：2026-07-11 02:07 +08（Asia/Kuala_Lumpur）。

## 一、当前控制权

- **Founder**：最终产品与外部动作裁决、唯一合并手。
- **Codex**：当前唯一控制面；分支 `codex/orchestrator-handoff`。
- **Fable 5**：判断联署顾问；两轮咨询的可复核证明见下表。
- **全局 skill**：`~/.claude/skills/orchestration` 是通用实体；`~/.codex/skills/orchestration` 以 symlink 共用它。FIKIRTIVE repo 版优先。
- **旧 Claude session**：`3d3b73a4-6c32-45a3-a845-4185acfb7d1d` 已硬暂停；不得恢复旧 workflow 或沿用其口头状态。

## 二、机器地面真相

| 面 | 【已验】状态 | 证据 |
|---|---|---|
| GitHub main | `09cd9060` | PR #227 merge head |
| 当前 Codex 分支 | 基于 `origin/main@09cd9060` | `codex/orchestrator-handoff` |
| Production web | 仍早于 #226/#227 | deploy `7ed7ac22`；本轮不部署 |
| Immersive staging | HTTP 200，分支 `54c1de0b` | deploy `a0b6eb42`；不是 main/production |
| PR #203 | OPEN、CONFLICTING、100 commits、272 files、+62,314 lines、无当前 checks | `claude/northstar-immersive@54c1de0b`；相对 main 为 16/122 分叉 |
| L0 | 只有六个量测 model/migration | 无 redirect、事件写入、UI/Otto handle |
| L1 | publish queue/scheduler/adapters/proxy/idempotency/reaper 已合 main | 仍 fail-closed；未 Meta 真权限/真发帖/当前 head Docker 验收 |
| L2/L3/L4 | 未建 | WhatsApp connector、回执/EasyStore、会员唤回均无 runtime |
| L-C | 未完成 | dirty `wt-lcf` 只有 `StudioIdea` schema + migration；不得清理或默认采用 |

### Fable 咨询证明

| 主题 | Session / 时间（UTC） | Transcript | 实际模型 / fallback | SHA-256 |
|---|---|---|---|---|
| 治理 | `3839889c-e68a-477c-bbf3-250db22f388e` / 17:38:00–17:42:01 | `~/.claude/projects/-Users-winnin--codex-worktrees-1850-FIKIRTIVE/3839889c-e68a-477c-bbf3-250db22f388e.jsonl` | `claude-fable-5` / 0 | `4a7862f5590593f0e653f4c17add48f03b7018d7464e442ca4665d64f7ca8a3d` |
| 产品/时序 | `9c385946-e8d3-4919-812c-b9121a248213` / 17:44:06–17:49:28 | `~/.claude/projects/-Users-winnin--codex-worktrees-1850-FIKIRTIVE/9c385946-e8d3-4919-812c-b9121a248213.jsonl` | `claude-fable-5` / 0 | `16de80074849a82c85ab171f8b3a2f46a7580d5a9ae4cccfc682e69b5cb9360c` |

### Dirty worktree 保护清单

- Owner：旧 Claude session 遗留，现视为 founder/user 资产；任何 agent 无清理权。
- Path：`/private/tmp/claude-501/-Users-winnin-Desktop-FIKIRTIVE--claude-worktrees-fikirtive-orchestrator-handoff-1ec82f/3d3b73a4-6c32-45a3-a845-4185acfb7d1d/scratchpad/wt-lcf`
- Branch / HEAD：`claude/lc-f-home-ideas-lighting` / `54c1de0b2dab0b1be6398ea1d36e1fb18142f17a`
- Porcelain：`M packages/db/prisma/schema.prisma`；`?? packages/db/prisma/migrations/20260711000000_studio_idea/`
- 文件 SHA-256：schema `e0272150a19112ffc939c0dda0d970d1fd366fd0b94f180641f066af8527e68e`；migration `21e190fb7b0f4d881336cb36540cf7a2cbde4d1bd14eeaefdf36d012177919db`；tracked diff `a9ec18baab1de40d6d70daace6af9f0c4a825861f00670cb850938cab353cd4f`。
- 耐久副本：`~/Desktop/FIKIRTIVE-RESCUE-2026-07-10/L-C-STUDIO-IDEA-2026-07-11/`；两文件 hash 与原件一致，原 worktree 未动。

02:07 +08 的全量 dirty worktree inventory（当前控制面本身另列，全部禁止清理）：

| Worktree | Branch / HEAD | Porcelain 摘要 |
|---|---|---|
| `~/Desktop/FIKIRTIVE` | `claude/northstar-immersive` / `763a28e6` | 5：`.gitignore` + launch/Codex/demo/log 等用户文件 |
| `…/scratchpad/wt-lcf` | `claude/lc-f-home-ideas-lighting` / `54c1de0b` | 2：StudioIdea schema + migration（详见上方） |
| `~/.codex/worktrees/24a1/FIKIRTIVE` | `codex/schedule-publish-qa-fixes` / `515e6073` | 15：canvas/Otto/设计资产 |
| `~/.codex/worktrees/a620/FIKIRTIVE` | `codex/admin-dashboard-v2` / `30dd90e0` | 1：`docs/audits/` |
| `~/.codex/worktrees/b5ec/FIKIRTIVE` | detached / `eb8ce68c` | 3：outputs/tmp/videos |
| `~/.codex/worktrees/dec1/FIKIRTIVE` | detached / `d5434f6d` | 16 个删除态文件（hooks/QA 截图/config/lockfile 等） |
| `~/.codex/worktrees/gtm-canvas-prod-qa-20260705` | `codex/nav-new-campaign-guard-20260705` / `71f85839` | 1：`FlowCanvas.tsx` |

当前 `codex/orchestrator-handoff` 的 3 个 dirty 项是本 PR 的 skill/AGENTS/状态账，不属于遗留资产。

## 三、已接管但未执行的风险

1. PR #227 在旧 session 中由 agent 自合，违反现行合并纪律；任何部署前需独立复审。
2. L1 疑似媒体契约缺口：排期允许视频，但 IG worker 可能把非 JPEG 资产截成 JPEG 首帧；必须以复现测试确认，不能先当事实修。
3. Cloudflare 高权限凭据已进入持久 transcript；另有 MCP key 曾出现在进程 argv。视为暴露，等待 founder 批准轮换为最小权限 token。
4. Production 与 main 不同步；本轮不部署、不启用 Meta、不做真实平台动作。
5. README/旧计划仍有 auto-deploy 等状态漂移；法律以 `AGENTS.md` 为准，状态以机器事实为准。

## 四、Founder 待决（Codex 与 Fable 当前共识）

### D0 · 三方治理 trial

建议：一级决定由 Founder + Codex + 已验证 Fable 共同裁决；二级判断由 Codex + 已验证 Fable 完成后集中报 founder、保留否决权；三级为既定方案内的有界执行，不再逐项打断 founder。先试跑一个完整工作循环，再决定是否永久接受。

### D1 · 产品心智

建议：FIKIRTIVE 身份保持「完整专业工具 + Otto 100% 操作」；Growth Mission 只作为 Otto 的工作/注意力视图，组合 Campaign + Routine + 审批收件箱 + 回执，不新造平行一等对象，也不取代画布/工作台主场。

### D2 · Immersive 时序

建议：否决整包合并 #203，也不继续在旧大分支接后台。把 #203 固定为设计基准；设计车道可继续，工程车道按纵向旅程从 main 切片上岸。第一片若需拖入超过 20 个无关文件才编译，则停止搬代码，改为依设计规格在 main 重建该片。

### D3 · Design B 首落

建议：先在 $0、fail-closed 的发布/证据纵向环证明 typed capability handle；创作钱路随后迁移，不把最高流量、最重钱路区当首个架构试验田。

### D4 · 下一批三张 PR

1. 独立复审 L1 + 用测试确认/修复视频媒体契约；不外呼。
2. L0 最小证据脊柱：短链 redirect、幂等事件写入、owner-scoped read；无 UI、无部署。
3. Design B 种子：typed capability registry + 机器审批公式，只包少量 $0/fail-closed action；UI 与 Otto 共享同一 handle，parity 债不增加。

以上四项均为提案；未获 founder 本轮明确批准前，不开产品代码 worker。

## 五、恢复顺序

1. 先确认本状态账的 SHA/PR/进程/部署仍属实。
2. 保护 `wt-lcf` 与所有用户 worktree；禁止 `prune/reset/clean`。
3. 读取 founder 对 D1-D4 的裁决。
4. 每个获批判断附同一证据包与实际 Fable 模型证明。
5. 派有界 worker；只开 PR，等待 founder 合并。

## 六、Trial 衡量

- 零自合、零 auto-merge、零自动部署、零真实花费/外部动作；
- founder 不需重复项目上下文；
- 每个一级/二级判断都有真实 Fable 模型证明；
- 中断后一次恢复，不遗失 dirty worktree/worker；
- 不再把设计壳、已合代码、已部署能力、已验证效果混为同一状态。
