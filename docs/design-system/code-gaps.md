# v3 一致性检查 — 代码 vs 规范差距台账(2026-07-07)

体例接续 `docs/design-system/polish-delta.md`(现状 → 建议 → 级别)。
**一致性结论先说:v3 文档里所有 token 精确值已逐一对过 `globals.css` 的 `.gb` 亮色块
(591–665 行)—— 颜色、圆角、阴影、软色对全部一致,零矛盾。** 唯一"规范先行于代码"的
三组值(motion token、`--chart-*`/`--data-label`、`--z-*`、暗色阴影)在文档中都明确标注
"to land",不属于矛盾。polish-delta #1–#10 仍然有效,下表只列 **新发现** 的差距;与
polish-delta 重叠处注明。

级别:**token 级**(改 globals.css 一处全站生效)· **组件级**(逐文件,碰哪修哪)·
**提案级**(需 founder 批准的 token 值变更)。

| # | 现状 | 建议 | 级别 |
|---|---|---|---|
| 11 | **4 个基础状态色没注册进 `.gb` 的 `@theme inline`**:`text-success`(6 处)、`bg-success`、`bg-error` 在组件里被消费但 `--color-success/error/info` 不存在 → Tailwind v4 静默不生成,样式无声丢失;`bg-warning` 只是碰巧借了 Vapor 的注册 | 在 `.gb` `@theme inline` 补注册 `--color-success/warning/error/info` 四行(§T5 三处规则) | token 级 ⚡ |
| 12 | **`.gb.dark` 缺 6 个暗色阴影**:亮色 `rgba(20 20 24/…)` 值在 `#0B0B0C` 上不可见 | 按 §K1 表落 6 个暗色值(黑基 0.35–0.60 alpha + brand 0.20) | token 级 ⚡(随 #3 motion token 同 PR) |
| 13 | **暗色是死代码**:`.gb.dark` 选择器齐全但全库无任何 `class="dark"` 设置器;`next-themes` 装了没挂 provider;`@custom-variant dark` 缺失导致 kit 里 stock `dark:` 工具类按 OS 媒体查询触发 —— **亮色模式现行 bug**:OS 深色用户在 select/textarea/checkbox 上看到灰色水洗底 | §K3 五线一 PR:ThemeProvider + `@custom-variant dark` + `color-scheme` + `themeColor` + 暗色阴影 | token 级 → 组件级 |
| 14 | **kit 用 Tailwind 命名阴影工具类** `shadow-xs/sm/md`(button/checkbox/input/select/switch):编译产物内联 Tailwind 自带黑影,完全绕过 `--shadow-*` token,暗色覆盖永远到不了 | 改 `shadow-[var(--shadow-xs)]` 等任意值形式;`card.tsx`/`dialog.tsx` 已是正确写法,照抄 | 组件级(6 文件各 1 行) |
| 15 | **focus ring 双层规范未落地**:现行是单层 40% 光晕(合成后对底仅 1.64:1,低视力不可见);且 alpha 散装 /30(input)、/50(switch/select/tabs/checkbox)、35%(3 处 CSS) | §A2 一条全局规则:1px 实线 keyline(3.42:1)+ 4px 40% 光晕;有边框字段用 ring 色边框 + 3px 光晕;全部 alpha 收敛 40%(升级 polish-delta #2) | token 级(1 条规则)+ 组件级(alpha 替换) |
| 16 | **disabled 不透明度散装**:input/button 0.4,textarea/select/checkbox/switch 0.5 | 统一 0.4(§F2 锁定) | 组件级(4 文件) |
| 17 | **`--data-label` 与 `--chart-*` 六 token 不存在**;Analytics 里 `#86867F`、`#15803D`、`#B42318` 裸 hex(`#B42318` 应归档到 `--error-soft-foreground` `#B42B30`,视觉等同),PerAd/kit 同源 | 按 §D5 表新建 6 token(三处规则,亮+暗),Analytics 裸 hex 就地替换 | token 级 ⚡ |
| 18 | **`--z-*` 十档不存在**;现行 z 散装:5/6/20(canvas)、199/200(drawer)、50(dialog)—— 已知危害:抽屉(200)盖住对话框(50) | 按 §L8 落十个 `--z-*` token,组件碰哪换哪;drawer/dialog 那对先修(真 bug) | token 级(落 token)→ 组件级 |
| 19 | **nav "New" 按钮(人类 CTA)带珊瑚阴影** `rgba(236,88,40,.18)`,violates coral law;h 38 / radius 12 双双偏格 | `--shadow-xs` 或无阴影;h 36、radius 14(§N2) | 组件级(OttoNav 1 处) |
| 20 | **nav 余额行的珊瑚色金币**:钱是用户的,Otto 没动它 —— 超珊瑚预算(§O4 已裁定) | 金币改 ink(`--foreground`);珊瑚只留品牌标 + 活动点 + (credits=Otto 燃料的立场若 founder 保留,则金币例外保留 —— 需 founder 一句话拍板) | 组件级 · 半提案级 |
| 21 | **Schedule 计划期可同屏出现 2–3 个珊瑚 statement**(通知横幅+提案卡+空计划卡),超 §O4 预算 max 1 | proposal 优先:有待批计划时,App-Review 横幅降级为 `--secondary` 中性行 + 16px 云标 | 组件级 |
| 22 | **Analytics/Schedule 珊瑚横幅裸 hex** `#FFF6F2`/`#FBD9C9`/`#9A3A1A` | `--brand-soft` 60% mix 填充 + `--brand-soft-foreground` 文字 | 组件级 |
| 23 | **thread 状态点裸 hex** `#f59e0b/#dc2626/#16a34a`(OttoNav)+ admin 内联 `#e5484d`/`#3fb950`(9 个 admin 文件;`#3fb950` 两个模式都不是本系统色) | `--warning/--error/--success` token | 组件级(顺手修) |
| 24 | **AdminV2Nav 裸 Tailwind 任意值** `bg-[#F8F8F7]`、`hover:bg-[#EAEAE8]`、`text-[#3A3A38]` + 13.5px 半像素字号 | `bg-muted` / `hover:bg-accent` / `text-muted-foreground`;14px | 组件级 |
| 25 | **canvas 节点白色控件族在暗色下全灭**:`.al-btn-glass` `rgba(255,255,255,.92)`、`.cv-play` 白圈、`.cv-switch` 白钮、`.cv-nodelabel` `#1C1B17` 底 —— 对比度 1.02–1.14:1(K4 实测) | 全部改 token 配方:`var(--card)` 填充 + 边框;nodelabel 用 `--primary`/`--primary-foreground`(扩展 polish-delta #5) | 组件级(集中在 globals.css canvas 段) |
| 26 | **宽度/尺寸偏格一批**(碰哪修哪,勿专项扫):列宽 720/920/1180 → 760/880/1280;侧栏 236/222/220/210 → 240/216;topbar 58 → 56;settings 内边距 36/44、节距 34、行 py 13 → 32/40、32、12;220ms 过渡 → 200ms `--dur-3` | §L3/L4/L5/L9 各表为准 | 组件级(顺手) |
| 27 | **Otto 头像尺寸偏格**:15(OttoTrace 眼睛以下)、24、28、30 散见 | 量到 §O1 阶梯 16·22·26·32·40·48·64(15→16 眼睛才可读) | 组件级(顺手) |
| 28 | **hand-rolled tablist 无方向键循环焦点**(OttoMemory、DetailPanel);ConvoTabs 用可点 div | 实现 ←/→ roving focus 或改用 `ui/tabs.tsx`;div → `<button>`(§N8/§A3) | 组件级 |
| 29 | **触达目标不足**:dialog 关闭 32×32、`.cv-play` 30×30、shadcn switch 32×18(低于 24 绝对底线)、`.cv-set-btn` h 34 | §A4:视觉不变,`::after` 扩热区到 36/44;switch 放进 ≥44px 可点行;set-btn h 36 | 组件级 |
| 30 | **UI 文案违例一批**:em-dash 字符串(error.tsx、OttoPlanCard 等)、"please try again"、全大写 "OTTO" 文案(settings sections、"✦ OTTO learned")、筛选空态误用 "Nothing here yet." | §V 各表:句号分句、去 please、"Otto"、"Nothing matches this filter."(fence D8 warn 长期盯) | 组件级(顺手,勿 copy-only 专项 PR) |
| 31 | **`--warning-soft-foreground` 亮色 `#B45309` 差 0.05 不过 AA**(4.45:1) | 提案:→ `#92400E`(6.28:1);唯一一处需要 founder 批准的 token **值** 变更;暗色已达标不动 | 提案级 |
| 32 | **gen-bar 轨道对比不足**:珊瑚滑块对 `--border` 轨道 2.80:1(<3:1) | 轨道改 `--background` + 1px `--border` 发丝线(globals.css 一行),滑块即达 3.42:1 | token 级 ⚡ |
| 33 | **`--surface-hover` 幽灵 token**(OttoNav 菜单用了个从未定义的变量)+ `#b42318` 危险色裸 hex | hover 用 `--accent`;危险色 `--error`/`--error-soft` | 组件级(1 文件) |

## 落地顺序建议(接 polish-delta 的四步)

1. **Token PR(纯 globals.css,与 polish-delta 第一 PR 合并)**:#11 状态色注册 + #12 暗色阴影 + #17 chart/data-label + #18 z-token + #32 gen-bar 轨道 + #15 的全局 focus 规则。
2. **Kit 小修 PR**:#14 阴影任意值形式 + #16 disabled 0.4 + #15 的 alpha 收敛(6 个 ui 文件,每处 1–2 行)。
3. **暗色点火 PR**:#13(K3 五线)—— 依赖 1、2 先行,否则点了也是坏的。
4. **随迭代顺手**:#19–#30、#33 碰哪修哪;#31 单独走 founder 审批;fence 脚本的 ratchet 基线把这些存量锁死不再增长。
