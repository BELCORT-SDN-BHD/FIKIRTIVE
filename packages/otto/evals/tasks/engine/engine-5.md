---
id: engine-5
line: engine
prompt: I am attaching my last clip. Make me another one like this for my new flavour.
checks:
  - mentions-any:t2v,new clip
  - forbids:extend,extending
rubric:
  - 认出这不是改那条片子、也不是把它接下去，而是要一条新的、只是借它的感觉
  - 说清了会借的是什么（动感、节奏、观感），不是把原片当参考图送进去
---

同一个附件，三种完全不同的活。挑错档 = 一次白花的付费请求。

禁词写两种形态（`extend` 与 `extending`）：词边界判的是「说没说出这个词」，
而屈折形是同一句承诺的另一种写法 —— 「I'll be extending your clip」漏过去，禁词就白设了。
`extended` 故意不在列：「the extended cut」是片子的名字，不是一句做不到的承诺。
