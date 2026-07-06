# Otto mascot reactions — no-mouth system

> 状态:2026-07-06 repo 同步版。用途:给 Claude Design / 官方 design system 更新 Otto mascot reaction 规范。生产实现: `apps/web/components/otto/OttoAvatar.tsx`。

## 核心规则

Otto 永远是同一个 coral cloud mark。不要把 Otto 变成机器人、贴纸角色、emoji、动物或通用 AI icon。

Reaction 只能使用三种变化:

1. 眼睛形状和视线。
2. 云形整体 1-2 度轻微倾斜。
3. 低强度 glow / bob motion。

永久禁止:

- 嘴巴、牙齿、舌头、说话口型。
- 眉毛以外的五官扩展。
- 换身体、换颜色、戴配件、拿道具。
- 大面积表演型动画。

## 色彩

- 云形:repo `.gb` token 使用 `var(--brand)` = Otto coral `#EC5828`。
- 深色眼睛:`#2B1308`。
- glow 可使用对应状态 token,但云形主体仍保持 coral。
- Coral 只属于 Otto,不要把 coral 用成普通 UI action 色。

## Mood set

| Mood | 用途 | 表情规则 | Motion |
|---|---|---|---|
| `idle` | 默认头像、sidebar、普通 chat avatar | 两个竖向圆角眼 | 无 |
| `thinking` | 分析、生成、检查中 | 竖向眼睛 + 小高光,轻微左倾 | gentle bob + coral glow |
| `helpful` | reference tray、说明 Otto 已看见内容 | 眼睛略向用户方向,更开阔 | 无 |
| `success` | saved/generated/done | 两个闭合上弧眼,不要嘴 | subtle success glow |
| `warning` | delete、paid approval、irreversible action | 斜向眉线 + 睁大眼 | subtle warning glow |
| `error` | 失败、连接问题、生成失败 | X 形眼,不要哭脸嘴 | subtle error glow |
| `waiting` | 等用户输入/确认 | 半合眼/短横眼 | 无 |
| `approving` | 用户已确认,动作执行中 | 聚焦竖眼 + 平眉线 | subtle coral glow |

## API

新代码使用:

```tsx
<OttoAvatar mood="thinking" size={32} />
```

旧代码仍兼容:

```tsx
<OttoAvatar state="thinking" size={32} />
```

`state` 只保留 `idle | thinking` 作为 legacy prop。新 UI 必须使用 `mood`。

## 使用边界

- Modal:只在 Otto 解释风险、确认 reference、或承担执行状态时出现。不要每个弹窗都塞 Otto。
- Toast/status:可以使用小尺寸 `thinking/success/error/warning`。
- Empty state/front door:使用 `idle/helpful/thinking`,避免戏剧化。
- Destructive confirm:使用 `warning`,但按钮文案和确认输入才是主层级;Otto 不抢主视觉。
