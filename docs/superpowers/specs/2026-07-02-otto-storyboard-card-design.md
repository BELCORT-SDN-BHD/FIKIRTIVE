# Otto 创作 · Block F 设计 —— storyboard 分镜卡

**状态:** 设计已与创始人对齐(brainstorm 完成 2026-07-02)。下一步:writing-plans → subagent-driven TDD。节奏同 block 1 / D/E。

**语言约定:** 本 spec 及 skill 文档用华语;生成 prompt 一律英文(D/E 的 skill 负责)。

---

## 0. 在 roadmap 的位置

创作子项目第 3 块。已 ship:**Block 1**(requires 刨根问底,PR #83)、**D/E**(prompt 精通 seedream/seedance,PR #91)。**本文件 = F(分镜卡)**;之后 **G**(两道闸的闸②:make all 视频)。总设计 `2026-07-01-otto-creation-experience-design.md`。

---

## 1. 目标

F = **可编辑的分镜卡 + 真实首帧图**。用户说"做个广告"、Otto 刨根问底(block 1)后,Otto 铺出一张**有序分镜**:每镜头 = 首帧 prompt + 视频 prompt(都由 D/E 的 skill 拼)。用户**看文字 + 真实首帧图确认方向、逐帧改**;满意后交给 G 做视频。

这是创始人原话流程里"出 storyboard 给用户看、逐帧改、满意再做"的那一段;**F 覆盖到"首帧图确认"为止,视频(闸②)在 G**。

---

## 2. 现状 / 复用(不动 proposePack)

- **proposePack 是活功能,保持不动**:它是 Otto 的现役工具(`registry.ts`),`OttoChatStream` 把同 `packId` 连续 GEN_CARD 合成 `PackCard`(带"Make all")+ `pack-credit-math.ts` 算钱。用途 = 一次摆一批**独立**提案卡供挑选(campaign pack)。分镜是**有序的一条脚本**,与之不同 → **新建分镜卡,不改 proposePack**。
- **但复用它的原语**(不重造钱路):`buildProposeCard`(定价/选模型/所有权 scoping)、`generate`(唯一花钱 skill,per-card 幂等)、`PackCard` 的"Make all"聚合审批 + 亲和度 + `pack-credit-math`、遗留 `CoworkPlan` 的有序 schema 形状。
- **依赖 D/E**(PR #91):`seedreamPrompt`(首帧图 prompt)、`seedancePrompt`(视频 prompt)。F 的实现分支 stack 在 D/E 之上。

---

## 3. 决策(创始人拍板)

1. **一整块做**(不拆 F-a/F-b),但内部按 TDD 分任务、把碰钱的闸① 放在后面的任务、隔离 review。
2. **v1 不做连贯**(所有镜头**独立**)—— 连贯(末帧→下一首帧)留到以后。因此 F v1 的首帧图**可一次全部生成**,不需要顺序链式。
3. **新建 `STORYBOARD_CARD`**(有序、可逐帧编辑),不塞进 proposePack。
4. **闸① 首帧图复用现有 `generate`**(不新建钱路);聚合审批"生成全部首帧(N · X credits)",像 PackCard 的 makeAll。
5. **v1 全套编辑**:改文字→重生该帧、只重出某帧图、增/删镜头、重排顺序。

---

## 4. 组件 + gate

| 组件 | 作用 | cost/effect/reach | 花钱? |
|---|---|---|---|
| `proposeStoryboard` skill | 持久化一张有序 `STORYBOARD_CARD`(每镜头:首帧 prompt + 视频 prompt)。Otto 已先逐镜头调 `seedreamPrompt`/`seedancePrompt` 拼好 prompt 再调它 | free/write/internal → 不审批 | ❌ $0 |
| `STORYBOARD_CARD`(新 ChatMessage kind + 渲染)| 有序镜头的可编辑载体;渲染参考 `OttoPlanCard`/`PackCard` 的样式 | —(UI)| ❌ |
| 编辑 server actions(4)| `editShotPrompt` / `addShot` / `deleteShot` / `reorderShots` —— 改的是卡片 payload(owner-scoped)| — | ❌ $0 |
| 闸① 首帧图(server action)| `generateStoryboardFirstFrames`(聚合)+ `regenShotFirstFrame`(单帧)—— **循环调用现有 `generate`** 出图,把 `firstFrameGenerationId` 写回镜头 | **复用 generate** | ✅ 审批 + money-review |

---

## 5. 数据形状(`STORYBOARD_CARD` payload)

复用遗留 `CoworkPlan` 的"有序镜头"形状,加上双 prompt + 首帧图引用:

```ts
type StoryboardCardPayload = {
  storyboardTitle: string;
  shots: {
    index: number;            // 有序(0..n)
    title?: string;           // 简短镜头名(可选)
    firstFramePrompt: string; // Seedream 首帧 prompt(来自 seedreamPrompt)
    videoPrompt: string;      // Seedance 视频 prompt(来自 seedancePrompt)
    firstFrameGenerationId?: string; // 闸① 生成后写回;编辑文字后清空(标记需重出)
  }[];
  // v1 无连贯字段(留后)
};
```

用 Zod 校验(镜头数、prompt 长度上限,借 `CoworkPlan` 的 caps)。编辑动作直接改这个 payload(重新持久化整条卡片,owner + thread scoped)。

---

## 6. 流程

```
用户"做个广告" → Otto 刨根问底(block 1)
   → Otto 逐镜头调 seedreamPrompt + seedancePrompt 拼 prompt
   → proposeStoryboard(有序 STORYBOARD_CARD,文字,$0)
   → 用户看/改(改文字→清该帧图 / 增删 / 重排,都 $0)
   → 闸① "生成全部首帧"(聚合审批,复用 generate 出 N 张图)→ 图写回卡片
   → 用户看「文字 + 真实首帧图」→ 满意 / 单帧重出 / 再改
   → [G] 闸② make all 视频
```

---

## 7. Money-safety(闸① 碰钱,硬约束)

- **不新建钱路**:每张首帧图 = 一次现有 `generate`(`cowork:${cardId}` 幂等、reserve/settle 不变)。闸① 只是**编排** N 次(像 PackCard makeAll),不复制花钱逻辑。
- **聚合审批 + 亲和度**:复用 `pack-credit-math` 算总额、balance-guard;一次"生成全部首帧(N · X credits)"确认。
- **单帧重出** = 一次独立 `generate`(用户主动、显式)。
- **编辑不花钱**:改文字/增删/重排都只动 payload。改文字会**清空该帧的 `firstFrameGenerationId`**(图变旧 → 用户重出),不会自动偷偷重生成。
- F 的实现走 **money-safety review**(碰 generate 编排)。`proposeStoryboard` + 编辑动作本身 $0(无 GenJob),可先独立 ship + review。

---

## 8. 编辑动作(server actions,owner+thread scoped)

- `editShotPrompt(cardId, index, { firstFramePrompt?, videoPrompt? })` → 改文字 + 清 `firstFrameGenerationId`。$0。
- `regenShotFirstFrame(cardId, index)` → 单帧重出(一次 `generate`)。**花钱**。
- `addShot(cardId, shot)` / `deleteShot(cardId, index)` → 增/删,重排 index。$0。
- `reorderShots(cardId, order[])` → 重排。$0。
- 全部严格 owner-scoped(身份来自 session,不来自输入)。

---

## 9. Build 顺序(F 内,一次一 task;碰钱的放后面)

1. `STORYBOARD_CARD` payload schema(Zod)+ `proposeStoryboard` skill($0)+ 测试。
2. `STORYBOARD_CARD` 渲染(有序镜头行,文字优先;参考 OttoPlanCard/PackCard 样式)。
3. 编辑 actions($0):editShotPrompt / addShot / deleteShot / reorderShots + 测试 + UI 接线。
4. **闸① 首帧图**:`generateStoryboardFirstFrames`(聚合,复用 generate + pack-credit-math)+ `regenShotFirstFrame`(单帧)+ UI + **money-safety review**。
5. 指令:告诉 Otto 多镜头视频/广告请求走 `proposeStoryboard`(先逐镜头调 seedream/seedancePrompt)。
6. registry 注册 `proposeStoryboard` + 重生成 CATALOG。

---

## 10. 依赖 / 后续(不在 F)

- **依赖**:D/E 的 `seedreamPrompt`/`seedancePrompt`(PR #91);实现分支 stack 在 D/E 上。
- **G(后续块)**:闸② make all 视频(N 个独立成片);碰钱,money-review。
- **连贯模式**(末帧→下一首帧、顺序链式、逐镜头确认)→ 留到 F 之后 / 随 G(总设计 §4.2 有记)。
- **prompt 长度 clamp**(装配 prompt vs `MAX_GEN_PROMPT` 2000)→ 多镜头分镜是真会撞的场景,F 实现时给 assembler/入库加 clamp(总设计审计 #9)。

---

## 11. 相关文件

- 复用原语:`packages/otto/src/skills/propose.helpers.ts`(buildProposeCard)、`propose-pack.ts` / `apps/web/components/otto/PackCard.tsx` / `pack-credit-math.ts`(makeAll 聚合模式)、`packages/otto/src/skills/generate.ts`(唯一花钱)、`packages/core/src/cowork.ts`(CoworkPlan 有序 schema)
- D/E prompt skills:`packages/otto/src/skills/{seedream-prompt,seedance-prompt}.ts`
- 卡片渲染参考:`apps/web/components/otto/{OttoPlanCard,PackCard}.tsx`、`OttoChatStream.tsx`(卡片分组/渲染)
- 新建:`packages/otto/src/skills/propose-storyboard.{ts,helpers.ts,test.ts}` + `STORYBOARD_CARD` 渲染组件 + 编辑/闸① server actions(`apps/web/lib/`)
