# 画布状态卡的确认位 规格书（S1）

> 状态: 草稿
> 批准: （冻结时填）https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/<N> Founder 评论「S1 批准 canvas-confirmation-card.md」(YYYY-MM-DD)
> 规格前缀: CARD（验收编号 = CARD-A1、A2…，全仓不得与其他规格撞前缀）

<!--
这是一份**草稿**，供 Founder grill 与签名。它由谁、为什么开出来：

  · `docs/specs/otto-engine.md` §7.2⑦ 的「边界（不做，写明归属）」明写：把确认**收回画布
    状态卡**、按已批准设计做出 `needs-confirmation` 状态机，**不在⑦段**；
    「那份小规格由做⑦的那一场在开工前另写、另签」。
  · `docs/specs/frontend-baseline.md` §7.1 第⑨段与 §7.5 也已把它划为「另立小规格再动」。

⑦段（PR 见 §5 登记）已经把画布退成一个输入框，确认在**对话面板**里完成；本规格要决定
的是：那张确认要不要、以及怎样搬回画布上那张状态卡。冻结之前不写一行产品代码。
-->

## 0. 一句话

<待 Founder grill 后填>草案：商家在画布上跟 Otto 说完一件要花钱的事，**不必打开对话面板**，就在画布左上那张一直看得见的状态卡上读到「要做什么、多少 credits」并按下确认。

## 1. 九问（S1 grill 的答案，一问一答；答不出的那问就是还没想清楚的那块）

> 下面每一问都先写「今天的事实（可核）」，再写「待 Founder 拍板的那一格」。事实部分是这一场
> 查过的，答案部分**留白**——那是 grill 要产出的东西，不是 AI 替 Founder 填的。

1. **商家做什么动作、看到什么结果？**
   - 今天的事实：⑦段之后画布上只有 Otto 那一个输入框；花钱那一下长在**对话流里**那张卡上
     （`apps/web/components/otto/OttoPlanCard.tsx`，主键 `Generate · N credits`）。画布左上
     那张一直看得见的状态卡今天是**纯标签**——`OttoCanvasStatus`
     （`apps/web/components/otto/OttoTrace.tsx`），它只说状态，按不下任何东西。
   - 已批准的设计要的是另一个样子：夹具 `apps/web/design-system/patterns/canvas/CanvasReference.tsx`
     的 `CurrentTurn` 卡在 `turn.status === "needs-confirmation"` 时**自己长出**一块
     `aria-label="Generation confirmation"` 的区域：几张、什么规格、用了哪张参考、多少 credits，
     外加 `Generate · {credits} credits` 与 Cancel 两颗键。
   - 待拍板：确认到底**搬**回状态卡（对话面板里那张卡随之退场），还是**两处都有**（同一张卡
     的两个投影）。两处都有就必须回答「按了其中一处，另一处怎么办」——这正是下面第 5 问。
2. **入口在哪里？（列全，含深链）**
   - 今天的事实：画布路由 `/create/canvas?project=<id>&thread=<id>`；状态卡挂在画布左上角
     （`CANVAS_OTTO_CORNER_ATTR`，`apps/web/lib/canvas-fit-padding.ts` 会为它让位）。侧栏 Otto
     面板是同一条对话的另一个入口（`surface` 分流见 `apps/web/lib/otto-thread-surface.ts`）。
   - 待拍板：侧栏面板里的那张卡要不要跟着改成同一个形状。
3. **四态：空、加载、错误、成功各长什么样？**
   - 今天的事实：夹具的 `CurrentTurn` 有六个状态（`working` / `queued` / `confirming-status` /
     `needs-answer` / `needs-confirmation` / `failed` / `cancelled` / `done`），生产的
     `OttoCanvasStatus` 只表达其中几个。
   - 待拍板：这六个状态里哪几个是**产品真的分得出来**的（造不出来的状态不许上卡面 —— 与
     frontend-baseline 裁决九「无契约的控件不出现」同一条）。
4. **数据从哪来、写到哪去？**
   - 今天的事实：卡面内容来自服务端写下的 GEN_CARD payload（`structuredPrompt` /
     `estimatedCredits` / `specChips` / `params`），界面一个字段都不自己编；批准走
     `ottoApprove`。
   - 待拍板：状态卡要读的是不是**同一份** payload（默认应当是；写成第二份读法就是两个屏幕
     两套真相）。
5. **碰不碰钱路（credits / 计费）？碰则幂等键是什么？**
   - **碰**。这是本规格最重的一格。
   - 今天的事实：确认那一下的幂等键是 `otto-approve:<threadId>:<cardId>:a<n>`
     （`apps/web/lib/otto-actions.ts`），生成任务锚在 `cardId` ＋ GenJob 的 `cowork:` 双批准
     （`packages/otto/src/approval-tools.ts`）。Otto 引擎 S1 九问 5 已冻结「幂等键一个都不新增」。
   - 待拍板：**两处都有确认位**的话，「同一张卡在两个地方各按一次」必须是**一次**扣款。既有
     幂等键锚在 `cardId` 上，形状上是够的；但界面上的**乐观态**要不要跨两处同步，是要答的。
