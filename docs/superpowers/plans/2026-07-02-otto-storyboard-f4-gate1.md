# Otto 分镜 · F4(闸① 首帧图)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **本块碰钱编排(不碰钱路本身)。实现 = Opus;每 task review + 最终整支 money-safety review = 必须。**

**Goal:** 分镜卡的闸①:一键"生成全部首帧(N · X credits)"聚合审批 + 单帧重出 —— **每镜头铸一张子 GEN_CARD,循环不改动的 `coworkGenerate`**,生成完把 `firstFrameGenerationId` 按 shotId 写回父卡并显示缩略图。

**Architecture(spec §7 已锁,Fable 终审设计):** 三个 $0 server action + UI。(1)`prepareStoryboardFirstFrames`:给每个缺图镜头**铸子 GEN_CARD**(`buildProposeCard` 定价;子卡 payload 带 `{storyboardCardId, shotId}` 回链;父卡镜头写 `firstFrameCardId` 显式追踪当前子卡)——铸卡 $0、可重入(已有新鲜子卡就复用,绝不重复铸)。(2)花钱只发生在**客户端**:确认后 PackCard.makeAll 式**顺序循环现有 `coworkGenerate(childCardId)`**——每子卡天然有自己的 `cowork:<childCardId>` once-EVER 幂等 key,**钱路一行不改**。(3)`syncStoryboardFirstFrames`:$0 对账——子卡 job DONE 的,读 GEN_RESULT 的 `generationIds[0]` 按 shotId 写回父卡 + 解析缩略图 URL。重出 = `regenShotFirstFrameCard` 再铸一张子卡(coworkVaryCard 先例)替换 `firstFrameCardId`。子卡在聊天流里**隐藏**(pre-pass 按 `payload.storyboardCardId` 跳过),状态呈现在分镜卡内。

**Tech Stack:** Next.js server actions(`"use server"`)、`buildProposeCard`(`@fikirtive/otto`,服务端图)、Prisma(RMW 事务)、vitest(mock prisma/auth,断言 $0)、React(StoryboardCard 扩展)。

## Global Constraints

- **钱路一行不改(最高约束)**:server action 绝不建 GenJob、绝不 reserve/settle、绝不 import `@fikirtive/generation`、绝不服务端调 `coworkGenerate`/`startGen`。花钱只由**用户在客户端确认后**经现有 `coworkGenerate` 逐子卡发生(startGen 原子 reserve + 余额守卫不变)。测试强制:三个 action 的 mock 断言 `genJob.create` 从未被调。
- **禁止复合幂等 key**(spec §7):绝不构造 `cowork:<storyboardId>:<shotIndex>` 之类;幂等 = 每子卡自己的 `cowork:<childCardId>`(coworkGenerate 内部既有,cowork-actions.ts:523-527)。
- **严格 owner-scoped,身份仅来自 session**(`requireOwner()`;载卡 `{id, ownerId, kind, deletedAt:null}` + thread owner 复核;`ownerId` 绝不来自输入)——同 F3 storyboard-actions.ts 模板。
- **写回按 shotId 定点、RMW 放事务里**(spec §7:F4 不许裸 last-write-wins):`prisma.$transaction(async (tx) => { 读父卡 payload → 只改目标 shot 的字段 → 写回 })`。
- **可重入 / 防重铸**:`prepare` 对已有 `firstFrameCardId` 且子卡 prompt 与当前 `firstFramePrompt` 一致的镜头**复用**,不再铸;"make all" 双击/刷新中途重进不产生多余子卡、更不可能重复扣费(幂等 key 兜底)。
- **子卡对聊天隐藏**:OttoChatStream 渲染 pre-pass 对 `payload.storyboardCardId` 为 string 的 GEN_CARD 返回 null(单条与 pack 分组两处都要);轮询(`hasWorkingJob`)不受影响(照常看到子卡的 genJobId → 驱动结果注入与本卡 sync)。
- **改文字既清 `firstFrameGenerationId` 也清 `firstFrameCardId`**(旧子卡 prompt 已过期;旧子卡留在 DB 是 $0 无害孤儿)。
- 华语注释/文档;卡片 chrome 英文;与 F3 相同的 zod-validate → `{error}` 风格(不抛)。

---

### Task 1: payload `firstFrameCardId` + 编辑变换清除($0)

