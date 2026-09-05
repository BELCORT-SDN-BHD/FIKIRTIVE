# Creation 线的题（这里现在是空的，故意的）

这个目录是 `docs/specs/otto-engine.md` §7.3 留给 Creation 的三件接口之一：
**Creation 只需要往这里加文件，不改 runner。**

- 题的形状与 engine 线**完全一样**（front-matter 五字段：`id` / `line` / `prompt` / `checks` / `rubric`），写法见 `../../README.md`。
- `line` 写 `creation`。`id` 用 `creation-<n>`，或逐字等于 Creation 那份规格的验收编号。
- 四项机械检查各注册**一个纯函数**进 `../../checks/index.ts`，别在题里另写逻辑。
- 其中「镜头词全部命中术语表」那一项，词表**从 `packages/otto/knowledge/craft/seedance.md` 的镜头术语表一节解析取**
  （解析器已经在 `../../checks/glossary.ts`，engine 线的 `uses-shot-vocabulary` 正在用它）——
  不要在 `checks/` 里抄第二份词表。
- 档案会落 `../../baselines/creation.json`（两条线各一份）。跑法与预算同 `../../README.md`，
  连同那条「一律 `env -u ANTHROPIC_BASE_URL`」。

归属：`docs/specs/creation-engine.md` §8.3 批 III。本段（Otto ③）只交付骨架，不替 Creation 出题。
