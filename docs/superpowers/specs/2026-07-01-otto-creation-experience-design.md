# Otto 创作体验设计 —— 意图 → 分镜 → 执行

**状态：** 设计已与创始人对齐（brainstorm 完成 2026-07-01）。下一步：按 build 顺序，对第 1 块（`clarify` + `requires`）走 writing-plans 出实现计划。

**语言约定：** 本文件及后续 skill 文档一律用华语写，方便创始人复审（`structuredPrompt` 生成 prompt 仍须英文，因为图/视频模型是英文调优的）。

---

## 0. 在整体 roadmap 的位置

本 session 的大目标：让 Otto 变"聪明"——**广度 + 质量**，覆盖整条营销链路。创始人拍板的顺序：

1. **创作（本文件）** ← 现在做
2. 搜索 / 研究（联网搜索缺 API key）
3. 发布 / 渠道（卡在 Meta App Review + 重连）
4. 运营 / 优化

原则：**每个 skill 走独立的 brainstorm，追求质量与细节**，不做浅扫。本文件是"创作"这个子项目的主设计（master spec），它自身再拆成 A–G 若干块，逐块细化实现。

---

## 1. 目标流程（创始人原话提炼）

```
用户说"otto，帮我给产品做个广告"
   │
   ▼
① 刨根问底（clarify）── 硬门：必要资讯没齐，不往下走
   │   · 先读已注入的 brandbrain / 对话历史 → 只问缺的
   │   · 每个 skill 用 requires 声明"我需要哪些资讯"，Otto 才知道要问什么
   │   · 例外放行：用户明说"不需要"或该资讯"没有"
   ▼
② 出分镜（proposeStoryboard，$0 文字）
   │   · 有序镜头；每镜头 = 首帧 prompt(Seedream) + 视频 prompt(Seedance)
   │   · 复用遗留 CoworkPlan 的 schema 形状（scenes → 有序 shots → 每 shot 一个 prompt）
   │   · Otto 判断这条广告需不需要"连贯"（末帧接首帧）
   ▼
③ 闸① 生成首帧图预览（Seedream，便宜）── 单独审批
   │   · 用户看到「文字 + 真实首帧图」→ 逐帧可改 / 重出某几张
   ▼
④ 闸② make all 视频（Seedance，贵）── 总审批
   │   · 不连贯 → 首帧并行、一次做完
   │   · 连贯 → 顺序链式（末帧→下一首帧），逐镜头确认（"聪明化"）
   ▼
交付 N 个独立成片（拼接成一条成片以后再说）
```

这是创始人认为的**最低质量线**。核心洞察：Otto 的"聪明"一半在**流程**（会问、会规划、会执行），一半在**prompt 质量**（精通 Seedance/Seedream 各自喜欢的 prompt 风格，甚至从模型偏好反推执行方式）。

---

## 2. 现状（研究结论摘要，2026-07-01 codegraph + workflow 调研）

**追问 / 意图感知：** 目前没有结构化的"先问后做"机制。追问是 LLM 的涌现行为，只被 prose 轻推：
- 唯一显式的"提案前先问 2–3 个问题"规则只在 `ottoSimpleModeBlock`（`packages/otto/src/instructions.ts:6-11`），且只在 simple 模式注入。
- 默认身份 + "何时调 propose"反而推 Otto **直接narrate + 提案**（`instructions.ts:15-26`）。
- 最接近脚本化访谈的是 `GOAL_PRESETS`（`packages/core/src/goals.ts:6-33`），但一次性（只在新 thread 注入）、按 goal 而非按 skill、且纯建议（不校验答案就 propose）。
- **好消息：ask→等回答→continue 的多轮循环是原生免费的。** Otto 回一句纯文字、不调工具，本轮 `run()` 干净结束 → `finalizeOttoRun` 记 `done`、`RunState` 序列化进 `ChatThread.ottoState`；下一轮 `ottoTurn` rehydrate 历史 + 追加新用户消息（`apps/web/lib/otto-actions.ts:430-439`）。**多轮访谈零新增管道**——缺的只是"告诉 Otto 问什么、何时先别急"的脚手架。

**分镜 / pack 现有地基：** 两套互不相连的系统：
- **遗留 cowork 分镜** —— `draftStoryboardSkill`（`packages/core/src/cowork-skills.ts:59`）产出 `CoworkPlan = { scenes: [{ title, shots: [{ prompt }] }] }`（`packages/core/src/cowork.ts:69-88`，带 Zod 校验 + 上限）。**形状正是目标要的"scenes → 有序 shots → 每 shot prompt"**，但它不是 Otto agent skill（不在 `allSkills`），唯一调用方把 shots 写进遗留 STUDIO 的 `Shot` 表，无 live UI 引用。
- **现役 Otto 卡片系统** —— `propose`（$0，一个 `GEN_CARD`）+ `proposePack`（$0，1–8 张卡）。`proposePack` 是**扁平袋**：每项是独立 `propose` 卡，只共享一个 `packId`/`packTitle`，**无镜头顺序、无场景分组、无关键帧联动**。`CardPayload.structuredPrompt` 本身就是"每镜头 prompt"；`forVideo`/`videoStep` + `sourceGenerationId` 已能在**单卡内**建模 图→视频 链。

