# Brand memory 重建 — 设计 spec

日期：2026-07-02 · 分支：`claude/brand-memory-rebuild`（off main `e61722f`）
状态：**已被升级** · mockup：`~/Desktop/brandmem-rebuild-mock.png`

> ⚠️ **2026-07-02 升级**：分类法已重设计并拍板 —— 见
> `2026-07-02-brand-memory-taxonomy-fable-design.md`（§5 拍板结果）。
> 本 spec 的「4 分区 / category 枚举 / 零新表」部分以该文档为准
> （6 分区；枚举 → `about|look|rules`；活集合存新 BrandRecord 表 = 拍板 C）。
> 聊天置顶、自动生效+可撤销（方案 A 机制）、徽章、钱路条款等其余部分**继续有效**。

## 背景 / 目标

现在 prod 的 Brand memory 是「聊天优先」：Research-URL 卡 + Chat 卡 + 底下一条平铺列表。
跟 approved 设计（**分类的品牌事实库**）不一致。创始人方向（2026-07-01 定）：

> 回到 approved 事实库，上面加对话框；user 让 OTTO 学习，OTTO 改的时候
> **实时**看到下面的事实卡片也在变；OTTO 和 user 都能编辑。

### 已锁定的决策
1. **布局** = approved 事实库（分区卡片 + 徽章）+ 置顶对话框。
2. **联动** = OTTO 自动实时生效、**可撤销**（不做逐条人工确认 —— 品牌事实不涉及花钱，自动改安全）。
3. **实现档位** = 方案 A「每轮刷新 + 高亮」（真·逐条流式 = v2）。
4. **开放点 ①（已定）** = Research-my-site 做成对话框里的 **chip**（点了走现有 researchWeb），不做独立卡片/横幅。

## 现状盘点（grounding，main `e61722f`）

**引擎全在，无需建新表：**
- `apps/web/lib/memory-actions.ts`：`addMemory / updateMemory / deleteMemory / listMyMemory / getBrandContextText`（5 个导出）。`MemoryRow = { id, category, content, source:"otto"|"user", pinned, updatedAt }`。
- `packages/otto/src/skills/remember-brand-fact.ts`：OTTO 写事实的技能，`source="otto"`。
- 当前 `OttoMemory.tsx` **已经有**：memory 列表 state + CRUD + 内联编辑、以及一个 brand chat（`Bubble[]` + `brandThreadId`）。

**所以这是「重排 + 打磨」，不是从零建。** 复用它的 state/CRUD/chat，改的是**版式 + 分区 + 徽章 + 高亮 + 撤销**。

## ⚠️ 要解决的一个真问题：category ↔ 分区对不上

- OTTO 技能现在的 category 枚举：`["Brand","Voice","Audience","Products","Rules"]`。
- approved KB 的 4 个分区：**About the brand / Look & feel / Your customers / Do & don't**。
- **「Look & feel」（颜色/风格）在现有枚举里没有对应** → 直接映射会永远空。

**解决方案（本 spec 采用）**：把事实的分组改成 approved 的 **4 个分区**，作为唯一真相。
- `remember-brand-fact` 的 category 枚举改为 4 个 section key：`about | look | customers | rules`
  （prompt 里给 OTTO 明确 4 选项 + 各自含义，让新事实落对分区）。
- **旧数据映射**（读时 + 一次性）：`Brand/Voice/Products → about`、`Audience → customers`、`Rules → rules`、其它 → `about`（认不出的兜底）。`look` 分区初始为空，等 OTTO/user 补。
- UI 用固定 4 分区渲染；每分区标题 12px/600/+0.05em/uppercase/muted（Analytics 基准）。

## UI 结构（对齐 Analytics 基准）

```
Brand memory                                     ← h1 24px/700/-0.02em
What OTTO remembers… uses this on every campaign. ← sub 15px muted

┌ 🐤 Chat with Otto about your brand ───────────┐ ← panel 卡 radius 16
│ [Describe my brand][My ideal customer]         │   起手 chips
│ [My brand voice][Research my site ↗]           │   ← ① Research = chip
│ [输入框 ……………………………] [↑]              │
│ Chatting uses a little credit. Otto edits the  │
│ facts below live — you can undo.               │
└────────────────────────────────────────────────┘

（OTTO 改动后出现）
🐤 OTTO updated your brand memory — 2 added, 1 changed.   [Undo]
   ← coral-soft 条，样式同 Analytics insight 条；~几秒/切走后消失

ABOUT THE BRAND
┌────────────────────────────────────────────────┐
│ Voice: …            [✦ OTTO learned]   ✎ 🗑    │ ← 事实行 14px/1.45
│ What you sell: …    [You added]        ✎ 🗑    │   徽章从 source 来
│ + Add a fact                                    │
└────────────────────────────────────────────────┘
LOOK & FEEL · YOUR CUSTOMERS · DO & DON'T          （同上）
```

