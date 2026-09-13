# QUEUE-A7 施工前探针 · BytePlus Ark 视频任务排队行为实测

> 规格：`docs/specs/zero-queue.md`（QUEUE 前缀，验收编号 QUEUE-A7）。规格头「批准: Founder 2026-09-13 对谈裁决 ——
> 先裁方向「根治方案本版就要，不等新票」，再批本规格全文「批准，含探针预算（≤US$2）」」。
> 本探针只回答 QUEUE-A7 一条：「施工前探针（≤US$2，用生产同族最便宜档约 $0.18/条）」。
> 环境：Railway `staging`（`worker` 服务），凭据经 `railway run --environment staging --service worker -- node <脚本>`
> 注入子进程，脚本只 `process.env.BYTEPLUS_API_KEY` 读取、从未打印；本文档与所有存档 JSON 均已过一道脱敏（签名 URL
> 的查询串、任何形如密钥/token/signature 的字段一律替换为 `<redacted...>`）。

## 0. 总花费

| 项 | 任务数 | 计费用量 | 牌价估算（$3.50/M token，`packages/core/src/cost-pins.ts:81` `video:seedance-2-mini:t2v-per-mtoken`） |
|---|---|---|---|
| 步骤 1（单条，含突发 GET 限速探针） | 1 | `usage.total_tokens=50638` | $0.1772 |
| 步骤 3（4 条并发提交） | 4 | 每条 `total_tokens=50638`，合计 202,552 | $0.7089 |
| **合计** | **5** | **253,190 tokens** | **$0.8862**（预算 ≤$2，剩余约 $1.11） |

预算纪律：单价源统一用仓库钉点表的**牌价**（不采折后价，理由与钉点注释一致 ——「折扣既不保证续、也可能静默失效，成本按牌价记才安全」）；账号实际是否有折扣本次未查（超出「视频任务 create/get/list/delete 四类」调用范围，未调用计费/pricing 接口）。

## 1. QUEUE-A7 四点逐条定案

| 编号 | 问题 | 结论 | 证据级别 |
|---|---|---|---|
| ① | 超并发提交确实进 `queued`？ | **本次未观测到** —— 4 条并发提交后立即 GET，4 条全部已是 `running`（§3）。与仓库既有实测互证：`packages/generation/src/provider-concurrency.ts:87` 记录「官方账户额度 10（2026-08-08 `arkcli models get` 实测 `concurrent_requests: 10`）」，4 远低于 10，服务端没有理由排队。按计划纪律（「4 条全部立即 running…就此打住，不许为凑「超容」再堆任务」）本次到此为止。 | **降级：错误码级证据缺失，直接超容未实测（预算内不可达，因账户真实并发额度已知为 10，非规格假设的「个人档 3」）** |
| ② | GET 轮询限速实测口径？ | **实测定案**：对已终态任务做 150 次 GET、约 1.9 次/秒、持续约 79 秒，**全部 200，零次 429**（`burst-get-log.json`）。 | **实测定案（在 ~2 req/s、150 次的包络内未撞限；限速阈值的确切边界未定位——需要更高速率或更长窗口，超出预算纪律不再加测）** |
| ③ | 超时任务 GET 返回的真实 status 字符串（文档枚举漏 `expired`）？ | 本次任务的终态字符串是 **`succeeded`**（正常完成，非超时路径）。`expired` 需要占满 1 小时 `execution_expires_after` 窗口才能复现，预算与时间都不允许。 | **`succeeded` 实测定案；`expired` 未实测（防御口径：worker 侧未知终态字符串一律按失败调查路径处理，不假设“非 succeeded/failed 就是某个已知值”）** |
| ④ | 排队数上限的真实错误行为（`QuotaExceeded` 三义区分）？ | 未触发 —— 本次连 `queued` 状态都未出现，遑论排队数上限。 | **未实测（防御口径：`QuotaExceeded` 按 message 三义区分，不单靠 code 分类，与规格 §1.7 一致）** |

