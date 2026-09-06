# 死代码清单(2026-07-04)—— 已清 + 待 founder 批准清

> 来源:三问评估(21-agent,对抗验证)确认的冗余项。本 PR **只删了无歧义、无纠缠、可被
> 绿灯证明安全**的部分;其余每一项都带一个真实的"纠缠/风险",不适合无监督批量删除 ——
> 列在这里,由 founder 或一个聚焦的后续 PR **逐项显式批准**再动。
>
> 判断原则:删除是不可逆的(尤其 schema 删表推 main = 自动改 prod 库);playbook 明确
> 警告"看似死实为承重"。0 静态 import 对 Next.js `"use server"` 模块不等于"绝对安全"
> (存在动态调用路径)。所以本清单的纪律是:**证据 + 风险级 + 建议的安全删法**。

---

## ✅ 本 PR 已删(证据充分、绿灯全过)

| 项 | 行数 | 证据 |
|---|---|---|
| `demo-remotion/` | 整目录 | Fikirtive 时代营销视频脚手架,在 pnpm workspace 之外;仍存活的生产 QA 脚本已改为运行时生成稳定 PNG fixture |
| `apps/web/lib/brand-actions.ts`(+ test) | ~237 | 0 importers + 0 UI 函数名引用;brand memory v2 实际走 `brand-record-actions.ts`(BrandRecord),此为 v1 遗留(BrandKit/BrandRule) |

> ⚠️ **BrandKit / BrandRule 表本身不可删。** brand-actions.ts 只是它们的**死写入者**(UI CRUD),
> 但 `getBrandContextText`(memory-actions.ts:114/118)仍**活读**这两张表喂 Otto 上下文。删写入者
> 安全(现有行照读),但**这两张表不在可删 schema 清单里** —— 别误把它们当死表 DROP。
| `apps/web/lib/brand-research.ts` | ~152 | 0 importers + 0 UI 引用;pre-Otto 品牌调研,已被 Otto `researchWeb` skill 取代 |
| `apps/web/lib/dnd.ts` | ~52 | 0 importers |
| 7 条 parity manifest 条目 | — | 上述已删 action 的 stale 映射 |

清理后:typecheck 0 · 全量测试全绿 · parity OK · schema 漂移闸 exit 0。

---

## ⏸️ 待 founder 批准清(每项的纠缠说明为什么不在本 PR 里删)

### 1. 5 个 UI-dead 的 cowork server action(`apps/web/lib/cowork-actions.ts`)
`coworkTurn`、`enhancePrompt`、`coworkDraftStoryboard`、`coworkRenameThread`、`coworkDeleteThread` —— 路由/组件层 0 引用,其中 `coworkTurn`/`enhancePrompt` 会跑**付费 LLM**且是 `"use server"` 导出(理论上任意已认证客户端可 POST 调用,是一个死的付费面)。
- **死活已确证(2026-07-04 phase-2 调查)**:5 个函数全部 0 真实调用。两处看似引用是假阳性 ——
  `otto-actions.ts` 引的是 `coworkTurnRequest`(**LIVE schema,同前缀不同符号,删函数时绝不能碰**)
  + 一句注释;`cowork-knowledge.ts` 是一句注释。
- **helper/import 归属已测绘(可直接照做)**:`refImageDataUrl`/`loadAvailableRefs`/`quotedKindLabel`/
  `quotedPreview` 仅被 `coworkTurn` 用 → 随删;`getTransport` 仅被这 3 个死函数用 → 删该 import;
  **`getEnhanceDirective`/`familyHasPromptSkill` 被 LIVE 的 `coworkGenerate`(:578)共用 → 保留**。
- **为什么仍未删**:这 5 个死函数与**钱路核心** `coworkGenerate`(唯一的 cowork→startGen 付费入口)
  同处一个 789 行热文件,且该文件正被并发 agent 编辑。在紧挨钱路的地方做 350 行非连续外科抽取,
  一处错手风险等级 = 动钱路。**收益(死付费面清理)配不上这个风险**(安全 > 效率)。