**Files:**
- Modify: `packages/otto/src/skills/propose-storyboard.helpers.ts`(payload type 加字段;zod 输入不变——该字段只由服务端写)
- Modify: `apps/web/lib/storyboard-edit.ts`(`applyEditShotPrompt` 同时丢 `firstFrameCardId`)
- Modify: `apps/web/lib/storyboard-card.ts`(视图透传 `firstFrameCardId`)
- Test: `apps/web/lib/__tests__/storyboard-edit.test.ts`、`apps/web/lib/__tests__/storyboard-card.test.ts`(补断言)

**Interfaces:**
- Consumes:F 已 ship 的 `StoryboardCardPayload`(shots 已有 `shotId`/`entityIds`/`firstFrameGenerationId`)。
- Produces:`StoryboardCardPayload` shots += `firstFrameCardId?: string`;`StoryboardShotView` 同步(Task 2/3/4 消费)。

- [ ] **Step 1: 加类型字段**

`propose-storyboard.helpers.ts` 的 `StoryboardCardPayload.shots` 项,在 `firstFrameGenerationId?: string;` 之前加:

```ts
    /** 该镜头"当前子 GEN_CARD"的 id(闸① 铸卡时写)——显式追踪;改文字/重出时替换或清空。 */
    firstFrameCardId?: string;
```

`storyboard-card.ts` 的 `StoryboardShotView` 同样加 `firstFrameCardId?: string;`,`parseStoryboardCardPayload` 透传(`typeof shot.firstFrameCardId === "string"` 才带上,同 firstFrameGenerationId 的写法)。

- [ ] **Step 2: 写失败测试**

`storyboard-edit.test.ts` 的 `applyEditShotPrompt` describe 加:

```ts
  it("改文字同时清 firstFrameCardId(旧子卡过期)", () => {
    const b = base();
    (b.shots[0] as Record<string, unknown>).firstFrameCardId = "child-0";
    const r = applyEditShotPrompt(b, 0, { firstFramePrompt: "NEW" });
    expect("firstFrameCardId" in r.shots[0]).toBe(false);
    expect("firstFrameGenerationId" in r.shots[0]).toBe(false);
  });
```

`storyboard-card.test.ts` 加:

```ts
  it("firstFrameCardId 透传(F4 用)", () => {
    const r = parseStoryboardCardPayload({
      storyboardTitle: "X",
      shots: [{ shotId: "s0", index: 0, firstFramePrompt: "a", videoPrompt: "b", firstFrameCardId: "child-1" }],
    });
    expect(r.shots[0].firstFrameCardId).toBe("child-1");
  });
```

- [ ] **Step 3: 跑红** — `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-edit.test.ts lib/__tests__/storyboard-card.test.ts` → 新 it FAIL。

- [ ] **Step 4: 实现** — `applyEditShotPrompt` 的解构改为同时丢两个键:

```ts
    const { firstFrameGenerationId: _drop, firstFrameCardId: _drop2, ...rest } = s;
```

- [ ] **Step 5: 跑绿** — 同 Step 3 命令,全 PASS。
- [ ] **Step 6: typecheck** — `pnpm --filter @fikirtive/otto typecheck && pnpm --filter @fikirtive/otto build && pnpm --filter @fikirtive/web typecheck`。
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(otto): storyboard shot tracks its current child card (firstFrameCardId, \$0)"`

---

### Task 2: `prepareStoryboardFirstFrames` + `regenShotFirstFrameCard`($0 铸卡)

新文件 `apps/web/lib/storyboard-gate1-actions.ts`(`"use server"`)。铸子卡 = **$0**(GEN_CARD ChatMessage,genJobId null,不建 GenJob)。

**Files:**
- Create: `apps/web/lib/storyboard-gate1-actions.ts`
- Test: `apps/web/lib/__tests__/storyboard-gate1-actions.test.ts`