- 徽章：`source==="otto"` → coral-soft「✦ OTTO learned」；`"user"` → 灰「You added」。
- 刚被 OTTO 新增/改的行：coral-soft 底 + 左侧 3px coral 竖条，~4s 淡出。
- ✎ = 行内 textarea 编辑 → `updateMemory`（存后 source 变 user，改过即用户的）。🗑 = `deleteMemory`。「+ Add a fact」= 分区内联新增 → `addMemory`（category = 该分区）。

## 实时联动 & 撤销（方案 A 机制）

1. 发消息前：前端 snapshot 当前 `MemoryRow[]`。
2. OTTO 这一轮流收尾 → refetch `listMyMemory()` → 纯函数 `diffMemory(snapshot, fresh)` 算 `{added, changed, removed}`（按 id + updatedAt）。
3. diff 非空 → 高亮变化行 + 顶部撤销条。
4. **Undo = 反向应用 diff**：added → `deleteMemory`；changed → `updateMemory`(旧文)；removed → `addMemory`(旧行)。页面内 state，切走即失效（v1 接受，不做持久化撤销栈）。

## 新建 / 改动清单（薄）

| 类型 | 内容 |
|---|---|
| 改（引擎，小） | `remember-brand-fact` category 枚举 → 4 section key + prompt 更新 |
| 新（纯函数，TDD） | `memory-sections.ts`：`SECTIONS` 常量、`categoryToSection(cat)` 映射（含旧值兜底）、`diffMemory(before, after)`、`invertDiff(diff)`（撤销用） |
| 改（UI） | 重写 `OttoMemory.tsx`：chat 置顶 + 4 分区事实库 + 徽章 + 内联编辑 + 高亮 + 撤销条（复用现有 state/CRUD/chat） |
| 确认/接线 | brand chat 的 OTTO run 里必须有 `remember-brand-fact` 技能才能"自动改事实"（现在的 brand chat 可能只研究不写）—— build 第一步确认，缺则接上（这是"OTTO 实时改"能成立的前提） |
| 数据 | 旧 category 读时映射（无破坏性 migration；不动库结构） |

## 钱路（BINDING）

- 聊天轮 = 现有 otto 花费门（thinking credit），**零新增花钱路径**。
- 事实 写/改/删 全免费（现状即免费）。
- 冻结文件全程不碰；每次提交跑 money-guard（`git status` over spend 路径 = 空）。

## 测试 / 验收

- **TDD 纯函数**：`categoryToSection`（含所有旧值 + 未知兜底）、`diffMemory`（增/改/删/无变化）、`invertDiff`（三种反向操作）全覆盖。
- **视觉**：`/skin-preview?view=memory`（已有 mock memory 数据）截图 vs mockup 同比例（1×）对比。
- **手动主线**：聊一句 →（mock 下）看到卡片高亮出现 → Undo 回退 → 手动 ✎ 编辑一条 → 徽章变 You added → 每分区「Add a fact」可用。

## 不做（YAGNI）

- BrandKit/BrandRule 不并入（继续做 agent 上下文层，跟本 KB 解耦）。
- 逐条流式冒卡（方案 B）→ v2。
- 撤销栈持久化 / 跨会话历史。
- Teach-OTTO 上传照片学习 → 后续。

## 隔离 / 边界（单元职责）

- `memory-sections.ts` = 纯逻辑（映射 + diff + 撤销计算），无 IO，可独立测。
- `OttoMemory.tsx` = 纯展示 + 编排，所有写操作走已有的 `*Memory` server actions（不新增 action）。
- `remember-brand-fact` = OTTO 侧唯一写入口，改的只是它的 category 词表。

三个单元各自「做什么 / 怎么用 / 依赖谁」都清晰、可独立理解与测试。
