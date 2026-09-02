# Cloudflare Ask AI flow evidence

本目录保存 2026-08-28 从 Mobbin 取得、并逐屏检查的 Cloudflare Ask AI 参考截图。
这些截图只用于说明 interaction model，不是 Fikirtive 的视觉 token 或组件权威。

## 覆盖范围

Mobbin 当前能找到 5 条直接属于 Cloudflare **Ask AI assistant** 的 flow，共 14 个画面：

| Flow | 画面数 | 本地证据 | Mobbin |
|---|---:|---|---|
| Chatting with AI | 5 | `01-dashboard-entry.jpg` → `05-answer.jpg` | [Open flow](https://mobbin.com/flows/5a90ebd3-8023-4be7-8931-fb296a3d58e0) |
| Switching a room chat | 3 | `05-answer.jpg`、`06-history-menu.jpg`、`07-switched-conversation.jpg` | [Open flow](https://mobbin.com/flows/b3567e20-7550-4f42-86ab-15335e501ab3) |
| Switching to fullscreen view | 2 | `05-answer.jpg`、`08-fullscreen.jpg` | [Open flow](https://mobbin.com/flows/f4ef5cc6-1abe-44b8-917f-4cfa4f934110) |
| Giving feedback | 2 | `05-answer.jpg`、`09-feedback-selected.jpg` | [Open flow](https://mobbin.com/flows/621edf7b-8456-4042-ae21-baabb03181a3) |
| Copying a chat | 2 | `05-answer.jpg`、`10-copy-confirmation.jpg` | [Open flow](https://mobbin.com/flows/efa3106d-1ee8-41e5-9d1d-1f36c9f6a61b) |

检索时翻完主查询的全部 3 页，并追加 new conversation、fullscreen、feedback、support、error / retry 的定向检索。Mobbin 当前没有独立记录 Ask AI 的 error / retry、close / reopen 或 support handoff flow；不能从缺失截图推断这些状态不存在。

`AI Playground`、`Adding AI chats`、`Starting a playground` 属于 Cloudflare 的模型测试产品，不是 dashboard Ask AI assistant，因此不作为 Otto panel 的直接 flow 依据。

