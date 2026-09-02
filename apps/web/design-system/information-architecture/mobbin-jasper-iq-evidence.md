# Mobbin evidence — Jasper IQ Brand flow

> 研究日期：2026-08-30。  
> 任务：以 Jasper IQ 的 marketing context flow 为 Fikirtive Brand 定义信息架构，不复制 Jasper 的视觉语言。  
> 方法：使用 Mobbin MCP `search_flows` 检查完整 flow screenshots。

## 1. 可核对的 Jasper flows

- [Jasper IQ](https://mobbin.com/flows/0f6eea06-b833-4732-87fa-c20ea68a7a8b)
- [Brand Voice](https://mobbin.com/flows/65040017-bcb5-4f33-8b6f-8a75e11e85cd)
- [Setting up and previewing a voice](https://mobbin.com/flows/857df8bd-14f0-4e3d-9b59-bddd27eedead)
- [Adding a voice](https://mobbin.com/flows/7ca28ebb-6b19-41ee-9dc0-0c27938f922b)
- [Applying project context](https://mobbin.com/flows/5bf9cf01-e343-4f91-b9e0-f25d10545b7e)

## 2. 实际观察

Jasper IQ 不是只有 logo / color / font 的 Brand Kit。它是给 AI creation 持续使用的
marketing context hub，顶层包含：

1. Brand voice；
2. Audiences；
3. Knowledge base；
4. Style guide；
5. Visual guidelines。

Brand Voice flow 支持从手动文字、URL 与文件建立 context；记录页保留 description、examples / excerpts、
best-used-for tags 与 visibility。在保存前，用户可比较同一输出在“未应用”与“已应用”该 voice 时的差异。
Project creation 则显式选择 voice、audience、language 与其他 context。

## 3. Fikirtive 的已批准适配

```text
Brand
├─ Brand voice
├─ Audiences
├─ Knowledge base
├─ Style guide
└─ Visual guidelines

Create / Canvas
└─ Visible context selection
   ├─ Brand voice
   ├─ Audience
   ├─ Knowledge
   ├─ Product reference
   └─ Character reference
```

约束：

- 学习 Jasper 的 context model 与建立 / 预览 / 应用 flow，不复制 Jasper 的视觉外壳。
- Brand 记录是长期可编辑 context；一次 prompt 不会自动升级为 Brand rule。
- Create / Canvas 必须让 Founder 看见当前采用的 context，且可更换或移除。
- 文件仍归 Library Assets；Brand 只引用 asset id，不建立第二份 media truth。
- Product truth 归 Library Product reference object；Knowledge base 可链接，不复制 facts。
