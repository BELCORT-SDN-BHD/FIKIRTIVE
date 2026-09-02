# Frontend convergence Phase 5 — Otto Reference picker

> **状态：Review fixture accepted by Founder — production integration pending。** 2026-09-02，Founder：“ok  这个版本可以很棒”。  
> **Upstream authority：** `reference-picker-contract.md`、`surface-contract.md`、Fikirtive Design System。  
> **Delivery order：** 先完成 review-only visual states；Founder 冻结后才接 production composer。

## 1. Who and success

**主要用户：** 在 Create / Canvas 里直接告诉 Otto 要制作什么的小生意 Founder。  
**一句成功：** Founder 输入 `@` 后，不离开 composer 就能找到、辨认、选择和移除准确的 reference，而且不会误以为整个 Collection 或 Canvas 被送给 Otto。

## 2. Intent

把 Founder 已冻结的 Reference picker interaction contract 转成一个可验收、可键盘操作的组件。菜单保持紧凑，只负责选择准确对象；Library 继续负责浏览、整理和详情。

本阶段先建立 visual states，因为 production 的旧 `EntityDTO` 尚未覆盖 Official avatars、Clothes、Generations、Uploads 与跨来源统一搜索。未有真实 contract 前，不把 fixture data 接进正式 composer。

## 3. Review fixture acceptance

1. 裸 `@` 打开 anchored menu，先显示最多 5 个 Recent，再显示 `Products / Characters / Official avatars / Locations / Clothes / Media` 分类入口。
2. 输入文字后直接跨类型显示最多约 8 个结果，不要求先选分类。
3. 每行只有 thumbnail / type icon、name、一行来源说明、右侧 type icon；active row 有清楚的 selection state。
4. Official avatar 行明确显示 `Official avatar · Read only`，但仍可选择使用。
5. Generation 与 Upload 使用同一 `Media` browse entry，但搜索结果仍显示准确对象类型和来源 Canvas / Uploads。
6. 支持 mouse、`Arrow up`、`Arrow down`、`Enter`、`Tab` 与 `Escape`；菜单关闭后 focus 留在 composer。
7. 选择后插入可移除 token；同一对象不会插入两次。
8. Composer 中同时展示多种 token，并在 sent-message state 保留可识别的 reference 摘要。
9. `No matches` 显示 `No references found`，只提供 `Upload media` 与 `Browse Library` 两个明确出口。
10. `Unavailable` 行不可选择，并用一行原因解释 processing、已删除或无权限状态。
11. 菜单内部最多约 8 行后滚动；不得扩展成完整 Library filter、detail 或 Collection manager。
12. 所有色彩、边框、圆角、type、focus ring、spacing 与 motion 使用当前 Fikirtive Design System；高频 keyboard highlight 不做位移动画。

## 4. Review states

- `recent`：裸 `@`，Recent + category entries。
- `search`：跨类型结果、duplicate names、active row。
- `category`：进入单一 type 后选择具体对象。
- `selected`：多个 removable tokens + sent-message references。
- `empty`：No matches + two exits。
- `unavailable`：可见但不可选择的对象及原因。

这些是同一个组件的状态，不建立六张不同页面。

## 5. Production implementation gate

Review fixture 获 Founder 冻结后，production implementation 仍必须先确认：

1. 一个有权限、可分页的统一 reference search contract；
2. approved typed IDs 与 source metadata；
3. Official avatar read-only 与 availability truth；
4. Generation / Upload canonical IDs；
5. sent message 与 generation provenance 保存准确 reference IDs。

这些 contract 缺失时，正式 composer 保留旧能力，不用 fixture data 冒充 production truth。

## 6. Non-goals

- 不建立 backend search index、schema、resolver 或 Otto prompt format。
- 不复制 Library filters、Collections、Favorites 或 asset detail。
- 不允许整套 Canvas、Chat、Collection 或 Favorites 成为 mention target。
- 不重新设计 Create / Canvas、Otto conversation 或 Library。
- 不加入尚未批准的新 reference type。

## 7. Evidence and verification

- Interaction authority：`apps/web/design-system/information-architecture/reference-picker-contract.md`。
- Product ownership：`apps/web/design-system/information-architecture/surface-contract.md`。
- Existing runtime gap：`apps/web/components/otto/OttoMentionPopover.tsx` 目前只显示简单名称列表；`apps/web/lib/types.ts` 的 `EntityDTO` 尚未覆盖完整 v1 taxonomy。
- Visual implementation完成后必须通过 focused component tests、keyboard tests、scoped ESLint、TypeScript 与 Design System audit。

## 8. Decision record

| Date | Status | Decision |
|---|---|---|
| 2026-09-01 | Drafted | Phase 5 先交付一个 review-only Reference picker visual fixture；Founder 冻结前不接 production，缺真实 contract 时不使用 fixture data。 |
| 2026-09-01 | Founder approved and frozen | Founder：“ok继续”。冻结 review fixture 的六种 visual states、keyboard acceptance 与 production data-contract gate。 |
| 2026-09-01 | Review fixture implemented | `/product-patterns/reference-picker` 已实现 Recent、search、category、selected、empty 与 unavailable 六种状态；实际 browser QA 覆盖分类点击、keyboard selection、token removal、Escape、sent-message reference snapshot。Focused tests 4/4、TypeScript、scoped ESLint、Design System audit、`git diff --check` 与 production build 已通过。Build 仍打印当前环境既有的 Better Auth secret / base URL warnings，但 route 正常生成。 |
| 2026-09-02 | Founder visual acceptance | Founder：“ok  这个版本可以很棒”。接受当前 Reference picker review 版本的视觉与交互方向；本批准不代表真实统一搜索、权限、ID resolution 或 provenance persistence 已完成。后续 production 接入继续遵守第 5 节 gate；不重新设计已接受的画面。 |

