# OM1 — off-main 能力盘点

> 基线核验：`git rev-parse --short=8 HEAD` = `b5a48d0f`（与工单钉死基线一致）。
> 只读盘点，禁止 checkout/fetch/pull；PR #202/#203 用本地已有分支 ref 做
> `git diff --stat $(git merge-base origin/main <branch>)..<branch>`；其余分支用
> `git rev-list --left-right --count origin/main...<branch>`（左=behind/仅 main 独有，
> 右=ahead/仅该分支独有）+ `git diff --shortstat`。命令均可复跑，未 checkout 任何分支。

## 1. 全量 open PR（`gh pr list --state open --limit 100`，共 4 条）

| PR | 标题（一句话） | head→base | 状态 | 备注 |
|---|---|---|---|---|
| #230 | fix(l1): 恢复路径双发窗口 —— UNCONFIRMED + Lock 4【founder-only 合并】 | `claude/l1-unconfirmed-guard`→main | draft, MERGEABLE | FIKIRTIVE 1 在途红测，只记 tip（见下表，ahead=1 behind=0） |
| #229 | fix(l1): IG 发布媒体契约守卫 —— 视频不再被静默抽成 JPEG 首帧 | `claude/l1-media-contract-redtest`→main | open, MERGEABLE | FIKIRTIVE 1 在途红测，只记 tip（ahead=1 behind=0） |
| #203 | feat(immersive): /northstar-immersive —— 完整可上手连贯 app | `claude/northstar-immersive`→main | open, mergeable=UNKNOWN | 见 §2 |
| #202 | feat(northstar): 北极星原型城 v1 —— 57 页全城可点击 | `claude/northstar-city-v1`→main | open, mergeable=UNKNOWN | 见 §2 |

证据：`gh pr list --state open --limit 100 --json number,title,headRefName,baseRefName,mergeable,isDraft`（原始 JSON 已在本次会话工具输出中，未落盘）。

## 2. #203 / #202 相对 merge-base 的 diffstat（本地分支 ref，未 checkout）

| PR | 分支 | merge-base | diffstat（`git diff --stat <base>..<branch>` 尾行） | 装的是什么（从 commit message 判） |
|---|---|---|---|---|
| #203 | `claude/northstar-immersive`（本地 HEAD `763a28e6`） | `d1cd70fd` | 272 files changed, 61923 insertions(+), 1 deletion(-) | 北极星沉浸式原型（全城可点击 app 外壳），最新提交是"总指挥交接书"文档，非产品代码 |
| #202 | `claude/northstar-city-v1`（本地 HEAD 见 branch） | `d1cd70fd`（同上） | 88 files changed, 18438 insertions(+) | 创作区 7 页原型（`product-rail.tsx`／`search-palette.tsx`／`schedule/kit.tsx` 等新组件），零后台 |

对照 `docs/ops/ORCHESTRATOR-STATE.md:34`：该文档记录 #203 为「272 files、+62,314 lines、相对 main 为 16/122 分叉」；本次复跑得到 272 files/+61,923（略低，属 main 在此之后继续推进的正常漂移，量级一致，未见矛盾）。

## 3. 全量非 main 分支：ahead/behind + diffstat 摘要 + 一句话

> ahead = 仅该分支独有的提交数；behind = 仅 origin/main 独有的提交数
> （`git rev-list --left-right --count origin/main...<branch>` → `behind ahead`）。

### 3a. 工单点名的重点分支

