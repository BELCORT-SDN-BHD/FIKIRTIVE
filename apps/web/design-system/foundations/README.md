# Foundations

`globals.css` 是产品实际渲染 tokens 与全局 recipes 的唯一 owner。`apps/web/app/globals.css` 只是
为了 Next.js 和现有测试保留的 symlink。

新增视觉值时，先判断它是否属于 brand、semantic state 或局部业务数据。只有跨页面重复且具有稳定
语义的值才能成为 token；加入 token 时必须同时覆盖 Tailwind 注册与所需 theme 状态。

当前文件仍含少量 strangler migration 的 legacy recipes。它们是待迁移实现，不是新增 UI 可复制的
范例；新界面从 `.gb` tokens 与 `primitives/` 开始。

