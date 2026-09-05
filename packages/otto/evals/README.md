# Otto 评测基线（ENGINE-A1 的骨架）

**跑之前先读这一段。** 本机跑评测（以及本机跑 Otto）**一律** `env -u ANTHROPIC_BASE_URL <命令>`：
`ANTHROPIC_BASE_URL` 在仓库 `.env.local` 与 agent 的 shell 环境里**都有值**，带着它调 Anthropic 一律 404，
症状看起来像「型号不存在」，2026-09-03 有人因此去改型号常量（改错方向）。
本 runner **不加载仓库 `.env.local`** —— 它只读已经在 shell 里的 `process.env`，那一行永远进不来；
并且开跑前会亲自检查一次：`ANTHROPIC_BASE_URL` 有值就拒跑，不会先花钱再失败。
（规格出处：`docs/specs/otto-engine.md` §7.7。）

## 怎么跑

```bash
cp /path/to/主检出/.env.local .           # 只为拿 ANTHROPIC_API_KEY
set -a; . .env.local; set +a
env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals        # 跑一次，写档案
env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals:check  # 重跑并比对基线，回归即非零退出
```

哪一条线由 `--line=engine|creation` 决定，**缺省 `engine`**（本规格自己的那条）。pnpm 传参要加 `--`：

```bash
env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals -- --line=creation
```

题目从 `tasks/<line>/` 装载、档案写 `baselines/<line>.json`，两条线共用这一个 runner。
题里的 `line` 字段必须与它所在的目录一致——对不上就当场炸，不会静默写进另一条线的档案。

`evals:check` **要花钱**（它会真的重跑一遍），所以它不是 CI 闸，只在人手里跑 ——
⑥段（技能文件柜替换单体）落地后重跑它，就是那一段「总分不低于基线」的判据。

## 基线已入档（2026-09-05）

`baselines/engine.json` 是 engine 线的第一份基线：日期、commit sha、型号、逐题分（含产物与每一条判词）、
总分与真实花费都在里面。它就是 ⑥段「不低于基线」的比较对象 —— 重跑用 `evals:check`。

（在它存在之前，`evals:check` 会**在开跑前**、不花一分钱就明说「没有基线可比」并非零退出：它不会假绿，
也不会先烧掉一整趟钱再告诉你。这条守卫仍在，Creation 那条线今天正处在这个状态。）

## 预算

**两道闸，都是真的，都在花钱之前**（`docs/specs/otto-engine.md` §7.7）：

1. **本段累计 $20**（`core.ts` 的 `SEGMENT_BUDGET_USD`）：**开跑之前**把 `baselines/spend.jsonl`
   这本**只追加、不覆盖**的花费账本里**每一行**的 `costUsd` 加起来，再加上本次全跑的最坏花费，
   超过 $20 就**拒跑** —— 一分钱不花、非零退出。每成功跑一趟（写档案或 `--check`，两者都花钱）
   就往账本追加一行，所以「累计」是真累计：跑三趟记三趟的钱。
   （账本与 `baselines/<line>.json` 是两件事：后者是**最近一次**的跑分档案，每跑一次就被整份覆盖，
   拿它求和只算得到每条线最后那一趟。）
   本次最坏花费按「每题一次被测调用 + 有 rubric 的再按判分重试一次算两遍」估，并被下面那道 $10 截住。
2. **单次全跑 $10**（`FULL_RUN_BUDGET_USD`）：**每次模型调用之前**过一次，
   已花的 + 这一次的最坏情况超过上限就**就地停**并非零退出。

花费按真实 token 用量 × `@fikirtive/core` 的价目表算，写进档案的 `costUsd`。
开跑前的那几道守卫（环境、有没有基线可比、累计预算）由 `runner.ts` 的 `preflight` 判、`guardedRun` 执行，
而 `main()` 的**接线**本身抽成了 `runMain({ preflight, runEvals })`：两件事都是闭包，谁先谁后由它一个函数说了算。
所以「守卫在花钱之前」是结构上的事实，不是注释里的说法 —— 回归测试钉的正是 `runMain`：
把它改成先跑后判，测试当场红。

## 回归判定的噪声容差

