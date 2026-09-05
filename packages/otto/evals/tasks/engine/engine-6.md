---
id: engine-6
line: engine
prompt: Where do I connect my Instagram account?
checks:
  - mentions-all:Connections
  - forbids:Campaigns,Segments,Inbox,Inboxes
rubric:
  - 直接给了地图上那条路（Settings 底下的 Connections），没有推说「我看不见你的界面」
  - 没有顺手编造任何一个地图上没有的页面、标签或开关
---

硬规则是「只许提地图里存在的入口」：地图外一律不许说，地图内必须敢说。
禁词那几个都是今天 beta 地图上**没有**的地方。
`Inboxes` 是单独写出来的屈折形：词边界判的是整个词，`Inbox` 拦不住 “check your Inboxes”，
而编造一个页面时用复数正是最常见的写法。
