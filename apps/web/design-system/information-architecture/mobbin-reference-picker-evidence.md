# Mobbin evidence — Otto `@` reference picker

> 研究日期：2026-08-30。  
> 方法：严格使用 Mobbin MCP 检查 mention、visual reference 与 persistent AI context flows。  
> 状态：Evidence；交互裁决见 `reference-picker-contract.md`。

## 1. Notion：轻量 trigger，再即时解析

- [Adding a mention tag](https://mobbin.com/flows/a95555e9-cdc5-48f9-8058-ff25f9f39995)

Notion 在 composer 中先用紧凑菜单区分 attach、mention 与其他动作；进入 mention 后才按输入名称缩小结果，并把选中对象留在
composer。对 Fikirtive 的启发是：裸 `@` 只需要近期对象与 browse 入口，不应一开始渲染整个 Library。

## 2. Runway：视觉 reference 必须保持可见

- [Adding a prompt](https://mobbin.com/flows/56b70e53-6a2f-4776-a4ad-3bff0e5fc882)

Runway 将 visual references 以 thumbnails 保留在 generation panel，并区分 `Recent / Saved`。这支持 Fikirtive 在选中
Generation、Upload、Character 或 Official avatar 后保留可见 thumbnail，而不是只把 invisible context 交给模型。

## 3. Jasper：persistent context 与单次 reference 分层

- [Selecting a brand voice](https://mobbin.com/flows/aff34e4e-33af-4e2c-b058-359d36ea93c4)

Jasper 将 Brand voice / Audience 作为持续 context 显示，而不是要求每条 prompt 重复附加。Fikirtive 因此保持 Brand / Otto IQ
rules 默认生效；`@` picker 只处理当前 instruction 需要明确点名的 Product、Element 或 media。

## 4. Slack：mention 在原输入流内完成

- [Mentioning a person](https://mobbin.com/flows/13be985d-6358-4026-bd63-da5f5df15db5)

Slack 的 mention 留在 message composer 和最终 message 中，用户不用进入另一个管理页面。Fikirtive 同样要求 reference selection
完成后回到原 prompt，并让 token 在发送前后都可辨认。

## 5. Fikirtive synthesis

采用四条组合原则：

1. Notion 的 lightweight trigger；
2. Runway 的 visible visual references；
3. Jasper 的 persistent / prompt context 分层；
4. Slack 的 inline mention continuity。

最终 contract 不是复制任何单一产品，而是把这些成熟 pattern 映射到 Fikirtive 的 Product、Library、Official avatar 与 Canvas truth。
