# Northstar Immersive — 上市前实测 QA 汇总(Pre-walk）

**结论一句话:** 三班实测共通过 60+ 条主线剧本(创作/发布/CRM/收件箱/广告/账务/日程全跑通、花钱数学正确、销毁性用例大多优雅回落),没有 P0 崩溃级缺陷;但有 **4 个 P1** 会在上市首日被真实用户撞到(手机端整个版面破版、刷新/深链空白页、控制台常驻两类 React 红错),外加 **12 类 P2** 体验/连续性/文案问题需在 Wave C 一并收口。

严重度计数:**P0 = 0 · P1 = 4 · P2 = 12**

---

## P0 —— 阻断级(0 条)

本轮无 P0。没有白屏崩溃、没有把钱算错、销毁性用例(乱填 id、空提交、Esc 取消、双击确认)均优雅处理,花钱数学逐笔核对无误。

---

## P1 —— 上市首日会被真实用户撞到(4 条)

### P1-1 手机端整壳破版,内容被压到不可用
- **在哪:** 全站 shell(`/northstar-immersive` 每一页,`/create/canvas` 尤甚)
- **怎么了:** 桌面侧栏固定 240px、无汉堡/抽屉,375px 视口下主内容列只剩 ~135px。标题截断(Morning→Morn…)、正文/Otto 卡片一行一个词、按钮切字(Ask Otto→Ask Ott),canvas 内容被整块挤出屏幕。侧栏占了 ~62% 屏宽。
- **该是什么:** 到移动断点侧栏收成抽屉/汉堡,内容用满宽,页面可读可操作(验收:不破版、可操作)。桌面 1280px 本身正常(nav 240 + main 1030)。
- **复现:** preview_resize mobile(375)→ 打开 `/northstar-immersive` → 看侧栏铺满、内容列 ~135px 截断;`/create/canvas` 同样。

### P1-2 刷新/深链 searchParams 详情页永久空白
- **在哪:** `/campaign/detail?id=…`、`/create/asset-viewer?asset=…`、`/schedule/composer?post=…`
- **怎么了:** 三类 query-param 详情页在直接输网址/浏览器刷新时,`<main>` 只剩一个未解析的 React Suspense 边界(`<!--$~--><template id="B:0">`),永远不填充。只有从 app 内点卡片软导航过去才渲染。无控制台报错、无失败请求。
- **该是什么:** 直接 URL 或刷新应渲染与软导航相同的内容(至少给个会解析的骨架),而不是永久空白。非参数页(overview/inbox/crm/credits)硬加载正常。
- **复现:** 直接打开 `/campaign/detail?id=camp-merdeka-01`(或到达后刷新)→ 内容区空白;`asset-viewer?asset=as-02`、`composer?post=post-01` 同样。

### P1-3 控制台常驻:重复 React key 红错(全站)
- **在哪:** 全部 `/northstar-immersive/*`(inbox/shared、inbox/knowledge、campaign/detail、create/canvas、media-editor、analytics/overview 均已确认),来自共享 shell
- **怎么了:** `Encountered two children with the same key` 反复触发(累计 70+ 条)。非唯一 key 会导致 React 复制或丢失子节点——在 `media-editor?asset=cv-img-1` / canvas 双图生成时**可见地发生**:生成完成气泡「All 2 are ready on the canvas」渲染了两次,一次快速生成只 2 条完成日志却留下 6 个对象。analytics/overview 冷加载也偶发 24 条(热刷新不复现)。
- **该是什么:** 每个列表子节点(生成对象、聊天消息、frames/版本)都用唯一 key;无 key 冲突、无重复/丢失子节点。
- **复现:** 打开任一 immersive 页开 devtools console 即见;或在 canvas 生成 2 张 A/B 图,观察重复的「All 2 are ready」气泡。

