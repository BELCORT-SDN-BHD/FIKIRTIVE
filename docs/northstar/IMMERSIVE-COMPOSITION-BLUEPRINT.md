# 北极星沉浸版 composition 蓝图(North Star Immersive — Composition Blueprint)

> **文件性质 —— 先读这个**
> 本文件是 `/northstar-immersive`(沉浸版)的 **composition 蓝图**:把 57 张原型页从"一堆样板间"综合成"一个能走通的连通 app"的施工总图。它是给非技术 founder 逐区过目、逐区批准用的草稿(华语,宪法 9;plain 人话)。
> 效力位置:金字塔"施工图"层,承接 `docs/northstar/PROGRAM.md` 总纲。本文件**不制造任何新产品决定** —— 每一区、每一页、每一条连线都引用蓝图 / 判决记录 / 已批 spec / 现有代码事实;发现冲突 → 停手、报告、等 founder 裁决(蓝图赢)。
> 它回答的是 PROGRAM.md 没回答的那半个问题:样板间已经各自建好了,**它们怎么拼成一栋能从任意一层走到任意另一层、不跳出去的楼**。
> 合并本文件 ≠ 批准施工;批准仍走 `docs/northstar/APPROVALS.md` 逐页拍板。本文件是那张拍板台账的"总规划底图"。

## 人话对照表(工作规矩②)

| 内部代号 | 人话 |
|---|---|
| composition / 编排 | 不是画单页,而是"把已有的楼拼成一座能走通的城"的那层设计 |
| ImmersiveShell / 沉浸外壳 | 常驻不重载的产品壳:左边导航 + 中间唯一会滚动的内容区 + 右下角 Otto 助手球 |
| connected app / 连通 app | 能从任意一区一步走到任意另一区、页面之间平滑流转的一个应用;反面是"57 张彼此不通的设计稿" |
| GalleryFrame / 画廊套壳 | 把旧的静态设计页原样塞进沉浸外壳里、没按新设计法重画的临时做法(34 页目前如此) |
| native / 原生页 | 按新设计法在沉浸外壳里亲手重画的页(23 页目前如此),是重建质量标杆 |
| mock 数据脊梁 | 全城共用的那一份虚构商家资料(Roti Bulan Bakery),让每一区看到的是同一个店 |
| kit 合并 | 把两份复制粘贴、已开始漂移的组件库,收成一套共享组件 |
| zone-to-zone / 跨区走位 | 从一栋楼走进另一栋楼的真实路径(点导航、点卡片、深链) |
| Otto 时刻 | 每一区里"Otto 做了/正在做某事"该怎么安静地被看见(coral 高亮、助手球脉冲、叙述条) |
| coral | Otto 专属的那一抹暖色,别的东西一律不许用 |

---

## 〇、founder 一分钟版(先读这段)

**问题的根**:沉浸版本该是"一个能走通的 app",但它其实是**拼凑**的 —— 57 页里有 **34 页是旧画廊页原样套了个壳**(没按新设计法重画),另外 23 页又分成两批、各写各的组件和假数据。散,是结构性的,不是错觉。

**这张图纸做的事**:把那个不存在的"整体施工图"补出来,让每一区都照**同一张图**建,拼起来才是一座连通的城,而不是 57 张各自为政的设计稿。

**图纸定死的四件事**:
1. **一套骨架**:全城一套共享组件 + 一条数据脊梁 —— 每一区看到的都是**同一个虚构商家**(Roti Bulan 面包店 / 老板 Aisyah),不再各编各的假名字假数据。
2. **一条主动线**:创作 → 排期 → Campaign → 分析 → CRM → 收件箱,每一步都能一键走到下一步,**没有死胡同**。
3. **Otto 的规矩**:常驻右下角助手球,随时能唤起、干活时被看见(coral 暖色只属于 Otto),但**永不抢占主场**;市政厅是唯一 Otto 不进的楼。
4. **重建顺序**:先立地基(合并组件 + 统一数据)→ 再把**两个旗舰区(创作/画布 + Campaign)+ 分析金标准**做到完美给你验 → 方向对了再铺满全部 57 页。

**你现在要做的**:读下面(尤其第七章"现状差距图"和第八章"重建顺序"),批准这张图纸。**批了我才照它动第一行重建代码。**

---

## 一、这个 app 是什么

**一句话:`/northstar-immersive` 不是 57 张设计稿的画廊,是一个连通 app —— 一座能从任意一区走到任意另一区的城,只有一扇门。**

它把蓝图第一章那个「ALL-IN-ONE marketing power house」全景,装进**一个常驻不重载的产品外壳(ImmersiveShell)**:

- **左边**一条持久导航(240 宽的产品 rail):Create / Assets / Operate 三组工具 + History(历史)+ Balance(余额)+ Identity(身份)。
- **中间**是**唯一会滚动的内容 pane**(换路由 = 换 key 做一次轻 fade,不是整页刷新)。
- **右下角**是**永远在的 Otto dock**(助手球):一步可唤起,收起是 48 圆点、展开是能打字的小工作面。

进城看到的是**首页 front door**:招呼店主(Morning, Aylia)、一条 coral 的 Otto 洞察条、三张可点进分析/排期/账单的 KPI 卡、四个 quick-start、Recent work 和 Up next —— **每张卡都是通向一个真实流程的 `<Link>`,不是死图。**

**商家一天怎么用它**:从首页或任意一区起手 → Otto 一步可唤起(dock 或 `/otto` 全屏,同一个大脑同一份 thread)→ 人工也可以亲手进任何一栋楼把事做完 —— **两条路通向同一份数据**。跨区走位靠三样东西缝成一条连续的流,永不跳出外壳:① 导航;② 深链(deep-link,如 `?asset=id`);③ 被拦截重写的交叉链接(`useKeepInsideImmersive` 把页内硬编码的 `/northstar/*` 点击在 capture 期改跳 `/northstar-immersive/*`)。

**六条它必须是「连通 app 不是页面画廊」的证据(全部可追溯到输入)**:

1. **只有一扇门**(废除 `/simple`+`/pro` 双门):同一个 app 里 Otto 和人工操作同一批楼,双模两条路通向同一份数据;Pro/agency 是往上加的楼层,不是并排的另一栋楼。
2. **双模无例外**:每个功能区必须(a)人工可完整操作 + (b)Otto 可 100% 操控,界面按钮和 Otto skill 走同一个 server action,禁两套实现(宪法 7)。
3. **Otto 常驻但永不抢主场**:画布/工作台是主场,Otto 以 dock/边栏安静住着,随时一步唤起、工作永远可见,但不霸占屏幕(宪法 11)。
4. **coral 只属于 Otto**:导航零 coral,coral 是 Otto 动作的专属视觉语言;首页招呼条是本屏唯一 coral statement。
5. **界面秒级反映后台**:推送优先、短轮询兜底;「后台已完成而界面不知」按缺陷处理;Otto 永远经动作层操作,不做像素级 computer-use(住在家里用门,不爬窗)。
6. **结构性保证**:一个常驻外壳 = persistent nav + 唯一滚动内容 pane + 常驻 dock;页面之间靠 `<Link>` / 深链 / `useKeepInsideImmersive` 缝成连续的流。这句话就写在 `immersive-shell.tsx` 的文件注释里:「the one persistent product shell, not a page gallery」。

---

## 二、信息架构

### 2.1 一扇门 + 一个外壳

整座城**只有一扇门**、**一个外壳**。外壳由三件常驻件构成(`immersive-shell.tsx` §L1):

```
┌────────────────────────────────────────────────────┐
│  ImmersiveShell  (h-dvh flex · body 不横滚)          │
│ ┌──────────┬─────────────────────────────────────┐ │
│ │          │                                     │ │
│ │  NAV     │   CONTENT PANE                      │ │
│ │  240     │   (唯一滚动所有者 overflow-y-auto    │ │
│ │  常驻     │    + min-w-0 · 换路由=换key 220ms   │ │
│ │  左 rail  │    fade-in · reduced-motion 不动)   │ │
│ │          │                                     │ │
│ │          │                          ┌────────┐ │ │
│ │          │                          │ Otto   │ │ │
│ │          │                          │ dock   │ │ │
│ │          │                          │ 常驻🔴  │ │ │
│ └──────────┴──────────────────────────┴────────┘ │ │
└────────────────────────────────────────────────────┘
   无顶栏 · 无画廊三态切换器 · 无 57 项目录轨
```

