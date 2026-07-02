# Analytics 平台切换器 — 设计 spec

日期：2026-07-03 · 分支：`claude/analytics-platform-switcher`（off main `e918fe0`，Analytics Phase A 已 merge）
状态：创始人已拍板 · 新 PR（#116 已 merge）

## 目标（创始人 2026-07-03）
Analytics 顶部加**平台切换器**：Meta（活数据，现有 Phase A）+ TikTok / Shopee / Google / WhatsApp（先占位「即将支持」）。等以后接了真 adapter 就自动点亮 —— 跟 Phase B / Schedule 一个套路。**纯前端 + 数据 seam 备好，不建假 adapter，read-only，零花钱。**

## 平台集（Meta 活，其余 soon）
`ANALYTICS_PLATFORMS`（纯常量，可读文件，以后加平台就多一行）：
| id | label | status |
|---|---|---|
| meta | Meta (IG + FB) | live |
| tiktok | TikTok | soon |
| shopee | Shopee | soon |
| google | Google | soon |
| whatsapp | WhatsApp | soon |

（`live` = 走现有 `getAnalytics`；`soon` = 显示占位面板。以后某平台接了 `channels/` adapter，把它翻成 `live` 并接 seam 即可。）

## UI（挂在现有 Analytics 头部）
- 现在头部：`Analytics` h1 + `via Meta · read-only` 静态字 + 右侧日期范围 select。
- 改：把 `via Meta` 静态字换成**平台 select**（样式同日期 select：h-[34px] rounded-[10px] border text-[13px] font-semibold），紧跟 `· read-only`。选项 = 5 个平台，soon 的加后缀「(soon)」灰显。
- 选 **meta** → 现有页面原样（KPIs/图/insight/toppanel/日期 select 全在）。
- 选 **soon 平台** → 隐藏日期 select + KPIs 区，改渲染一个**居中占位面板**（复用现有 ConnectPanel 的版式语言）：cloud/图标 + 标题 `<Platform> analytics is coming soon` + 副 `We'll light this up here once <Platform> is connected — same place, same view.` + 一个灰 ghost 无操作按钮 `Notify me`（Phase B 再接，先 no-op；标 TODO）。
- 平台 state 纯页内（`useState`，默认 meta）；切平台不发请求（soon 平台无数据；回到 meta 用已加载的 initial/当前 data，不重新 fetch —— 保留当前 range 的 data）。

## 钱路（BINDING）
- 纯展示；切到 soon 平台不调任何 server action；Meta 仍走只读 `getAnalytics`。零 spend，零新表，冻结文件不碰。

## 测试
- 纯：`ANALYTICS_PLATFORMS` 形状 + `platformById(id)` helper（TDD 小）。
- 视觉：skin-preview 选到一个 soon 平台 → 占位面板；回 meta → 原页。截图。

## 不做（YAGNI）
- 真 TikTok/Shopee/Google/WhatsApp adapter 与 OAuth（各自独立大工程，需创始人那边的开发者账号）。
- 「All platforms」聚合视图（现在只有 Meta 一个活的，聚合无意义）→ 以后 ≥2 个活平台再说。
- Notify-me 真实订阅（先 no-op 占位）。