`evals:check` 比对总分时留 **±5 个百分点**（`core.ts` 的 `REGRESSION_TOLERANCE_POINTS`）：
判分器对同一份产物两次跑不一定给同一个分（`engine-6` 那 1 分就这么浮动过），
一题 4 分、共 10 题，一个维度抖一档就是总分 1.25 个百分点 —— 按「低一点点就是回归」判，
报的是噪声不是回归。低于基线**超过**这一格才算真回归。

要更严就自己给：

```bash
env -u ANTHROPIC_BASE_URL pnpm --filter @fikirtive/otto run evals:check -- --tolerance=0
```

`--tolerance=` 收一个 ≥0 的百分点数；`0` 就是旧口径（低一点点也算回归）。
不做「多跑取中位」——那要花好几倍的钱，登记在 `docs/specs/otto-engine.md` §5 等有必要再说。

## 目录

```
evals/
├── README.md        ← 本文
├── judge.md         ← 判分标准（单一权威；engine 与 creation 两条线共用一份）
├── tasks/
│   ├── engine/      ← 本规格的营销任务（ENGINE-A1 基线；缺省的那条线）
│   └── creation/    ← Creation 的题（creation-engine.md 批 III 自己填，跑法 --line=creation）
├── checks/          ← 机械检查注册表（纯函数）
├── baselines/       ← 跑分档案（JSON：日期、commit、型号、逐题分、总分、花费）＋ spend.jsonl（只追加的花费账本）
├── core.ts          ← front-matter 契约、判分、预算闸（纯函数，测试跑它零成本）
├── run.ts           ← 跑一遍（subject 与 judge 都是注入的）
└── runner.ts        ← tsx 入口：真调用、写档案、--check
```

`evals/` 在包根，**不在** `packages/otto/tsconfig.json` 的 `include` 里 —— 与 `packages/otto/scripts/` 同样经 `tsx` 跑，不进 `dist`。

## 怎么加一题

一题一文件，`tasks/<line>/<id>.md`，front-matter 五个字段（两条线共用同一份契约）：

```markdown
---
id: engine-1
line: engine
prompt: 商家自己会打出来的那句话，一行写完
checks:
  - mentions-all:seedreamPrompt,propose
  - forbids:Campaigns
rubric:
  - 判分维度一（机械检查判不了、要人/模型看的那种）
---

这一题为什么这么出（给人读的，runner 不认得这一段）。
```

- `id`：逐字等于验收编号，或 `<line>-<n>`。
- `checks`：`checks/index.ts` 注册表里的名字，可带 `:参数,参数`。名字拼错＝当场炸，不会静默满分。
  `forbids` **按词边界**判（`extended` 不算命中 `extend`）；`mentions-all` / `mentions-any` 仍是子串
  （它们判的是「有没有提到」，宁可宽一点）。
- `rubric`：**只写机械检查判不了的事**。机械检查判得了的分永远不进模型（省钱，也省噪声）。
- 两者不能都是空的。

## 判分的诚实口径

1. **机械检查先行**：确定性、零成本、零模型；一条 1 分。
2. 只有机械检查判不了的那部分（rubric 维度）才交模型判分；一个维度满分 2 分，折成 1 分。
3. 一题的分 = 得分 ÷ (机械检查数 + 维度数)；总分 = 各题得分的平均（每题等权）。
4. **每一次判定连同它读到的产物一起写进档案** —— 分数怎么来的可以复核。

## 被测的到底是什么

runner 每题发一次调用：system = Otto 这一题**装出来的那份说明书** + 一段**固定不变**的台架后缀
（说明这一轮没有接工具，请照实说会调哪几个工具、传哪些字段），user = 题目里那句商家人话。

被测的就是**那份说明书**。⑥段（ENGINE-A7）之前它是单体常量 `packages/otto/src/instructions.ts`；
⑥段之后它是 `assembleOttoInstructions(题目)` —— 技能文件柜按这道题的话对上书脊标签，装常驻薄层
`knowledge/_core.md` ＋ 对上的那几份全文，也就是商家真正拿到的那一份。台架后缀一个字不动，
所以两次跑分比的仍是同一件事：同一道题、同一段后缀，换的只是说明书的组织方式。

## 已知的弱点（S1 §4 已在案，不必再发现一次）

题是自拟的 —— 自己出的题考不出自己不知道丢了什么。这是 ⑥段「不低于基线」这条验收的强度上限。
见到真实商家用法后逐题替换，替换不算改签。
