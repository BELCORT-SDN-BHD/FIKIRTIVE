# Library backend handoff contract

> **状态：Founder-approved frontend / backend boundary — 2026-09-01。**  
> **用途：** 记录已批准 Library screen 要求 backend 提供的最小真实能力。本文不是 backend implementation spec，也不授权 schema、migration 或 production data change。  
> **上游权威：** [`README.md`](README.md)、`../../information-architecture/product-map.md`、`../../information-architecture/surface-contract.md`。

## 1. Boundary

Library frontend 已完成设计与 fixture 验收。正式 `/library` 不得使用 fixture data、browser-only state 或成功 toast 冒充持久化。

Frontend 只消费 typed read / action contracts。Backend 负责 canonical object、Org isolation、persistence 与 stable identity。

## 2. Canonical owners

| Object | Canonical owner | Required rule |
|---|---|---|
| Generation | Existing Generation / Asset truth | History、provenance 与 media identity 不复制。 |
| Upload | Existing Asset / ingest truth | Upload 仍是同一个 Asset，不因加入其他 view 而复制。 |
| Favorite | Owner-scoped preference link | Favorites view 可引用 Generation、Upload、Element 与 Official avatar；移除 Favorite 不删除原对象。 |
| Collection | Owner-scoped Collection + membership links | Collection 只保存 typed object links；一层结构；同一对象可属于多个 Collections。 |
| Element | Existing Entity identity plus the approved type contract | UI 使用 Element；code identity 仍是 Entity。Product facts 只链接 Otto IQ，不复制。 |
| Official avatar | Fikirtive-owned read-only catalog | Catalog identity 与 media 不可由 Merchant 修改；Favorite preference 属于当前 Org。 |

## 3. Minimum backend capabilities

1. **Generation history read**：owner-scoped cursor paging；支持 media type、Canvas、Chat、date、source 与 search；返回 stable Generation / Asset IDs、created time、provenance、prompt、references 与 lineage。
2. **Uploads read / ingest**：可区分 Upload 与 Generation；上传成功后可由同一 Library read model 读取。
3. **Favorite actions**：对支持的 typed object 建立、移除与查询 preference；动作可重试且不会复制对象。
4. **Collection actions**：list、create、rename、add membership、remove membership；membership 写入前重新验证 Org 与 object access。
5. **Elements read**：Products、Characters、Clothes 与 Locations 使用 stable typed IDs；Product facts 返回 Otto IQ link / summary，不建立第二份 product truth。
6. **Official avatar catalog read**：stable avatar ID、mention name、portrait、character sheet、scene evidence、filters、commercial-clearance disclosure 与 availability。
7. **Use in Canvas handoff**：只传 typed object ID；Canvas 在 server side 重新解析当前可用的 canonical object，不接收复制 facts 或任意 media URL。

## 4. Safety rules

- Org identity 只来自 authenticated server principal；client 不提交可信 `ownerId`。
- 所有 Merchant-owned reads / writes 都带 Org scope；Official avatar catalog 可全局只读，但 Favorite 仍按 Org 隔离。
- Collection membership、Favorite 与 Canvas handoff 必须验证目标 object 仍存在且可访问。
- 删除 Collection 或移除 membership 不删除 Generation、Asset、Element 或 Official avatar。
- Frontend 在 capability 不存在时不显示可点击成功动作；不得把 fixture-only behavior 搬进 production。

## 5. Frontend ready condition

Backend 提供以上 contracts 及行为测试后，frontend 才进行完整 production convergence：

- 用 approved Library components 替换 `/library` 的 legacy `OttoStuff`；
- 五个一级 views 与 Elements child views 全部连接真实数据；
- 所有 sort、search、filters、selection、detail、Favorite、Collection 与 `Use in Canvas` 均有可见、可恢复、可持久的结果；
- fixture 继续只作视觉证据，不进入 production import graph。

## 6. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-09-01 | Boundary confirmed | Founder 确认 Collection、cross-object Favorite、Element type 与 Official Avatar persistence 属于 backend 工作；当前 UIUX session 只记录 handoff contract，不实现 backend 或 fake persistence。 |
| 2026-09-02 | Documentation authorized | Founder 要求补充接线执行说明，供后续 backend wiring refine；本次只授权文档更新，不表示 Founder 已冻结未来实现、接口或上线范围。 |

## 7. 当前接口核对 — 2026-09-02

仅核对 `codex/uiux-frontend` 当前 worktree 的代码；没有检查其他 backend 任务的未合并实现。缺口不等于其他任务尚未开发，也不授权本任务修改 backend。