- **导航(左 rail,`immersive-nav.tsx`)** —— 六区固定顺序(§N2):① Brand(回沉浸首页)② New(唯一 INK 主按钮)③ History(campaign + 嵌套会话)④ 工具三组 Create→Assets→Operate(#129 分组税)⑤ Balance 钉底(coral credit 币 + Top up)⑥ Identity(头像)。导航形态是**单一状态系统**(§N3):rest 透明、hover=`--accent`、active=`--secondary`+600,**零 coral、零左条**;coral 库存严格三件(brand mark / 6px 活动点 / credit 币)。
- **内容 pane** —— 唯一滚动的地方;每个内容页各自从 §L3 宽度梯挑一档并居中。
- **Otto dock(`immersive-dock.tsx`)** —— fixed 右下 z-70;收起 48×48 圆点 ⇄ 展开 380×520 面板,是能真打字的一小块工作面 + 右上 Maximize2 跳全屏 `/otto`。dock 与全屏页是**同一个 Otto 的两个入口**。

### 2.2 14 区如何编排进一个连通 app

57 条路由分属 **14 个区**(〇 全局横切 + 一到十三)。它们不是并列的 14 个孤岛,而是围绕一条主动线编排:

```
        ┌─── 十二 Onboarding/登录 (城门,壳外前庭)
        │
   [ 进城 ] → 〇 沉浸首页 (front door) ←──────── Otto dock/全屏 (〇)
        │                                            ↕ 同一个 Otto
        ├─→ 一 创作区 (canvas-as-home,主场/心脏) ★旗舰
        │       ↓ 成片
        ├─→ 二 排期区 → 十 团队审批 → 发布
        │       ↑ 提案毕业
        ├─→ 六 Campaign 区 (编排中枢) ★旗舰
        │       ↑ 依据          ↓ 投给谁
        ├─→ 三 分析区 (设计基准) → 五 广告区 (看-修-扩)
        │
        ├─→ 四 资产区 (货架/供货端)
        ├─→ 七 CRM 区 (人的账本) ←→ 八 收件箱 (前台接客)
        ├─→ 九 自动化区 (授权书档案室)
        └─→ 十一 住户服务中心 (管账后屋:钱/身份/连接)

   十三 市政厅 (内部运维台,Otto 永久豁免,对客看不见这扇门)
```

**编排法则(信息架构层)**:
- **进城默认落点** = 沉浸首页(`immersive-home.tsx`);首页每张卡是通向某一区某个真实流程的 `<Link>`。
- **主场是创作区**(canvas-as-home):它是家与心脏,别区的产物都从这里生出、又都能一键回流。
- **导航是全城唯一的走路方式**:任意一区经左 rail 一步可达任意另一区(§N2 分组税)。
- **Otto 是横切的第 15 种存在**:不是一个区,是住在每一页右下角的常驻 dock(〇 全局)。

---

## 三、共享骨架

**一套 kit + 一条 mock 数据脊梁 = 一个虚构商家,全城同一份数据。** 这是「连通 app 不是画廊」在代码层的落地:如果每区各画各的组件、各编各的商家,城就散了。

### 3.1 一套 kit(合并两份重复的组件库)

**现状**:两套区级 kit(`account-ops/kit.tsx` 238 行、`crm-inbox/kit.tsx` 247 行)是同一批原语的复制粘贴,几乎逐字重复,**已开始漂移**。

**逐项重叠(两文件各定义一份、实现相同)**:Card、CardHeader、SegNav、fmtStamp、useReducedMotion、useSweep(600ms coral sweep 注入了两个独立 `<style>`,产品里其实是同一个动效跑两份)。

**漂移点(同名不同物,重建陷阱)**:
- **ChannelTag 签名不兼容** —— account 版吃 `NsChannel`(5 值),crm 版吃 `NsInboxChannel`(3 值);crm-contacts 还要 `as NsInboxChannel` 强转才能喂进去,埋了运行期不一致的雷。
- **页壳不统一** —— crm 抽了 `ZonePage`,account 每页手抄 `mx-auto max-w-[880px]`;max-width 还不一样(account 880、crm-contacts 920)。
- **通用件被塞进区级 kit** —— crm 独有 Initials/fmtDate/fmtMyr、account 独有 SettingRow/SectionTitle。

**结论 —— 上提为 immersive 级共享 kit**(`KIT_SPINE` 逐条):

| 共享件 | 作用 | 收敛掉的重复 |
|---|---|---|
| `IMMERSIVE_BASE` | 唯一 base-path 常量 | ACCOUNT_OPS_BASE + CRM_INBOX_BASE(俩都是同一字符串) |
| `useReducedMotion()` | §A5 hook | 4 份逐字副本(两 kit + shell + dock) |
| `useSweep()` + 单一 coral keyframe | §8a 一次性 coral sweep(≤600ms) | 两份仅 keyframe 名漂移的副本 → 一个注入 |
| `Card` / `CardHeader` / `SectionTitle` | §5/§L5 面与段头 | 两份相同副本 |
| `ChannelTag` + 单一 CHANNELS(全 5 渠道) | §N 渠道 chip | 两份签名冲突的副本 → 一个吃全 5 渠道,inbox 只传它用的 3 个 |
| `Initials` | 确定性头像 chip | crm 独有 + nav/team 各自内联重造 |
| `fmtStamp/fmtDate/fmtMyr` | 确定性时间/金钱格式(无 locale API) | fmtStamp 两份 + fmtDate/fmtMyr crm 独有 |
| `SegNav`(带 `activePrefix` 匹配器) | §N4 段控子导航 | 两 kit 各一份 + 5 个具名包装 → 一个,每区只给 VIEWS 数组 |
| `ZonePage`(`width` prop 按梯) | §L2/§L3 页壳 | crm 独有 + account 每页手抄 |
| `SettingRow` | §F7 设置行 | account 独有,提为共享 |
| **`PageHeader` / `StatCard` / `EmptyState`** | §N6/§D3/§V4 | **从 `_shared.tsx` 复用,禁止 fork**(home 已用同一份;account/crm 页绑上去,防第三份) |

**净结果**:单一 SWEEP keyframe、单一 ChannelTag、两份区级 kit 只留真正的区专属件。

### 3.2 一条 mock 数据脊梁(一个虚构商家)

**先纠正一个已知误解 —— 商家身份没有碎裂**:全站只有一份城级 mock `components/northstar/_mock.ts`(`NS_BRAND` = **Roti Bulan Bakery** / owner **Aisyah Rahman** / Bangsar KL / MYR / creditBalance 1240,语气 warm/neighbourly、KL 式英马混说)。两份区级 `data.ts` 都 `from "@/components/northstar/_mock"` 派生;nav 走的 `global/_data.ts` 只是 re-export 同一个 `_mock`。所以名字/城市/产品/客户在原生页里是一致的,**「一个商家」的错觉在原生页成立**。

一份脊梁如何串起全城(`KIT_SPINE.mockTenant`):

```
_mock.ts (唯一 tenant · Roti Bulan Bakery)
 ├ NS_PRODUCTS  (pandan cake / kaya croissant …) → CRM 知识答案 · deal 标题 · brand-memory · campaign hooks
 ├ NS_CONTACTS  (Mei Ling / Hafiz / Priya …)     → CRM 联系人 · deals · segments(纯 filter)· 对话参与者
 ├ NS_CONVERSATIONS                              → inbox shared · contact-profile 历史;comments 派生自已发帖
 ├ NS_SCHEDULED_POSTS                            → schedule queue · home · comments 源
 ├ NS_CAMPAIGN(_ENTRIES)                          → home 'Up next' · nav History · campaign 区 · dock thread
 ├ NS_ASSETS / STUFF / GEN_RECORDS               → home Recent work · library · my-stuff · campaign 产出
 ├ NS_CHAT_THREADS                               → nav History · dock · 全屏 Otto
 └ NS_BRAND + NS_CREDIT_LEDGER                    → credits / connections / team / wallet
```

**真正的碎裂在别处 —— 派生视图常量各写各的、并与源事实漂移(重建必修)**:
1. **金额口径不一致**:`crm-inbox/data.ts` 的 `DEALS.amountMyr` 硬编码(170/1080/88/620/340),注释宣称派生自 `totalOrdersMyr` 实则漂移 —— 同一客户在 contacts 页(ct-01=640…)和 deals 页金额对不上。**这才是破坏「一个商家一套账」的点。**
2. **渠道口径被各区重造**:account kit 的社媒 handle 独造无源;`NS_CONNECTIONS`(5 渠道)与 crm 只认 3 渠道不一致;`account-settings` 页头「3 / 5 connections」直接写死在 JSX,没读 `NS_CONNECTIONS`。
3. **结构常量当本地事实**:充值档位、规则/例程、成交阶段、分群、知识库、admin FLAGS 各自散在区级文件。

**重建时的数据脊梁纪律(`KIT_SPINE.dataSpineShape`)**:
- `_mock.ts` 是唯一 tenant aggregate root;新增**一层 `_selectors.ts`**,把现在各页内联重算的跨区读(`creditSummary()`、reach 28 total、published-posts filter、bestSellers)收成共享 selector —— home/account/crm 调同一个,不再各自 sum。
- 两份区级 `data.ts` 的 pass-through re-export 折掉,页面 import selector 而非裸数组。
- **晋升规则**:某个数据被第二个区需要时,它**向上晋升进 `_mock.ts`**(单一源),区之间永不横向复制。
- 区级只允许加「产品口径、不是品牌事实」的结构(deal stages / top-up packs / rules),明确注记。

---

## 四、连通法则

**zone-to-zone 的真实走位**:一条主动线把六个区缝成一次连续的流,每个花钱/对外动作仍过既有的闸。

### 4.1 主动线:canvas → schedule → campaign → analytics → CRM → inbox

```
一 创作区 canvas          做出成片
   │  「排期这条」/查看器 Share
   ▼
二 排期区 composer→plan   落时间轴 → 待批 →(十 团队审批)→ SCHEDULED → 发布
   │  提案毕业着陆坪 ↑↓ 同一份数据
   ▼
六 Campaign 区            研究→提案→生成(pack-confirm 过闸)→ 回排期
   │  依据 ↑ trends        投给谁 ↓ 喂 segment
   ▼
三 分析区 overview        看结果(设计基准)→ insight「Make more like it」回 canvas
   │  广告读面 → 五 广告区 performance 诊断卡 → 回 canvas 改素材
   ▼
七 CRM 区 contacts        对话/广告把人自动带进来 → 档案 → 分群
   │  分群「Post to this group」→ 排期
   ▼
八 收件箱 conversation     从对话进来 → 存档案(回七)→ 分群 → 下一轮 campaign(回六)
```

**闭环成立的证据**:分析 insight → 创作(O-10 诊断→创作链);分群 → 排期(broadcast 真去处);对话 → CRM 档案(同一个人);CRM 分群 → campaign(投给哪群)。**没有一条是死胡同** —— 每个读面都接回一个下一步动作。

### 4.2 缝合机制(三条,永不跳出外壳)

1. **`<Link>` 深链**:首页 KPI→分析/排期/credits、Recent→`asset-viewer?asset=id`、Up next→`composer?post=id`。
2. **`useKeepInsideImmersive`**:capture 期委托监听,把复用页里硬编码的 `/northstar/*` 普通左键点击改跳 `/northstar-immersive/*`(这是 library→canvas、templates→canvas 等流的实现)。
3. **`openOtto(prompt?)`**:任意页「问 Otto」注入预填 prompt、展开 dock,不自动发送、不自动花钱。

### 4.3 六条 live-reflection 与花钱闸(横切所有连线)

- **秒级反映**:后台/Otto 的动作推送优先、短轮询兜底(宪法 11)。
- **coral 只属于 Otto**:导航零 coral、搜索 item hover 永不 coral、dock 面板行中性;coral 只在被跳到的**目标元素**上 sweep。
- **计费透明 + 钱路神圣**:spend 面只显示 credits,money-in 显示 MYR;`needsApproval = 花钱 ∥ (写 ∧ 外部)`;money-in 是 Otto 永不代办的豁免;首页/factory/campaign 的付费点都先过总价确认页。

---

## 五、逐区 composition 契约

> 每区给:**角色 / 逐页布局 archetype + 宽度梯 / 关键交互 / 跨区链接 / Otto 时刻 / 重建动作**。所有断言可追溯到 `ZONE_CONTRACTS`。宽度梯档位见 design-rules §L3(front-door 1080/1280、data console 1280、mixed 880、reading 760、config/单栏 560、auth 360、chat 480)。

---

### 〇 全局横切(外壳 / 导航 / dock / home / Otto 全屏 / 搜索 / 通知 / 法务)

**角色**:连通 app 的"地基与走路方式" —— 一套常驻外壳(240 rail + 唯一滚动 pane + 右下 dock)托起全城每一页,是「只有一扇门、canvas-as-home、Otto 常驻不抢主场」三条法则的物理载体。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键点 |
|---|---|---|
| 导航骨架 | §L4 rail 240(≤680 折 280 drawer) | 六区固定顺序;每行真 `<Link>`;coral 严格三件 |
| 沉浸外壳 | §L1 h-dvh flex;pane 唯一滚动 | 换路由 220ms fade;`useKeepInsideImmersive` + `openOtto` |
| Otto dock | §8d/§O6 fixed 右下 z-70;面板 380(chat 档) | 48 圆点 ⇄ 380×520;能打字 + Maximize2 跳全屏;Esc 收起、不 outside-click 关 |
| 沉浸首页 | §L2 front-door;内容列 1080 | Otto 招呼条 → KPI 三卡 → Quick starts 四卡 → Recent 3 列 + Up next 2 列 |
| 全局搜索 | §L2 List;720（**注:偏离七档,760 才是最近档,记为漂移**) | 命令面板;空词=Recent、有词=Projects/History/Chat 三组;300ms 防抖 + 骨架 |
| Otto 全屏 `/otto`+`/global/otto-chat` | §L2 Workbench;左 thread 轨 + 680 阅读列 | **两路由复用同一画廊源**;`/otto` 是 dock 放大入口 |
| 通知与审批 `/global/notifications` | §L2/List | ApprovalRequest 一原语;Otto 动作时间线(与 dock 同源);不发明独立通知系统 |
| 法务 `/global/legal` | §L3 reading 760(设计降级) | tab 切 privacy/terms/data-deletion;无 Otto、无 coral |