### P1-4 控制台常驻:CanvasPage 渲染期写 nav 状态(setState-in-render)
- **在哪:** `/create/canvas`(CanvasPage → ImmersiveNav),`/create/media-editor`
- **怎么了:** 控制台红错 `Cannot update a component (ImmersiveNav) while rendering a different component (CanvasPage)`。CanvasPage 在 render 阶段写共享 immersive store(ImmersiveNav/dock 订阅它),这也是 Next.js dev「1 Issue」角标的来源。nav 通知角标在 canvas 渲染中肉眼可见地抖动(2→4→3→2)。源头:`apps/web/components/northstar/create/canvas-page.tsx`(约 line 56 导入 `setOttoWorking`,bootstrap/seed 路径在初次 render 写 store)。
- **该是什么:** 触及 nav/dock 的状态更新放到 effect/handler,不在 render 阶段;无 setState-in-render 警告。
- **复现:** 打开 `/create/canvas` → 看 console → 加载即报,每次生成再报。

---

## P2 —— 体验/连续性/文案(12 类)

### P2-1 跨区状态不持久(连续性,分量最重)
- **在哪:** dock ↔ `/otto`;`/schedule/*`;`/campaign/detail`;`/campaign/calendar` → `/schedule/plan`;nav credits
- **怎么了:** 各区是独立静态 mock,状态互不共享。最扎眼的是 Otto dock 里发的消息在 Maximize 到 `/otto` 后消失——而那页当面写着「One thread — Whole business」。此外:credits 导航即重置(canvas 花完显 1,216,别的页都回 1,240);刚排的帖不进 `/schedule/queue` 或 `/schedule/plan`;对象 Add to campaign 后不进该 campaign 的 Content tab 也不进 `/assets/my-stuff`;campaign/calendar 改的文案(已保存、pack-confirm 也正确反映)**不**传播到 `/schedule/plan`(那里仍是原 hook「The box that sells out every Merdeka」,而非「QA EDITED…」)。
- **该是什么:** 上市至少让头部连续性流打通共享 store——Otto 线程 dock↔全屏一致、credits 余额一致、排好的帖落进 plan/queue、campaign 编辑处处一致(日历自己也写着「it stays in sync」)。
- **复现:** dock 发消息 → 点 Open full Otto → 消息不见;或 canvas 生成(credits 掉)→ 换页 → 余额回 1,240;或 calendar 改 hook 保存 → 到 schedule/plan 仍是原文。

### P2-2 图片资产在全屏 viewer 里混入视频元数据
- **在哪:** `/create/asset-viewer?asset=cv-img-1`
- **怎么了:** 主图正确(Merdeka box hero),但周边是视频/通用样本元数据:DETAILS 写「Kind: Image」却又「Duration: 6s / Resolution: 720p」;渲染 FRAMES 胶片条(0s–5s)和视频「Regenerate / Continue(6s, 720p)」控件;「v3 - current」版本缩略图是另一张图(croissant,photo-1517248135467)而非当前 hero(photo-1464349095431)。
- **该是什么:** 图片资产隐藏视频专属 UI(frames/时长/分辨率/视频重生成);版本缩略图应对应该资产真实历史。
- **复现:** canvas → 选 Merdeka box hero → Full screen → 看 VERSIONS/FRAMES/DETAILS。

### P2-3 花钱 Confirm 按钮无防重入守卫(钱安全硬化)
- **在哪:** `/create/canvas`(Generate 确认弹窗)
- **怎么了:** Confirm CTA 无 submitting 标志/同步禁用,单帧内多次点击各自扣费:同 tick 连点 5 次扣 60 credits(5×12)且与实际任务失步(只 2 条完成日志)。**正常鼠标双击不触发**——已验证跨帧双击只扣一次(首点后弹窗卸载)。按产品「花钱安全」优先级作为硬化项报出。
- **该是什么:** Confirm 首次激活即同步置 submitting/禁用自身,任何同 tick 二次点击都不能再扣。
- **复现:** canvas → 走到 Confirm 弹窗 → 单 JS tick 内程序化连点(非普通鼠标双击)。