| 约定能力 | 当前可复用能力 | 尚缺的前端接口 | 结论 |
|---|---|---|---|
| Generation history | `lib/library-actions.ts` 的 `getGenerationHistory` 支持 owner scope、cursor paging、prompt search 与 generation favorite 筛选；返回 Generation / Asset / project IDs 等基础字段 | media、Canvas/Chat、日期与 source 筛选；read response 中的 provenance、references、lineage 与来源标记 | 部分具备 |
| Upload read / ingest | `lib/upload-actions.ts` 的 `finalizeCandidateUploads` 写入 Asset 与 source=UPLOAD 的 Generation | Library read response 尚不返回 source，无法准确分开 Uploads / Generations | 部分具备 |
| 跨类型 Favorites | `lib/asset-actions.ts` 的 `setFavorite` 按 owner 更新 Generation.favorite | 尚无跨 Asset／Element／Official avatar 的 typed preference 与统一查询 | 部分具备 |
| Collections | 本 worktree 未找到 Collection / membership 的 schema、actions 或行为测试 | list、create、rename、成员增删、typed links 与访问校验 | 未具备 |
| Elements | `lib/data.ts` 的 `getEntities` 与 `lib/brand-record-actions.ts` 的 Product records 可复用 | `packages/db/prisma/schema.prisma` 的 EntityType 没有 Clothes；缺显式 Product → Otto IQ canonical link / summary contract，不能仅凭图片匹配当作同一对象 | 部分具备 |
| Official avatars | 当前仅找到已批准 frontend fixture / design | 缺正式 read-only catalog：稳定身份、媒体／样片、筛选、许可文案与 availability | 未具备 |
| Use in Canvas | `lib/canvas-actions.ts` 的 `createCanvasNode` 校验 Generation 的 owner + project | 尚非统一 typed-object handoff；不支持各类 reference 的 canonical resolution，不能把无效对象静默置空当作成功交接 | 部分具备 |

**核验边界：** `lib/__tests__/library-actions.test.ts` 的 9 项 mock 行为测试已通过；只证明既有 read-model 的当前行为，不证明新增接口或真实 tenant / database 验收。其他行以 live schema / actions 定向读取核对。CodeGraph: not used — 非持图 worktree，使用 `rg` 与直接文件读取。

**接线时再核对：** 本表是 2026-09-02 的观察，不要求现在寻找或依赖另一项 backend 工作。实际接线时逐项核对 live contract、行为测试与可用组件；接口与行为测试齐备后，再按第 5 节替换正式 Library 页面。若要改成分批上线，须由 Founder 另行批准范围；不能静默隐藏已批准功能来声称完整接入。

## 8. 接线执行配方（后续任务使用）

本节把已批准的 Library 行为落到接线顺序；业务语义仍以 [Library pattern](README.md)、[core flows](../../information-architecture/core-flows.md) 与 [`@` reference contract](../../information-architecture/reference-picker-contract.md) 为准。这里不规定 endpoint、schema、cache、provider 或时序实现。

### 8.1 先建立真实 read model

1. 每个已生成 result 都写入同一 canonical history；不以 Favorite、当前选中、是否仍在 Canvas 上作记录门槛，也不由 Library 自订扣费结算门槛。read 返回 stable typed ID、Asset identity、source、created time、状态、provenance、references 与 lineage；未完成／失败作业按引擎真实状态呈现，不能伪造成功产物。
2. Upload 的 canonical source 是 Asset / ingest truth。文件传输成功只代表已接收；可复用性以服务端处理状态和访问检查为准。processing、failed 与 preview-failed 都保留身份和诚实状态；预览加载失败不等于素材处理失败，不能因缩略图失败就丢掉原对象。
3. 列表项使用 stable typed object ID；Favorite 与 Collection membership 按第 2 节关联目标，不要求额外复制对象身份。URL 中的 ID 只是待验证的定位参数；UI 不从标题、media URL、页面顺序或 fixture label 猜对象、来源或权限。

### 8.2 把已批准视觉接到 reads / actions