## 9. Frontend regression follow-up — 2026-09-02

Founder：“继续任务”。保持已接受的外观，不扩大 production 范围；本轮只修正已冻结交互的实现缺口。

**验收：**

1. 遵守 `apps/web/AGENTS.md`：普通 Enter 只在有可选项时选择，其他情况保留换行；Shift+Enter 发送；IME 组字中不触发选择或发送。
2. Recent 的方向键导航可进入六个分类，高亮项即时滚入可见区域；pointer 或 keyboard 选分类后，输入焦点回到 composer；Escape 只关闭 picker，Shift+Tab 保留原生反向焦点导航。分类内的 `All types` 是返回浏览，不得清空草稿、已选引用或已发送记录。
3. 在一段文字中间插入 `@` reference 时，只替换光标附近的 mention query，不删除后续文字、不把 email 当 mention。
4. 无结果与不可用项不能被误选；已有 reference 不重复；已发送消息的 references 不随草稿变化。
5. 用挂载真实组件的 DOM 行为测试证明上述流程，不能只靠 source-substring tests。

**本轮明确不修改：** 已接受的菜单尺寸与 composer 上方布局。旧 contract 的“输入光标附近”仍需精确坐标定位时，该项不能被宣称已验证；将其列为待对齐差异，而非本轮静默改动视觉。

### 本轮验收记录

- **实现：** `patterns/reference-picker/ReferencePickerReference.tsx` 复用 `lib/otto-mentions.ts` 的光标解析，修正 Enter / Shift+Enter、分类导航与返回、焦点恢复、高亮即时滚动、Shift+Tab、局部文本替换及重复 selection event 重置高亮的问题。视觉布局不重做。
- **行为证据：** `lib/__tests__/reference-picker-interaction.test.tsx` 的 7 项挂载组件测试覆盖上述键盘／选择流程、无结果、不可用对象、去重与 sent-reference snapshot。最初测试复现了误发送及分类不可达；联合运行另复现重复 selection event 导致高亮重置，修复后补入显式回归断言。
- **2026-09-02 最终自动检查：** 17 个定向测试文件 **119/119 passed**（含 7 项新 DOM 行为测试）；scoped ESLint、`tsc --noEmit`、`git diff --check` 均通过。运行结果：`/tmp/fikirtive-frontend-check.AJB5W2/final-results.json`，可重跑的测试源保存在仓库内。这不是完整 web suite 或 required CI 结果。
- **测试维护：** Library / Brand 的过时 shell import 断言改为检查当前共用 `ProductPatternShellFrame`，并在 `product-pattern-shell.test.ts` 验证它确实复用正式 `MerchantShellFrame`，不降低共用外壳约束。
- **Design System 检查边界：** 本轮沿用已有 primitives 与 tokens；`design-system:audit` 已运行，但该脚本仅统计 import 使用量，不能据此声称整站视觉／无障碍全部合规。
- **尚未验证：** 本轮 live browser QA 未完成。本地 3008 服务恢复后，浏览器工具仍被自身连接失败页的 URL policy 拦住；没有改用其他控制方式绕过，也没有把 DOM 测试等同于浏览器验收。菜单精确 caret 坐标定位、屏幕阅读器实测与 production 接入仍未关闭。

已接受的设计方向保持不变；本轮记录不冒充 Founder 对修复后浏览器版本的新验收，也不解除第 5 节 production gate。

### 浏览器补验 — 2026-09-02

Founder 同意先补完浏览器复验，再核对 Library 正式接入条件。连接本轮已恢复；前一记录中的 browser blocker 不再作为当前 blocker。

- 在默认桌面 viewport 的 `/product-patterns/reference-picker` 实测：Recent → 方向键选择 Products → Enter 进入分类 → Tab 插入引用；输入焦点正确回到 composer。
- 实测 Shift+Enter 发送、`All types` 保留草稿／chips／已发送记录、移除草稿引用不更改已发送摘要；No matches 和 Unavailable 下普通 Enter 只换行、不发送。
- 实测在 `Before @ja after` 中移动光标并选择 Product，后续 `after` 保留；输入 `email@test.com` 不打开 picker；Shift+Tab 移到前一可聚焦控件、不选择引用。
- **发现并修复：** 刚载入页面时 DOM 光标在 0，但预设查询 `@` 的逻辑光标在 1；直接点击 Alya 原先无反应。`selectItem` 在 DOM 光标不能形成有效 mention 时使用已跟踪的逻辑光标；未重做视觉。新增 unfocused / caret-0 DOM 回归测试先失败，修复后通过。重新载入页面、未点击输入框，直接选择 Alya 已在真实浏览器确认 token 出现、菜单关闭、composer 获得焦点。
- 定向自动检查：Reference picker 12/12（8 DOM + 4 source guard）；连同既有 Library read-model mock tests 为 21/21。没有用 mock tests 宣称真实数据库／权限验收完成。
- 剩余边界：精确 caret 像素锚定、屏幕阅读器、跨浏览器／尺寸矩阵与真实 production 数据接入未在本次关闭。此补验是工程操作验证，不代替 Founder 验收。
