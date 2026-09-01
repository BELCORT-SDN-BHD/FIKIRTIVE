# Mobbin evidence — Brand boundary

> 研究日期：2026-08-30。  
> 任务：决定 Brand 应拥有哪些长期资料，以及如何把 Brand context 带进 Creation，同时避免建立第二个 Library。  
> 方法：使用 Mobbin MCP `search_flows` 并检查返回的 flow screenshots。
>
> **状态：历史比较证据。** Founder 已选择 Jasper IQ 方向；当前决定以
> `mobbin-jasper-iq-evidence.md` 和 IA change register 为准。

## 1. Canva — broad Brand Kit

Flows：

- [Brand kit](https://mobbin.com/flows/e0e057b9-5ff5-4838-8f0d-a23d7d84df94)
- [Brand kits](https://mobbin.com/flows/9c4c0ca9-dba1-4f3f-b9cf-580409dbfd10)

Canva 把 Logos、Colors、Fonts、Brand voice、Photos、Graphics、Icons，甚至 Charts 收进 Brand Kit。
这些 category 会在 editor 里成为可快速套用的 design ingredients。

**对 Fikirtive 的价值：** Brand context 应该在 Creation 可直接使用，不应要求 Founder 每次重新说明。

**不宜直接照搬：** Canva 的 Brand Kit 同时扮演 asset shelf。Fikirtive 已经把 Library 定义为唯一 asset truth，
若 Brand 再上传和保存一套 Photos / Graphics / Icons，会产生两个位置和两套删除语义。

## 2. Semrush — compact visual kit

Flow：[Creating a brand kit](https://mobbin.com/flows/df3054e1-943e-4003-b56b-13b43c0a0b82)

Semrush 的 Brand Kit 保持紧凑：Logos、Colors、Fonts。用户从 editor 进入 Brand Kits，编辑完成后回到当前创作。

**对 Fikirtive 的价值：** Brand 应是一套稳定输入，而不是一条创作工作流；进入 Brand 修改后可以返回原本 Canvas。

## 3. Typeform — assets 与 themes 分责

Flow：[Creating a brand kit](https://mobbin.com/flows/4a1996a5-897f-4e00-afc8-2fc35c7c6179)

Typeform 将 Logos、Fonts、Colors、Media 归入 Assets，同时把可应用的组合归入 Themes。

**对 Fikirtive 的价值：** 稳定事实与“如何使用这些事实”是两种信息。Fikirtive 可对应为 Brand identity / products 与
Brand rules / voice，而不需要复制 Typeform 的 theme builder。

## 4. Bloom — identity + design language becomes generation context

Flow：[Brand](https://mobbin.com/flows/ffbc50b7-dbf3-433c-a294-55e03799a693)

Bloom 的 Brand 页把 Identity、Colors、Fonts、Tone 与 Aesthetic 放在一起，并在同一面提供 image-generation prompt。

**对 Fikirtive 的价值：** Brand 不只是视觉 kit；它也是 Otto 和 Creation 使用的 durable context。

## 5. VEED — reusable media inside Brand Kit

Flow：[Brand kits](https://mobbin.com/flows/8adaf466-47aa-45de-871f-1e4ec1d742bf)

VEED 将 videos、images、audio、logos、colors 与 fonts 放进 Brand Kit，让 editor 直接复用。

**Fikirtive 的偏离：** 功能意图应保留，但 media 不复制到 Brand。Brand 只保存对 Library asset id 的角色引用，
例如 `Primary logo`、`Product hero`、`Approved music`。

## 6. 原 Proposed Fikirtive boundary（已被 Jasper IQ 裁决取代）

```text
Brand owns durable truth
├─ Identity          name · description · market
├─ Visual identity   colors · fonts · logo roles
├─ Voice & rules     tone · do / don't · required claims
├─ Products/offers   product facts · price context · positioning
└─ Official media    references to Library asset ids

Library owns files
└─ image · video · audio · logo source files

Create / Canvas consumes
└─ visible, removable Brand context from the same records
```

关键约束：

- 一个 media file 永远只有一个 Library asset id；Brand 只赋予它角色，不复制文件。
- Brand 的长期事实与偏好必须可见、可编辑、可追溯；一次 prompt 不自动升级为长期 rule。
- Create 默认带入当前 Brand context，并让 Founder 看见用了哪些 context；需要时可移除或更换。
- 多品牌切换不进入 v1；当前只定义一个 workspace 的 Brand truth。
