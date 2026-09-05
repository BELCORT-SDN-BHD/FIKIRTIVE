---
id: engine-2
line: engine
prompt: Make me a short video of my new tumbler. I do not have any pictures of it yet.
checks:
  - mentions-all:seedancePrompt
  - mentions-any:t2v,text-to-video
rubric:
  - 认出了手上没有首帧，所以这一趟是从零起片子（t2v），而不是默认那档「让一张首帧动起来」
  - 时长／清晰度／画幅／声音这几项说清了是走 propose 的字段，而不是写进提示词文本里
---

档挑错就是烧一次付费请求：没有首帧却按默认 i2v 写，提示词会说「从给定的首帧开始」而引擎手上什么都没有。
