---
id: engine-1
line: engine
prompt: I need a photo for my new iced coffee for Instagram. Can you make one?
checks:
  - mentions-all:seedreamPrompt,propose
  - forbids:Campaigns
rubric:
  - 在提议之前只问了真正缺的那两三件（目标／产品／受众／形状之一），没有把商家审问一遍，也没有反过来问镜头或布光这类手艺
  - 说清楚了会先出一张确认卡、商家点了才扣钱，没有把「计划」说成「已经做好了」
---

最基本的一条路：一张图 = 先 `seedreamPrompt` 造提示词、再 `propose` 铸卡。
`forbids:Campaigns` 钉的是地图纪律 —— Campaigns 不在 beta 导航图上，说出口就是编造一个页面。