- **安全删法(基础已打好)**:待该文件安静时,单独聚焦 PR,按上面的 helper/import 映射逐个删 +
  删 `money-safety-review/SKILL.md:41`(它为死的 `coworkTurn` 维护不变量,是"法律层漂到死代码"的实例)
  + 删对应 parity 条目;每步 typecheck+全量 test 绿,末尾对抗审查确认 `coworkGenerate` 未被触碰。

### 2. core 的 pre-Otto planner 模块(`packages/core/src`)
`cowork-coach`、`cowork-planner`、`cowork-skills`、`cowork-transport`。
- **消费者已逐符号测绘(2026-07-04 phase-2 调查)—— 有 LIVE 触手,不可整簇删**:
  - `cowork-planner.buildPlannerMessages` 被 **`apps/web/components/admin/KnowledgeAdmin.tsx` 消费**
    → 若 KnowledgeAdmin 活着,cowork-planner 就活着(先判 KnowledgeAdmin 死活:它 0 route 引用,
    但需确认没被其他 admin 组件间接引用 —— 这本身是一个待解的子问题)。
  - `cowork-transport.createTransport` 被 **`runtime-config.ts` 消费**(admin `cowork_provider` 开关)
    → 删 transport 须先删这条配置链的 UI + config。
  - 真正 0 消费者的只有:`lintPrompt`/`looksLikeTagSoup`/`countMotionCues`(coach)、
    `runSkill`/`draftStoryboardSkill`/`enhancePromptSkill`(skills)、`COWORK`(planner)。
- **安全删法**:先判定 KnowledgeAdmin 与 cowork_provider 开关的死活(各是一个独立判断)→ 再决定
  哪些能删。**不是整簇一刀**,而是先解两个子问题。

### 3. `apps/web/lib/studio-actions.ts`(~160)
0 file-importers,但 `addShot`/`deleteShot` 在 1 个 UI 文件出现(疑似与 `actions.ts` 同名函数**撞名**)。
- **纠缠**:名字歧义未解 —— 删前必须确认那处 UI 引用的是 `actions.ts` 的同名导出,不是 studio-actions。

### 4. Admin v1 组件(`apps/web/components/admin/*`,~1100 行,10/12 孤立)
#131 dashboard v2 同日取代但未删。
- **纠缠**:仍被 `apps/web/app/skin-preview/admin/page.tsx`(dev-only、prod 404 的抛弃页)引用 —— 删组件须同改 skin-preview。

### 5. Schema 死表(需**破坏性迁移**,推 main 自动改 prod 库)
`GenerationBatch`、`TemplateBundle`(均 0 读 0 写)、退役的 NextAuth 三表(`Account`/`Session`/`VerificationToken`)、`sweep` 队列(建了无 handler/producer)、`ScheduledPost.projectId`(写错值从不读)。
- **纠缠 = 最高风险**:从 schema.prisma 删 model 会生成 `DROP TABLE` 迁移 → **推 main 自动对 prod 执行,不可逆**。虽表为空,仍应 founder 显式签字。本 PR 新增的破坏性迁移闸会要求该迁移带 `-- DESTRUCTIVE-OK: <理由>` 确认 —— 正是为这一步设的。
- **安全删法**:单独 PR,founder 明确批准,迁移带 DESTRUCTIVE-OK,合并前在 prod 快照(PITR)已开的前提下做。

---

## 一句话
本 PR 清掉了 ~440 行零风险死代码;真正的大头(cowork 簇、admin v1、schema 死表)每一块都
连着一根活线或一次不可逆的 prod 操作,值得你按上面的"安全删法"逐项批准 —— 而不是一次
bulldozer。需要我做其中哪一块,说一声,我按对应安全流程走。
