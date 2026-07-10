# FIKIRTIVE 编排状态账

> 性质：可恢复控制面的最后核验检查点，不替代 git、PR、CI、部署与进程事实。
> 状态：`trial`，founder 已批准开始。更新时间：2026-07-11 03:32 +08（Asia/Kuala_Lumpur）。

## 一、当前控制权

- **Founder**：founder-only 类别最终裁决；已授权 #228 生效后的普通 PR 由 control plane 按分权规则处理。
- **Codex**：当前唯一控制面；分支 `codex/orchestrator-handoff`；本机配置 `gpt-5.6-sol / ultra`。
- **Fable 5**：一级/二级判断联署顾问，调用必须请求 `max`；完成证明与本次 incomplete 记录见下表。
- **全局 skill**：`~/.claude/skills/orchestration` 是通用实体；`~/.codex/skills/orchestration` 以 symlink 共用它。FIKIRTIVE repo 版优先。
- **旧 Claude session**：`3d3b73a4-6c32-45a3-a845-4185acfb7d1d` 的主 backend 已退出，遗留子进程保持停止态；不得恢复旧 workflow 或沿用其口头状态。

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
| 模型/effort 复核（未完成） | `535aad46-c402-4d63-b161-8e71fbebbb5f` / 19:00:05–19:05:24 | `~/.claude/projects/-Users-winnin--codex-worktrees-1850-FIKIRTIVE/535aad46-c402-4d63-b161-8e71fbebbb5f.jsonl` | observed `claude-fable-5` / fallback 0；requested `max`，applied unknown；14 assistant records、无 `end_turn` | `f6413585b483a6ebe494194fcaa3e1e5458b5d7e347866bcd38c24e1538f10bc` |

### 2026-07-11 advisor incident

- Fable max call：stdout/stderr 均 0 bytes；transcript 在 19:05:24 UTC 后停止增长，进程继续 sleep；10 分钟后由 control plane `SIGTERM`。标签：`Fable 5 verified, advisor incomplete: no end_turn`，不是联署意见。
- 两条只读 Codex research subagent：均立即返回 `Selected model is at capacity`，未改文件。标签：`advisor unavailable: capacity`。
- Clean-room SOL Ultra：fresh `--ephemeral --ignore-user-config --sandbox read-only`；thread `019f4d72-1882-7e40-99b0-c8ab120edb0a`；requested `gpt-5.6-sol / ultra`，因 ephemeral session 无持久 model metadata，observed model/effort 为 unknown。累计约 519 KB structured events，但 16 分钟没有最终 `turn.completed`，由 control plane 截止。标签：`independent SOL Ultra requested, advisor incomplete: hard timeout`，不是共识。
- Opus 异族 diff review：requested `opus / max`；session `8af75a33-7853-4525-9044-a51dcbe7d81e` 只有输入、0 assistant records，连续 5 分钟无进展后截止。标签：`reviewer unavailable: no progress`，未伪报 PASS。
- 耐久证据：`~/Desktop/FIKIRTIVE-RESCUE-2026-07-10/ORCHESTRATION-PROOFS-2026-07-11/`。SOL events SHA-256 `2f16130c6a8d291b9fdd44fda10de6e7e06b5a3456df0be6a12eeb8b0dea5d6b`；Fable/SOL prompt SHA-256 分别为 `809ec6135835bc56648f65f453623d1ad398addb2b0f8f780eeb4b92cc093e94` / `7b6054a2221ca352115269138513bef48b5c305bf83ee89187c042300a0d9c78`。

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

当前 `codex/orchestrator-handoff` 的 dirty 项只允许属于 PR #228 的治理文件；数量以实时 `git status --short` 为准，不沿用本快照计数。

## 三、已接管但未执行的风险

1. PR #227 在旧 session 中由 agent 自合，违反现行合并纪律；任何部署前需独立复审。
2. L1 疑似媒体契约缺口：排期允许视频，但 IG worker 可能把非 JPEG 资产截成 JPEG 首帧；必须以复现测试确认，不能先当事实修。
3. Cloudflare 高权限凭据已进入持久 transcript；另有 MCP key 曾出现在进程 argv。视为暴露，等待 founder 批准轮换为最小权限 token。
4. Production 与 main 不同步；本轮不部署、不启用 Meta、不做真实平台动作。
5. README/旧计划仍有 auto-deploy 等状态漂移；法律以 `AGENTS.md` 为准，状态以机器事实为准。

## 四、Founder 已批准的工作方向