**参考图/视频上传：** 见 §3。

**生成后端：** 只有两种产物——IMAGE（t2i 或 参考图条件编辑；1–4 张变体）和 VIDEO（t2v / i2v / i2v-tail；**永远 count=1**，一 job 一段）。一个 `GenJob` = 一个 prompt = 一批图 或 一段视频。**无多镜头入口、无拼接步、无批量花钱。** 钱路是"一 job 一次 provider 调用"，原子 reserve/settle；`generate` 幂等键按卡 `cowork:${cardId}`。视频宽高比仅 16:9 / 9:16。

---

## 3. 参考上传的判定（创始人明确问的）——已 spin off

| 情况 | 判定 | 说明 |
|---|---|---|
| (a) @提及已有实体 | ✅ 有 | 两个 composer 都有；`entityIds` → `loadAvailableRefsForAgent` 注入 `@name [type,id]` |
| (b) 聊天里上传新图/视频 | ⚠️ 部分 | **图片：只在流式 `OttoChatStream` 有**；**视频：完全没有**（accept + `sourceGenerationId` 校验都限图片扩展名）|
| (c) 用历史生成图作源 | ✅ 有 | `sourceGenerationId` 全链路打通 |

**总的坑：** 即使有附件，**live 路径里 Otto（规划者）也看不到像素**——`runInput` 是纯文字，附件只作为 id 进 `OttoContext` 供工具用。唯一的"图像喂给模型"代码在**已死的** `coworkTurn`。

**结论：** 真正的"Canva 式拖任意图/视频进来、且 Otto 能看懂内容"不完整。这与创作核心正交，**已开独立 session 做**（chip `task_21c8587b`，创始人已在另一 session 启动）。三块：① 上传 UI 补齐到非流式 surface；② 视频作参考（需放宽校验 + provider 视频条件路径）；③ 把像素喂给规划者（复活 `coworkTurn` 的图像收集）。**软依赖：** 若分镜要"视觉上匹配"用户拖入的参考图，第 ③ 块是质量前提。

---

## 4. 完整设计（方案 B：最小框架改动）

架构原则：**层在 runtime 之上，不动 `@openai/agents` 的 agent loop，不动钱路，不动 seam。** 唯一的框架改动是 `OttoSkillSpec` 加一个可选字段。

### 4.1 组件清单 + gate 分类 + 框架改动

| # | skill / 组件 | 作用 | cost/effect/reach → gate | 框架改动 |
|---|---|---|---|---|
| **A** | `requires` 字段 | 每个 skill 声明所需资讯（`{ field, question, canAutofill? }[]`） | —（框架层）| **OttoSkillSpec 加一个可选字段**（本设计唯一的框架改动）|
| **B** | `clarify` skill | 出结构化问题卡、刨根问底 | free / write / internal → 不审批 | 复用 `propose` 的"写卡片"模式（**不用** SDK interrupt）|
| **C** | `recallBrandFact` skill | Otto 察觉缺资讯时去 brandbrain 定向查 | free / read / internal → 不审批 | 复用现有 `brandBrain` port |
| **D** | `seedancePrompt` skill | 精通 Seedance 视频 prompt 风格 | free / read / internal → 不审批 | 借 `seedance-prompt-skill` 模板 |
| **E** | `seedreamPrompt` skill | 精通 Seedream 图像 prompt 风格 | free / read / internal → 不审批 | 加模型 = 加这类 skill（模块化）|
| **F** | `proposeStoryboard` + `STORYBOARD_CARD` + 逐帧编辑 UI | 出可编辑的有序分镜 | free / write / internal → 不审批 | 新卡片类型 + 编辑 UI |
| **G** | executeStoryboard 编排（两道闸 + 连贯模式）| 照 script 执行 | **不是新的花钱 skill** | **钱路不动**——循环调用现有 `generate` |

### 4.2 关键机制

**追问硬门（A + B + C）**
- **硬拦截**：`requires` 里的每个字段必须满足，否则 Otto 不出分镜 / 不执行。**例外放行**：用户明说"不需要"或该资讯"没有"（每字段可被用户显式豁免）。执行时用 `execute` 内的自检返回"缺资讯"来兜底，不只是 prompt 引导。
- **资讯来源经由 skill 处理**：Otto 发现缺资讯时，先看已注入的 brandContext，再调 `recallBrandFact` 去 brandbrain 定向查，仍缺的才用 `clarify` 问用户。
- **wait/continue 免费**：clarify 不用 SDK 的 needsApproval interrupt（那是给花钱/外部写的）；它就是一张 `QUESTION_CARD` + 用户答案作为下一轮用户消息回流。

**分镜（F）**
- 新 `STORYBOARD_CARD`，payload 为**有序**结构：`{ shots: [{ index, title, firstFramePrompt, videoPrompt, keyframeGenerationId?, continuity? }] }`，起点复用 `CoworkPlan`/`coworkPlan` 的 Zod 形状。
- 每镜头展示：首帧 prompt + 视频 prompt +（闸①后）真实首帧图。
- 逐帧可编辑（typed edits：改/换/删某一帧，而非整体重写——借 SkillOpt 的 typed-edit 纪律）。
- **连贯性感知**：Otto 判断这条广告需不需要 末帧→首帧 链接。

