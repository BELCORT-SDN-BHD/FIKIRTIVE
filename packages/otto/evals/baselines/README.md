# 跑分档案

一条线一份：`engine.json`（缺省）、`creation.json`（`--line=creation` 跑出来的那一份）。

每份档案记：日期、commit sha、被测型号与判分型号、单次预算上限、**真实花费**、逐题分（含产物与每一条判词）、总分。
写档案的是 `pnpm --filter @fikirtive/otto run evals`（Creation 那份加 `-- --line=creation`）；
`evals:check` 只比对、不覆盖，而且**开跑前**就会发现「这条线还没有基线」并非零退出——不会白跑一趟。

档案是 git 跟踪的 —— 「不低于基线」这句话要有一个能 diff 的对象。
