# Fikirtive brand — 官方品牌资产包(v4 · Soft Prism)

> 这里是 Fikirtive 品牌的**唯一权威家**。规则的完整版在 `guidelines/` 里的 brand guidelines(PDF/PPTX,18 页,结构严格按 Shopify brand guidelines 模板:Logos / Typography / Color palette / Imagery / Audience / Voice and tone / Grammar and style + tagline 与 boilerplate);本 README 只做索引与最常用的规矩。
> 方向与全部拍板:Founder 2026-08-20(色彩方向 A 柔光棱镜 / Geist 留任 / V1 浅色 only / 机器人脸退役 / tagline / grammar 四项)。
> Questions → Nicks Gan · nicksgan@belcort.com

## Tagline 与 boilerplate(原样使用,不改写)

**Tagline:`The marketing OS.`**(含句号;句号可用珊瑚色;不翻译、不加副句。)

**Boilerplate**(press / 合作方 / 应用商店 / 社媒 bio 通用):
> Fikirtive is the all-in-one marketing OS for small businesses. It gives merchants complete, hands-on marketing tools — creation, campaigns, scheduling, and publishing — plus Otto, an AI marketing operator that researches, plans, and executes with the merchant's approval. Every action is transparent: merchants see what things cost before they run, and everything leaves a trail they can read. Fikirtive is operated by BELCORT SDN BHD.

## 两件官方标识,各司其职

| 标识 | 是谁的 | 文件 |
|---|---|---|
| **F 字标**(有机手绘 F) | **公司/产品**的标 | `logo/svg/f-mark-*.svg`(墨/纸/白/珊瑚四色)、`f-tile-*`(方砖)、`f-app-icon-*`(圆角砖) |
| **Otto 云朵** | **Otto(AI 操盘手)**的标 | `otto/otto.svg`(正稿)+ 7 个表情变体 |

两者**不许互换角色**。F 是招牌,云朵是店伙计的脸。

## 最常用四条

1. **默认身份砖 = 珊瑚圆角砖**(`f-app-icon-coral` / `png/favicon-*.png`);黑砖是正式/单色场合。珊瑚 F 永不放珊瑚底;彩底上用纸色或墨色。
2. **名字写法**:字标一律小写 `fikirtive`(Geist 750);行文写 `Fikirtive`;全大写 FIKIRTIVE 停用;法务主体 BELCORT SDN BHD 照旧。
3. **珊瑚法**:珊瑚 `#EC5828` 是品牌色——F 砖与云朵用它;**产品 UI 内**珊瑚只示意 Otto 在场(气泡、进度、生成中),人类操作按钮一律墨黑 `#16171C`。
4. **Grammar**(Founder 拍板 2026-08-20):美式拼写 · sentence case · Oxford comma · 金额 `RM 2,350.00` / `1,240 cr` · 日期 `12 Aug 2026` · 产品词 Fikirtive(行文)/ fikirtive(字标)/ Otto / credits / canvas · 禁句 "Coming soon"、供应商名、无来源数字。

## 目录

```
docs/brand/
├── README.md            ← 你在这
├── colors.json          ← 机器可读色板与规则(components 场翻译成 CSS token 的源)
├── logo/
│   ├── svg/             ← F 标矢量正稿(marks / tiles / app icons)
│   └── png/             ← 官方导出(1024/512 + favicon 16-512 全套)
├── otto/                ← 云朵正稿 + 7 表情(idle 即 otto.svg)
└── guidelines/
    ├── fikirtive-brand-guidelines-v4.pptx   ← 18 页分页版(可编辑,PowerPoint 实测可开)
    ├── fikirtive-brand-guidelines-v4.pdf    ← 18 页分页版(分发用)
    └── brand-book.html                      ← 网页版(同结构同内容)
```

## 血缘与来源

- **F 字标原稿由 Founder 提供(2026-07-16,黑砖 raster)**,矢量重绘定稿于 `fikirtive-marketing-website` 仓 `design/brand/`;2026-08-20 起以本目录为唯一权威,营销站仓那份视为镜像(它的 README 已注明「if the original vector master surfaces, drop it in」——就是这里)。
- **云朵正稿几何**来自营销站现役 mark(`public/otto-mark.svg`):四团不对称云 + 深褐竖条眼 `#2B1308`。产品内 `OttoAvatar.tsx` 的手写几何(对称三圆、白眼)与正稿不一致,**components 场统一收编到本正稿**。
- 旧机器人脸三件(产品仓 `apps/web/public/brand/logo-mark.svg` / `logo-wordmark.svg` / `otto.svg`)已由 Founder 2026-08-20 裁决**退役**;文件暂留原地,随换壳切换票一并处理。
- 设计过程档案(方向书、字体比对)在 Claude Design 项目「FIKIRTIVE — MAIN」`brandkit-v4/`;那是过程稿,不是权威。

## 消费方式

- 产品实现:components 场把 `colors.json` + guidelines 翻译进 `apps/web/app/globals.css` token;favicon/OG/邮件资产从 `logo/png/` 取。
- 对外物料(deck、merch、社媒):直接用 `guidelines/` 的 PDF 页式规范 + 本包资产,不要另画。
