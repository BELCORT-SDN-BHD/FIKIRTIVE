---
id: engine-3
line: engine
prompt: I want a 3-scene ad for my cafe - morning prep, the pour, a customer smiling.
checks:
  - mentions-all:proposeStoryboard
  - forbids:proposePack
rubric:
  - 认出这是分开的多个镜头、要走分镜卡，而不是一次 propose
  - 明说了分镜卡本身不扣一分钱、首帧与视频是之后各自单独批准的步骤
---

分镜与单条片子的分界：输出是商家要逐条审阅、逐条改的分开的片子 → 分镜卡。
`proposePack` 是图片的「几个选项」，用在这里就是拿错工具。
