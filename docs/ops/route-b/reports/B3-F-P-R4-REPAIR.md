# W-NODE-280-R4/R5 repair report — factory attempt 原子语义

日期：2026-07-13（Asia/Kuala_Lumpur）
PR：#280
分支：`claude/route-b-b3-f-p`
严格起点：`8a2fda86840ee72d454b363c7926a692b20aebda`

## 1. 结论

R3 的三项 blocker 已按同一数据流封类：factory 的 logical cell、显式 attempt、完整
material binding 与 `fresh/reused/conflict` disposition 都归 `startGen`。owner/project-scoped
early verdict 只能 durable reuse / conflict，不能 create / reserve；miss 才跑动态 fresh-only
gates，并在既有 project advisory transaction lock 内重读后决定。只有该事务真正提交
`GenJob create + reserveCredits` 的调用返回 `fresh`；factory 据此把本次真实新 reserve
计入 `BatchResult.totalCredits`。

R5 把 worker-equivalent 的 image `variantSel` 缺省 / `null` / 空 object 统一为 material
`null`；fresh persistence 与 guardian 参数也服从同一 normalizer。非空 mapping 仍按
canonical key order 比较，key/value binding 必须完全相同。

未增加 schema、migration、provider、worker、credits writer、第二 spend authority 或 UI。
开发与验证使用 mock provider / `*_test` Postgres，真实 provider 调用与真实花费均为 0。

## 2. R3 blocker 映射

| R3 blocker | 修复 | 证明 |
|---|---|---|
| FAILED prior 绕过完整 material binding | 新增共享纯 helper，factory 早拒与 `startGen` early/锁内 verdict 使用同一归一化字段；任何状态（含 FAILED）都参与 binding | prompt、reference-video、duration/videoOptions、entityIds 变化均 error/0；entityIds 重排亦 conflict/0，重复数不被抹掉；空 `variantSel` 与缺省双向 canonical，非空 binding 变化仍 conflict/0 |
| 双 precheck 无法封并发 FAILED retry | 79 字符 structural key 分离 logical cell 与 caller-stable attempt；锁内按 any-status history 原子决定 exact duplicate / explicit retry | barrier 先让两路越过 factory precheck，再并发进入真实 `startGen`：首次与 FAILED retry 各仅 1 job / 1 RESERVE |
| `startGen` 只回 `{id}` 导致 loser 被报 queued/full | `StartGenResult` 明示 `fresh/reused/conflict`；active、exact、non-FAILED logical hit、P2002 recovery 都回 reused；factory 仅 fresh 计 quote | mixed batch、generic active/P2002、factory exact/P2002、并发 loser 均断言 reused/0，`totalCredits` 等于本轮新 reserve |

## 3. 原子数据流

逐格 key：`batch:<32-hex logical hash>:attempt:<32-hex attempt hash>`，固定 79 字符，
在 `genRequest` 的 80 字符上限内。所有 history / exact lookup 同时带
`ownerId + projectId`。

| history verdict（early 安全命中；miss 锁内重查） | material | exact attempt | 裁定 | 新 reserve | BatchResult |
|---|---|---|---|---:|---|
| 无历史 | — | 无 | fresh create | 1 | queued / full quote |
| 任一非 FAILED 历史 | 相同 | 任意 | reused | 0 | reused / 0 |
| 全部 FAILED | 相同 | 已有 | delayed duplicate | 0 | reused / 0 |
| 全部 FAILED | 相同 | 新 attempt | explicit retry fresh | 1 | queued / full quote |
| 任一历史 | 不同 | 任意 | conflict | 0 | error / 0 |

锁内 material 覆盖 `prompt/model/kind/count`、`source/tail/reference-video` refs、
`shotId`、order-sensitive `entityIds`（保留重复数；顺序参与 binding）、canonical `variantSel`
（缺省 / `null` / `{}` 同为 `null`；非空 key/value exact），以及由
`videoDefaults + overrides` 得出的五个 `videoOptions` 字段。

factory 自己的 any-status precheck 只做 read-only early reject；它不推断 reused，也不决定
reserve。`startGen` 内另有 owner/project-scoped durable replay read：exact/non-FAILED 命中只
返回既有 job；miss 才经过 guardian/admin-model/pricing 等 fresh-only gates并在锁内重查。
因此已接受 job 后的动态 gate 漂移不改变同 attempt 的 reused/0 response，而
`startGen` 的 create + reserve transaction 仍是唯一钱路权威。

## 4. Attempt 来源与审批连续链

- Otto model schema 不含 `attemptId`，且 strict schema 对模型注入该字段直接拒绝。
- `ottoApprove` 先验证 parked args hash，再以 CAS 成功消费 `APPROVAL_CARD`；仅在此后把
  原始 `cardMsg.id` 传入 `buildOttoContext`。
- server-only `ctx.runFactoryBatch` closure 把该 card id 注入 strict owner-scoped action；
  parked/model args 与 approval material hash 均不含 token。
- 同 card 二次批准在 consumed-card 分支已返回 already-resolved，不再 resume 或触发
  `startGen`；新 card 产生不同 attempt segment。
- 直接 `runVariantBatch` / `runBulkGrid` strict envelope 必须由调用方提供 caller-stable
  `attemptId`；同一次确认的网络重放保持它不变，后来明确 Retry 才换 token。