- `LibraryReference.tsx` 的 `LibraryToolbar`、`MediaGrid`、`DetailPanel`、`CollectionView`、`ElementsView` 与 `SelectionBar` 是已批准的展示／交互边界：production route 传真实 query result、状态和 action callbacks；review route 继续传 fixture。
- `filtering.ts` 目前按 fixture array order、固定 `group` 与 `Canvas` / `Chat` 字符串筛选和排序，不能作为 production 排序或分组逻辑。真实 contract 应给可比较的创建时间与来源／关系字段；展示层只把结果渲染成已批准的分组与文案。
- `model.ts` 的 `LibraryAsset` 是 review display shape（含 string refs），不是 backend typed contract。先写最小 mapper / presentation props，再复用 grid、toolbar、detail、selection 的展示；不把 `LibraryReference.tsx` 的 fixture state 搬入 production，也不复制一套页面。
- `OfficialAvatarsView.tsx` 和 `OfficialAvatarFavorites` 目前直接导入 `OFFICIAL_AVATARS`，并以其 fixture type 约束 card / detail；接线时先把 catalog data 与 display props 分离，再由真实 read 提供 catalog、availability 与 favorite state。它们与 `LibraryReference.tsx` 都不是直接 production-ready code。

### 8.3 查询、分页与 route 状态

1. search、view、sort 与全部 filters 作用于完整结果集；每次条件改变重置 cursor，并取消或丢弃旧 query 的迟到结果。选择集合按当前交互范围清理／核对，计数始终对应实际操作目标，不能只重置数字。loading 保持 grid geometry，错误、空结果和旧结果不会伪装为新条件的成功结果。
2. 加载更多只追加同一组查询条件的下一页，依 stable typed ID 去重；界面若显示总数，必须来自完整查询的真实计数，不能把已加载条目数当作总数。不强制所有接口返回 total count。时间分组从真实 created time 计算，不能沿用 fixture group。
3. detail 使用 route-backed typed ID。关闭与 Back 恢复原 grid 的 query、filters、sort、scroll 和仍有效 selection；刷新重取当前 read scope，深链对象即使不在已加载页也要能按权限读取。目标被删除／拒绝访问时显示不可用，而不是显示空库；Avatar 被筛选排除时按已批准交互关闭 detail 并清理 stale route，不自动换成其他对象。

### 8.4 组织动作与失败结果

- Favorite 与 Collection membership 都是链接，读回时 resolve 原对象；移除链接不删除 Generation、Upload、Element 或 avatar，也不创建副本。写入可安全重试，并重新验证当前 Org、capability 与目标可访问性。
- 多选动作按真实合同反馈：若允许部分成功，显示成功项与失败项，仅重试失败对象；若后端原子失败，诚实显示本次未成功。本文不指定事务模型。单项操作同样需要 pending／失败反馈，详情、列表与 count 依据权威结果同步，不能用成功 toast 代替保存；如采用乐观更新，失败时须恢复正确状态。

### 8.5 跨 surface 的 canonical resolution

- Product card / detail 只读 Otto IQ canonical Product facts；Library 保存的只是 Product ID 与 linked media。Official avatar catalog 是 FIKIRTIVE-owned read-only；merchant 可以 favorite / preview / use，不能改 identity。
- `Use in Canvas` 与 Otto `@` 都只交付 typed reference ID，Canvas / resolver 在 server side 重新解析可用对象；生成结果记录 Context used / lineage 后自动回到 Generation history。Library 不自动触发付费 generation。完整 reference 规则链接见 [`reference-picker-contract.md`](../../information-architecture/reference-picker-contract.md)，不在这里复制。
- 删除语义、新 Element preset、actor media / likeness / rights 或 clearance 与当前 contract 冲突时，作为接线时待决项记录并交给正确 owner；不得从 fixture 或本节发明政策。任何 material flow 改动仍按[前端接线规范](../../governance/frontend-integration-handoff.md)交 Founder 决定。

### 8.6 最小端到端验收场景

| 场景 | 可检查结果 |
|---|---|
| Generate 4，favorite 其中 1 个 | 4 个都在 history；Favorites 仅显示链接到其中 1 个的对象，取消 favorite 后 history 不变。 |
| 从 Collection 移除一个对象 | 该 Collection 少一个 membership；原 Generation / Upload / Element 仍可从 canonical view 打开。 |
| Upload processing / failure | 已接收文件显示 processing 或 failed 身份与原因；只有 ready item 可 reuse；重试／刷新后状态以真实 ingest 结果为准。 |
| Filter、load more、Back | filters / sort 搜全量、分页不重复，count 不只算已加载页；detail Back 恢复原 query、scroll 与有效 selection。 |
| Avatar `Use in Canvas` / `@` | 两条路径都传同一 avatar typed ID；发送／生成后能查到实际使用的 references；新 Generation 回 history，avatar 仍不可编辑。 |
| 被拒绝或已删除 reference | detail / `@` / Canvas resolver 说明 unavailable；已选 token 保留可识别的错误与移除／重新选择出路，不静默丢掉后继续生成，也不自动换对象或显示交接成功。 |