**Interfaces:**
- Consumes:`buildProposeCard(input, ctx, ownedEntityIds)`(`@fikirtive/otto`,propose.helpers.ts:93 —— **实现前读它确认精确签名与 ctx 字段**);`requireOwner`;`prisma`/`Prisma`;`newId`(`@fikirtive/core`);F3 的 `loadCard` 模式(storyboard-actions.ts:26,复制成本文件私有 helper,勿跨文件导出)。
- Produces(Task 4 消费):
  - `prepareStoryboardFirstFrames(raw: {cardId}) → { children: ChildFrameCard[]; totalCredits: number } | { error }`
  - `regenShotFirstFrameCard(raw: {cardId, shotId}) → { child: ChildFrameCard } | { error }`
  - `type ChildFrameCard = { shotId: string; childCardId: string; estimatedCredits: number; structuredPrompt: string; entityIds: string[]; spent: boolean }`(`spent` = 子卡已有 genJobId 或已存在其幂等 job——UI 据此跳过已花钱的)。

- [ ] **Step 1: 写失败测试**(mock 模板同 F3 storyboard-actions.test.ts:`vi.hoisted` + `vi.mock("../auth-guard")` + `vi.mock("@fikirtive/db", { prisma: { chatMessage: {...}, genJob: { findFirst, create } }, Prisma: {} })`;另 mock `@fikirtive/otto` 的 `buildProposeCard` 返回定值 payload `{ kind:"image", model:"m", params:{count:1}, structuredPrompt:<入参>, entityIds:<入参>, estimatedCredits: 5, estimatedPriceUsd: 0.2, reason:"", downgraded:false, variantSel:{} }`,并 mock ownedEntityIds 所需的 entity 查询)。核心断言:

```ts
describe("prepareStoryboardFirstFrames — $0 铸卡", () => {
  it("给缺图镜头逐个铸子 GEN_CARD(payload 带 storyboardCardId+shotId 回链),父卡写 firstFrameCardId", async () => {
    // 3 镜头:s0 无图无子卡 → 铸;s1 已有 firstFrameGenerationId → 跳过;s2 无图无子卡 → 铸
    // 断言:chatMessage.create 恰好 2 次,kind:"GEN_CARD",payload.storyboardCardId===父卡id、payload.shotId 各对应
    // 断言:父卡 update 的 payload 中 s0/s2 的 firstFrameCardId 写上了新子卡 id;s1 原样
    // 断言:返回 children 2 项 + totalCredits = 10
  });
  it("可重入:镜头已有 firstFrameCardId 且子卡 prompt 一致 → 复用,不再铸", async () => {
    // s0.firstFrameCardId="child-0",mock 载入 child-0(payload.structuredPrompt === s0.firstFramePrompt,genJobId:null)
    // 断言:chatMessage.create 未被调;children 含 child-0,spent:false
  });
  it("$0 铁证:genJob.create 从未被调;不 import @fikirtive/generation", async () => {
    // 两个用例后统一断言 mockGenJobCreate 从未被调(文件级 grep 由 review 把关 import)
  });
  it("requireOwner 失败 / 卡不存在 / 非 STORYBOARD_CARD → {error},不写 DB", async () => {});
  it("全部镜头都有图 → children:[], totalCredits:0,不写 DB", async () => {});
});

describe("regenShotFirstFrameCard — $0 重出铸卡", () => {
  it("按 shotId 铸新子卡替换 firstFrameCardId 并清 firstFrameGenerationId(其余镜头不动)", async () => {});
  it("shotId 不存在 → {error},不写 DB", async () => {});
  it("genJob.create 从未被调", async () => {});
});
```

(测试写全——上面注释即断言内容,实现者按 F3 测试文件的 mock 风格补齐 fixture;**每条断言必须真实存在**,不许留 TODO。)

- [ ] **Step 2: 跑红** — `pnpm --filter @fikirtive/web exec vitest run lib/__tests__/storyboard-gate1-actions.test.ts` → module not found。

- [ ] **Step 3: 实现**(骨架如下;`buildProposeCard` 的 ctx:先读 `apps/web/lib/otto-actions.ts` 的 `buildOttoContext` 看 `disabledModels`/owned-entity 的现有取法并**复用同一来源**;ctx 只需 `Pick`(orgId/threadId/disabledModels,source/referenceVideo 留 undefined)):

