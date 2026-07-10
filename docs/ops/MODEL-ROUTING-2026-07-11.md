# FIKIRTIVE 模型与 effort 路由（trial）

> 生效前提：随 PR #228 由 founder 合入 main。快照时间：2026-07-11 03:32 +08。
> 目标：把最高智能用在真正需要判断的地方，同时让每个执行任务都有合适模型、明确 effort、独立复核与机器证据。

## 1. 证据优先级

1. 当前调用的实际 response/session metadata；
2. 当前本机 model catalog 与 CLI 可验证行为；
3. 官方模型/CLI 文档；
4. 本项目盲测与真实 PR 结果；
5. `MODEL-DOSSIER-2026-07.md` 与第三方资料，只作候选证据。

模型自己说“我是某模型/用了最高 effort”不算证据。公开文档与本机私有 label 必须分开写。

### 2026-07-11 已验 runtime 事实

| 面 | 已验事实 | 不可外推 |
|---|---|---|
| Codex control plane | `~/.codex/config.toml` 为 `gpt-5.6-sol / ultra`；本机 catalog 把 `ultra` 定义为最大推理 + 自动任务委派 | 不把这个 label 当所有公开 API/账号都支持的稳定契约 |
| Codex 公共配置 | 官方 config reference 列出通用 reasoning effort 到 `xhigh`，并说明更高档受模型支持限制 | 不能只凭公共 enum 否定本机 catalog 的额外档位 |
| Claude advisor | Claude Code v2.1.206；Fable 5 支持 `max`，默认只有 `high`；非交互调用要在启动时传 `--effort max` | 请求了 `max` 不等于已观察到 applied `max`；组织 cap 可能不在 JSON 中显式报告 |

官方参考：[Claude model/effort configuration](https://code.claude.com/docs/en/model-config)；[Codex configuration reference](https://developers.openai.com/codex/config-reference)。

## 2. 固定席位

| 席位 | 首选 | effort | 责任与边界 |
|---|---|---|---|
| Recoverable control plane | GPT-5.6 Sol | `ultra` | 维护状态、拆任务、路由、验证、汇报；不自审自合，不越过生产/钱/租户/治理闸 |
| Judgment co-orchestrator | Fable 5 | `max` | 一级/二级产品、架构、设计、审计判断；fresh、read-only，不承载施工主循环 |
| Fable clean-room fallback | 独立 GPT-5.6 Sol | `ultra` | 仅当 Fable unavailable/incomplete；ephemeral、read-only、无旧结论、不可 resume；标签不得写成 Fable |
| Deep implementation / native review | Opus 4.8 | `high` 默认；高风险 `xhigh/max` | 跨模块实现、复杂 debugging、长上下文审查；钱路/租户/安全件只施工或审查，不独自批准 |
| Bounded production work | Sonnet 5 | `high` | 既定设计内的代码、测试、批量变体；范围漂移立即升级 |
| Mechanical worker | Haiku 4.5 或经试工合格的轻量模型 | `medium`；失败升 `high` | URL、清单、格式、简单 fixture；完成必须由工具/测试证明 |

模型容量、账号可用性或官方版本变化时，不静默换名；状态账写 `unavailable`，再按同一任务级别选已验证备选。

## 3. 按任务选 model/effort

| 任务 | 首选组合 | effort 规则 | 必要复核 |
|---|---|---|---|
| 产品身份、ICP、品牌、商业模式 | Codex control plane + Fable | `ultra` + `max` | founder 最终裁决；Fable 不可用才启 clean-room SOL Ultra |
| 架构、领域/数据模型、跨模块接口 | Codex + Fable；Opus 施工/审查 | `ultra` + `max`；Opus `xhigh` | 方案与实现分席；schema/migration 永远 founder-only merge |
| 钱路、tenant、安全、凭据 | Codex + Fable；Opus 安全审查 | 顾问 `max`，审查 `max` | exactly-once/ownerId 机器 gate + founder；任何单模型都不能批准 |
| UI/UX 方向、旗舰交互 | Fable 判断；Opus/Sonnet 实现 | 方向 `max`，实现 `high/xhigh` | 截图/真实浏览器/任务完成率盲评，不以代码完成代替体验完成 |
| 普通 feature / bug fix | Sonnet 5 或 Opus 4.8 | 明确边界用 `high`；跨模块/难 bug 升 `xhigh` | 单测、集成、web build；异族 review 按风险抽/全审 |
| PR 独立 review | 与作者不同家族 | 普通 `high`；重要 `xhigh/max` | reviewer 无写权限；逐条 disposition；不能让作者本人当唯一 reviewer |
| 最新资料/竞品/法规研究 | Sol/Opus 只读研究 | 单线 `high/xhigh`；多线综合才 `ultra/max` | 只用一手来源；时点、URL、未知项入证据包 |
| 机械核对、格式、CI 重跑 | 轻量 worker | `medium` 起；不通过即升档，不循环猜 | 命令输出与 current SHA；无判断权 |

### 升档触发器

出现任一项就升一级 effort 或换更强模型：证据互相矛盾、跨三个以上模块、不可逆副作用、money/tenant/security、用户承诺变化、长上下文丢失风险、测试无法解释、reviewer 与作者结论冲突。

不要因任务“看起来简单”降 effort：认证、幂等、时区、媒体类型、权限过滤常以小 diff 藏高风险。按后果而不是行数分档。

## 4. Advisor provenance 与 clean room

每轮记录：prompt/evidence SHA、requested model/effort、observed model/effort、session/thread ID、fallback 事件、开始/最后进展/结束时间、结束状态、output SHA。

- `requested=max` + 无 applied metadata → 写 `applied effort unknown`；
- Fable 实际 model 正确但没有 `end_turn` → `Fable verified, incomplete`，不能联署；
- capacity/refusal → 立即 `unavailable`，不在同一 session 反复撞；
- fallback prompt 只含 founder 原话、法律、raw evidence、选项；隐藏 Codex recommendation 与旧 advisor answer；
- 独立 memo 完成后才能向 fallback 展示 Codex 论纲做第二回合挑战。

## 5. Liveness budget

- 无结构化进展连续 5 分钟：graceful terminate；
- 默认 hard wall 20 分钟；超过前必须在状态账预登记理由；
- 有事件增长只是 `in_progress`，最终回答 + 正常结束标记才是 `complete`；
- 背景进程必须每 60 秒以内向 founder 报告健康证据，不能只说“还在跑”。

## 6. 路由质量衡量

每个完整工作循环统计：错误完成报告、fallback/incomplete 比率、升级次数、独立 review 真缺陷数、返工原因、CI 首过率、founder 被打断次数。两周后只根据这些结果调整路由，不根据模型发布会或单次印象升降档。
