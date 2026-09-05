# 跑分档案

一条线一份：`engine.json`、（Creation 批 III 之后）`creation.json`。

每份档案记：日期、commit sha、被测型号与判分型号、单次预算上限、**真实花费**、逐题分（含产物与每一条判词）、总分。
写档案的是 `pnpm --filter @fikirtive/otto run evals`；`evals:check` 只比对、不覆盖。

档案是 git 跟踪的 —— 「不低于基线」这句话要有一个能 diff 的对象。