**跨区链接**:左 rail 是全城分发中枢 —— New→创作、Storyboard→分镜、Schedule→排期、Analytics→分析、Library/Templates/Discover→资产、Campaigns→Campaign、Contacts→CRM、Connections/Account/Balance→住户服务中心;dock Maximize2 ↔ 全屏 Otto。

**Otto 时刻**:把 §8 四种 live-reflection 收进「常驻但不抢主场」—— ① dock 圆点是全城唯一永久动的 Otto(26px live mood + 8px brand 徽点脉冲);② dock 面板 header = §8c narration 解剖;③ 首页招呼条 = §O4 本屏唯一 coral statement;④ 交叉页由 §8b card landing + coral sweep 承接。**缺口(rebuild 要补)**:§O3 规定 Otto home(`/otto`)dock 应隐藏,现外壳未按路径隐藏 —— 两个 Otto 同屏,超预算。

**重建动作**:`merge-kit`(外壳/nav/dock/home/search 已原生,合并 kit + 补 `/otto` dock 隐藏)。

---

### 一 创作区(canvas / 创作首页 / 资产查看器 / 素材编辑 / 分镜 / 工厂 / 想法)— ★旗舰

**角色**:这座连通 app 的**家与心脏**。canvas-as-home,进城默认落点,画布/工作台永远是主场,Otto 以壳级常驻 dock 安静陪跑;别区产物都从这里生出、又都能一键回流就地进化。

**逐页布局 archetype + 宽度梯**:
| 页 | archetype / 宽度梯 | 关键交互 | 合规闸 |
|---|---|---|---|
| 创作首页 `/create/home` | §L2 front-door;composer 560 + Discover 网格到 1280 | 三模式 composer 提交→跳 canvas 裂变;What's new 首登弹窗 | 提交零花费(只跳转) |
| **Canvas 主场** `/create/canvas` | §L2 Workbench(唯一严格 workbench);左 chat clamp(320/30%/420)+ 右无限画布 | GOAL 全表 B1–J2:pan/缩放、落位、拖动、视频内嵌、中间态、Make Video、多选 Stitch、命名思考 + 中断、@Image N 引用 | 图直出(余额即闸);视频/批量走 SpendConfirmDialog;Delete 键故意失效,删除只走 ✕→确认 |
| 资产查看器 `/create/asset-viewer?asset=id` | §L2 Detail overlay;媒体 840 | 版本/帧轨 · 续写 · Download/Share | overlay = canvas 二级 place(Back 回 canvas);续写=真花费,按边界 A 报价 |
| 素材编辑面 `/create/media-editor` | §L2 Detail;媒体 840 | Crop/Trim 双把手逐帧/Extract Frame | Trim 重渲染=新花费点,过闸报价 |
| 分镜工作台 `/create/storyboard` | §L2 List/Detail;网格 880–1280、逐镜 760 | 1–3 步 $0,第 4 步 make-all 付费渲染 | make-all 走确认闸;进度 §FB8 determinate coral |
| 工厂出片间 `/create/factory` | §L2 List;1280 | 模式→风格卡→Hook 生成器→批量变体矩阵 | **收钱先锋 P1**;批量总价确认(tier-3 + 失败自动退款说明) |
| 想法清单 `/create/ideas` | §L2 List;760 | 极轻增删 + 一键「转创作」跳 canvas | campaign 备选点子落这里(缝 5/9 同数据) |