### P2-4 选中对象工具栏 Full screen / Crop 链接漏 `-immersive` 段
- **在哪:** `/create/canvas`(选中对象工具栏)
- **怎么了:** 链接写成 `/northstar/create/asset-viewer?asset=…` 和 `/northstar/create/media-editor?asset=…`,少了 `-immersive`。只因预览环境把 `/northstar` 重写到 `/northstar-immersive` 才解析成功;没这个重写就会 404。
- **该是什么:** 直接指向 `/northstar-immersive/create/…`(与所有 nav 链接一致),不依赖仅预览环境的重写。
- **复现:** canvas → 选对象 → 看 Full screen / Crop 的 href 属性。

### P2-5 消息上下文 chip 深链不精确
- **在哪:** `/otto`(消息上下文 chip)
- **怎么了:** 「Campaign · Merdeka week bakes」「Campaign · Raya open house」都指向通用 `/campaign/list` 而非各自 detail。两个同标签「Canvas · Merdeka box hero」chip 指向**不同**页(`/assets/library` 与 `/assets/brand-memory`),且都不是 Canvas。
- **该是什么:** chip 应深链到被引用的具体实体(按 id 到 campaign detail、到 canvas/对象),同标签不该解析到不同目的地。
- **复现:** 打开 `/otto` 查消息上 chip 的 anchor href。

### P2-6 Otto dock 发送提示与全站惯例相反
- **在哪:** Otto dock(任意页)
- **怎么了:** dock 底部提示「Shift+Enter to send · Enter for a new line」,与 app 其他所有 composer(Enter 发送)相反。
- **该是什么:** Enter 发送、Shift+Enter 换行(至少与 canvas composer 一致)。
- **复现:** 打开 Otto dock 看 textarea 下方脚注。

### P2-7 不存在的 asset id 静默回落到默认资产
- **在哪:** `/create/asset-viewer?asset=totally-bogus-id-9999`
- **怎么了:** 不存在的 id 直接渲染一个真实默认资产(「Croissant fold reel」)而非 not-found/空态。不崩溃(优雅),但会误导——用户可能以为坏链是有效资产。
- **该是什么:** 显式「asset not found」态(或重定向),不要替换成无关默认资产。
- **复现:** 直接开 `/create/asset-viewer?asset=totally-bogus-id-9999`。

### P2-8 `/schedule` 裸索引直接 404
- **在哪:** `/northstar-immersive/schedule`
- **怎么了:** 裸 `/schedule` 返回整页「404 This page could not be found.」;只有 `/schedule/plan|calendar|queue|composer` 存在,命中区根(或旧分享链)就是死胡同。
- **该是什么:** `/schedule` 重定向到 `/schedule/plan`(默认 tab),与 nav 链接解析一致。
- **复现:** 直接开 `/northstar-immersive/schedule`。

### P2-9 广告诊断「修一下」CTA 打开 canvas 不带上下文
- **在哪:** `/ads/performance` → `/create/canvas`(analytics 的「Make more like it」同样)
- **怎么了:** 「Recut with the payoff first」CTA 是无 query 的 `<a href='/northstar-immersive/create/canvas'>`,点后 canvas 落在预置默认「Merdeka box shots」对话,与刚诊断的 croissant-timelapse 广告无关。卡片文案却暗示带种子(「Opens in canvas」)。sessionStorage/localStorage/location.search 均无上下文。
- **该是什么:** canvas 应带诊断广告的上下文(recut brief)开场(回 canvas 带上下文的闭环)。
- **复现:** `/ads/performance` → 展开「Croissant fold timelapse 30s」→ 点「Recut with the payoff first」→ canvas 是通用 Merdeka demo。