```ts
"use server";
/**
 * storyboard-gate1-actions — 闸① 的 $0 铸卡层。
 * 铸子 GEN_CARD(定价走 buildProposeCard)+ 父卡 firstFrameCardId 登记。
 * 花钱不在这里:用户确认后由客户端循环现有 coworkGenerate(childCardId)——
 * 每子卡自有 cowork:<childCardId> once-EVER 幂等 key,钱路一行不改。
 * 禁止复合 key(spec §7)。
 */
import { z } from "zod";
import { prisma, Prisma } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { buildProposeCard } from "@fikirtive/otto";
import type { StoryboardCardPayload } from "@fikirtive/otto";
import { requireOwner } from "./auth-guard";

export type ChildFrameCard = {
  shotId: string;
  childCardId: string;
  estimatedCredits: number;
  structuredPrompt: string;
  entityIds: string[];
  spent: boolean;
};

// loadCard:复制 F3 storyboard-actions.ts 的 owner-scoped 模式(id+ownerId+kind+deletedAt+thread 复核)。
// mintChild(tx, parent, shot, ctx, owned):buildProposeCard({kind:"image", structuredPrompt: shot.firstFramePrompt,
//   entityIds: shot.entityIds ?? [], variantSel:{}, count:1}) → payload += { storyboardCardId: parent.id, shotId: shot.shotId }
//   → tx.chatMessage.create({ id:newId(), threadId: parent.threadId, ownerId, role:"AGENT", kind:"GEN_CARD",
//        seq: last.seq+1, text:"", payload })   ← genJobId 不写(null);seq 取同 thread 最新+1(propose-pack.ts:46-108 先例)
// spentOf(childCardId, ownerId):prisma.genJob.findFirst({ where:{ ownerId, idempotencyKey: `cowork:${childCardId}` }})
//   !== null → true(只读判断,不建任何东西)
// prepareStoryboardFirstFrames:validate → requireOwner → loadCard → $transaction(async tx => {
//   重新读父卡 payload(事务内),逐 shot:
//     有 firstFrameGenerationId → 跳过
//     有 firstFrameCardId:载子卡;prompt 一致 → 复用(children.push,含 spent);不一致(防御)→ 铸新+替换
//     无 → 铸新子卡 + shot.firstFrameCardId = 新id
//   写回父卡 payload(只动 firstFrameCardId 字段)
// }) → { children, totalCredits: children.filter(c=>!c.spent).reduce(+estimatedCredits) }
// regenShotFirstFrameCard:validate(cardId, shotId) → requireOwner → loadCard → $transaction:
//   找 shot(by shotId,找不到 → error);铸新子卡(当前 prompt);shot.firstFrameCardId=新id;
//   删 shot.firstFrameGenerationId(旧图作废);写回 → { child }
```

(实现全文写出,不留注释骨架——上面是结构说明;每个函数按 F3 的错误风格返回 `{error}`。)

- [ ] **Step 4: 跑绿** — Step 2 命令全 PASS。
- [ ] **Step 5: typecheck + web build**(server 图 import `@fikirtive/otto` 合法,但**必须**验证:`pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web build` —— build 是上一轮 critical 的教训,`"use server"` 文件在服务端图,应过)。
- [ ] **Step 6: Commit** — `git commit -m "feat(otto): gate1 \$0 child-card minting — prepare + regen actions (no GenJob, no composite keys)"`

---

### Task 3: `syncStoryboardFirstFrames`($0 对账写回 + 缩略图 URL)

**Files:**
- Modify: `apps/web/lib/storyboard-gate1-actions.ts`(加第三个 action)
- Test: `apps/web/lib/__tests__/storyboard-gate1-actions.test.ts`(加 describe)

**Interfaces:**
- Consumes:GEN_RESULT 形状(worker gen.ts:130-157:`{ genJobId, payload: { generationIds: string[] } }`);URL 解析——**读 `apps/web/lib/data.ts` 里 thread DTO 的 `urlsByJob` 是怎么由 Generation → storage URL 构建的,复用同一 helper/写法**。
- Produces:`syncStoryboardFirstFrames(raw:{cardId}) → { payload: StoryboardCardPayload; frames: Record<string,string> } | { error }`(frames = shotId → 缩略图 URL,含已写回的旧图)。

- [ ] **Step 1: 写失败测试**:

```ts
describe("syncStoryboardFirstFrames — $0 对账", () => {
  it("子卡 job DONE → 读 GEN_RESULT.generationIds[0] 按 shotId 写回 firstFrameGenerationId", async () => {});
  it("job 未完成 → 该镜头不写,其他完成的照常写(部分完成可对账)", async () => {});
  it("写回是定点的:只动目标 shot 字段,其余 shot(含正在编辑的文字)原样", async () => {});
  it("无待对账镜头 → 原样返回,不写 DB", async () => {});
  it("genJob.create / startGen 从未被调($0)", async () => {});
});
```