> **⚠️ 现状 double-rail 陷阱**:现 native canvas 在 chat 左侧还自带一条 w-56 的 A3 rail —— 它与壳级 240 nav 并列 = **双 rail**;重建时须并入壳级导航或收进 chat pane。

**关键交互(全区)**:提交/点卡→canvas 裂变;canvas 对象 Full Screen→查看器;查看器/canvas Make Video/Trim→编辑面;产物落 Library/My stuff;canvas 产物→「排期这条」→ composer。

**跨区链接**:New→canvas;Recent work→查看器;KPI 三卡→分析/排期/credits;招呼条「Ask Otto」/「Plan a campaign」→ Campaign 提案卡;视频/批量花费不足→充值页。

**Otto 时刻**:canvas-as-home 铁律 —— Otto 只以壳级 dock 陪跑。§O3 presence 分屏差异化:① Canvas 只用 working marks(in-node gen state、2px coral 选中边=**唯一非-Otto coral 豁免**、top-center 叙述 pill),无 avatar 情绪;② 首页 = 唯一 coral statement 招呼条;③ 查看器/编辑/分镜/工厂 = §8b card landing + §8a sweep;④ live reflection 四镜像(右上进度胶囊 + canvas 卡% + chat 缩略图 + History 角标),off-surface 亮 dock 徽点。**screenshot test**:Otto 不工作时全屏 coral ≤6 处(2 chrome + 1 statement + 3 mark sets)。

