# 设计方向 v4(现行权威)

> Founder 2026-08-20 设计专场定案。**本目录 + `docs/brand/` 合起来是 FIKIRTIVE 设计的全部现行权威**;`docs/design/` 下其余带旧日期的文档、`docs/design-system/design-rules.md` 的 2026-06-28 颜色锁、Claude Design 项目里的 prototype v2 与旧 ui_kits,全部已被本方向取代,只作历史参考。

## 这个 v4 是什么

- **色彩方向 A(柔光棱镜)**:近白底、墨黑 CTA `#16171C`、紫/桃/天蓝低饱和渐变糖、珊瑚 `#EC5828` 专属 Otto 与品牌标识。比例 90/8/2。V1 只做浅色。
- **字体**:Geist(全部界面与营销文字)+ JetBrains Mono(数据)。
- **外壳**:传统 SaaS dashboard(七门 + Otto pop-up 按钮);**canvas section = Stitch 式整页工作区**(源头 = Founder 录屏 idea)。
- **两件官方标识**:F 字标(公司)+ Otto 云朵(操盘手),规范全文在 `docs/brand/`。

## 目录

| 文件 | 内容 | 状态 |
|---|---|---|
| [`design-principles.md`](design-principles.md) | 《Fikirtive 设计原则》一页:13 条死规矩 + 逐条判法,品味判官对每张 UI PR 的判据 | 定稿(Founder 2026-08-20 逐条拍板 13/13) |
| [`design-direction.html`](design-direction.html) | 方向书全文:七门设计方向、canvas 工作区交互蓝图、Soft Prism 系统 | 定稿(Founder 拍板全录) |
| [`stitch-canvas-analysis.md`](stitch-canvas-analysis.md) | Founder 录屏 96 帧逐帧分析 + Stitch 交互语法 + 预先修掉的两个致命伤(无廉价编辑路径、跨屏风格漂移) | 研究定稿,prototype 场直接引用 |
| [`font-showdown.html`](font-showdown.html) | 字体四选一比对过程稿(Geist 胜出) | 历史过程稿 |
| [`../../brand/`](../../brand/) | 品牌规范权威家:17 页 guidelines(PDF 主稿/PPTX/网页版)+ logo/云朵矢量正稿 + colors.json + 字体包 | 定稿(四轮判官验收) |

在线版本:brand guidelines artifact `claude.ai/code/artifact/fe00019d-68ba-4df3-a620-3db3a5c0aca2`;方向书 artifact `claude.ai/code/artifact/da3592f2-5151-4f5c-b6dd-dacf9cd99d93`;Claude Design 项目「FIKIRTIVE — MAIN」`brandkit-v4/`(过程稿镜像,非权威)。

## 三场路线(Founder 认可)

1. **本场(已收官)**:brand guidelines + 设计方向。
2. **components/设计系统场**:`docs/brand/colors.json` + guidelines 翻译成 `apps/web/app/globals.css` token;OttoAvatar/favicon 收编官方几何;英式拼写清理;FIKIRTIVE 三写法收敛。待办已登记 issue #1042 评论。
3. **prototype 场**:七门 + Stitch 式 canvas 完整原型,按方向书与 `stitch-canvas-analysis.md` 执行。

## 界外

- Otto 记忆分家(canvas 内按 project 分席 + 共享知识库)是 Founder 已登记的 idea,**连接前后端时再展开**,不属于设计场范围。
- 本目录不含任何组件代码;实现一律走 components 场按票交付。
