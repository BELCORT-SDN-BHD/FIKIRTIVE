# Beta frontend convergence — Phase 1 application shell and route ownership

> **状态：Founder approved and frozen — 2026-08-31。授权 Phase 1 implementation。**  
> **上游权威：** `product-map.md`、`surface-contract.md`、`core-flows.md`、`navigation-contract.json`。  
> **下游 runtime authority：** `packages/core/src/navigation.ts`。  
> **Founder approval：** 2026-08-31，Founder：“好的。”

## 1. Who and success

**For：** 没有完整营销团队、需要在一个清楚产品结构里查看表现、创作和管理资产的小生意 Founder。

**One-sentence success：** Founder 在 beta 左侧导航只看见 `Home / Create / Library / Brand / Settings`，每个入口进入唯一、正确的产品表面；Parked 旧入口不会撞墙、不会产生第二套导航，也不会改变现有数据、权限或钱路。

## 2. Why this phase exists

已冻结 IA 与当前 runtime 仍有结构性 drift：runtime 导航继续显示 Campaigns 与 Schedule，Settings 仍是旧分组，部分 Parked route 仍可作为 active product surface 使用。五个 `/product-patterns/*` review fixtures 已用于设计验收，但它们不是 production route authority。

本阶段只收敛 **application shell、active navigation 与 route ownership**。它不把五个已验收页面一次性搬进 production，也不重新设计任何 screen。这样每一批都能独立验收，避免一个无法 review、无法安全回退的大迁移。

## 3. Frozen product contract consumed by this phase

### Active beta destinations

```text
Home
Create
Library
Brand
Settings
```

- `Settings` 在主导航只出现一次；Personal / Workspace 与各 section 属于 Settings 内部导航。
- `Ask Otto` 是跨 surface assistant action，不是主导航目的地。
- `Canvas` 属于 Create，并继续使用 full-screen workspace；它不新增导航项。
- `home.analysis` 属于 Home detail；它不新增 Analytics 导航项。

### Parked or deferred destinations

- Campaigns → Home。
- Schedule merchant surfaces → Home。
- Schedule analytics → `home.analysis`。
- Manual Video editor → Create。
- CRM → Home。
- Existing public share / review surfaces 不属于 merchant shell，不能被 Schedule merchant redirect 误伤。

准确 URL 字面量、labels、redirect source 与 destination 只由 `@fikirtive/core/navigation` 持有；本文件不建立第二份 route map。

## 4. User-visible behavior

### Application shell

1. 所有 application-shell beta surfaces 使用同一条 navigation tree、同一 rail 与同一 utility bar。
2. 当前 destination 及其 child surface 只有一个清楚 active state：
   - Home analysis 归 Home；
   - Canvas 归 Create，但 full-screen Canvas 不重复渲染 rail；
   - Library child view / detail 归 Library；
   - Brand section 归 Brand；
   - Personal / Workspace settings 归 Settings。
3. Credits 与 Profile shortcut 继续进入 canonical Settings experience 的 Billing & credits 与 Personal / Profile。
4. Ask Otto 保持跨 surface 可达；导航收口不能制造第二个 Otto page 或中断当前 surface context。

### Compatibility destinations

1. Founder 从旧 bookmark 或内部 legacy link 进入 Parked merchant surface 时，由 server-side destination 送到冻结 owner surface；不显示 404、空壳或假功能。
2. 只保留 destination 能理解的 typed context。旧参数不得被静默解释成另一种业务事实。
3. Auth、tenant 与 capability gate 在 destination 前后保持不变；redirect 不能成为绕过认证或权限的路径。
4. Public share / review route 保持 standalone、read-only 与可访问，不继承 merchant shell，也不被 Schedule merchant redirect 捕获。

## 5. Implementation sequence

### C1 — Guard first

- 先让 tests 表达冻结的五个 active keys、Parked destinations、Settings single-entry rule 与 public-share exception。
- `navigation-contract.json` 的 `knownRuntimeExtraMainNavigationKeys` 在 runtime drift 真正消失的同一变更中清空；不能提前宣称完成，也不能保留已修复 allow-list。

### C2 — Runtime navigation authority

- 只在 `packages/core/src/navigation.ts` 修改准确 route、label、grouping 与 redirects。
- `MERCHANT_NAV`、active-state helpers、Otto route descriptions 与 shell consumers 从同一 source 读取。
- Parked route constants 如仍需兼容，可以保留为 redirect source；不得重新进入 active navigation 或 active quick action。

### C3 — Shared shell convergence

- Production shell 消费新的 runtime navigation authority。
- 不在 page、pattern、Otto prompt 或 test fixture 手抄第二份五项导航。
- Review fixture shell 继续消费 `navigation-contract.json`；production 与 review 可以使用不同 route adapters，但不能拥有不同 product tree。

### C4 — Compatibility convergence

- 按 frozen destination rules 收敛 Campaigns、Schedule merchant routes、Schedule analytics、Manual Video editor 与 CRM legacy entries。
- 明确排除 auth、legal、admin、public share / review 与 design-system review fixtures。

### C5 — Acceptance and checkpoint

