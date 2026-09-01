# Beta frontend convergence — Phase 3 Create and Canvas acceptance

> **状态：Implementation complete within the frozen frontend scope; closure pending authenticated Founder acceptance and the database-backed money test leg。**  
> **冻结规格：** `frontend-convergence-phase-3-create-canvas-spec.md`，Founder approved and frozen 2026-09-01。  
> 本文件只记录验收事实；不改写冻结规格。

## Acceptance ledger

| # | 状态 | 当前证据或剩余条件 |
|---|---|---|
| 1 | Pass | 正式 `/create` 只保留 `Create`、一个 Otto composer 与 tenant-scoped Canvas history；removal boundary 由 `create-design-system.test.ts`、`create-route-rename.test.ts` 与 `northstar-home-new-canvas-button.test.ts` 钉住。 |
| 2 | Pass | Create submit 与 history 均使用 `canvasHref` 进入 `/create/canvas`；Canvas Back 使用 canonical Create route。 |
| 3 | Pass | Founder-facing Create / Canvas 使用 `Canvas` 与 `Conversation`；production convergence tests 禁止旧 `Project / Projects` anatomy。Database model `Project` 依 frozen non-goal 保留。 |
| 4 | Pass | Production route import tests禁止 `CanvasReference`、`CreateWorkspaceReference`、prototype model 与 review fixtures。 |
| 5 | Partial | Production composition 已移除 left rail；公开 review fixture 在当前 desktop viewport 无遮挡。正式 1440×900 与 1920×1080 authenticated visual QA 待 Founder session。 |
| 6 | Pass | `NorthstarCanvasWorkspace` 继续只挂载一个 `FlowCanvas`；没有第二套 node、drag、generation 或 settlement kernel。 |
| 7 | Pass | Existing kernel 的 select、multi-select、keyboard reach、drag、zoom 与 persistence behavior suites 通过；viewport 仍以 kernel 的 Fit-to-content 初始化。 |
| 8 | Pass | `CanvasOttoOverlay` 只组合真实 `OttoFrontDoor / OttoChatStream`；current turn、Conversation 与 omnibox 没有 fixture state machine。 |
| 9 | Pass | `createCanvasConversation` 原子建立 Canvas、Conversation 与 handoff；稳定 request identity 的 retry tests 证明不会重复建立或遗失第一句。 |
| 10 | Pass | Canvas 复用现有 Otto thread action；blocking question 与 paid confirmation contract 未复制、未改写。 |
| 11 | Pass | Image、video、edit、variation、animate 继续由 `FlowCanvas` / existing generation action owner 执行；本阶段未新增 price owner。 |
| 12 | Pass | Existing Otto stream / Canvas state components继续持有 working、done、failed、cancelled、queued 与 confirming-status；refresh rehydrate 读 durable thread。 |
| 13 | Pass | Existing Canvas lineage 与 source-near placement kernel 未被替换；original artifact 保留。 |
| 14 | Pass | Conversation 首屏只取最近 60 条；`Load earlier messages` 使用 server-owned `seq` cursor progressive loading，不一次渲染无止境 history。 |
| 15 | Pass | Canvas 继续读取 owner-scoped canonical entity IDs；selection 与 `@` references 交给同一 Otto composer。 |
| 16 | Pass | Existing selected-artifact Download / share contract与 Canvas interaction suites保持通过；本阶段没有隐藏默认 selection。 |
| 17 | Partial | Create empty state、Canvas read state、credits / stream failure与 settlement behavior已有测试；正式 authenticated save/read/out-of-credits visual pass仍待 Founder session。 |
| 18 | Partial | Automated keyboard / accessible-name suites通过，公开 fixture 浏览器 console 为零 warning / error；正式 authenticated tab order与 Escape pass待 Founder session。 |
| 19 | Pass | 新 overlay 与 progressive-loading motion使用 Design System duration / reduced-motion owner；Canvas kernel没有加入装饰性 delay。 |
| 20 | Partial | TypeScript、scoped ESLint、production build、Create / Canvas / Design System与 mocked money suites通过。真实 database-backed idempotency suite因本环境没有 `DATABASE_URL` 未执行；正式双 viewport visual QA待 Founder session。 |

## Automated evidence

- Phase 3 core behavior：11 files / 82 tests passed。
- Canvas Design System与 interaction：8 files / 62 tests passed。
- Otto stream、turn cost、spend guards与 Canvas chat dependency：4 files / 67 tests passed。
- Web TypeScript：passed。
- Scoped ESLint：passed；`lib/dto.ts` 仅保留本任务之前已有的三个 unused destructuring warnings，无 error。
- Design-system usage audit：repository-wide 136 / 270 product files（50.4%）；本 Phase 的 Create / Canvas changed surfaces 没有 raw `button / input / textarea / select`，并通过 Design System source-of-truth tests。
- Production build：passed；local build仍报告缺少 Better Auth secret / base URL 的环境 warning，不影响 compilation，但不能替代 authenticated runtime acceptance。
- Browser：`/product-patterns/create` 的 composer、Canvas history进入 `/product-patterns/canvas`、Conversation展开均通过；browser console零 warning / error。Fixture 证据不能升级为 production acceptance。
- 未执行：`asset-idempotency-ledger.test.ts` 需要真实测试数据库；当前环境没有 `DATABASE_URL`，10 cases均在连接前 fail closed，没有写入任何数据。

## Named closure seams

1. **Authenticated Founder acceptance**：Founder登入正式 `/create` 与 `/create/canvas` 后，检查 1440×900、1920×1080、keyboard、Back / Forward、refresh / restore 与 same-viewport comparison。
2. **Database-backed money leg**：在明确的 `_test` database 环境执行 idempotency / ledger suite；不得借用 production 或不明数据库完成勾选。

## Closure rule

本 Phase 现在不能标记 **closed**。只有以上两条 closure seams完成，且 Founder确认正式 Create / Canvas 后，才可把本文件状态改为 closed。

## Founder review record

| 日期 | 验收范围 | 结果 |
|---|---|---|
| 2026-09-01 | Phase 3 frozen spec | Founder：“批准”。授权 implementation；不是 final visual acceptance。 |
| 2026-09-01 | `/product-patterns/create` 与现有 Canvas fixture 方向 | Founder：“can, continue”。Fixture 方向通过；不升级为 authenticated production、database-backed money 或双 viewport final acceptance。 |
