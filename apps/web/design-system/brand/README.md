# Fikirtive brand — 官方品牌资产包(v4)

> 本目录是 Fikirtive 品牌资产的唯一权威。完整规范在 `guidelines/`(17 页 PDF/PPTX + 网页版,结构按 Shopify brand guidelines 模板:Logos / Typography / Color palette / Imagery / Audience / Voice and tone / Grammar and style + tagline 与 boilerplate)。本 README 只做索引与最常用规则。
> 拍板记录:Founder 2026-08-20(色彩方向 / Geist 留任 / V1 浅色 only / 机器人脸退役 / tagline / grammar / boilerplate 收紧版)。
> Questions → Nicks Gan · nicksgan@belcort.com

## Tagline 与 boilerplate(原样使用,不改写)

**Tagline:`The marketing OS.`**(含句号;句号可用珊瑚色;不翻译、不加副句。)

**Boilerplate**(press / 合作方 / 应用商店 / 社媒 bio 通用):
> Fikirtive is the marketing OS for small businesses. Merchants get the full toolset — creation, campaigns, scheduling, and publishing — plus Otto, an AI marketing operator that researches, plans, and executes with the merchant’s approval. Merchants see the cost of every action before it runs, and every action leaves a readable record. Fikirtive is a product of BELCORT SDN BHD.

## 两件官方标识

| 标识 | 归属 | 文件 |
|---|---|---|
| **F 字标** | 公司/产品 | `logo/svg/f-mark-*.svg`(墨/纸/白/珊瑚四色)、`f-tile-*`(方砖)、`f-app-icon-*`(圆角砖) |
| **Otto 云朵** | Otto(AI operator) | `otto/otto.svg`(正稿)+ 7 个表情变体 |

两者不互换。

## 最常用四条

1. **默认身份砖 = 珊瑚圆角砖**(`f-app-icon-coral` / `png/favicon-*.png`);黑砖用于正式/单色场合。珊瑚 F 不放彩色底;彩底上用纸色或墨色,且装在砖里。
2. **名字写法**:字标一律小写 `fikirtive`(Geist 750);行文写 `Fikirtive`;全大写 FIKIRTIVE 停用;法务主体 BELCORT SDN BHD。
3. **珊瑚 `#EC5828` 的分工**:品牌标识色(F 砖与云朵);产品 UI 内只用于标示 Otto 在场(气泡、进度、生成中);人类操作按钮一律墨黑 `#16171C`。
4. **Grammar**(Founder 拍板 2026-08-20):美式拼写 · sentence case · Oxford comma · 金额 `RM 2,350.00` / `1,240 cr` · 日期 `12 Aug 2026` · 产品词 Fikirtive(行文)/ fikirtive(字标)/ Otto / credits / canvas · 禁句 "Coming soon"、供应商名、无来源数字。

## 目录

```
design-system/brand/
├── README.md            ← 你在这
├── colors.json          ← 机器可读色板与规则(components 场翻译成 CSS token 的源)
├── logo/
│   ├── svg/             ← F 标矢量正稿(marks / tiles / app icons)
│   └── png/             ← 官方导出(1024/512 + favicon 16-512 全套)
├── otto/                ← 云朵正稿 + 7 表情(idle 即 otto.svg)
├── fonts/               ← Geist 5 磅 + JetBrains Mono 2 磅静态 TTF(SIL OFL,许可证同目录)
└── guidelines/
    ├── fikirtive-brand-guidelines-v4.pdf    ← 17 页主稿(排版直出:活字 Geist 内嵌 + 矢量标,分发用)
    ├── fikirtive-brand-guidelines-v4.pptx   ← 17 页可编辑副本(原生 Geist 文字 + SVG,PowerPoint 实测)
    └── brand-book.html                      ← 排版源(浏览器打开即书页视图;PDF 由它经 Chrome 打印直出)
```

> 编辑 PPTX 前先安装 `fonts/` 里的字体(双击 TTF → 安装),否则 PowerPoint 会静默回退到 Calibri。

## 血缘与来源

- **F 字标原稿由 Founder 提供(2026-07-16,黑砖 raster)**,矢量重绘定稿于 `fikirtive-marketing-website` 仓 `design/brand/`;2026-08-20 起以本目录为唯一权威,营销站仓那份视为镜像(它的 README 已注明「if the original vector master surfaces, drop it in」——就是这里)。
- **云朵正稿几何**来自营销站现役 mark(`public/otto-mark.svg`):四团不对称云 + 深褐竖条眼 `#2B1308`。产品动态实现集中在 `components/OttoAvatar.tsx`。
- 旧机器人脸和旧 runtime copies 已移入 `../references/retired-assets/`，不再发布或消费。
- 设计方向全量在 **`../direction/`**；Claude Design 项目「FIKIRTIVE — MAIN」
  `brandkit-v4/` 只是过程稿镜像，不是权威。

## 消费方式

- 产品实现：`colors.json` + guidelines 翻译进 `../foundations/globals.css`；favicon/OG/邮件资产从 `logo/png/` 取。
- 对外物料(deck、merch、社媒):直接用 `guidelines/` 的 PDF 页式规范 + 本包资产,不要另画。