## 2. 步骤 1：单条提交 → 轮询到终态（状态时间线）

- 模型：`dreamina-seedance-2-0-mini-260615`（生产 `seedance-2-mini` 槽位，同族最便宜档）
- 参数：`resolution=480p`、`duration=5`、`generate_audio=false`、`watermark=false`、`execution_expires_after=3600`
- 请求形状与生产 `packages/generation/src/byteplus.ts:551-580` 一致（纯文生，无参考图/首尾帧）
- task id：`cgt-20260913211554-q56jn`

| 相对提交时刻 | HTTP | task status |
|---|---|---|
| +0ms（提交） | 200 | （建任务，返回 `id`，无 status 字段） |
| +7,082ms | 200 | `running` |
| +14,182 ~ +64,095ms（8 次） | 200 | `running`（未观测到 `queued`） |
| +71,175ms | 200 | **`succeeded`**（终态） |

完整回执（`task1-final.json`，已脱敏）关键字段：`usage.total_tokens=50638`、`resolution=480p`、`ratio=16:9`（adaptive）、`duration=5`、`framespersecond=24`、`service_tier=default`、`priority=0`、`output_format=mp4`。全程**未出现 `queued`** —— 与①的结论互证：单条提交时服务端直接进 `running`，说明账户远未触达并发上限。

估价：50,638 tokens × $3.50/M = **$0.17723**。

## 3. 步骤 3：4 条并发提交 → 立即 GET（服务端排队试探）

四条任务几乎同时提交（`Promise.all`），随后逐条立即 GET：

| 序 | task id | 提交 HTTP | 提交后立即 GET 的 status |
|---|---|---|---|
| #1 | `cgt-20260913211901-gpbqw` | 200 | `running` |
| #2 | `cgt-20260913211901-bssxk` | 200 | `running` |
| #3 | `cgt-20260913211901-8v2vt` | 200 | `running` |
| #4 | `cgt-20260913211901-qf2vt` | 200 | `running` |

**0 / 4 处于 `queued`**。按计划纪律，就此打住，不再堆任务凑「超容」；4 条全部继续轮询到终态以统计花费：

| task id | 终态 | `usage.total_tokens` | 终态相对四条提交时刻 |
|---|---|---|---|
| `cgt-20260913211901-gpbqw` | `succeeded` | 50,638 | +66,719ms |
| `cgt-20260913211901-8v2vt` | `succeeded` | 50,638 | +75,075ms |
| `cgt-20260913211901-qf2vt` | `succeeded` | 50,638 | +83,226ms |
| `cgt-20260913211901-bssxk` | `succeeded` | 50,638 | +107,619ms |

零成本旁证（非 QUEUE-A7 正式验收点，顺手记录）：单条提交耗时 71.2s，四条并发的完成时刻却铺开到 66.7s–107.6s——API 层面从未报告 `queued`，完成时刻却有铺开——原因未定：可能是供应商渲染层争抢，也可能是单次波动或四条任务内容差异；本次 n=4、无对照组，prompt 未存档，不能下因果结论。

## 4. 步骤 4：DELETE / 取消（条件触发）

**未触发** —— 步骤 3 没有观测到任何 `queued` 任务，无可取消对象。按计划纪律不强行制造排队来测取消，`docs/specs/zero-queue.md` QUEUE-A7 本条到此为止（DELETE 端点本身、`queued→cancelled` 的转换字符串仍是文档声称、未经本次实测验证）。

## 5. 花费合计

- 步骤 1：1 条 × 50,638 tokens = **$0.17723**
- 步骤 3：4 条 × 50,638 tokens = 202,552 tokens = **$0.70893**
- **本次探针总计：5 条任务，253,190 tokens，$0.88616（牌价）**，预算硬顶 $2，剩余约 $1.11
- 步骤 2（150 次 GET 限速探针）、步骤 4（DELETE，未触发）均为 $0 —— 视频计费只在提交（`create`）那一刻发生，`get`/未发生的 `delete` 不产生额外费用

