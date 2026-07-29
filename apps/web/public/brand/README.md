# Brand assets

本目录是设计系统 `brand-assets/` 的镜像,不是权威。

**权威在 Claude Design 项目「FIKIRTIVE — WEBSITE」**(projectId
`f3bb32b0-ecdc-47ee-9b48-6b21edd73e70`)的 `brand-assets/` 目录;用法规范见同项目
`brand/f-lettermark.card.html`。任何标志改动必须先落在那里,再从那里同步到本目录。
不要在本目录直接改稿。

## 用法规范(摘自 f-lettermark 卡)

- **角色**:F 字标 = 公司标志;OTTO 云朵 = Otto(操作员/产品吉祥物)。两者绝不互换。
- **颜色**:仅 ink `#141414` / paper `#F5F1E8` / white `#FFFFFF` / coral `#EC5828`。
  绝不 coral-on-coral,绝不裸标压图。
- **净空**:四周 ≥ 标高 25%;裸标最小高 24px,tile 内最小 16px。

## 文件清单

| 文件 | 来源(设计系统路径) | 用途 |
| --- | --- | --- |
| `f-mark-ink.svg` | `brand-assets/f-mark-ink.svg` | 公司标,纸底默认 |
| `f-mark-paper.svg` | `brand-assets/f-mark-paper.svg` | 公司标,深底用 |
| `f-mark-white.svg` | `brand-assets/f-mark-white.svg` | 公司标,深底/彩底用 |
| `f-mark-coral.svg` | `brand-assets/f-mark-coral.svg` | 公司标,白底强调 |
| `f-app-icon-coral.svg` | `brand-assets/f-app-icon-coral.svg` | 应用图标(默认,圆角 tile);favicon 源 |
| `f-tile-coral.svg` | `brand-assets/f-tile-coral.svg` | 满幅方 tile;apple-touch-icon 源 |
| `otto-cloud.svg` | 设计系统 `brand/brand-marks-audit.card.html` 中的 marketing OTTO cloud(与 `components/otto/OttoAvatar.tsx` 内联云朵同源) | Otto 产品标(珊瑚云朵) |

`apps/web/app/favicon.ico`(16/32/48)、`apps/web/app/icon.svg`、
`apps/web/app/apple-icon.png`(180×180)均由上表的 app icon / tile 源文件栅格化生成;
换标时需一并重新生成。

历史:旧机器人三件套(logo-mark / logo-wordmark / otto)已于 2026-07 降级为 legacy
并从本目录删除(issue #497),需要时从 git 历史取。