- [ ] **Step 2: 跑红。**
- [ ] **Step 3: 实现**:requireOwner → loadCard → 收集 `firstFrameCardId && !firstFrameGenerationId` 的镜头 → 逐个:载子卡 genJobId(无则查 `genJob.findFirst({idempotencyKey: cowork:<childId>})`)→ job status DONE → 找该 genJobId 的 GEN_RESULT ChatMessage → `payload.generationIds[0]` → 事务内 RMW 定点写 `shot.firstFrameGenerationId`。frames:对所有有 generationId 的镜头,用与 data.ts urlsByJob 相同的 Generation→storage.url 解析。
- [ ] **Step 4: 跑绿;Step 5: typecheck;Step 6: Commit** — `git commit -m "feat(otto): gate1 \$0 sync — write back firstFrameGenerationId by shotId + frame urls"`

---

### Task 4: UI —— 子卡隐藏 + "Generate all first frames" 聚合确认 + 单帧重出 + 缩略图

**Files:**
- Modify: `apps/web/components/otto/OttoChatStream.tsx`(pre-pass 隐藏子卡 + 给 StoryboardCard 传 `balanceUsd`/`onBalanceRefresh`)
- Modify: `apps/web/components/otto/OttoConversation.tsx`(同样传 balance props)
- Modify: `apps/web/components/otto/StoryboardCard.tsx`(闸① UI)
- Modify: `apps/web/components/otto/pack-credit-math.ts` **不改**(直接复用 `canAffordPack`;总额由 action 返回)

**Interfaces:**
- Consumes:Task 2/3 的三个 action;`coworkGenerate`(`@/lib/cowork-actions`,**客户端唯一花钱调用**,同 PackCard.makeAll:76-116);`canAffordPack`(pack-credit-math.ts)。
- Produces:用户可见的闸① 完整闭环。

- [ ] **Step 1: 隐藏子卡**。OttoChatStream 渲染 pre-pass(~640):在 pack 分组判断**之前**加——`const isStoryboardChild = kind === "GEN_CARD" && typeof (payload as any)?.storyboardCardId === "string";` 为 true 时 `i++` 继续(不 push 任何 renderItem)。单条渲染路径同理(防御双保险)。**轮询不动**(hasWorkingJob 继续看到子卡 job → 驱动 GEN_RESULT 注入;GEN_RESULT 本身照常渲染?——**不**:子卡的 GEN_RESULT 也要隐藏,否则聊天里冒出孤立结果图。判定:GEN_RESULT 的 `genJobId` 对应子卡……客户端拿不到映射;简法:sync 后分镜卡内已显示缩略图,GEN_RESULT 隐藏与否是纯 UX——**v1 决定:不隐藏 GEN_RESULT**(和 PackCard 行为一致:pack 子卡的结果也是散排的),留给后续 UX 打磨。)
- [ ] **Step 2: StoryboardCard 扩展**。props += `balanceUsd?: number; onBalanceRefresh?: () => void;`。新 state:`children: ChildFrameCard[] | null`、`confirming`、`generating`、`genIdx`、`frames: Record<string,string>`。流程:
  - "Generate all first frames" 按钮(有缺图镜头时显示)→ `prepareStoryboardFirstFrames({cardId})` → 显示 "Confirm — N frames · X credits"(`canAffordPack(totalCredits, balanceUsd ?? 0)` 不足则禁用 + Top-up 提示,同 PackCard:212)。
  - 确认 → 顺序 for 循环 `coworkGenerate({ cardId: c.childCardId, prompt: c.structuredPrompt, entityIds: c.entityIds, variantSel: {} })`(跳过 `spent`;单卡失败记录错误继续下一张,同 PackCard 容错)→ 循环后 `onBalanceRefresh?.()`。
  - 生成中/后:每 3s 调 `syncStoryboardFirstFrames({cardId})`(上限 ~40 次)直到所有缺图镜头有 `firstFrameGenerationId`;每次用返回 payload/frames 刷新本地 view + 缩略图(`<img src={frames[shot.shotId]}>`,行内小图,`rounded-[10px] border border-border`,英文 alt "Shot N first frame")。
  - 每镜头(有图后)"Regenerate frame" 按钮 → `regenShotFirstFrameCard` → 显示该子卡 credits 确认 → 单卡 `coworkGenerate` → 继续 sync。编辑文字过的镜头(无图无子卡)自然回到 "Generate all" 的缺图集合。
  - `busy`/`generating` 期间禁用编辑动作(F3 的结构编辑与花钱流互斥,防 RMW 竞争窗口)。
