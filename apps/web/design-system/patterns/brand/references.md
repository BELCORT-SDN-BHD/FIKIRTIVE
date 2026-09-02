# Brand / Otto IQ references

## Mobbin flows

这些 flow 已在 2026-08-30 通过 Mobbin MCP 的完整 screenshots 检查，并记录在
`../../information-architecture/mobbin-jasper-iq-evidence.md`：

- [Jasper IQ](https://mobbin.com/flows/0f6eea06-b833-4732-87fa-c20ea68a7a8b)
- [Brand Voice](https://mobbin.com/flows/65040017-bcb5-4f33-8b6f-8a75e11e85cd)
- [Setting up and previewing a voice](https://mobbin.com/flows/857df8bd-14f0-4e3d-9b59-bddd27eedead)
- [Adding a voice](https://mobbin.com/flows/7ca28ebb-6b19-41ee-9dc0-0c27938f922b)
- [Applying project context](https://mobbin.com/flows/5bf9cf01-e343-4f91-b9e0-f25d10545b7e)
- [Adding knowledge](https://mobbin.com/flows/5bbff547-1046-4875-80d2-e2f956f8b166)
- [Uploading a file](https://mobbin.com/flows/45c89bc3-7323-466a-ac92-77ea7a11f896)

## What Fikirtive borrows

- persistent context 按稳定 categories 管理；
- Text / URL / File 是输入来源，不是最终 object taxonomy；
- 保存前 review extracted draft；
- 使用真实 output 做 Without / With context preview；
- Creation 中显式显示当前采用的 context。

## What Fikirtive does not copy

- Jasper 的视觉外壳、spacing、colors、component styling；
- Project / Project Brief 概念；Fikirtive 的 Founder-facing work unit 是 Canvas；
- Product 或媒体副本；Product ID 与 Library asset ID 保持 canonical；
- Brand 内的第二套 AI chat。

## Current Fikirtive evidence

- `app/brand/page.tsx`：当前 production route 仍组合 legacy `OttoMemory`，与冻结 sitemap 不一致。
- `components/otto/OttoMemory.tsx`：当前 about / look / customers / products / offers / rules taxonomy 与新的五-section Brand contract 不一致，但已有真实 Memory / BrandRecord actions，可在后续 implementation spec 中评估复用。
- `../../information-architecture/runtime-convergence.md`：已将 production Brand convergence 登记为独立后续工作。

本文件只记录 pattern research。它不授权修改 production data model、route 或 backend actions。