- 逐项执行 automated guard、route tests、interaction checks、typecheck、scoped lint 与 production build。
- 在 desktop reference viewports 检查 rail、active state、keyboard focus、Otto open / close、Canvas carve-out 和 redirects。
- 本阶段只形成当前 UI/UX worktree 的结构 checkpoint；Founder 未明确批准前不 push、不 deploy，也不进入下一批 production surface replacement。

## 6. Checkable acceptance criteria

1. Runtime main navigation 的 stable keys 严格等于 `navigation-contract.json.activeMainNavigationKeys`，顺序为 Home、Create、Library、Brand、Settings。
2. Campaigns 与 Schedule 不出现在 rail、mobile substitute、command shortcut、Otto navigation map 或空状态 CTA 中。
3. Settings 在 rail 只显示一个 destination；Profile、General、Connections、Billing & credits 在 Settings experience 内分流。
4. Ask Otto 仍是 assistant action，没有 `MERCHANT_NAV` entry，也没有第二个 Founder-facing Otto home。
5. Home、Create、Library、Brand、Settings 及其 approved child surfaces 的 active state 唯一且正确。
6. Full-screen Canvas 不渲染第二层 application shell；返回动作进入 Create owner surface。
7. Campaigns、Schedule merchant surfaces、Manual Video editor 与 CRM legacy entries 到达冻结 destination，不出现 redirect loop、404 或 auth-wall regression。
8. Schedule analytics 进入 `home.analysis` owner；若 legacy context 无法可靠映射，显示诚实的 default analysis entry，不伪造 subject 或 filters。
9. Public share / review、Auth、Legal 与 Admin routes 的壳类型和可达性保持不变。
10. Redirect 只使用 runtime navigation authority；page component、shell 与 test 不新增 route 字面量副本。
11. `knownRuntimeExtraMainNavigationKeys` 只在 runtime 导航完成收敛后清空，design-system source-of-truth guard 通过。
12. 所有 visible navigation controls、Settings entry、Profile、credits、Ask Otto 与 back actions 可点击、可键盘到达、有可读 accessible name。
13. 当前 route refresh、Back / Forward 与 deep link 后仍进入同一 owner surface；supported query context 不丢失。
14. 1440×900 与 1920×1080 下 rail、utility bar、content 与 Otto panel 不重叠；Canvas carve-out 不出现双壳。
15. Existing auth、tenant isolation、permissions、money actions、data reads / writes 与 backend contracts 没有行为改变。
16. Targeted tests、typecheck、scoped lint、design-system authority guard 与 production build 全部通过；warning 不能被写成 pass，必须单独记录。

## 7. Single source of truth / DRY rules

| Decision | Canonical owner |
|---|---|
| Beta product areas、surface ownership、handoff | 本目录冻结 IA |
| Accurate runtime routes、labels、groups、redirects | `packages/core/src/navigation.ts` |
| Active / Parked drift guard | `navigation-contract.json` |
| Application-shell visual structure and interaction | `../patterns/application-shell/` |
| Tokens and primitives | `../foundations/`、`../primitives/` |
| Product-page business data and actions | Existing domain / product code |

- 不建立 `betaNav`、page-local route map 或第二份 Settings tree。
- Compatibility alias 可以存在，但只能指向 canonical implementation，不能 fork behavior。
- 当实现改变本表任何 owner 时，先改 owner，再让 consumers 跟随；不能逐页 surface patch。

## 8. Non-goals

- 不在本阶段把 Home、Create / Canvas、Library、Brand 或 Settings review fixture 整体替换进 production。
- 不重新设计已验收页面、tokens、primitives、Otto panel 或 Canvas interaction。
- 不实现 Reference picker、Library object lifecycle、Brand backend 或 Home analytics backend。
- 不删除 Campaign、Schedule、Video editor 或 CRM 的 database records、domain code、jobs 或 migrations。
- 不改变 auth、tenant、permissions、billing、credits、generation、publishing 或 external connection behavior。
- 不加入 mobile dashboard、Campaigns、Schedule、CRM、Manual Video editor 或新的 beta destination。
- 不 push、deploy 或修改生产数据。

## 9. Rollback boundary

- 本阶段的可回退范围是 navigation data、shell consumption、redirect files 与直接相关 tests。
- 不用 destructive Git 操作；回退只能撤销本阶段自己新增或修改的 bounded changes。
- 若任一 active destination 在当前 runtime 无法保持真实可用，停止切换该入口并记录 blocker；不能用 fake success、disabled-looking-but-clickable control 或 duplicate page 掩盖。

## 10. Approval and change register

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-08-31 | Candidate drafted | Founder 批准起草 Beta frontend convergence spec，并再次要求遵守 SSOT、DRY、分层与逐步验收原则。本 candidate 只覆盖 Phase 1 application shell 与 route ownership；尚未授权代码实现。 |
| 2026-08-31 | Founder approved and frozen | Founder：“好的。” 批准并冻结本 spec，授权按 C1–C5 顺序实施；任何超出 acceptance criteria 的新方向进入 change register，不在本批顺手实现。 |