> 2026-07-11 founder 明确回复：D0–D5 全部可执行；model/effort 使用最高且按任务路由；Fable 不可用时用独立 SOL Ultra；普通 PR merge 授权 control plane，重要决定仍回 founder；允许全产品重新审计并推翻既有建议。顾问本次 incomplete 不覆盖 founder 的明确命令。

### D0 · 三方治理 trial

**Approved as trial**：一级决定由 Founder + Codex + 已验证 Fable 共同裁决；二级判断由 Codex + 已验证 Fable 完成后集中报 founder、保留否决权；三级为既定方案内的有界执行。Fable unavailable 时按 clean-room SOL Ultra 协议，不伪造联署。

### D1 · 产品心智

**Approved as working hypothesis, reopened for audit**：当前执行假设保持「完整专业工具 + Otto 100% 操作」；Growth Mission 只作工作/注意力视图。`FULL-PRODUCT-REAUDIT-2026-07-11.md` 可用证据推翻这条；若触及蓝图，先由 founder 修宪。

### D2 · Immersive 时序

**Approved**：否决整包合并 #203，也不继续在旧大分支接后台。把 #203 固定为设计基准；设计车道可继续，工程车道按纵向旅程从 main 切片上岸。第一片若需拖入超过 20 个无关文件才编译，则停止搬代码，改为依设计规格在 main 重建该片。

### D3 · Design B 首落

**Approved, subject to audit Gate 1**：先在 $0、fail-closed 的发布/证据纵向环证明 typed capability handle；创作钱路随后迁移。若全产品 re-audit 在 Gate 1 改变 product thesis，再重新排序。

### D4 · 下一批三张 PR

**Approved sequence, with audit hold on product-expanding work**：

1. 独立复审 L1 + 用测试确认/修复视频媒体契约；不外呼。
2. L0 最小证据脊柱：短链 redirect、幂等事件写入、owner-scoped read；无 UI、无部署。
3. Design B 种子：typed capability registry + 机器审批公式，只包少量 $0/fail-closed action；UI 与 Otto 共享同一 handle，parity 债不增加。

### D5 · 凭据轮换

**Approved**：先完成依赖/停机影响 inventory，再轮换 transcript/argv 中暴露过的 Cloudflare 高权限凭据与 Magic MCP key；真实撤销/替换仍按具体 provider 的外部动作 gate 报告执行证据，不打印旧值。

### D6 · 模型与 effort

**Approved**：control plane 使用最高可用 orchestrator effort；Fable 请求 `max`；Fable unavailable 时使用独立 clean-room SOL Ultra；其他任务按 `MODEL-ROUTING-2026-07-11.md` 路由，不机械地把 ultra 用在变量名/格式活。

### D7 · 全产品重新审计

**Approved to start**：按 `docs/review/FULL-PRODUCT-REAUDIT-2026-07-11.md` 重新审计用户、product thesis、Otto、UI/UX、能力真实性、商业、竞争、架构、安全与品牌。允许提出完全不同结论；Gate 1 前不扩建大壳或新 continent。

### D8 · Merge delegation

**Approved with separation of duties**：PR #228 修改治理，仍由 founder 合并。#228 生效后，Codex control plane 可合并自己未参与编写、current-head CI 全绿、独立异族 review 无 P0/P1、且不含 founder-only 类别的普通 PR；作者不得自合，永不 auto-merge。

产品代码 worker 仍需遵守 re-audit Gate 0/1：只允许不扩大 thesis 的 L1 red test、安全 inventory 与只读取证先行。

## 五、恢复顺序

1. 先确认本状态账的 SHA/PR/进程/部署仍属实。
2. 保护 `wt-lcf` 与所有用户 worktree；禁止 `prune/reset/clean`。
3. 读取 D0-D8 的批准与 re-audit gate；不把 working hypothesis 写成永久真理。
4. 每个判断附同一证据包与 advisor provenance；incomplete/fallback 不冒充 Fable。
5. 派有界 worker；普通 PR 只有 #228 生效后才按分权规则合并，founder-only PR 等 founder。

## 六、Trial 衡量

- 零作者自合、零未授权 merge、零 auto-merge、零自动部署、零真实花费/外部动作；
- founder 不需重复项目上下文；
- 每个一级/二级判断都有完整 advisor provenance；Fable / clean-room fallback / founder override 不混标；
- 中断后一次恢复，不遗失 dirty worktree/worker；
- 不再把设计壳、已合代码、已部署能力、已验证效果混为同一状态。
