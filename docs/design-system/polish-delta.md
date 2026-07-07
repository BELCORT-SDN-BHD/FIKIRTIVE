# Apple 化 polish delta — 现状 vs 建议(2026-07-07)

依据实读代码:`apps/web/app/globals.css`(`.gb` 块 + Vapor 遗留)、`components/ui/button.tsx`、`components/ui/card.tsx`、`components/ui/input.tsx`、`components/otto/OttoAvatar.tsx`、`components/otto/OttoChatStream.tsx`。
**颜色一律不动。** 标 ⚡ 的是"快赢":只改 token(基本只碰 globals.css 一个文件),全站一次到位。

| # | 现状 | 建议 | 影响面 | 级别 |
|---|---|---|---|---|
| 1 ⚡ | **按钮圆角实际是 20px,不是设计定的 14px。** `button.tsx` 用 `rounded-lg`,而 Vapor 的 `@theme inline`(globals.css:112)把 `--radius-lg` 注册成 20px,Tailwind v4 就按 20px 渲染;`.gb` 定义了 `--radius: 14px` 却从未注册成 Tailwind 圆角工具类 | 在 `@theme inline` 注册 `--radius-control: 14px` 等 gb 圆角 token,button/input 改用 `rounded-[var(--radius)]`(或注册后的工具类);顺手把 settings/canvas 里 9px、10px、16px 的散装圆角量到 10/14/18/24 | 全部控件的轮廓感 — 这是"不像 Apple"的最大单点 | token 级 |
| 2 ⚡ | **焦点环在 .gb 亮底上是白色(看不见)。** 全局 `:focus-visible`(globals.css:134)用的是 Vapor 的白色 `--ring-focus`;各组件各自补:button 用 `ring-ring/40`,`.gb .al-btn` 用 35% color-mix — 透明度还不一致 | 加一条 `.gb :focus-visible { box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 40%, transparent) }`,统一 40%,组件不再各写各的 | 键盘可达性 + 珊瑚焦点环这条"宪法级"视觉语言 | token 级 |
| 3 ⚡ | **`.gb` 没有任何 motion token;`--ease-spring` 全库不存在。** button.tsx 硬编码 `cubic-bezier(0.34,1.56,0.64,1)` + 150ms;cv-switch 140ms、tooltip 0.12s、node-actions 0.12s、al-btn 用 Vapor 的 120ms — 五种时长各玩各的 | 在 `.gb` 落 `--dur-1:120ms / --dur-2:150ms / --dur-3:200ms / --dur-sweep:600ms / --ease-out / --ease-spring`(值按 design-rules-v2 §6),组件逐步改引 token | 全站动效节奏统一;也是 Live reflection 四模式的地基 | token 级(落 token)→ 组件级(替换) |
| 4 ⚡ | **INK 悬停色硬编码 `#1A1A18` 出现 3 处**(globals.css:210、689、800),button.tsx 却用 `hover:bg-primary/90` — 两套 ink-hover,且 hex 在 `.gb.dark` 下直接错色 | 新增 `--primary-hover` token(亮:#1A1A18;暗:对应浅一档),3 处 CSS + button 统一引用 | 所有主按钮悬停;dark 模式正确性 | token 级 |
| 5 ⚡ | **`.gb` 作用域内仍有一批裸 hex/裸阴影,dark 模式必坏:** `.cv-nodelabel` 背景 `#1C1B17`、节点按钮 `rgba(255,255,255,.92)`、settings 危险色 `#B4321E`/`#E7B7AE`、`.cv-toolbar`/`.cv-detail`/`.al-promptbar`/节点卡片各自手写阴影(0 8px 24px… / 0 16px 48px… / 0 6px 18px…) | hex → 语义 token(danger 用 `--error`/error-soft 系);手写阴影全部映射到三层阴影档:rest=`--shadow-sm`、raised=`--shadow-md`、overlay=`--shadow-lg/xl`(值不变或就近归档) | canvas、settings、composer;`.gb.dark` 从"名存"变"实亡→实活" | token 级 |
| 6 | **字号是散装的:** OttoChatStream 里 `text-[0.90625rem]`(=14.5px)、`text-[0.8rem]`、`text-[0.8125rem]`;`.gb` 作用域 CSS 里 13.5/12.5/11.5px(Vapor 半像素遗产);`.gb` 没有任何字阶 token | 采纳 design-rules-v2 §3 的九档整像素字阶(28/24/20/18/15/14/13/12/11),半像素值就近量化(14.5→15、13.5→14 或 13、12.5→13、11.5→12);可在 `.gb` 落 `--text-*` token 供 CSS 侧引用 | 全站文字质感 — Apple 感的第二大单点 | 组件级(逐屏,Analytics 已是金标准,照它拉齐) |
| 7 | **间距不在网格上:** settings/canvas CSS 里 13px、9px、7px、11px、18px 内边距随处可见(Vapor 配方带进来的) | 按 §4 的 4px 网格量化(13→12、9→8、7→8、11→12、18→16 或 20);新代码只允许 4 的倍数 | 视觉节奏;diff 很大但零逻辑风险 | 组件级(顺手修,不专项扫) |
| 8 | **发丝线不一致:** input.tsx 用 `border-[1.5px]`,其余全是 1px `--border`;canvas 选中态是 2px brand(对);dropzone 是 2px 虚线 | 统一 1px 发丝线;input 焦点态靠珊瑚 ring(见 #2)而不是加粗边;2px 仅保留给 canvas 选中 + dropzone | 表单精致度 | 组件级(1 行) |
| 9 | **卡片悬停"抬升"无统一规范:** card.tsx 注释说 "Hover lifts 2px (opt-in via className)" — 即每处自己写,写法必然发散 | 给 Card 加一个 `interactive` prop/variant:`hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]`,150ms ease-out,全站只此一种抬升 | 所有可点卡片 | 组件级 |
| 10 | **Live reflection(宪法 v2.6)只有零件没有系统:** 珊瑚仅存在于 `.cv-gen`(生成中)与 selected 边框;OttoAvatar 有全部 8 情绪但没有 narration bar、没有 sweep、没有 dock | 按 design-rules-v2 §8 落四件套:coral sweep(≤600ms 一次性)、card landing(200ms spring)、narration bar(复用 `.cv-gen-bar` 配方 + OttoAvatar)、持久 Otto dock;demo 见 cards/*.html | 这是本次升级唯一"新增物";其余全是收敛 | 组件级(新建,依赖 #3 的 motion token) |

## 落地顺序建议

1. **第一个 PR(纯 token,~1 文件):** #1 圆角 + #2 焦点环 + #3 motion token + #4 primary-hover + #5 hex/阴影归档 — 全是 globals.css 内改动 + button/input 两个文件几行,风险最低、观感提升最大。
2. **第二个 PR:** #8 + #9(两个 ui 组件小改)。
3. **随迭代顺手做:** #6 字阶、#7 间距 — 碰哪屏修哪屏,以 Analytics 屏为金标准。
4. **独立 feature:** #10 Live reflection 四件套(先 narration bar + sweep,dock 单独评审位置策略)。

不动的东西:全部颜色值、coral law、语义色 state-only、Otto 造型(两眼无嘴珊瑚云)、radii 三档定义、shadcn new-york 结构、`.gb` strangler 迁移策略。
