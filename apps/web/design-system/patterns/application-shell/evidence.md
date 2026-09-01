# Application shell evidence

> 状态：Founder checkpoint。范围只包括 shared rail、utility bar、content frame 与 Otto panel
> geometry；不批准完整 Dashboard 内容或 Otto conversation flow。

## Benchmark

Mobbin Cloudflare desktop evidence：

- [Account home](https://mobbin.com/screens/316dadce-2699-43cd-b652-728282a0daa0)：固定左侧导航、薄顶部工具栏与高密度内容区。
- [Account home with Ask AI](https://mobbin.com/screens/2c50fd95-b44e-40eb-80bd-efa06e2cb139)：AI 从顶部 utility bar 打开右侧 dock，主内容收窄而不是被盖住。
- [Detailed metrics](https://mobbin.com/screens/4806b442-2102-4174-9cbd-44939fb9434c)：rail、utility bar 与内容滚动区的持续关系。
- [AI history](https://mobbin.com/screens/5f8e667f-9ad8-4d84-adc2-a4df5241c6f9)：右侧 panel 的 history / conversation 结构证据。

Fikirtive 保留自己的 v4 brand、tokens、typography、radius 与 Otto coral ownership，不复制
Cloudflare 的品牌外观。

## Source map

| 决定 | 唯一 owner |
|---|---|
| Routes、labels、groups | `packages/core/src/navigation.ts` |
| Rail rendering 与 interaction | `navigation/rail/NavigationRail.tsx` |
| Utility bar 与 account entry | `navigation/MerchantTopBar.tsx`、`navigation/MerchantAccountMenu.tsx` |
| App-level shell composition | `apps/web/components/global-navigation.tsx` 的 `MerchantShellFrame` |
| Otto geometry 与 open/dock state | `../otto-panel/` |
| Tokens 与 primitives | `../../foundations/`、`../../primitives/` |
| Founder review route | `apps/web/app/product-patterns/application-shell/`，只注入 fixture |

## Acceptance boundary

- rail、utility bar、content scroll owner 与 Otto panel 组合为一套正式 shell。
- Ask Otto 使用同一 `OttoPanelShell` controls，不建立第二个 drawer state。
- Docked panel 挤窄内容，不盖住内容，也不加 scrim。
- review route 不定义 route、label、token、primitive 或 panel geometry。
- account 与 preview balance 是 fixture；页面不得伪装成已连接的真实 merchant data。
- 完整 Otto flow 与完整 Dashboard detail 必须在后续 checkpoint 单独验收。