## 6. 我不确定的地方

1. **①④ 都需要更高并发或真正打满队列才能复现**，而账户真实并发额度（10，见 `provider-concurrency.ts:87`）远高于本次测的 4；要故意撞排队需要一次性提交 ≥11 条同款任务，预估花费 ≈$1.8+，会把本票预算基本用尽且仍不保证命中（供应商侧是否对视频任务应用与该注释相同的「10」额度、是否随时间/账户等级变化，未核实）。**未做**，如实标注。
2. **`expired` 终态字符串未实测**：需要提交任务后不轮询、放它占满 `execution_expires_after=3600`（1 小时）才会由供应商自己判 `expired`，超出本次探针的时间与预算纪律。施工方按「未知终态一律走失败调查路径」防御处理，不假设具体字符串。
3. **GET 限速的确切阈值未定位**：150 次 / ~2 req/s / ~79s 全部放行只说明「在这个包络内没有撞到限速」，不说明供应商限速阈值确切在哪——更高频或更长窗口的探测超出预算纪律，未做。
4. **折后价未核实**：本次估价全按牌价 $3.50/M（`cost-pins.ts` 的既定纪律），账户是否仍享有该表记载的 $1.40/M 折后价、折扣是否仍生效，本次未查（会用到 pricing/billing 类接口，超出「视频任务 create/get/list/delete 四类」的调用许可）。
5. **DELETE 端点本身未实际调用**：无 `queued` 任务可测，DELETE 请求的真实响应形状、`cancelled` 是否是准确的终态字符串，本次均为文档声称、未经验证。
6. **一次实测不等于稳定**：供应商侧的并发接纳策略可能随负载、账户等级漂移，本结论是 2026-09-13、`dreamina-seedance-2-0-mini-260615`、480p、staging 环境这一格的单次实测。

## 7. 产物文件清单（均已脱敏：签名 URL 查询串与任何密钥形字段已替换）

| 文件 | 说明 |
|---|---|
| `task1-create.json` | 步骤 1 提交的建任务回执（脱敏） |
| `task1-poll-timeline.json` | 步骤 1 完整轮询时间线（每次 GET 的相对时刻、HTTP 状态、task status） |
| `task1-final.json` | 步骤 1 终态完整回执（脱敏，`video_url` 签名串已去除） |
| `burst-get-log.json` | 步骤 2 突发 GET 限速探针原始记录（150 条，逐条 HTTP 状态与耗时） |
| `step3-submits.json` | 步骤 3 四条并发提交的原始响应（脱敏） |
| `step3-immediate-gets.json` | 步骤 3 提交后立即 GET 的结果 |
| `step3-poll-timelines.json` | 步骤 3 四条任务轮询到终态的完整时间线 |
| `step3-finals.json` | 步骤 3 四条任务的终态完整回执（脱敏） |
| `step3-summary.json` | 步骤 3+4 的汇总（是否观测到 queued、是否尝试 DELETE、各任务终态与用量） |
| `summary.json` | 步骤 1+2 的汇总 |

## 8. 跑过的命令（脱敏；密钥从未出现在任何命令行或输出里）

```
git fetch origin claude/zero-queue-spec   # 该分支已被删除（规格已合并入 main），改读 origin/main:docs/specs/zero-queue.md
railway whoami
railway status
railway run --environment staging --service worker -- node step1.mjs <out-dir>   # 步骤 1 + 2
railway run --environment staging --service worker -- node step3.mjs <out-dir>   # 步骤 3 + 4
```

探针脚本零依赖（Node ≥20 内置 `fetch`），只用 `process.env.BYTEPLUS_API_KEY` 一个环境变量，从未 `console.log` 它或任何派生值。
