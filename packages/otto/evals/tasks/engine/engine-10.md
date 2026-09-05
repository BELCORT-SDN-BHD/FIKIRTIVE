---
id: engine-10
line: engine
prompt: Same tumbler clip but vertical for an IG story, 9:16, with sound.
checks:
  - mentions-all:desiredAspect,9:16
  - mentions-any:aspect,vertical
rubric:
  - 形状既传给了 propose 的字段、也传给了提示词那一侧（同一个值传两处），因为竖版要额外一句防字幕
  - 时长、清晰度、声音这几项走 propose 的字段，没有被写进提示词文本
---

画幅是唯一一项要同时传两处的东西 —— 传漏了，竖版就容易长出没人要过的烧录字幕。