**执行（G）—— 两道闸**
- **闸①**：生成 N 张首帧图预览（Seedream，便宜）——单独审批。用户看图 + prompt → 逐帧改 / 重出某几张。
- **闸②**：make all 视频（Seedance，贵）——总审批。
- **不连贯**：所有首帧并行出 → 一次 make all。
- **连贯**：无法一次并行（下镜头首帧 = 上镜头末帧，得等上镜头视频做完）→ **顺序链式、逐镜头确认**（`sourceGenerationId` / i2v-tail 已有原语）。Otto 智能选模式。
- **交付**：N 个独立成片；拼接成一条成片以后再说（后端目前无 concat）。

**Money-safety（硬约束）**
- 真正花钱的只有现成的 `generate`（幂等键 `cowork:${cardId}`）。闸①闸② 都是 fan-out 去调它，**钱路一行不改**。
- **不做**"单个批量花钱 skill"——那会撞 3 字段 gate 的"`spend` ⇒ 一个 `idempotencyKey`"规则（一个 key 无法覆盖 N 个不同生成）。批量执行是编排/UI，循环 per-card `generate`。
- G 块碰花钱路径（即使只是循环），实现时走 money-safety review。

---

## 5. 借鉴的 3 个外部 repo（只取可迁移的）

- **`seedance-prompt-skill`（最贴近）：** 4 步流程「意图 → 必问参数（如时长必问）→ 逐镜头首/尾帧各自独立的图像 prompt → 提炼」几乎就是目标流；**衔接点（上镜头末态 = 下镜头初态）**正是连贯执行的依赖契约；若 Otto 用 Seedance/即梦，其 prompt 模板、@引用规则、分段策略、镜头/风格词汇可**直接作内容复用**（→ D/E 块）。
- **`Agent-Reach`（结构层）：** 声明式"这个能力需要多少 setup"字段 → `requires` 的形状类比；带主/备的 provider 列表 + 健康探测（doctor）纪律；SKILL.md 的触发契约模板（MUST USE / NOT for / 别瞎猜）。
- **`SkillOpt`（seam 验证）：** `get_reference_metadata` 式的"每 skill 声明所需元数据"验证了 `requires` 模式；typed `Edit`/`Patch`（带出处、有界）优于自由重写 → 分镜逐帧编辑应是 typed ops；`evaluate_gate` 作纯 accept/reject 函数（Otto 的 gate 已是这个形态）。忽略其离线训练/benchmark 部分。

---

## 6. Build 顺序（一次一块，每块单独细化）

1. **A + B + C**（`requires` + `clarify` + `recallBrandFact`）→ 立刻兑现"刨根问底"北极星，独立可上，最小改动。← **先做这块**
2. **D + E**（Seedance/Seedream prompt 精通）→ 提升质量，现有 `propose` 马上也受益，低风险。
3. **F**（`STORYBOARD_CARD` + `proposeStoryboard` + 编辑 UI）→ 依赖 1、2。
4. **G**（两道闸执行 + 连贯模式）→ 依赖 3，碰花钱路，走 money-safety review。

---

## 7. 未决 / 后续

- **首帧图"预览档"**：闸① 用正式 Seedream 生成还是有便宜的低清预览档？（待确认 Seedream 是否有便宜档；无则用正式生成的最小规格）
- **prompt 精通 skill 的主动/被动形态**：D/E 是被动知识注入（Otto 自己写 prompt 时参考）还是主动"打磨/校验"工具（Otto 起草 → 按模型偏好重写）？实现细化时定，倾向：注入为主 + 可选校验步。
- **连贯性判定的具体规则**：Otto 依据什么判断"需要连贯"（用户明说 / 广告类型 / 镜头语义）——细化 G 时定。
- **参考上传第 ③ 块（多模态喂规划者）** 若要分镜视觉匹配拖入参考图，是软前提；跟踪 `task_21c8587b`。

---

## 8. 相关文件（绝对/相对路径）

- 指令 / 追问 seam：`packages/otto/src/instructions.ts`、`packages/core/src/goals.ts`
- 框架：`packages/otto/src/skill.ts`、`registry.ts`、`otto.ts`、`context.ts`、`skills/AGENTS.md`
- 卡片 / pack / 分镜：`packages/otto/src/skills/propose.ts`、`propose-pack.ts`、`propose.helpers.ts`；`packages/core/src/cowork.ts`、`cowork-skills.ts`
- 轮次 / 花钱：`apps/web/lib/otto-actions.ts`、`apps/web/lib/gen-actions.ts`、`packages/otto/src/skills/generate.ts`
- 参考 / composer：`apps/web/components/otto/OttoChatStream.tsx`、`OttoConversation.tsx`、`PackCard.tsx`；`apps/web/app/api/otto/stream/route.ts`
- 后端：`packages/core/src/gen.ts`、`packages/generation/src/index.ts`