6. **权限与租户边界是什么？**
   - 今天的事实：卡片按 `ownerId` ＋ `threadId` ＋ `projectId` 三重校验才读得到
     （`packages/otto/src/skills/generate.ts`），客户端传什么都不算数。本规格不改这一格。
7. **参考对照：抄哪家？（Mobbin 截图或链接，稿上注明）**
   - 已批准的自家夹具就是对照：`CanvasReference.tsx` 的 `CurrentTurn`。
   - 待补：Founder 若要外部对照（画布上「原地确认」这件事），这一场再取 Mobbin 截图。
8. **胃口：轻／中／重挡，为什么？**
   - 建议 **中挡**（既有表面上的可见行为变化，不新增路由、不动 schema、不新增幂等键）。
     若拍板改成「对话面板那张卡退场」，则升 **重挡**（退役一个实现）。
   - 待拍板。
9. **Otto 怎么协助这个功能？或明写「不适用」。**
   - 今天的事实：卡本来就是 Otto 铸的；本规格只改它**长在哪块屏幕上**。
   - 待拍板：Otto 要不要在卡上多说一句「我为什么建议这个规格」。

## 2. 验收表（S5 只认这张表；一行一个可当场演示的判定）

> **草案，未冻结。** 编号先占位，冻结时按 grill 的结论重排。

| 编号 | 商家做 X | 看到 Y |
|---|---|---|
| CARD-A1 | 商家在画布上跟 Otto 说一件要花钱的事，**不打开对话面板** | 画布左上那张一直看得见的状态卡自己长出确认位：做什么、几张、多少 credits，外加确认与取消两颗键 |
| CARD-A2 | 商家在状态卡上按下确认 | 与在对话流那张卡上按下**完全同一条**花钱路：同一个 `cardId`、同一把既有幂等键、账本一次扣款 |
| CARD-A3 | 商家在两处（状态卡与对话流）各按一次同一张卡 | 只扣一次；第二次得到的是「这张已经在做了」，不是第二个任务 |
| CARD-A4 | Otto 反问一句（`needs-answer`）而不是要钱 | 状态卡出现的是**答题位**，不是确认位；卡上明写此刻 0 credits |
| CARD-A5 | 这一张卡被取消 / 失败 / 完成 | 状态卡当场说出它此刻真的状态，且不留下一颗按了没反应的键 |

## 3. 不做（非目标；写明为什么和触发条件，防「遗漏」误会）

- **不新增幂等键**：Otto 引擎 S1 九问 5 已冻结，本规格是界面位置的变化，不是钱路语义的变化。
- **不动 GEN_CARD 的 payload 形状**：卡面读的是服务端已经写下的那一份；要新字段就是另一件事。
- **不重开「画布要不要有直出 composer」**：那一条由 `otto-engine.md` §7.2⑦ 落定（已退役），
  触发条件＝Founder 另裁。
- **不改侧栏 Otto 面板的展开规则**：`frontend-baseline.md` §5 的 FRONT-A14 那几行管着它。

## 4. 异议栏（AI 必填：本规格最大的风险或异议，一条即可；真没有就写「无异议」——套话算违规）

- **最大的风险是「两个屏幕两颗同名的按钮」**。若拍板成「两处都有确认位」，那么同一张卡在
  画布状态卡与对话流里各有一颗 `Generate · N credits`。钱路那一侧是安全的（幂等键锚在
  `cardId`，重复按不会二次扣款）；**危险的是界面的乐观态**——一处按下、另一处还写着「等你
  确认」，商家很自然会再按一次，然后对着两颗都变灰的按钮猜自己是不是被收了两次钱。真扣款
  只有一次，但**商家的信任是按他看见的东西算的**，不是按账本算的。
  这一条建议在 grill 时优先拍板：**要么只留一处**（推荐，也与已批准夹具一致），要么在冻结
  的验收表里给「两处状态同步」单开一行（上面的 CARD-A3 是它的草案）。

## 5. 变更登记（冻结后的中途想法只进这里，下次 S5 批量裁决；不当场执行）

| 日期 | 想法 | 裁决（留空待 S5） |
|---|---|---|
| 2026-09-05 | 本文件由 `otto-engine.md` §7.2⑦ 的边界条款开出（「那份小规格由做⑦的那一场在开工前另写、另签」）。⑦段本身已合入的内容：画布退成一个输入框、直出 composer 与工具条 Generate 退役、花钱走对话流那张卡。**本规格冻结之前不写一行产品代码** | |

## 6. 改签记录

- 无