## 5. RED → GREEN 与验证证据

旧 head red-first：新增的 5 个 `gen-actions` disposition / FAILED binding 测试在
`8a2fda86` 均失败，随后才实现锁内语义。

R5 red-first（`488cda47`）：helper、factory、真实 `startGen` 三路各 1 个失败，合计
3 failed / 29 passed；分别暴露 `{}` 未归一、stored `{}`→current omitted 假 conflict、
prior `null`→current `{}` 新 attempt 假 conflict。实现共享 canonicalizer 后 3 files /
32 tests 全绿。

| 命令 | 结果 |
|---|---|
| `pnpm --filter web exec vitest run lib/__tests__/batch-idempotency.test.ts lib/__tests__/gen-actions.test.ts lib/__tests__/factory-batch.test.ts lib/__tests__/factory-approval.test.ts` | PASS：4 files / 45 tests；含 guardian block + admin-disabled 后 exact FAILED 仍 durable reused、首读 miss→锁内 exact/conflict、entityIds reorder→conflict/0，以及 `variantSel` null/{} 双向 canonical + non-empty exact binding |
| 上述 4 files + `factory-batch-ledger.test.ts`（`*_test` DB） | PASS：web targeted 5 files / 61 tests，其中 16 real-ledger tests |
| `pnpm --filter @fikirtive/otto exec vitest run src/skills/run-factory-batch.test.ts` | PASS：1 file / 7 tests |
| `DATABASE_URL='postgresql://…/fikirtive_test' pnpm -r test` | R4 baseline PASS：全 workspace 2,849 tests；R5 仅改 canonical compare/persistence，并在 exact code 上重跑 targeted 61 + Otto 7 + typecheck；最终外部全量证据由 R5 current-head CI 承载 |
| `pnpm -r typecheck` | PASS：8/9 workspace projects |
| `pnpm --filter @fikirtive/otto run catalog:check` | PASS：`CATALOG.md is fresh` |
| `pnpm lint:parity` | PASS：187 entries；34 个登记债未增加 |
| `node scripts/route-b-matrix-check.mjs` | PASS |
| `node scripts/check-margin-floor.mjs` | PASS：5/5 sellable SKU ≥45% |
| `bash scripts/check-skill-imports.sh` | PASS：0 spend/provider bypass |
| `bash scripts/check-no-raw-prisma.sh` | PASS：425 call-sites（本轮 `startGen` 增 1 个 owner/project-scoped durable history read；脚本当前为 P0 warning baseline） |
| `bash scripts/check-blueprint-integrity.sh` | PASS：Blueprint 未改 |
| `bash scripts/check-destructive-migrations.sh` | PASS |
| Prisma migrate diff (`*_test`) | PASS：No difference detected |
| `DATABASE_URL='postgresql://…/fikirtive_test' pnpm --filter @fikirtive/web build` | PASS：exit 0，Compiled successfully；本地缺 auth secret 产生既有 build warning |
| `git diff --check` | PASS |

Current-head GitHub CI 需在本报告随 commit 推送后触发；不在本地伪称执行。PR checks 是
最终外部证据，必须全绿后才可进入 founder 点名池。

## 6. Diff 文件清单

核心：

- `apps/web/lib/batch-idempotency.ts`
- `apps/web/lib/gen-actions.ts`
- `apps/web/lib/factory-batch.ts`
- `apps/web/lib/factory-actions.ts`
- `apps/web/lib/otto-actions.ts`
- `packages/otto/src/context.ts`
- `packages/otto/src/skills/run-factory-batch.ts`
- `packages/otto/src/approval-tools.ts`（仅同步 key 注释）

测试：

- `apps/web/lib/__tests__/batch-idempotency.test.ts`
- `apps/web/lib/__tests__/gen-actions.test.ts`
- `apps/web/lib/__tests__/factory-batch.test.ts`
- `apps/web/lib/__tests__/factory-batch-ledger.test.ts`
- `apps/web/lib/__tests__/factory-approval.test.ts`
- `packages/otto/src/skills/run-factory-batch.test.ts`

报告：

- `docs/ops/route-b/reports/B3-REPORT.md`
- `docs/ops/route-b/reports/B3-F-P-R4-REPAIR.md`

## 7. R5 最小范围

- production 仅改 `apps/web/lib/batch-idempotency.ts` 与 `apps/web/lib/gen-actions.ts`。
- shared canonicalizer 同时约束 expected/stored comparator；历史 `{}` 与新 `null`、历史
  `null` 与新 `{}` 双向一致。
- `startGen` guardian 只收 normalized non-empty map / `undefined`；fresh create 只持久化
  normalized non-empty map，未来不会继续制造 `{}`。
- 非空 map 仍 key-order insensitive，但 key/value 任一变化都 fail-closed 为 conflict/0。

## 8. 明确未执行 / 禁止项

- 未调用真实 fal / BytePlus / Anthropic 或其他付费 provider；真实花费 0。
- 未部署、未合并、未启用 auto-merge，未直接推 main。
- 未改 `docs/BLUEPRINT.md`，未改 schema / migration / worker / provider / credits writer。
- 未做 UI 壳接线或真实 provider 时延验收；均不属于本 R4 钱路封类范围。
- merge 权限不变：本 diff 含 money path，仍由 founder-only 点名处理；实现作者不得自合。