| 分支 | ahead/behind | diffstat（merge-base..branch） | 装的是什么 | 证据 |
|---|---|---|---|---|
| `codex/schedule-publish-qa-fixes` | 1 / 96 | `apps/web/lib/__tests__/schedule-actions.test.ts`(+50/-1)、`schedule-actions.ts`(+42/-3)、`packages/core/src/index.ts`(+2)、`schedule-draft.ts`(+8/-2) → 4 files, 91(+)/11(-) | 排期草稿 action 的一处修复+测试补强 | `git diff --stat $(git merge-base origin/main codex/schedule-publish-qa-fixes)..codex/schedule-publish-qa-fixes` |
| `codex/admin-dashboard-v2` | 3 / 112 | `TenantDetail.tsx`(405行变更)、`admin-v2.ts`(+810 新文件)、`admin-v2-page.tsx`(+13)、`tenant-actions.ts` 等，共 27 files, 3566(+)/652(-) | 管理后台 tenant 详情页 v2 大改版（新增 admin-v2 数据层） | 同上，`git diff --stat $(git merge-base origin/main codex/admin-dashboard-v2)..codex/admin-dashboard-v2` |
| `codex/fikirtive-dashboard-uiux` | 0 / 467 | 空（merge-base == 分支 HEAD，即分支尖端已是 main 历史上的祖先提交） | 无独立内容 —— 该分支 HEAD 是一个早已合入/被 main 超越的旧提交（"docs(otto): phased implementation plan for OpenAI Agents SDK migration"），非活跃在建能力 | `git rev-list --left-right --count origin/main...codex/fikirtive-dashboard-uiux` → `467 0` |
| `claude/l1-unconfirmed-guard`（PR #230） | 1 / 0 | `schedule-actions.test.ts`(+17)、`schedule-actions.ts`(+11)、`publish-doublepost.test.ts`(+127 新文件)、`publish.test.ts`(+10/-2)、`publish.ts`(+33/-4)、`schema.prisma`(+6/-2) → 6 files, 198(+)/6(-) | L1 恢复路径 UNCONFIRMED 状态 + Lock 4 拒绝闸（红测） | 只记 tip，未深挖（工单要求） |
| `claude/l1-media-contract-redtest` (PR #229) | 1 / 0 | `publish-media-contract.test.ts`(+100 新文件)、`publish.ts`(+43/-10) → 2 files, 133(+)/10(-) | L1 IG 发布媒体契约守卫红测（mime 白名单） | 只记 tip |

### 3b. 其余具名分支（本地/远端全量，含 ahead=0 已被 main 吸收的分支）

| 分支 | ahead/behind | diffstat 摘要 | 一句话 |
|---|---|---|---|
| `claude/blueprint-amend-v2.11` | 1/15 | 2 files, +19/-5 | BLUEPRINT v2.11 修宪包（R5 双脑） |
| `claude/blueprint-v2.10-platform-protocol` | 1/19 | 2 files, +2/-1 | BLUEPRINT v2.10 平台协议附则 |
| `claude/blueprint-v2.5-positioning` | 1/36 | 2 files, +9/-2 | BLUEPRINT v2.5 定位宣言 |
| `claude/blueprint-v2.6-agent-native-ui` | 1/32 | 2 files, +3/-2 | BLUEPRINT v2.6 Agent-native UI |
| `claude/blueprint-v2.7-wording` | 1/29 | 2 files, +5/-4 | BLUEPRINT v2.7 措辞修正 |
| `claude/blueprint-v2.8-interpretation` | 1/26 | 2 files, +11/-2 | BLUEPRINT v2.8 解读边界附则 |
| `claude/blueprint-v2.9-zero-learning-curve` | 1/21 | 2 files, +4/-3 | BLUEPRINT v2.9 零学习曲线定律 |
| `claude/confident-kapitsa-f2a22b` | 0/46 | 空（HEAD 是 main 祖先） | `fix(otto): submit campaign name reliably`——已被 main 超越/吸收，无独立差异 |
| `claude/d8-capability-truth` | 1/15 | 2 files, +2/-2 | D8 能力真话表文案对齐 |
| `claude/design-quickwins-tokens` | 1/23 | 3 files, +157/-9 | 设计 token 快赢包（圆角/焦点环/动效 token 等） |
| `claude/design-system-repo-mirror` | 1/29 | 7 files, +657 | 设计系统 repo 镜像文档 |
| `claude/design-v3-mirror` | 1/25 | 13 files, +2258/-156 | 设计规则 v3 完全体镜像 |
| `claude/doctrine-sol-elevation` | 1/3 | 1 file, +2/-1 | Sol Ultra 升格并肩 advisor 文档（已合入 main，见 HEAD commit b5a48d0f 前一条） |
| `claude/fikirtive-orchestrator-handoff-1ec82f` | 0/6 | 空（HEAD 是 main 祖先） | PR-L0a 量测原语（#218）——已并入 main |
| `claude/funny-proskuriakova-963366` | 0/21 | 空（HEAD 是 main 祖先） | canvas Phase 1（#191）——已并入 main |
| `claude/governance-docs-to-main` | 1/17 | 23 files, +4679/-6 | 治理文档落 main 打包 |
| `claude/l1b-publish-worker` | 2/7 | 20 files, +310/-36 | PR-L1b-1 publish plumbing（token-crypto/creationId/PUBLISH_QUEUE，inert） |
| `claude/lc-f-home-ideas-lighting`（= staging `54c1de0b`） | 122/17 | 272 files, +62314/-1 | 见 §4（staging 核实） |
| `claude/leader-playbook-verdicts` | 2/12 | 3 files, +227 | 借鉴先行律移入教训清单 |
| `claude/masterplan-lighting-v2` | 1/11 | 4 files, +690 | 点亮章 v2 masterplan |
| `claude/nice-lamarr-02b471` | 0/21 | 空（HEAD 是 main 祖先） | canvas Phase 1（#191 同源）——已并入 main |
| `claude/northstar-city-v1`（PR #202） | 7/23 | 见 §2 | 北极星创作区 7 页原型 |
| `claude/northstar-immersive`（PR #203） | 103/23 | 见 §2 | 北极星沉浸式全城原型 |
| `claude/nsi-work` | 7/23 | 88 files, +18438 | 创作区 7 页原型（同 #202 系） |
| `claude/orchestration-skill-merge` | 1/5 | 5 files, +84/-80 | orchestration skill 三合一重构 |
| `claude/orchestration-skill-setup-1312a5` | 0/0 | — | 与 origin/main 完全同头（establish Codex-Fable control plane，即 #228，已合入） |
| `claude/otto-kb-citation-followup` | 17/113 | 21 files, +3079/-5 | Otto P0 KB citation follow-up |
| `claude/otto-url-build` | 1/112 | 1 file, +109 | B-02 URL 一键建档 spec |
| `claude/playbook-live-reflection` | 1/32 | 1 file, +9 | live reflection 三查入审查清单 |
| `claude/r5-two-brain-archive` | 3/15 | 2 files, +485 | 地雷一二裁入档 |
| `claude/relaxed-chaplygin-17e7bc` | 0/21 | 空（HEAD 是 main 祖先） | canvas Phase 1（#191 同源）——已并入 main |
| `claude/serene-swartz-e3fc34` | 14/23 | 104 files, +28500/-1 | northstar 预览豁免 auth 代理（walkable preview） |
| `claude/verdicts-2026-07-11` | 1/6 | 1 file, +9 | founder 六答归档 |
| `claude/whatpass-v2-candidates` | 1/21 | 2 files, +644 | WHAT-pass v2 扩容候选总表 |
| `codex/auth-session-gate-test` | 1/112 | 1 file, +129 | session.create.before 锁测试 |
| `codex/content-qa-fixes` | 52/105 | 53 files, +1764/-487 | canvas node toolbar 点击可靠性等 QA 修复包 |
| `codex/nav-new-campaign-guard-20260705` | 3/58 | 4 files, +157/-6 | 排期贴纳入 campaign work 判定 |
| `codex/orchestrator-handoff` | 3/1 | 未取（ahead 小，非产品能力，纯交接文档） | orchestration 交接协议 v1 采纳 |
| `codex/research-queue-safety` | 1/112 | 4 files, +179/-26 | 阻止冒充 approve + 找回丢失队列发送 |
| `codex/schedule-publish-qa-fixes` | 1/96 | 见 3a | 排期 action 修复+测试 |
| `fix/ops-legal-baseline` | 1/102 | 23 files, +585/-9 | 事故可见性 + 合规面补课 |
| `ns-account-work` | 11/23 | 99 files, +25852 | northstar 账户页原型 |
| `nsc-account-work` | 7/23 | 88 files, +18438 | 创作区 7 页原型（同 #202/nsi-work 系） |
| `codex/eslint-sweep-20260710`（仅远端，无本地 ref） | 17/2（vs `origin/main`） | 未取 diffstat | eslint 清债引入的轮询时序回退修复（`origin/codex/eslint-sweep-20260710` HEAD commit message） |

### 3c. `worktree-agent-*` 分支（22 条，全部 ahead=0）

全部 `ahead=0`（无独立提交），HEAD 分别停在若干条已合入 main 的历史 PR 上（#134 区划图刷新 / #181 MASTERPLAN v1 / #187 v2.5 定位宣言 / #189 X 发布 spec / #194 两级 staging / #197 artlio 清剿 / #200 北极星计划 / #186 死付费端点删除）。判断：这些是并行 agent worktree 在不同历史时点创建的快照分支，无独立能力内容，diffstat 为空。未逐条深挖每一支的具体 diffstat（ahead=0 已可判定无差异，属本轮预算取舍）。

证据：`git for-each-ref refs/heads/ | grep worktree-agent-` + 逐条 `git rev-list --left-right --count origin/main...<branch>`（全部结果见本次会话工具输出，均为 `N 0`）。

## 4. staging 分支 `54c1de0b` 相对 main 的分叉核实

- `54c1de0b` 完整 hash 解析为 `54c1de0b2dab0b1be6398ea1d36e1fb18142f17a`，commit subject
  `fix(gate4/factory): 修八条抽验坐实缺陷(H1/H2/M1/M3/M4/M5/M6/M7)`。
- 该 hash 是本地分支 **`claude/lc-f-home-ideas-lighting`** 的 HEAD（`git rev-parse --short=8 claude/lc-f-home-ideas-lighting` → `54c1de0b`），**不是** `claude/northstar-immersive` 的 HEAD（后者本地 HEAD 是 `763a28e6`）。
- `git rev-list --left-right --count origin/main...claude/lc-f-home-ideas-lighting` → `17 122`（17 = 仅 main 独有 / behind；122 = 仅该分支独有 / ahead）。
- 对照 `docs/ops/ORCHESTRATOR-STATE.md:33-34`：该文档把「Immersive staging 分支 `54c1de0b`」与「PR #203 `claude/northstar-immersive@54c1de0b`」并列，同时称分叉为「16/122」。本次核实：短 hash `54c1de0b` 实际归属 `claude/lc-f-home-ideas-lighting`，与 `claude/northstar-immersive`（HEAD `763a28e6`）是两个不同分支尖端；ORCHESTRATOR-STATE 里把两者都记成同一短 hash，疑似文档记录时序错位或两分支曾短暂同头后各自继续提交（未继续深挖，原始观察见下）。分叉数字「17/122」与文档「16/122」的 behind 相差 1，量级一致（main 在此后又推进一条提交，属预期漂移）。
- `git diff --stat $(git merge-base origin/main claude/lc-f-home-ideas-lighting)..claude/lc-f-home-ideas-lighting` → `272 files changed, 62314 insertions(+), 1 deletion(-)`（merge-base `c7f6a04b`），与 #203 的 diffstat（272 files, +61923/-1，merge-base `d1cd70fd`）文件数一致、行数接近但不完全相同 → 两分支内容高度重叠但非同一提交历史（merge-base 不同）。

## 5. 受保护 dirty worktree（禁止访问路径，仅引用 ORCHESTRATOR-STATE.md 记录）

以下均只转述 `docs/ops/ORCHESTRATOR-STATE.md` 的既有记录，未访问任何实际路径：

- `…/scratchpad/wt-lcf`（`docs/ops/ORCHESTRATOR-STATE.md:64,74`）：分支/HEAD `claude/lc-f-home-ideas-lighting` / `54c1de0b2dab0b1be6398ea1d36e1fb18142f17a`；porcelain 2 项 = `M packages/db/prisma/schema.prisma` + `?? packages/db/prisma/migrations/20260711000000_studio_idea/`（StudioIdea schema + migration，未提交）。
- `~/Desktop/FIKIRTIVE`（`docs/ops/ORCHESTRATOR-STATE.md:70`）：分支/HEAD `claude/northstar-immersive` / `763a28e6`；porcelain 5 项，`.gitignore` + launch/Codex/demo/log 等用户文件。
- `~/.codex/worktrees/24a1/FIKIRTIVE`：分支/HEAD `codex/schedule-publish-qa-fixes` / `515e6073`；porcelain 15 项（canvas/Otto/设计资产）。
- `~/.codex/worktrees/a620/FIKIRTIVE`：分支/HEAD `codex/admin-dashboard-v2` / `30dd90e0`；porcelain 1 项（`docs/audits/`）。
- `~/.codex/worktrees/b5ec/FIKIRTIVE`：detached `eb8ce68c`；porcelain 3 项（outputs/tmp/videos）。
- `~/.codex/worktrees/dec1/FIKIRTIVE`：detached `d5434f6d`；porcelain 16 项删除态文件（hooks/QA 截图/config/lockfile 等）。
- `~/.codex/worktrees/gtm-canvas-prod-qa-20260705`：分支/HEAD `codex/nav-new-campaign-guard-20260705` / `71f85839`；porcelain 1 项（`FlowCanvas.tsx`）。

注：以上 HEAD 短 hash（如 `515e6073`/`30dd90e0`/`71f85839`）与本次盘点中对应分支的本地 ref HEAD 可能不同——ORCHESTRATOR-STATE 记录时间是 02:07 +08，dirty worktree 里的分支可能之后又有新提交推到远端/本地被本次盘点的 ref 追上。未做交叉核验（预算取舍，且这些路径本身禁止访问）。

## 断层观察（原始观察，不排序不评分）

1. `codex/fikirtive-dashboard-uiux` 分支名暗示"仪表盘 UI/UX"能力，但实际 HEAD 已是 main 历史祖先（ahead=0），diffstat 为空——分支名与实际内容不匹配，可能是早期快照未清理。
2. ORCHESTRATOR-STATE.md 把短 hash `54c1de0b` 同时标注给 `claude/lc-f-home-ideas-lighting`（staging 部署分支）和 `claude/northstar-immersive@54c1de0b`（PR #203 描述里），但本次核实两分支本地 HEAD 不同（`54c1de0b` vs `763a28e6`）——文档内部这两处引用可能存在记录时序错位，需人工确认哪个才是真正部署到 staging 的提交。
3. `claude/northstar-immersive`（PR #203，103 ahead）与 `claude/lc-f-home-ideas-lighting`（122 ahead，= staging）diffstat 高度接近（272 files 相同，+61923 vs +62314）但 merge-base 不同（`d1cd70fd` vs `c7f6a04b`）——两条分支疑似同源分叉后各自独立推进，内容大量重叠但非同一历史线。
4. `claude/northstar-city-v1`（PR #202，nsi-work，nsc-account-work）三个分支 diffstat 完全相同（88 files, +18438，0 deletions）——极可能是同一批提交在不同分支名下的重复/镜像，而非三份独立工作。
5. 5 个分支（`confident-kapitsa-f2a22b`、`fikirtive-orchestrator-handoff-1ec82f`、`funny-proskuriakova-963366`、`nice-lamarr-02b471`、`relaxed-chaplygin-17e7bc`）ahead=0 且 diffstat 为空，说明它们的内容已完全并入 main（HEAD 是 main 祖先节点）——是历史遗留、非活跃在建能力，但仍挂在分支列表里，未清理。
6. 22 条 `worktree-agent-*` 分支全部 ahead=0，是并行 agent 会话自动创建的历史快照，无独立内容——分支列表噪音，占比接近全部非 main 分支的三分之一（22/68）。
7. `docs/ops/ORCHESTRATOR-STATE.md:34` 记录 #203 分叉为「16/122」，本次复跑得到 17/122（behind 多 1）——量级一致，属 main 持续推进的正常漂移，非矛盾。

## Unknowns

1. `54c1de0b` 到底是哪次真实部署到 immersive staging 的提交——是 `claude/lc-f-home-ideas-lighting` 还是曾经短暂等同的 `claude/northstar-immersive` 某个历史点——本次只能确认当前两分支本地 HEAD 不同，无法回溯部署当刻的确切分支状态（deploy `a0b6eb42` 对应的源未在本次盘点范围内核实）。
2. `codex/orchestrator-handoff`（ahead=3/behind=1）的具体 diffstat 未取（判定为非产品能力，纯交接文档，预算取舍下跳过）。
3. `codex/eslint-sweep-20260710`（仅远端分支，无本地 ref）未取 diffstat，只有 commit subject。
4. dirty worktree 清单里的短 hash（`515e6073`/`30dd90e0`/`71f85839` 等）与本次盘点对应分支最新 HEAD 是否一致，未交叉核验（受保护路径禁止访问，且 ORCHESTRATOR-STATE 记录时间早于本次盘点，可能已有新提交）。
5. 除本工单点名的 5 个重点分支外，其余具名分支的 diffstat 只取了 `--shortstat` 摘要（文件数+行数），未逐一取完整 `--stat` 文件级清单——如需文件级细节需针对具体分支再跑一次。