### P2-10 提交审批不进 team/approvals 队列
- **在哪:** `/ads/builder` → `/team/approvals`
- **怎么了:** ad-builder「Submit for approval」把 builder 翻成「Pending approval」,但提交的 campaign 从不出现在 team/approvals 队列(那里只列两条预置 editor 项)。两个界面脱节,提交项无法被查看/审批。
- **该是什么:** 提交审批的 campaign 应出现在队列里可被审批人看到并操作。
- **复现:** `/ads/builder` → Submit for approval → 确认 → 开 `/team/approvals` → 找不到该提交项。

### P2-11 旗舰 canvas demo 图与叙事不符
- **在哪:** `/create/canvas`
- **怎么了:** 聊天要「a hero shot of the Merdeka gift box」,但 Image 1 是彩虹千层蛋糕、Image 2 是蜂蜜煎饼堆、Image 3 是蓝灰抽象漩涡(根本不是食物),削弱旗舰 demo 说服力。7 张图均正常加载(0 破图),纯内容匹配/打磨问题。
- **该是什么:** 旗舰 canvas 的占位/demo 图应是与 prompt 一致的品牌烘焙礼盒图,别用无关素材(尤其那张蓝色抽象)。
- **复现:** 开 `/create/canvas`,对比聊天文案(Merdeka gift box)与三个图节点主体。

### P2-12 文案微 bug 合集(缺空格 / 冠词错)
- **在哪:** 三处
- **怎么了:**
  - `/create/canvas` quick-check 卡:「Sounds like a Image job.」——CSS 大写的 image 前应为 an。
  - `/northstar-immersive` 首页 Otto 桃色卡:「…drove most of it.Want me to turn…」——句号后缺空格。
  - `/ads/performance` 过期广告横幅:「2 ads havegone stale」——have 与 gone 粘连。
- **该是什么:** 分别改为「Sounds like an image job.」「…most of it. Want me to…」「2 ads have gone stale」。
- **复现:** 依次访问上述三页读对应文案。

---

## 修复建议分工

### 即刻修(小改、高可见、正确性/钱安全,不必等 Wave C)
- **P1-3 / P1-4 两类控制台红错** —— dev「1 Issue」角标来源,列表 key 唯一化 + 把 CanvasPage 的 store 写从 render 挪进 effect;correctness 底线,应先清。
- **P2-3 Confirm 防重入守卫** —— 触及花钱,founder「安全 > 效率 > 易管理」,即刻加 submitting 同步禁用。
- **P2-4 链接漏 `-immersive`** —— 改字符串即可,消除对预览重写的隐性依赖。
- **P2-8 `/schedule` 重定向到 /plan** —— 一行 redirect。
- **P2-6 Otto dock 发送提示** —— 改脚注文案(顺带对齐 Enter 发送行为)。
- **P2-12 文案三处** —— 纯文案,顺手清。

### 进 Wave C「循环系统」施工一起修(结构性,需共享 store / 类型感知)
- **P1-1 移动端整壳响应式**(抽屉/汉堡 + 用满宽)—— shell 级重构,单独一块。
- **P1-2 直链/刷新空白**(searchParams + Suspense 解析)—— 结构性,与数据流一起收。
- **P2-1 跨区状态持久化**(dock↔/otto 一线程、credits、排帖落 plan/queue、add-to-campaign、calendar→schedule 传播)—— 这就是 immersive 要装的「循环系统」本体,共享 store 落地时统一解决。
- **P2-2 图片资产隐藏视频 UI + 版本历史正确** —— 需资产类型感知,随资产模型一起。
- **P2-5 上下文 chip 深链到具体实体** —— 需真实实体链接,随共享数据模型一起。
- **P2-7 bogus asset not-found 态** —— 随 asset 数据层加空态。
- **P2-9 修一下 CTA 带上下文回 canvas** —— 需 canvas 种子机制,与闭环一起。
- **P2-10 提交审批进队列** —— 需两界面共享审批 store。
- **P2-11 canvas demo 图换成品牌礼盒** —— 内容/素材更新,随旗舰打磨一起。