**重建动作**:`keep-native`(现为 GalleryFrame 套壳的 create/* 须按此契约**原生重建** —— 见第七章;canvas 是旗舰,先行)。

---

### 二 排期区(plan / calendar / queue / composer / share-preview)

**角色**:连通 app 的**发布器官** —— 成片在这里落时间轴、审批、逐平台定制、定时发布;也是 Campaign 提案卡毕业成真实排期的着陆坪。Plan/Calendar/Queue 三视图共享同一批帖子数据(segmented 切看法,非 tabs)。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| Plan(默认落点) | §L2 List;880 | DRAFT 行 Approve→ApproveDialog;campaign 归组角标;进页 Otto 自动草拟 |
| 日历 Calendar | §L2 List;**1280**(网格封顶) | HTML5 拖动改期(仅未发布);month/week segmented;拖动落定 coral sweep |
| 队列 Queue | §L2 List;880 | **防双发可见**:published 行 attempt N + ShieldCheck「publish lock held」;post-06=首发失败+重试成功样例 |
| Composer | §L2 List/Detail;页壳 880、表单列 560 | PostVariant tab 逐平台定制;X 分档报价(不含链接 1 / 含链接 4 credits);media 选现有成片(不生成) |
| share-preview | §L2 Detail;760 | token URL + 有效期 Select + Regenerate(tier-2 确认);只读镜像;**此页无 Otto inline** |

**跨区链接**:New post→Composer;ViewSwitch 三视图互切;campaign 归组卡→Campaign calendar;Composer media→创作/资产;Composer 空态「No channels」→ Connections;帖行 Share→ share-preview(→ 外部无席位 `/p/{token}`)。

**Otto 时刻**:主场是排期工作台,Otto 安静常驻(§O3 moods 仅 idle/waiting/approving/success,**绝不 thinking-to-look-alive**)。live-reflection 四拍全在 Plan 跑通、严守 coral budget:① §8c 叙述条(进页 1.4s 开始草拟)② §8b 5 张提案 PostRow 错峰 120ms 着陆(先占位不推挤)③ §8a >3 条对 campaign 容器 sweep 一次 ④ statement 卡=Otto 提案通知(本屏唯一 statement)。share-preview 无 Otto inline(dock only)。

**重建动作**:`keep-native`(现 schedule/* 为 GalleryFrame 套壳,按此契约原生重建)。

---

### 三 分析区(overview / reports)— 总览即全城设计基准 gold standard

**角色**:"看懂结果"的一区 —— 把 Otto 做的事、花的钱、平台真实回报,收敛成一屏 4 KPI + 一图一问 + Otto 一句人话,再把每个洞察接回创作/连接,让分析不是死胡同。它同时是 **§D 金标准**,别区数据面都照它。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 分析总览 `/analytics/overview`（P0·§D 金标准） | §L List;880;**pinned header 永远渲染**(空/错/未连接墙住 body) | 4 KPI 卡(答案先行,delta 语义色是唯一非-coral 语义色)· 平台切换器(Meta live,余 soon)· 日期区间旧数 opacity-60 不空屏 · Reach 一图一问(NsLineChart,top-3 coral peak dots)· organic 断电=诚实缺口 · 全套 body 内 loading/empty/error/disconnected |
| 报表引擎 `/analytics/reports`（P2·红旗二双模无例外） | §L 双栏 mixed;1280;左 320 构建器 + 右 680 预览 | 报表**无新表**(只读现有对象面,source 副标注明);Build=人的 INK 动作(只读、不花 credits);构建=Otto 工作(叙述条 3 步→骨架→LandIn + sweep);品牌化报告体 + GM-04 周报人话;对外分享未拍→仅 internal preview 印章 + Download PDF |

**跨区链接**:总览 insight「Make more like it」→ canvas(prefill,不自动花钱)· disconnected「Connect Meta」→ Connections · 首页 KPI「Reach·28天」→ 本区 · checklist「See your numbers」→ 本区 · 广告诊断卡「Make more like it/Open ad builder」→ canvas + 广告 builder。

**Otto 时刻**:Otto 最克制的一区 —— 总览只许 idle/helpful,**读面永不 thinking、永不出审批 mood**(数字是既成事实)。四时刻:insight banner(唯一 coral statement)/ 未连接墙(idle)/ 报表构建(3 步 counter→骨架→sweep)/ 常驻 dock。**§D6:若发光即说谎**,数据面是全 app 最静的屏。

**重建动作**:`rebuild-from-gallery-frame`(现 analytics/* 为套壳,总览是金标准须**优先**原生重建 —— 别区照它)。

---

### 四 资产区(my-stuff / library / brand-memory / templates / discover / brand-kit / cast)

**角色**:城里的**素材仓库与货架** —— 创作产出落这里、从这里被翻找、翻找完一键回画布;是「进城→创作」闭环的**供货端**,不是主场。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| My Stuff `/assets/my-stuff` | §L2 List;1280;§L7 密度开关 | kind segmented 筛选;失败 Retry→GenBar→sweep;item→详情 overlay(Download 审批闸 + Open in canvas) |
| Library `/assets/library` | §L2 List;1280;归 Create 组 | 缩略图→overlay→**Open in canvas**(硬编码 href 被 shell capture 期改跳);资产区最主要的「回主场」链路 |
| Brand memory `/assets/brand-memory` | §L2 List;880;6 tab | living collections 增改删(inline sweep);产品链接一键建档(#124);**全区唯一带 inline Otto**(Research my site→叙述条→事实落地 + tab coral dot) |
| Templates `/assets/templates` | §L2 List;1280;归 Create 组 | 卡→overlay→Use template→canvas |
| Discover `/assets/discover` | §L2 瀑布流;1280;归 Create 组 | hover 视频预览;点卡→转创作→canvas |
| Brand kit `/assets/brand-kit` | §L2 Settings/Detail;760;P1 未入 nav | 结构化字段;C-08 生成校验入口;**rebuild 前是 GalleryFrame** |
| Cast `/assets/cast` | §L2 List;880/1280;P2 未入 nav | New persona Dialog;training 状态;**rebuild 前是 GalleryFrame** |

**跨区链接**:Library/Templates/Discover overlay 的 Open in canvas / Use template / 转创作 → canvas;Download → 余额(不足 door 到 Top up);Brand-memory 建档/Research → 创作(喂生成);左 rail 分组(Library/Templates/Discover 在 Create 组、My-stuff/Brand-memory 在 Assets 组)。

**Otto 时刻**:§8a coral sweep 是本区主语言 —— 货架不放头像(§O3 shelves=none),只用 ≤16px mark + 落地 sweep(≥3 目标则 stagger 120ms 或容器一次)。唯一例外是 Brand memory(有 inline Otto)。dock 由 shell 承担;GalleryFrame 已把画廊自带的 DemoStateBar 悬浮条藏掉,避免与 dock 撞右下。

**重建动作**:`keep-native`(现 assets/* 全 7 页为 GalleryFrame 套壳,按此契约原生重建;brand-memory 是带 inline Otto 的样板)。

---

### 五 广告区(表现 / 构建工作台 / 多平台)

**角色**:投放的**看—修—扩闭环** —— analytics 之后 Otto 逐条诊断广告并把发现接回创作;人工可完整建整 campaign 草稿($0/PAUSED,过审批闸);多平台以 adapter 逐个点亮。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 表现页 `/ads/performance`(P0·live·revamp) | §L List;880;header 永远渲染 + 「via Meta·read-only」pill | 4 KPI + 两段 hairline-list(Doing well/Needs attention);点行展开=**触发 Otto 诊断**(叙述条 2 步→skeleton→coral-soft 诊断卡,带 KB/Meta 来源引用);卡内 brand 按钮=O-10 诊断→创作链「Opens in canvas. Nothing generates until you confirm the cost.」 |
| 构建工作台 `/ads/builder`(P1·断电) | §L Workbench-lite;1280;两栏 280 树 + 编辑面 | **全人工面零 coral**;campaign→adset→ad 三级树;素材「New creative comes from the canvas.」;Submit for approval=$0 建草稿全 PAUSED(非钱路确认) |
| 多平台 `/ads/multi-platform`(P2·未来) | §L List;880 | 平台卡切换器(aria-pressed,选中 border-foreground 非 coral);加平台=加 adapter 不加页;next 平台「Open Connections」(连接入口不复刻) |

**跨区链接**:诊断卡 brand 按钮→canvas(花钱前必确认)· 空态/connected「Open ad builder」→ builder · connected「View ad performance」→ performance · next「Open Connections」→ Connections · builder 素材→canvas · 外壳 nav 无 Ads 项(靠 Analytics#128/Campaign/Connections 交叉链进入)· builder Submit 提交→团队审批。

**Otto 时刻**:performance 是本区唯一 Otto 在场页(read-only 区)—— 展开一条 ad = Otto 诊断工作,走满 §8 三态(叙述条→占位后落地→诊断卡=唯一 statement,不捏造带来源)。builder + multi-platform 全程零 coral。dock 永不覆盖 builder 右下 Submit CTA(§8d 让位)。

**重建动作**:`keep-native`(现 ads/* 为 GalleryFrame 套壳,按此契约原生重建)。

---

### 六 Campaign 区(工作台 / 日历 / 提案卡 / 打包确认 / 列表 / 趋势)— ★旗舰

**角色**:「研究→提案→生成→排期→发布→复盘」全链在同一屋檐下的**编排中枢** —— 用户花几小时「过目 + 点头」而不是几周亲手做,每个花钱/对外动作仍过既有闸。把画布创作、排期、生成三块能力用 Otto 串成一次跨月叙事的旗舰房间。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 工作台 `/workbench`(结构化入口) | §L2 Settings/Detail;760;表单列 480 | 四项填表(goal/period/budget/平台)→ 与 Otto 同一动作层(O-12,殊途同归落到 `proposeCampaign`);§F4 全验永不禁用提交;§F10 Otto 干活时 readOnly;PLAN_STEPS 叙述条→提案 ready 卡 |
| 提案卡 `/proposal-card`(默认落点) | §L2 Workbench-chat;680 阅读列 + 480 chat card | 研究叙述条(带来源,不捏造 trend)→ CAMPAIGN_CARD 日历卡落地→逐条改/删/Approve($0,卡→钱定律:花钱在打包确认)→ PREPARE_STEPS→pack-confirm |
| 日历工作台 `/calendar` | §L2 List/data-console;1280 | 进场 Otto 铺日历(叙述条 + 卡错峰落地 + 容器 sweep)→ 落定归平静;逐条批/改/删经 Dialog;预估总价实时重算 |
| 打包确认 `/pack-confirm`(大单确认) | §L2 Detail;760;§FB6 blocking | review 逐条(可剔除,server 重算)→ spend 按钮带准确价「Confirm pack·N credits」(唯一 statement 级 brand 按钮)→ running 逐条过 generate 闸(一条失败自动退该条 + Retry,其余不累)→ 成片经 `schedulePosts` 只建草稿→schedule/plan |
| 列表与详情 `/list`(完全体 P3 形态先画) | §L2 List→Detail overlay;1280 | 状态机 StatusTrack(DRAFT→ACTIVE→DONE + CANCELLED);GM-03 目标进度条(ink + micro-mono 计数);UTM 基串 Copy;归组产物 tabs;**管理面安静,dock 外零 coral** |
| 趋势存档 `/trends`(市场资料库人工面) | §L2 List;880;搜索 360 | 进场演示深研写入(叙述条 + 最新 TrendSnapshot 落地);只读列表(结论 + 来源 + 日期 + 关联 campaign);行展开 disclosure;via 段控过滤 |

**跨区链接**:提案 Approve/日历改完→pack-confirm(花钱闸)→ settled 成片 `schedulePosts` 只建草稿→schedule/plan(逐条点发过发布闸)· 备选点子→create/ideas · rationale 来源↔trends↔list 互溯源 ·「Ask Otto」→ dock→全屏 Otto · 左 rail Campaigns/History campaign 行→ proposal-card。

**Otto 时刻**:全区共用 §8 四模式且严守 coral 预算(不工作 ≤6 处)。逐页:workbench(PLAN_STEPS→ready 卡 + sweep)· proposal-card(研究叙述条→CAMPAIGN_CARD 落地 + sweep;Approve→PREPARE_STEPS)· calendar(铺日历错峰 + 容器 sweep→归平静)· pack-confirm(唯一 statement「Confirm pack」按下即开工;逐条 GenBar,失败自动退款 + Retry)· trends(深研写入→读面落定零静态 coral)· list(故意安静,dock 外零 coral)。全区常驻 dock:off-surface 批量生成时 dock 徽点脉冲 + header 承接叙述(§O5 一 job 一信号,不与页内叙述条双亮)。

**重建动作**:`keep-native`(现 campaign/* 全 6 页为 GalleryFrame 套壳 —— **含过闸花钱的 pack-confirm** —— 按此契约原生重建;与创作区并列为旗舰,先行)。

---

### 七 CRM 区(联系人 / 客户档案 / 分群 / Deal 看板)

**角色**:「记得每一个客户」的**记账楼** —— 对话与广告把人自动带进来,这里收成唯一档案、分成群、按阶段推进;是排期(发给谁)、收件箱(在跟谁聊)、Campaign(投给哪群)三条线共用的「人」的账本。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 联系人列表 `crm/contacts`(默认落点) | §L List;**920→建议收回 880**(现漂移) | 整行=真去处→contact-profile?id=;渠道徽标 + 勿扰 outline badge;搜索空态;底部句子织入 segments/deals |
| 联系人档案 `crm/contact-profile?id=` | §L Detail;880 | 多渠道身份合并;三 stat;对话行→inbox/conversation(跨区);Deals 卡→crm/deals;StageBadge 语义色零 coral;字段留痕只画只读时间线 |
| 分群 `crm/segments` | §L 双栏;**1000→建议 880**(梯外漂移) | 计数真从 filter 推;规则=可读文本(**非节点画布**,harmony-01 #13);「Post to this group」→schedule/plan(分群真去处) |
| Deal 看板 `crm/deals` | §L 看板;**1040→建议 1280 或 880**(梯外) | 可配阶段(lead→quote→confirmed→delivered);拖动流转是点亮时后台,原型只画形态;金额 fmtMyr(RM,对客永不写 credits 也永不写 $);成交卡→contact-profile |

> **⚠️ 现状金额漂移(第三章已列)**:contact-profile/deals 金额来自硬编码 `DEALS.amountMyr`,与 `_mock.totalOrdersMyr` 对不上 —— 重建时收敛到脊梁 selector。

**跨区链接**:三入口(contacts/segments/deals)共汇一张档案;档案对话行→收件箱;分群→排期;Operate 组 Contacts 一步可达;来源侧(首触 campaign)→ Campaign 归因 + 广告带来的联系人(原型只画只读来源标记)。

**Otto 时刻**:CRM 是 **ambient 数据楼,不在 inline-Otto 名单** —— 名册/看板/分群**永不挂 Otto 头像 mood**,Otto 只以常驻 dock 现身。正确形态是 §8a coral sweep:Otto 自动收进新联系人/改 tag/推进 deal 时,在**那一行/那一张卡**放一次 sweep + dock header 一句叙述。非工作态 coral ≤6 处。

**重建动作**:`keep-native`(已原生,是列表页/详情页样板;修金额漂移 + 宽度收梯)。

---

### 八 收件箱客服区(共享收件箱 / 对话 / 公开评论 / 知识库 / 试驾场,WhatsApp-first)

**角色**:连通 app 里**接客的前台** —— 客户从任何渠道进来的每句话、每条公开评论汇成一条流,人和 Otto 同台接客(Otto 起草、店主一键采用或整条放手);知识库是客服答案的唯一依据,试驾场是上线前先扮客户验一遍 Otto 会怎么答的硬前置。上游连排期(帖→评论),下游连 CRM(对话→档案)。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 共享收件箱 `/inbox/shared`(默认落点) | §L2 List;**880(现 920 漂移,收回)** | 每行一对话(渠道徽标 + Unread/Otto answered badge);未答优先 warning 色;过滤器纯 client 状态。**缺口补齐**:加「谁在接:你/Otto」头像列 |
| 对话视图 `/inbox/conversation?id=` | §L2 Detail;760 | 三方气泡(customer/owner/otto);Otto 起草卡 + Use this draft→灌输入框 + sweep;INK Send。**缺口(点名须补)**:① AI 接管开关(§F7 INK never coral)② 人插手即停(打字/Use draft→接管落下 + 叙述条)③ 答案溯源(气泡下「来自:知识库·XX」小链→knowledge) |
| 公开评论 `/inbox/comments` | §L2 List;760 | 帖下 public-comment 待办流(派生已发帖);Otto suggests(secondary 非 coral);Post reply→sweep |
| 知识库 `/inbox/knowledge` | §L2 List/Detail;**820(轻漂移,归 880 或 760)** | 类目分组一问一答 + Used N× badge;**缺口(#9 知识飞轮)**:从已解决对话沉淀草稿入口 |
| 试驾场 `/inbox/test-drive` | §L2 单列聊天;**720(轻漂移,归 680)** | 扮客户验 Otto(命中 KNOWLEDGE 取答);420ms 延时演出。**缺口**:溯源可点 + 护栏行为演示(超范围转人工/不乱答) |

**跨区链接**:收件箱行/对话头「View contact」→CRM 档案;评论「scheduled」→schedule/queue;knowledge↔test-drive 自检回路;对话「让 Otto 接管」→ dock + 九 自动化区规则;评论「open shared inbox」→shared。

**Otto 时刻**:三类 live-reflection,守「不抢主场」:①【已建】Use draft/Post reply 采用后被采用卡/行放 ≤600ms sweep 收尾(起草卡本身 --card 非 coral,§8b 落地)②【须补】接管态:开关打开→dock 圆点 coral 徽点 + 对话顶叙述条「Otto is answering this thread」;人插手→开关自动落 + 秒切「You've taken over — Otto paused」③【须补】溯源即 Otto 之声「来自:知识库·XX」。coral ≤6 处。

**重建动作**:`keep-native`(已原生,是列表/对话样板;补三个点名缺口 + 宽度收梯)。

---

### 九 自动化区(规则文件编辑器 / Routine 管理面)

**角色**:连通 app 里的**授权书档案室** —— 用户把重复决定沉淀成人看得懂、改得动的规则文件与定时例程,一处启停、一处看花费,任何花钱的一步永远退回到人的那一次点头。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 规则文件编辑器 `/automation/rules` | §L2 List;880;AutomationNav segmented + INK「New rule」 | 每条=when→then 白话卡;§F7 INK Switch 即时启停(启用规则不花钱,花钱仍走每次审批);会花额度的挂 coral「Uses credits」小徽;顶部 Otto 建议条(唯一 statement)。**缺口须补**:勿扰名单 / 人插手即停 / 营业时间(N-20)在规则文本旁明示 |
| Routine 管理面 `/automation/routines` | §L2 List;880;两列 grid(≤680 塌单列) | 每条=名字 + cadence + §F7 Switch + 有序步骤;「See what it lines up」→schedule。**本区最大补齐项**:按 O-02+O-05 授权模型,「授权四件套」(范围声明/预算上限/kill switch/事后摘要)与 run×花费历史应全部可见 —— 当前卡缺预算上限/kill switch/事后摘要/run 历史;建议卡内加一条「四件套」+ 可展开 run 历史,**不另开页** |

**跨区链接**:规则「See activity」→inbox/shared · routine「See what it lines up」→schedule/plan · routine 读数/收尾→analytics/overview · Otto 建议「Draft a rule」→ dock→全屏 Otto · rules↔routines 页内互指 · 花钱触发→审批入口 + account/credits。

**Otto 时刻**:ops/授权面,按「Account 类 = none, dock only」—— 主体不放头像。允许:① 规则页顶 Otto 建议 statement ② 花钱规则「Uses credits」coral mark ③ routine/规则后台真跑一步时 §8a sweep 落在被改行 + dock 徽点脉冲 + header 叙述。**启停 Switch 永远 INK 不 coral**;花钱确认 INK,coral 只上事后 Otto 产出。

**重建动作**:`keep-native`(已原生;补授权四件套 + run 历史 + 规则硬约束提示)。

---

### 十 团队协作区(成员席位 / 审批工作台)

**角色**:连通 app 里「多人一间店」的**信任层** —— 一处定谁能花钱/发布(席位),一处把所有「需要一个人拍板」的事排成队等人批。founder 硬要求的「小编做→老板批→才发布」就发生在这里,且和别区审批入口(dock、通知中心、聊天卡)共用同一个 **ApprovalRequest 原语**。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 成员与席位 `team/members` | §L2 List;880;TeamNav segmented | hairline 行(头像 + role Badge);pending 挂 warning「Invited」;「What each role can do」= CREATOR/APPROVER 双档白话面;Invite=INK Dialog;顶部待批条→approvals |
| 审批工作台 `team/approvals` | §L2 List;880 | ApprovalCard **影响清单先行**(「What happens」1–4 条,无裸 Are you sure);**一原语两面孔**:generation(花额度,OttoAvatar waiting + ~N credits + coral Approve)/ schedule(人的动作,中性 Check + INK);每条可点开被审对象(→proposal-card / schedule/plan);批准 flip「Working…」600ms 落定;空态「All caught up」 |

**跨区链接**:members↔approvals segmented 互跳 · approvals「View the campaign/posts」→proposal-card / schedule/plan · 底部「set who can approve」→members · Invite email 域/Owner→account/settings · **同一 ApprovalRequest 的另两面**↔ global/notifications + dock/otto 审批卡(从任一处批,live reflection 同步)。

**Otto 时刻**:members 是钱/身份/席位决定,none, dock only。approvals 恰好 Otto 有话对具体内容说才现身:generation 卡 OttoAvatar(waiting→success≤4s→idle),Approve 后 §8a sweep + dock header「Generating…」;schedule 卡全程 INK 零 coral(coral=Otto only)。跨区在 dock/通知中心批同一条,本区队列秒级反映。coral ≤6 处。

**重建动作**:`keep-native`(已原生)。

---

### 十一 住户服务中心(Account / Credits / 充值 / Connections / 通道费钱包)

**角色**:连通 app 的**管账后屋** —— 钱(生成额度 credits + 投放钱 MYR,**两条互不混的账道**)、身份/品牌资料、全部渠道连接开关都在这一区集中;城里任意区遇到「没额度/没连渠道/要改资料」都把用户送到这里,办完原路送回主场。

**逐页布局**(全部居中列 max-w-880,AccountNav segmented):
| 页 | 关键交互 |
|---|---|
| Account 设置(默认落点) | 顶部三张概览卡整卡可点→credits/connections/team;Brand/Notifications/Preferences 三卡 §F7 即时开关(无 Save);Brand voice→brand-memory。**§O3:Otto avatar=none,只有 dock**(身份决策读作用户自己的) |
| Credits | 三 stat 卡(**只显示 credits,对客不写 $**);低额提示条→top-up;Recent activity 每行按 category 深链(Otto chat→otto、Image/Video→library、Search→trends、Top up→top-up);单笔可展开是须补形态 |
| 充值 top-up(**MONEY_IN 豁免**) | 三档 PackCard→汇总条(credits·RM)→INK「Continue to payment」;确认 Dialog 明写「New balance will be N credits」;成功态两条真去处(Start creating→canvas / View activity→credits) |
| Connections | Meta(IG+FB 一处授权)/ Other(X/TikTok/WhatsApp);未连→内联授权 Dialog(mock OAuth,「Otto never posts without your approval」);已连给真去处(IG/FB/X/TikTok→schedule/plan,WhatsApp→inbox/shared);Needs attention→INK Reconnect |
| 通道费钱包(**第二账道**) | 顶部醒目区分条(投放钱 RM vs 生成额度 credits,永不混账)→点它 Open credits;By channel 行(RM 余额 + Auto reload §F7 开关 + Add funds);「没看到某渠道?去 connections 连」 |

**跨区链接**:任意区「Out of credits」/花费按钮→top-up(状态+门,never 死路);Credits 流水按 category 深链 otto/library/trends;成功态 Start creating→canvas;Connections 已连→schedule/plan 或 inbox/shared;Account 概览 Team→team/members、Brand voice→brand-memory;wallet↔credits↔connections 三页脚注互链(讲清两账道 + 先连再充)。

**Otto 时刻**:§O3 硬约束 —— Account/connections/billing 页内**不放 Otto avatar(none)**,钱与身份决策读作用户自己的、不被陪同;只有右下常驻 dock。live-reflection:Otto 代劳(帮充值/续 token/连渠道)后在对应行落一次 sweep(双模里 Otto 100% 代劳的可视回执)+ dock 徽点。**确认按钮保持 INK**,coral 只落 Otto 事后产物;此区静止截图 coral 只应出现在 chrome。

**重建动作**:`keep-native`(已原生,account-settings 是账户页样板;修「3/5 connections」硬编码 + 渠道口径收敛到脊梁)。

---

### 十二 Onboarding + 登录

**角色**:进城的**唯一一扇门** —— 登录是 app 之外的 auth 前庭(无 nav、无 dock、无 coral),验证通过落入产品外壳;checklist 是新店主进城后的开店清单,做完即消失,可关不打断工作流。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| 登录/注册 `onboarding/login`(P0·live·revamp) | §L2 Auth(现居中 460 须改)→ split hero 1.15:1 + form 360;hero 半边可放 Otto idle 云(**coral 只在 hero,永不落表单后**) | email 单字段(§F3 44/16 anti-zoom,focus=coral ring);Enter=submit;「魔链已发」态(不发真请求);继续 INK;§F4 submit 永不 disabled |
| checklist `onboarding/checklist`(P1·须建) | §L2 Settings/Detail,**落在产品外壳内**;760 | h1「Welcome, {owner}」+「{n}/4 done」;四步 hairline 行(连渠道·加产品·发首帖·看数字);**勾选圈 §F7 checked fill 走 INK 不 coral**(是用户自己的进度,不是 Otto 的);进度即时;全做完/Skip 都进 create/home;可 Skip、完成即隐 |

**跨区链接**:登录继续→create/home(注册→checklist);法务尾注→global/legal;checklist 四步 CTA 走真实沉浸式目的地(Connect→connections、Add product→brand-kit、First post→composer、See numbers→analytics/overview);Start creating/Skip→create/home;come back→account/settings。

**Otto 时刻**:登录(auth 前庭)—— Otto 只作品牌陈述,hero 半边一朵**静态 idle 云**(永不 waiting/thinking),无 dock/无 narration/无 sweep;coral 预算=那一朵陈述云(表单后面零 coral)。checklist —— shelves 类,无 inline 头像,dock 收起 idle;进度是用户人工动作,§8a sweep 不适用(除非未来 Otto 代劳某步)。

**重建动作**:`merge-kit`(login/checklist 已原生;login 须从居中 460 改 split hero;合并 kit)。

---

### 十三 市政厅(admin,内部运维台 — 设计降级,Otto 永久豁免)

**角色**:「盖房子的人」(仅 BELCORT 内部)看的运维与账房后台 —— 不是对客产品面,是同一个 app 里**唯一 Otto 不进、coral 不亮、dock 不该出现**的一栋楼;设计刻意降级到纯 token 密度排版,只用系统语义色(success/warning/muted);对客的逐页 UIUX 拍板标准在这里不适用。

**逐页布局**:
| 页 | archetype / 宽度梯 | 关键交互 |
|---|---|---|
| Admin console `/cityhall/admin`(单页全后台) | §L2 Detail;880(内部台不铺满,读密度优先) | 4 section(环境条/服务健康/功能开关/发布历史);功能开关 §F7 checked fill=INK 绝不 coral;服务健康语义色 + degraded 计数进标题;**无 rail 内 admin 入口**(不进 NAV_GROUPS,直达 URL 到达);全人工,**没有任何「问 Otto」入口**(双模在此单向坍缩为纯人工) |

**跨区链接**:经 persistent shell 直达 URL 进入(内部人员手输/书签,对客看不到这扇门);发布历史只读镜像不外链回对客(内部台是终点);点 Brand 标/任意对客工具行→离开内部台回创作区(shell 常驻不重载)。

**Otto 时刻**:**无** —— 全 app 唯一没有任何 Otto live-reflection 的一区。禁 coral sweep、禁 card landing coral 收尾、禁叙述条、禁常驻 dock;状态变化只用系统语义色 + 密度排版。coral 预算=零;此处出现任何 coral 或 dock 即违规。

**重建动作**:`keep-native`(刻意设计降级,fit-for-purpose)。

---

## 六、设计法遵从

**每张页 100% 落在 `docs/design-system/design-rules.md`(v3)的 token/字阶/间距/圆角/阴影/动效/live-reflection 内,零新造值。** 引用清单:

| design-rules § | 遵从要点 |
|---|---|
| **§2 语义色** | delta 语义色(up=success-soft-fg / down=error-soft-fg / flat=muted)是数据面唯一允许的非-coral 语义色;状态 badge 用 semantic soft 对 |
| **§5 / §L5** | Card(rounded-[18px] border bg-card 平面,永不卡阴影)/ CardHeader / SectionTitle / 段落节奏 |
| **§8a sweep** | 一次性 coral sweep ≤600ms,reduced-motion=静态 2px 描边;≥3 目标 stagger 120ms/最多 3 或容器一次 |
| **§8b landing** | 卡片着陆 200ms spring(opacity+translateY),先占位不推挤 |
| **§8c 叙述条** | 一屏一条、原地更新;present-participle 现在时短语(§V6) |
| **§8d / §O6 dock** | 常驻 dock:48 圆点 ⇄ 380 面板;off-surface 亮 8px brand 徽点 2s 脉冲 |
| **§D1–D6 数据面** | 答案先行;pinned header 墙住 body;honest gaps(断电不藏面板);§D6 若发光即说谎 |
| **§D3 StatCard** | label 12/500,value 26/700 tabular-nums,delta 语义 |
| **§F1–F10 表单** | field anatomy;§F3 44/16 anti-zoom;§F4 submit 永不 disabled;§F7 switch checked fill=INK never coral;§F10 Otto 干活时 readOnly |
| **§FB4–FB8 反馈** | 影响清单先行;tier-2/tier-3 花费确认;骨架代 spinner;determinate/indeterminate GenBar |
| **§L1–L8 布局** | shell/宽度梯/rail/密度开关/canvas z-raised |
| **§N2–N8 导航** | 六区固定顺序;单一状态系统(hover=accent/active=secondary,零 coral);segmented vs tabs 铁律;detail=overlay 二级封顶 |
| **§O1–O6 / §8 Otto** | presence map 分区差异化;coral 预算(不工作 ≤6 处 = 2 chrome + 1 statement + 3 mark sets);coral=Otto only |
| **§V4–V6** | 空态两句;§V5 spend 只显 credits / money-in 显 RM;§V6 现在时叙述 |
| **§A5/§A6** | prefers-reduced-motion gate;文本孪生(叙述条 role=status,气泡流 role=log) |

**已知设计法漂移(重建时收敛,记录在案)**:
- 宽度梯偏离:全局搜索 720、crm-contacts 920、segments 1000、deals 1040、inbox-shared 920、knowledge 820、test-drive 720 —— 均须归到最近的 §L3 档。
- `/otto` dock 未按路径隐藏(§O3 违规,两 Otto 同屏)。
- 2px coral 选中边(canvas nodes)是**唯一登记在案的非-Otto coral 豁免**(user-controlled),不算违规。

---

## 七、现状差距图(57 路由)

**当前分布**:23 原生页(重建质量标杆)+ 34 GalleryFrame 套壳(须原生重建)。GalleryFrame = 把旧画廊页原样嵌入,靠作用域 CSS 藏掉 DemoStateBar,**未按设计法 v3 原生重画**。

### 7.1 原生保留(keepNative,重建标杆)

- **外壳三件**:`immersive-shell.tsx`(load-bearing 帧)/ `immersive-nav.tsx`(最佳连通脊梁,nav 模板)/ `immersive-dock.tsx`。
- **样板页**:`account-settings.tsx`(账户页模板)/ `crm-contacts.tsx`(列表页模板)/ `immersive-home.tsx`(hub 模板)/ `immersive-search.tsx`(搜索模板)/ `cityhall-admin.tsx`(刻意降级,fit-for-purpose)。
- **10 个 account-ops 原生页** + **9 个 crm-inbox 原生页** = 唯一手绘区,同一 `_shared`+`_mock` 质量标杆,是 34 套壳页重建要对齐的**参考集**。
- **`_mock.ts`** = 单一城级 mock,重建的商家事实唯一源。

### 7.2 GalleryFrame 要原生重建的 34 页(按区)

| 区 | 套壳页 | 重画优先级 |
|---|---|---|
| **一 创作**(旗舰) | create/home · **canvas** · asset-viewer · media-editor · storyboard · factory · ideas | **P0 先行**;canvas 是核心创作面仅套壳、home 是 nav「New」主动作却是套壳 |
| **六 Campaign**(旗舰) | workbench · calendar · proposal-card · **pack-confirm** · list · trends | **P0 先行**;pack-confirm 是过闸花钱页仅套壳、proposal-card 是 nav「Operate·Campaigns」落点 |
| 二 排期 | plan · calendar · queue · composer · share-preview | plan 是 nav「Operate·Schedule」落点却是套壳 |
| 三 分析 | overview · reports | overview 是 §D 金标准,别区照它,须**优先**重画 |
| 四 资产 | brand-kit · brand-memory · cast · discover · library · my-stuff · templates | brand-memory 是 nav「Assets」落点、library 是素材→canvas 流的源 |
| 五 广告 | builder · multi-platform · performance | performance 是 P0 live·revamp |
| 〇 全局 | legal · notifications · otto-chat · **otto** | otto/otto-chat 两路由复用同一画廊源(dock 放大入口) |

### 7.3 两 kit 合并 + mock 脊梁统一(第三章的差距版)

- **两 kit 合并**:8 类原语(Card/CardHeader/SegNav/fmtStamp/useReducedMotion/useSweep/ChannelTag/ZonePage)+ Initials/SettingRow/SectionTitle 上提为 immersive 级共享 kit;`_shared` 的 PageHeader/StatCard/EmptyState 复用不 fork;单一 SWEEP keyframe、单一 ChannelTag(全 5 渠道)。
- **mock 脊梁统一**(商家身份没碎、派生口径碎了):修 deals↔contacts 金额漂移(收敛到 `totalOrdersMyr`)、渠道清单/连接态/社媒 handle 三处重复收敛、`account-settings`「3/5 connections」硬编码改读 `NS_CONNECTIONS`;新增 `_selectors.ts` 一层共享跨区读;晋升规则(第二区需要→向上进 `_mock.ts`,永不横向复制)。

### 7.4 各区重建动作一览

| rebuild 类别 | 区 |
|---|---|
| `keep-native`(已达标,补缺口/收梯) | 二 排期✱、四 资产✱、五 广告✱、六 Campaign✱、七 CRM、八 收件箱、九 自动化、十 团队、十一 住户、十三 市政厅 |
| `rebuild-from-gallery-frame`(套壳须原生重画) | 三 分析(overview 金标准优先) |
| `merge-kit`(原生 + 合并 kit) | 〇 全局、十二 Onboarding |

> ✱ 注:这些区的 `rebuild="keep-native"` 指**契约质量标杆是原生页**;但其中 create/*、campaign/*、schedule/*、ads/*、assets/* 的具体页目前仍是 GalleryFrame 套壳(见 7.2),须按各自契约**原生重建到 keep-native 标杆**。"keep-native" 是终态,不是现状。

---

## 八、重建顺序

**原则(compositionLaws #9「建设有序不发明 feature」+ MASTERPLAN P0→P4)**:page 清单只来自蓝图/判决/已批 spec;agent 永不发明 feature;旗舰区先行做到完美 → founder 验 → 再铺满全部。

### 阶段 0 —— 共享骨架先行(不画任何单页,先立地基)
1. 合并两 kit → 一套 immersive 共享 kit(单一 SWEEP、单一 ChannelTag) → **验:两区级 kit 只剩区专属件,`grep` 无重复原语**。
2. 统一 mock 脊梁 → `_selectors.ts` + 修金额/渠道漂移 → **验:deals 与 contacts 同客户金额一致;`account-settings` 读 `NS_CONNECTIONS`**。
3. 补 `/otto` dock 隐藏(§O3) → **验:`/otto` 全屏无第二个 Otto**。

> 为什么先做骨架:旗舰区重建要落在共享 kit + 统一脊梁上,否则旗舰做完又要返工。

### 阶段 1 —— 旗舰区做到完美(创作 + Campaign 先行)
4. **一 创作区**原生重建 7 页(canvas 优先,double-rail 并入壳级导航) → **验:GOAL 全表交互形态齐;canvas 无双 rail;花费点全过确认闸;coral ≤6 处 screenshot test**。
5. **六 Campaign 区**原生重建 6 页(pack-confirm 过闸花钱页优先) → **验:proposal→calendar→pack-confirm→schedule 主动线走通;pack-confirm 逐条失败自动退款 + Retry 形态齐**。
6. **三 分析总览**原生重建(§D 金标准,别区的标尺) → **验:pinned header 墙住 body 四态齐;§D6 不发光;delta 唯一非-coral 语义色**。

> **→ founder 逐页验收(APPROVALS.md)。** 旗舰三块(创作 + Campaign + 分析金标准)批准后,它们成为 binding design contract,别区照抄质量。

### 阶段 2 —— 铺满全部(其余套壳 → 原生 + 原生区补缺口)
7. 二 排期 5 页 / 四 资产 7 页 / 五 广告 3 页 / 〇 全局(legal/notifications/otto)套壳 → 原生,照旗舰标杆 → **验:每区跨区链接走通,不跳出外壳**。
8. 原生区补点名缺口:八 收件箱(接管开关 + 人插手即停 + 溯源)/ 九 自动化(授权四件套 + run 历史)/ 七 CRM + 八 + 十一(宽度收梯 + 金额/口径收敛)/ 十二 login(改 split hero) → **验:PAGE-INVENTORY 点名缺口逐条销账**。
9. 十 团队 / 十三 市政厅 / 十一 住户(已达标)最后过一遍 kit 合并回归 → **验:全城 57 页同一份 kit、同一份脊梁、coral 预算全过**。

### 铁律守全程
- 每页一 agent、一页一 PR(PROGRAM.md §3.2),只动 `app/northstar-immersive/` 目录。
- 每 PR:CI 全绿 + 整页截图 + 审查两问(①100% 落设计法?②只动原型目录?)。
- **原型阶段只走缝 7**(单一设计系统);点亮时才结清功能债(缝 1/3/5/9)。**永不碰钱路**(原型无可触发花费的代码路径,花费点只画确认闸的**形态**)。
- 发现输入与蓝图冲突 → 停手、报告、等 founder(蓝图赢)。

---

**本蓝图的验收标准(founder 一句话版)**:批准后,`/northstar-immersive` 的每一区都能被一个 agent 照着"逐页布局 + 跨区链接 + Otto 时刻"三栏建成,建完把 57 页拼起来是**一座能从任意一区走到任意另一区、页面平滑流转、Otto 常驻不抢主场、coral 只属于 Otto、全城同一个商家一套账**的连通 app —— 不是 57 张设计稿的画廊。

---

## 修订记录

| 日期 | 修订 | 批准 |
|---|---|---|
| 2026-07-08 | v1 沉浸版 composition 蓝图(总审查员起草;依据 = BLUEPRINT 第一章全景 + PAGE-INVENTORY 14 区 + design-rules v3 + 沉浸版现状审计 + 已批 spec) | 待 founder 终审(批准 = 照此蓝图开工重建) |