- [ ] **Step 3: 两渲染器传 props**(OttoChatStream:791 与 OttoConversation:534 的 `<StoryboardCard>` 加 `balanceUsd={balanceUsd}` + stream 侧 `onBalanceRefresh={() => void onBalanceRefresh?.()}`,conversation 侧用它已有的等价 prop——读文件确认名字)。
- [ ] **Step 4: 验证** — `pnpm --filter @fikirtive/web typecheck && pnpm --filter @fikirtive/web exec vitest run`(允许的失败仅 12 个既有环境性)**且 `pnpm --filter @fikirtive/web build` EXIT 0**(上轮 critical 的门,凡动 client 组件必跑)。
- [ ] **Step 5: Commit** — `git commit -m "feat(otto): gate1 UI — make-all first frames (aggregate confirm) + per-shot regen + thumbnails"`

---

### Task 5: 整支 money-safety review(必须,合并前)

- [ ] 用最强模型跑整支 review(SDD 的 final review 模板),**专项核**:(a) 服务端零花钱(三 action 无 GenJob/startGen/coworkGenerate);(b) 幂等 = 仅每子卡 `cowork:<childCardId>`,无复合 key;(c) 客户端花钱全部经现有 `coworkGenerate`(每次点击→确认→循环,不自动触发);(d) 可重入不重铸不重扣;(e) RMW 事务定点写回;(f) `next build` EXIT 0;(g) 子卡隐藏不影响轮询与审批。发现 Critical/Important → 修完复审再谈合并。

---

## Self-Review

**Spec coverage(storyboard spec §4 闸① 行 + §7 修正 + §8)**:聚合审批 ✅(Task 2 prepare + Task 4 确认循环);单帧重出 ✅(regen 铸新子卡,§7 "重出=再铸一张");firstFrameGenerationId 写回 ✅(Task 3,按 shotId 定点);pack-credit-math 复用 ✅(canAffordPack;总额由 action 算自 buildProposeCard 的 estimatedCredits);money-review ✅(Task 5);子卡回链 {storyboardCardId, shotId} ✅;禁复合 key ✅(Global Constraints + 测试无此形状)。
**Placeholder scan**:Task 2/3 的测试/实现给的是**结构说明+硬性断言清单**而非全文——这是有意的(money-adjacent 代码必须对着真实签名写,seam 报告已给出 file:line;实现者被要求先读 buildProposeCard/buildOttoContext/data.ts 再落码,且断言清单一条不许少)。其余步骤代码完整。
**Type consistency**:`ChildFrameCard` 在 Task 2 定义、Task 4 消费;`firstFrameCardId` 贯穿 Task 1→2→3→4;action 返回 `{...}|{error}` 风格与 F3 一致。
**Money-safety**:见 Global Constraints;花钱面 = 现有 `coworkGenerate` × 用户显式确认,服务端零新花钱代码。

## 相关文件(seam 报告 2026-07-02,Explore 提取)

铸卡:`packages/otto/src/skills/propose.helpers.ts:93-229`(buildProposeCard)、`propose-pack.ts:46-108`(N 卡循环先例)、`cowork-actions.ts:655-701`(coworkVaryCard 重出先例)。花钱:`cowork-actions.ts:497-619`(coworkGenerate 输入面 + `cowork:${cardId}` once-EVER 守卫:523-527)。聚合:`PackCard.tsx:76-116`(makeAll 顺序循环)、`pack-credit-math.ts`。隐藏:`OttoChatStream.tsx:640-663`(pack pre-pass)。写回:`apps/worker/src/jobs/gen.ts:130-157`(GEN_RESULT 形状)、`apps/web/lib/data.ts`(urlsByJob URL 解析)。F3 模板:`storyboard-actions.ts`(owner-scoped loadCard/persist)、`storyboard-gate1` 测试 mock 风格:`__tests__/storyboard-actions.test.ts`。
