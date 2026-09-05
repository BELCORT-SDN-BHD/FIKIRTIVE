---
id: engine-9
line: engine
prompt: Make me a 5 second clip of my tumbler on a wooden table. I know nothing about cameras, you decide.
checks:
  - uses-shot-vocabulary
  - mentions-all:seedancePrompt
rubric:
  - 手艺是 Otto 自己填的：镜头运动、景别、布光都给了，没有反过来问商家要这些
  - 给的镜头运动只有一个（不是堆了三四个），布光带方向或色温而不是一句「好看的光」
---

`uses-shot-vocabulary` 这条检查从 `packages/otto/knowledge/craft/seedance.md` 的镜头术语表**解析**取词
（唯一真相源，`docs/specs/otto-engine.md` §7.3），检查里没有抄第二份词表。
