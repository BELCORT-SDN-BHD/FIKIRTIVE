# 平台真相总台账 · 2026-07-10

> **这份文件是什么**：8 个平台的官方文档被逐个啃过一遍后，我把「我们想让平台干的活」对上「平台官方到底允不允许、要等多久、最狠的规矩是什么」，再回头对照我们**城里已经画好的按钮**和**已经拍板的功能**，把矛盾一条条挑出来。
>
> **给谁看**：founder（非技术）。所以下面尽量说人话，技术名词第一次出现都带白话解释。
>
> **覆盖的 8 个平台**：Instagram、Facebook（这两个 Meta 合成一份研究）、WhatsApp、Google 商家资料（Google Business Profile）、TikTok、Shopee、Lazada、EasyStore。
>
> **一句话先说结论**：我们的城建得比想象中**诚实**——排期区只画了 IG/FB（没吹牛），分析区其他平台都老实写着「即将上线」。真正的雷不在按钮上，而在**几条已经"判要/曾批准"的功能**里：WhatsApp Status 当发布渠道（官方根本没这个接口）、一键群发/冷号直接群发（官方没有群发接口而且没 opt-in 会被封号）、一键请评（没有任何平台给"催评"接口）。这些必须在动工前改写。

---

## 第一部分 · 一页总表

图例：✅官方明确支持 · ⚠️有限/有坑 · ❌官方无此能力

| 平台 | 我们最想要的活 | 官方支持度 | 接入门槛（要等多久） | 最狠的一条红线 |
|---|---|---|---|---|
| **Instagram** | 发帖/Reels/Stories/轮播、读评回评 | ✅ 发布类全支持；Stories 细节存疑 | Meta App Review「提交后**一周内**出结果」+ 商业验证（Business Verification，可能再加几天到几周） | **代客户发帖前必须先拿到账号主人明确同意**（政策 1.7）；且**审核员测不到你申请的功能 = 整单被拒** |
| **Facebook** | 发主页帖、**原生排期**、读评回评 | ✅ 全支持，且 FB 侧**有原生定时发布**（IG 没有） | 同上 App Review（pages_manage_posts 等） | 同 Meta 政策；发帖人必须在该主页有 CREATE_CONTENT 权限 |
| **WhatsApp** | 群发营销、CRM 唤回、售前表单(Flows)、送达回执 | ⚠️ 能发但**没有"一键群发"接口**（逐个收件人循环）；**没有 Status/动态发布接口** | 商业验证 + 建号 + 每条模板逐条送审；等级从 250/天 起爬 | **"AI Provider"条款**：若 Meta 认定我们"以 AI 为主要功能"，**非欧洲/巴西的用户可能整体禁用 WhatsApp**（认定权全在 Meta 手上）——重仓前必须先由 founder/法务判我们算不算 |
| **Google 商家资料** | 发帖(活动/优惠)、读评回评、本地表现数据、请评 | ⚠️ 发帖/回评/数据✅；**请评❌无接口**；私信❌已下线 | 「Basic API Access」表单申请，**14 天内**审；且每个商家还要**各自单独授权** | **禁止"挑好评"(review gating)、禁止花钱/送礼换评价、禁止买排名**——违规会下架已有评价+挂消费者警示牌 |
| **TikTok** | 发短视频/图文、投广告、卖货数据、直播数据 | ⚠️ 发布✅但**过审前只能发"仅自己可见"**；广告走官方 MCP；**直播不能开播只能读数据** | 内容发布 API 要过 ToS 审核（**时长官方没给**）；TikTok Shop 合作方审核（传闻 2-7 天，非官方） | 未过审强制 **SELF_ONLY**、24h 最多 5 个号发帖；马来西亚**保健品类 2026-07-09 起缺 NPRA 属性直接建品失败**（硬合规） |
| **Shopee** | 上架、发短视频、直播、广告、售前聊天、订单/归因 | ⚠️ 大部分✅；**聊天 API 对新接入者已关门**；主动营销消息❌禁 | 卖家账号审 **3 工作日**；第三方平台(ISV)审 **10 工作日**；马来西亚门槛低（近30天≥1单即可） | **聊天 API 自 2024-11-18 起对新接入者全部关闭**；且明令禁止主动推送/促销群发/机器人自动回复；禁爬虫、禁刷单 |
| **Lazada** | 上架、素材、库存、订单、广告、请评(回评)、IM 客服、归因 | ⚠️ 大部分✅；请评只有"回评"没有"催评"；客户 PII 默认打码 | 开发者账号运营审核 + App 从测试转正需**连续两周达标**；**解码客户姓名/电话要过 DataMoat 安全审 2 周（限时）** | **客户 PII 默认全平台打码**，要拿明文必须过完整安全审（含渗透测试）；违规处罚阶梯**最终可永久冻结整个开发者账号** |
| **EasyStore** | 订单/客户/交易/忠诚度/推荐 字段级读取 + OAuth（商店与 CRM 数据底座） | ⚠️ **我收到的研究数据在这里被截断**，正文没传全 | OAuth 应用注册（细节未知） | **未知——本平台一页纸是残页，见诚实栏** |

> **门槛总览的白话版**：真正卡住我们上线的第一关是 **Meta App Review（约一周）**——排期区的"真发布"和广告区的"写/建"都在等它。Google 的 14 天、Shopee ISV 的 10 天可以并行去排队。Lazada 的坑最深（要过 2 周安全审才能看到客户电话）。WhatsApp 不是 P1 的事（蓝图排在 P2），但**"我们算不算 AI Provider"这个法律判断要早做**，否则可能白建。

---

## 第二部分 · 逐平台一页纸

> 每页四栏：**能干什么** / **不许画的**（设计里不能出现的按钮）/ **红线**（会被封号/罚的）/ **假设台账**（还没坐实、需要实测或登录才能确认的）。

### 1) Instagram（Meta 内容发布面）

**能干什么**
- 发单图/视频到 Feed、发 Reels、发 Stories、发轮播（最多 10 张，轮播在配额里算 1 帖）。
- 读评论、回评、隐藏/删评、开关评论（官方建议用 webhook 订阅评论事件，别轮询）。
- 查当天发布配额用量（GET content_publishing_limit）。

**不许画的**
- ❌ **IG 没有"原生定时发布"**——不能像 FB 那样传一个未来时间戳让 IG 到点自己发。要排期就得**我们自己建定时器**，到点再调发布接口（我们排期区正是这么设计的，对得上）。
- ❌ **不能直接上传文件**——IG 只吃"公网能访问的媒体网址"，图片**只支持 JPEG**。含义：我们的素材（存在 R2）发 IG 前必须有一个**公网可达的网址**，发布 worker 要处理这件事。
- ❌ 未经账号主人同意就自动代发。

**红线**
- 1.7 同意：代发前必须拿到明确同意。
- 2.7 禁止互动造假（买卖赞/评/粉）——这条直接管到我们"请评/唤回"相邻功能。
- 审核可及性：审核员测不到 = 整单被拒。

**假设台账**
- 24h 发布配额到底 50 还是 100？**官方同一页自己打架**（专门端点写默认 50，总览页写 100）。要用真号实测 `GET content_publishing_limit` 看当前生效值。
- Stories 是否支持互动贴纸（投票/提问/倒计时/链接贴纸）、发布后能不能查——官方没逐条确认，存疑。
- App Review「2-3 天」的说法只在搜索引擎摘要里，官方原文只保证「一周内」。

### 2) Facebook（Meta 内容发布面）

**能干什么**
- 发主页帖（POST /page/feed）。
- ✅ **原生排期**：scheduled_publish_time 参数，未来 **10 分钟到 75 天**之间。IG 没有、FB 有——如果只发 FB，可以省掉我们自己的定时器。
- 读评回评同 IG 一套权限。

**不许画的**
- ❌ 发帖人若在该主页没有 CREATE_CONTENT 权限，发不了。

**红线**：同 Meta 政策（1.4 别骗人 / 1.6 守文档 / 1.7 同意 / 2.7 禁造假 / 3.a.vii 功能实质变化要重审）。

**假设台账**：Page Publishing Authorization(PPA) 是否仍是 IG 发布前置步骤，官方页面没正面确认或否认，可能是历史遗留术语。

### 3) WhatsApp（WABA / Cloud API）

**能干什么**
- 发模板消息（要 Meta 先审通过，分营销/工具/认证/服务四类，类别定了不能乱用，错类目计价错）。
- 一对多推送 broadcast——**但本质是对每个人逐条调接口**，受"每日等级"和"每秒吞吐"双重限速。
- WhatsApp Flows：结构化售前表单（预约/浏览商品/收集线索/收反馈）——官方支持。
- 送达/已读回执 webhook。
- 服务类消息 2024-11-01 起全免费；营销类不论窗口内外**一律计费**。

**不许画的**
- ❌ **没有 Status/动态（24 小时故事式）发布接口**——Graph API、WABA、Cloud API 三处全查过，没有。唯一名字像的是"消息送达状态 webhook"，那是回执不是动态。→ **凡是把"WhatsApp Status"当发布渠道的设计，全部作废改写**（见第三部分冲突 C2）。
- ❌ **没有"一键群发名单"接口**——所谓 broadcast 是自己写循环逐个发。
- ❌ 不能拿 WABA 对话数据（哪怕匿名/聚合）去训练除"自用微调"外的任何 AI 模型。
- ❌ 不能给单个用户建画像；不能把数据卖/转/授权给第三方。

**红线**
- **AI Provider 条款（最狠）**：以 AI 为"主要而非附带功能"的实体，被明文禁止用 WhatsApp Business Solution，只对欧洲(EEA)/巴西号码例外，认定权全在 Meta（"sole discretion"）。**FIKIRTIVE 自己算不算，需 founder/法务先判**，再决定要不要重仓 WhatsApp。
- 发营销模板前**必须先拿到用户 opt-in**（明确同意接收+告知企业名）。不合规发送会被限流+被举报。
- 质量分掉到红（Red）会冻结发送额度。

**假设台账**
- 质量分/拉黑率的具体百分比阈值：Meta **只给定性描述、从不公开数字**。网上流传的"2-3% 拉黑率触发降级"是第三方博客瞎猜，不采信。→ 含义：我们做"防封号自动监控"时，**无法用官方数字设阈值**，只能保守估。
- Flows 页面是 JS 渲染，正文靠搜索摘要拼的，没逐字核对。
- marketing_lite 计价类目官方没独立文档，存疑。

### 4) Google 商家资料（Google Business Profile）

**能干什么**
- 发 Local Posts（活动 EVENT / 优惠 OFFER / 行动号召 CALL_TO_ACTION）。
- 上传照片/视频。
- 读评、回评。
- 本地表现数据（展示/点击/致电/导航/预订等聚合指标）。
- 问答(Q&A) 读写。

**不许画的**
- ❌ **不能发 Product（商品）帖**——官方原文"Product Posts cannot be created via the API"。
- ❌ **没有"发送请评邀请"的接口**——请评只能靠商家后台生成的评价链接/二维码自己分享。我们要做请评自动化，只能**自建触达通道（短信/邮件/WhatsApp）去分享那个官方链接**，不能靠 API 代发求评。
- ❌ **私信/聊天已于 2024-07-31 官方下线**——GBP 侧没有售前对话能力了。
- ❌ GBP 不给客户联系方式/订单历史——**CRM 数据层必须我们自建**。
- ❌ 不提供广告投放（那是 Google Ads API，另一个东西）。

**红线**
- **禁 review gating**：不能只挑满意客户请评、不能劝阻差评、不能店内施压留评、不能指定评价内容。
- **禁 fake engagement**：花钱/送礼换评价"strictly prohibited"。
- **本地排名不可购买**——"没有办法花钱买更好的本地排名"。→ 任何"付费保排名"话术直接和官方立场冲突。
- 违规后果：一段时间收不到新评价 + 已有评价被下架 + 商家资料挂"虚假评价已移除"警示牌。

**假设台账**
- 审核时长：prereqs 页没写，FAQ 写"14 天内"，两处不一致，以 FAQ 为准但没实测。
- reviews.updateReply 前提写的是旧"G Suite"时代文案，是否仍强制生效需实测。
- BUSINESS_CONVERSATIONS 指标：枚举还列着但支持文章说聊天已下线、该指标"不再可用"，**两处官方打架**，需实测该字段还返不返数据。

### 5) TikTok

**能干什么**
- 内容发布 API（Direct Post）：发短视频/图文到创作者账号。
- 广告：TikTok for Business Marketing API + 官方 **MCP Server**（2026-06-30 上线，零代码接入）。
- TikTok Shop 卖家 API（马来站）：商品/订单/物流/财务/分析/客服等。
- 直播**数据**（LIVE Analytics 只读）+ 订单能标记来自哪场直播。

**不许画的**
- ❌ **过审前不能公开发布**——未审核强制"仅自己可见"，24h 最多 5 个号发帖。
- ❌ **不能用公开 API 开播/结束直播/管理直播间商品**——TikTok 没有这类端点（对比：Shopee **有**）。TikTok 直播只能卖家在网页/App 手动操作。
- ❌ 没有官方 API 抓直播间实时弹幕/礼物/在线人数。

**红线**
- 未过审 private-only 是防滥发设计，触发 spam 风险会限流/封发帖权。
- 马来西亚 **2026-07-09 起**：保健品类（Beauty Supplement / Fitness / Vitamins / Herbal）经 API 上架/编辑**必须传 NPRA 属性**，否则建品/改品直接失败——硬合规，任何自动上架工具都要先过这道校验。

**假设台账**
- 内容发布审核**时长官方没给**。
- TikTok Shop 限频页是 JS 渲染 SPA，具体数字没读全。
- **TikTok for Business MCP 完整文档是登录墙**——工具清单/认证方式/限频全没核实到。建议先邮件 tiktok-ads-mcp-agentic-hub@tiktok.com 拿书面工具清单。
- ⚠️ 方法论坦白：研究时共享 headless 浏览器一度和并行研究 Shopee/Lazada 的兄弟 agent 串台、拿错过页面，已识别弃用。

### 6) Shopee（马来西亚站）

**能干什么**
- 商品上架/改价改库存/变体、短视频发布、**直播**（开播/结束/上下架直播间商品/实时数据——马来在支持名单内）、广告（CPC + 联盟营销）、订单/物流（含发货/拆单）、店铺自建促销（折扣/券/闪购）、联盟活动招募、归因报表、Follow Prize（关注有礼）、读评回评。

**不许画的**
- ❌ **售前聊天(Chat API)对新接入者已关门**——2024-11-18 起个人第三方和第三方平台(ISV)都不能再申请，只有此前已获批且持续达标的老账号能用；台湾完全不开放。
- ❌ **禁止主动推送/促销群发/机器人自动回复**——就算拿到 Chat 权限，也只能"回应买家"，主动实时更新要走 webhook 不是聊天广播。→ **Shopee 上做不了"复购唤回主动私信"**。
- ❌ 没有"报名官方 9.9/11.11 大促坑位"的 API（只有店铺自建促销 + 联盟活动）——存疑，可能藏在后台。
- ❌ 禁爬虫抓 Shopee 数据。

**红线**
- 聊天关门（上面）。
- 禁刷单刷评刷粉刷赞（brushing）——"请评"若设计成虚假激励好评直接踩线。
- **App 存活硬指标**：90 天内须上线、上线后 90 天内至少 1 次调用、日均成功率不得低于 90%，否则处罚阶梯直到移除账号。

**假设台账**
- Chat API 完整文档是登录门槛内容，只拿到方法名清单。
- 通用（非 Chat）API 的每日/每秒具体配额官方没公开数字，按 partner_id 后台核发。
- "App Scoring and Tiering"（决定限频分级）页面没读全。

### 7) Lazada（LazOP，马来站及配套开店入口）

**能干什么**
- 商品发布/上下架、图片/视频素材、库存价格联动、订单读取、履约与退款、营销工具（券/满减/组合折扣）、广告（Sponsored Discovery，Phase 1）、请评（**只有回评 GetProductReviewList + SubmitSellerReply**）、IM 客服（有 webhook）、财务对账、事件 webhook（约 15 类，官方推荐替代高频轮询）、新卖家开店（网页流程，非 API）。

**不许画的**
- ❌ **请评没有"主动邀评/催评"发起接口**——只能被动拉已产生的评价再回复。
- ❌ 客户姓名/电话等 PII **默认全平台打码**，没有"即时自助解码"，必须走完整 DataMoat 安全审。
- ❌ 广告 Phase 1 明确"does not support"四项：手动充值、关键词编辑、出价管理、其他广告方案。
- ❌ **不要用死循环高频轮询 GetOrders 监测新订单**——官方原文"可能会禁用你的 App"，正确做法接 webhook。
- ❌ API Explorer 用的是**生产环境真实数据**，不是隔离沙箱。

**红线**
- **PII 打码 + DataMoat 安全审**（架构信息表 + 数据流图**不许网上抄**+ 人工审 + 渗透测试 + 漏洞按等级限期修复 + 最终验证，全程限时 2 周逾期作废）。
- 处罚阶梯：警告 → 停获取新卖家授权 → 限流到每日 1000 次 → 全停 → App 下线 → **永久冻结整个开发者账号**。
- 休眠机制：90 天没上线/没调用会被压到每日 1 次。
- 禁反编译/去匿名化；禁用 Lazada Content 造竞品。

**假设台账**
- App 转正的成功率门槛**两份官方文档打架**（一处 95%、一处 85%），以 Console 实际提示为准。
- **注册页有"Seller Instant Messaging AI Terms"独立条款链接没抓到内容**——这对我们做"AI 售前自动回复"是否合规是**关键信息缺口**，要单独排查原文。
- 新加坡以外市场的"卖家连接资格"官方只写"Not applicable"，是否有隐性门槛没核实。

### 8) EasyStore ⚠️ 残页

**我收到的研究数据在这里被截断了。** 原文只看到一行：聚焦 orders/customers/transactions/loyalty/referral 的**字段级**读取 + OAuth 接入；官方源是 developers.easystore.co / postman.easystore.co / support.easystore.co。

**能推断的定位**（未坐实）：EasyStore 是东南亚电商建站平台，在我们这盘棋里最可能是**商店与 CRM 数据底座**——订单、客户、交易、忠诚度、推荐码，这几样恰好是 Shopee/Lazada 因 PII 打码或聊天关门而给不全的东西。**如果这个推断成立，EasyStore 反而是我们 P3 CRM 区最干净的客户数据来源。**

**能干什么 / 不许画的 / 红线 / 配额 / OAuth 细节**：**未知，等完整研究对象补齐**（见诚实栏第一条）。在拿到全文前，任何依赖 EasyStore 的设计决策都应标"待 EasyStore 真相补齐"。

---

## 第三部分 · 与现行设计和法律的冲突点（最重要）

> 每条格式：**冲突** → **平台真相** → **要改什么**。分三档：🔴必须改写（已画/已批但和官方对着干）、🟡要限定范围（能做但有隐形墙）、🟢已对齐（确认没问题，写出来防止将来改错）。

### 🔴 C1 · WhatsApp Status 当发布渠道 —— 作废改写
- **冲突**：`docs/research/GRILL-WORKSHEET-2026-07-03.md`（第 570 行）把排期区未来覆盖渠道写成"覆盖长尾渠道（**WhatsApp status**/小红书类）"。这就是编排口中"大陆地图第 5 名"——把 WhatsApp Status 当成一个可发布的渠道排进了名单。
- **平台真相**：WhatsApp **官方三处 API 全查过，没有任何 Status/动态发布接口**。这不是"要等审核"，是**根本不存在**。
- **要改什么**：把"WhatsApp status"从任何"可发布渠道"清单里**划掉或改写**为"官方无发布接口、不可做"。注意别误伤：**Instagram Stories 是能发的**（media_type=STORIES），"Stories 这个概念"没死，死的是"WhatsApp Status"这一个。别把两者混为一谈。
- **好消息**：我们**排期区的代码是干净的**——`SCHEDULE_CHANNELS = ["instagram","facebook"]`，只画了 IG/FB，注释还写着"until App Review adds more"。所以要改的是**路线图/叙事文档**，不是已上线的按钮。

### 🔴 C2 · 一键群发 / 冷号直接群发 —— 加 opt-in 硬闸，否则封号
- **冲突**：`docs/northstar/WHATPASS-V2-CANDIDATES.md` 已批准（M-06）"分群群发 + 失败重发 + 送达报表"，并新增"**冷启动号码导入直接群发（无对话历史）**"。
- **平台真相**：①WhatsApp **没有一键群发接口**，是逐个收件人循环 + 双重限速；②发营销模板**必须先有 opt-in**，把导入的陌生号码直接群发营销模板 = **踩 opt-in 红线**，会被限流+举报+可能封号；③营销类模板**不论窗口内外一律按条真金白银计费**（走通道费账道）。
- **要改什么**：（a）"群发"UI 背后必须是**逐条发 + 限速 + opt-in 校验**；（b）"冷号直接群发"这个候选要么砍掉，要么强制加"这批号码是否已 opt-in"的**fail-closed 硬闸**——好在我们已经判要了"Consent/勿扰字段 + 群发运行时硬拦截"（WHATPASS 第 43 行，已升级为运行时硬约束），**这就是这道闸的落点**，务必让它在 Shopee/WhatsApp 所有主动消息前先跑。

### 🔴 C3 · 一键请评 —— 没有任何平台给"催评"接口
- **冲突**：`WHATPASS-V2-CANDIDATES.md` 第 254 行"Reviews 轻量版（**自动请求评价**+AI 回复评价）… 下单后自动请评"（轻量子集转正候选）。
- **平台真相**：**Google、Shopee、Lazada 三家全都没有"发送请评邀请/催评"的 API**。Google 只能分享后台生成的评价链接；Shopee/Lazada 只能读评+回评。
- **要改什么**：（a）"自动请评"必须改成**我们自建触达（WhatsApp/短信/邮件）去分享官方评价链接**，不能宣称"平台原生请评"；（b）**AI 回复评价是可行的**（Google/Shopee/Lazada 都有回评接口，代客户回复需先拿授权），这半边保留；（c）**法律硬线**：Google 禁 review gating——**不能只给满意客户发请评**，否则下架评价+挂警示牌。请评逻辑里不许有"先判断满意度再决定发不发"。

### 🔴 C4 · Shopee 上的"复购唤回主动私信" —— 平台明令禁止
- **冲突**：CRM/唤回区（P3）的心智是"跨所有渠道把沉睡客户唤回"，`WHATPASS` 多条唤醒候选（第 208、410 行）默认能主动私信老客。
- **平台真相**：**Shopee Chat API 明令禁止主动推送/促销群发/机器人自动回复**，而且**新接入者根本申请不到 Chat API**（2024-11-18 关门）。Google 私信已下线。
- **要改什么**：唤回渠道要**按平台分门**——WhatsApp 可（有 opt-in + 计费）、EasyStore/自有渠道可、**Shopee 主动私信不可**（连接口都没有）、Lazada IM 待"AI Terms"排查。任何"跨全渠道统一唤回"的设计要标清哪些渠道走不通。

### 🔴 C5 · AI 客服自动回复 —— 三堵法律墙
- **冲突**：自动回复/客服区（对标 respond.io，P2/P3）默认能在各渠道 AI 自动回。
- **平台真相**：①**Shopee 禁机器人自动回复**、禁把自动消息伪装成人工；②**Lazada 有"Seller IM AI Terms"独立条款（我们没抓到内容）**，可能专门约束 AI 自动回话术；③WhatsApp 有 AI Provider 存亡级风险。
- **要改什么**：AI 自动回复必须**按渠道开关**：WhatsApp 有条件可、Shopee 不可（至少不能自动回 + 不能伪装人工）、**Lazada 动工前必须先读到那份 AI Terms**。这是设计前置阻断项，不是细节。

### 🟡 C6 · 分析区四个"即将上线"标签 —— 有的平台没有那种数据
- **冲突**：`apps/web/lib/analytics-platforms.ts` 画了分析区平台切换器：Meta（live）+ TikTok/Shopee/Google/**WhatsApp**（标"soon"占位）。标签本身诚实（都写着即将上线），但**背后的承诺**要对齐真相。
- **平台真相**：**WhatsApp 根本没有营销归因分析**——官方只给"消息送达/已读回执"和"质量分（还不公开数字）"。一个暗示"触达→转化漏斗"的 WhatsApp 分析 tab 会兑现不了。TikTok 分析是真的但**分散在三个门**（内容/广告/Shop 各一套 API，且部分登录墙）。Google 分析真但 BUSINESS_CONVERSATIONS 指标存疑。
- **要改什么**：这几个"soon"上线时**各自缩到官方真给的口径**——WhatsApp tab 就叫"送达 & 号码质量"别叫"营销分析"；TikTok tab 要么先只上广告侧，要么明确它是三套拼的。占位标签不用现在改，但**产品叙事别提前吹**。

### 🟡 C7 · "一稿多发 FB+IG+TikTok" —— TikTok 那一路要先过审 + 单独适配
- **冲突**：`WHATPASS` 第 355 行已批（S-04）"同一条促销发 FB+IG+TikTok，一键"。
- **平台真相**：TikTok 内容发布**过审前只能"仅自己可见"**，且是**另一套 API**（要先调 Query Creator Info 拿到当前允许的隐私级别，选项必须完全匹配返回值）。所以"一键发含 TikTok"要等审核过 + 单独 adapter。
- **要改什么**：多平台一稿多发的**平台可插拔架构**要允许"某平台未过审时该 tab 灰掉/标 pending"，别做成"三个都亮着能发"的假象。

### 🟡 C8 · 直播管理 —— 只有 Shopee 能编程开播，TikTok 不能
- **冲突**：若未来画"统一开播/直播间选品"跨市场按钮。
- **平台真相**：**Shopee 有**完整直播 API（create/start/end session、上下架直播间商品、马来支持）；**TikTok 没有**（只能读直播数据，开播得手动）。
- **要改什么**：直播的"程序化开播/挂品"能力**只对 Shopee 承诺**；TikTok 直播是"手动开播 + 我们读数据"。别画统一开播按钮。

### 🟡 C9 · Lazada 的 CRM 客户数据 —— 默认看不到电话
- **冲突**：CRM 区（P3）"联系人从对话/订单自动进来"。
- **平台真相**：**Lazada 客户姓名/电话默认打码**，要明文得过 DataMoat 安全审（渗透测试 + 2 周限时）。
- **要改什么**：Lazada 侧 CRM 先按"打码默认"设计，明文解码当成**一个独立安全项目**排期，别假设一接入就有电话。**EasyStore（若定位成立）可能是更干净的客户数据来源**——但等它真相补齐再定。

### 🟢 C10 · 已对齐，确认无误（防将来改错）
- **排期用我们自建定时器**：IG 官方没有原生排期，我们自建调度 worker 到点发——**这是唯一正确解**，别有人以后"优化"成想找 IG 原生排期参数（不存在）。FB 侧倒是可以用原生 scheduled_publish_time（10 分钟–75 天）省事，可选。
- **通道费独立账道（harmony-05）**：WhatsApp 营销消息按条真金白银算，我们的"两条账道分行列示报价卡"设计**正好接住** Meta 的 per-message 计价——对齐。
- **对外 MCP 禁区 vs TikTok 官方 MCP**：宪法第 8 条禁的是"外人操作我们的城"，而**我们作为消费方去调 TikTok 官方 MCP**已由 v2.10 附则⑦释宪允许——**合法通道**，别误判成违宪。
- **审批闸 vs Meta 同意条款**：Meta 1.7"代发前先同意"和我们的 `needsApproval = write ∧ external`（外部写要审批）**天然对齐**——代客户发帖本就是外部写，必过审批闸。
- **消费明细 / dev 花费问 founder**：WhatsApp/BytePlus 等测试期真实花费**逐笔问 founder**（宪法第 2 条），发测试营销消息也算，别自动烧。

---

## 第四部分 · 十个工作日权限冲刺清单（顾客一号 · 五把钥匙）

> **先说一句实话**：`docs/design/2026-07-04-gtm-gate0-worksheet.md` 里"第一个付费客户到底是谁"还全是【待定】（Gate 0 未通过）。所以下面的"五把钥匙"是**给一个典型马来西亚 SMB 配的标准五把**——真正顾客一号需要哪几把，取决于他实际用哪些渠道。**这是并行去排队的清单，不是等一把办完再办下一把。**
>
> "谁能办"分两种人：**founder**（提供公司实体/KYC/身份证件、接受平台条款、做商家侧授权——像当初签 BytePlus 那类动作）；**工程**（建 app、写演示流程、提交审核、接 OAuth）。

| 钥匙 | 覆盖的活 | 接入动作（谁办） | 预计等多久 | 10 天内能到哪一步 |
|---|---|---|---|---|
| **① Meta（IG+FB）** 🥇最高优先 | 排期真发布、广告写/建、读评回评 | 工程：给现有 Meta app 加 instagram_content_publish + pages_manage_posts（发布）、ads_management + pages_show_list（广告写）；录 1080p 每权限演示视频、备隐私政策 URL/app 图标、提交 App Review。founder：提供商业验证材料、接受 Platform Onboarding Terms | App Review **提交后一周内**出结果；商业验证另算（可能几天到几周） | **能提交 + 大概率出结果**。这是解锁"排期真发布"和"广告写/建"的**唯一钥匙**，第 1-2 天就得提交 |
| **② Google 商家资料** | 发帖、读评回评、本地数据、请评（分享链接式） | 工程：建 GCP 项目拿 Project Number、用 GBP 表单选"Application for Basic API Access"提交（**提交邮箱必须是某商家的 owner/manager**）。founder/客户：该商家要已验证 + 活跃 60 天 + 有官网 | FAQ 说 **14 天内**审 | **能提交，窗口内多半还没批**（14 天略超 10 工作日）。越早提交越好 |
| **③ Shopee（马来）** | 上架、短视频、直播、广告、订单/归因（**不含聊天**） | 工程：注册开发者账号、按功能申请 scopes、接 webhook。若走第三方平台(ISV)：要有营业执照 + 已上线产品 + 可验证电商集成 + HTTPS/TLS1.2+ A 级评级。founder：营业执照 | 卖家账号审 **3 工作日**；ISV 审 **10 工作日** | **卖家路径 10 天内能批**；ISV 路径卡点在 10 工作日线上。**记住：新账号拿不到 Chat API** |
| **④ TikTok** | 发内容（先仅自己可见）、广告（官方 MCP）、Shop 数据 | 工程：注册开发者 app 申请 video.publish、提交 ToS 合规审核解 SELF_ONLY；注册 TikTok Shop Partner（选马来）；邮件要 Business MCP 书面工具清单。founder：Business Center/Shop 的公司实体 | 内容发布审核**时长官方没给**；Shop 审传闻 2-7 天（非官方） | **未过审也能先接**（SELF_ONLY 测试，≤5 号）。公开发布不保证 10 天内解锁 |
| **⑤ 商店/CRM 底座（EasyStore ／ Lazada 备选）** | 订单/客户/交易/忠诚度/推荐（CRM 数据源）、Lazada 上架/广告 | 工程：EasyStore OAuth 应用注册（**细节未知，见诚实栏**）；Lazada 走开发者账号 + App 转正（两周达标）+ 若要客户电话再过 DataMoat（2 周限时）。founder：Lazada 需营业执照 | EasyStore：未知；Lazada：**数周起**（转正 + DataMoat 各约 2 周） | **EasyStore 大概率最轻、最先能通**（待真相补齐确认）；**Lazada 明确超出 10 天窗口**，本冲刺只能"启动排队" |

**十天冲刺的现实预期**：
- **第 1-2 天**：把 ①Meta ②Google ③Shopee ④TikTok 四把钥匙**全部提交/注册**（这几个都能立刻发起）。
- **窗口内大概率清掉**：③Shopee 卖家账号（3 天）、①Meta App Review（约 1 周）。
- **窗口内提交但要探头出去等**：②Google（14 天）、③Shopee ISV（10 天压线）。
- **本冲刺只能"点火排队"、批不下来**：④TikTok 公开发布审核（无 SLA）、⑤Lazada（数周 + DataMoat）。
- **不在本冲刺、但要早做的一件非技术事**：**法务判定"FIKIRTIVE 算不算 WhatsApp 眼里的 AI Provider"**——这决定 WhatsApp（P2）值不值得重仓，越早判越好，别等 P2 才发现白建。

---

## 第五部分 · 诚实栏（哪些没看全 · 哪些结论会过期）

**① 我收到的研究数据本身有缺口（最大的一条）**
- **EasyStore 的研究对象在传给我时被截断**——正文没到，我只看到它聚焦 orders/customers/transactions/loyalty/referral 字段 + OAuth。所以**第二部分第 8 页是残页**，EasyStore 的能力/红线/配额/OAuth 细节都写不了。凡依赖 EasyStore 的决策请标"待补齐"。**建议**：把 EasyStore 的完整研究对象重新取回再补这一页。
- "八平台"的账：8 = IG + FB + WhatsApp + Google + TikTok + Shopee + Lazada + EasyStore；其中 **Meta 一份研究覆盖 IG+FB 两个**，所以我手上是 6 份研究对象覆盖 7 个平台 + EasyStore 残页。

**② 官方文档看不全（要登录/要资质/SPA 渲染）**
- **TikTok for Business MCP**：登录墙，工具清单/认证/限频全没核实——第三方博客提到的工具名(campaign_create 等)不采信。
- **TikTok Shop Open Platform**：JS 渲染 SPA，限频页、"App Scoring and Tiering"分级页没读全。
- **Shopee Chat API 完整文档**：登录门槛内容，只拿到方法名清单，没逐个核对参数。
- **Lazada "Seller Instant Messaging AI Terms"**：**没抓到内容**——直接影响"AI 售前自动回复"是否合规，是**关键缺口**，动工前必须单独取回原文。
- **WhatsApp Flows 页 / 质量分页**：SPA，正文靠搜索摘要拼的，没逐字核对。

**③ 官方自己打架 / 结论存疑（需用真号实测才能定）**
- IG 24h 发布配额 **50 vs 100**（同页两处矛盾）——实测 `GET content_publishing_limit`。
- Google **BUSINESS_CONVERSATIONS** 指标：枚举还在 vs 支持文章说已下线——实测该字段返不返数据。
- Meta App Review 时长：只有"一周内"是官方原文，"2-3 天"是搜索摘要，不采信。
- Lazada App 转正成功率门槛 **95% vs 85%**（两份官方文档矛盾）——以 Console 实际提示为准。
- WhatsApp 质量分/拉黑率**具体百分比 Meta 从不公开**——网传数字全是猜的，我们做防封号监控无法用官方阈值。

**④ 会过期的结论（有时效，要盯官方后续公告）**
- **WhatsApp 计价按季度可调**（1/1、4/1、7/1、10/1）：2025-07-01 起已转"按条计价"；2026-07-01 多国拿独立市场价、巴西 BRL 本币计价上线——马来价目要持续核。
- **TikTok Shop 马来 NPRA 强制属性 2026-07-09 才生效**——刚生效，是全新规则。
- **Meta Business Agent**（2026-06-03 发布）当前不含内容发布/排期，但官方留了"未来扩展"口子——和我们内容发布这块目前不撞车，但要持续关注它会不会扩到发布/评论回复（评论/私信回复方向可能和我们售前对话泳道重叠）。
- 各平台审核时长、门槛数字都可能随文档更新变动，本台账是 **2026-07-10 的快照**。

---
*台账制作：合账官（Opus 级）· 基线 main c7f6a04b · 2026-07-10*

---

## 附页:EasyStore 完整真相(合账时被截断,此为研究员原始产出补录)

**能干什么(官方支持):**
- [官方支持] CRM：顾客档案同步（姓名/联系方式/消费历史/分组） — Customers REST（GET list /api/3.0/customers.json、GET search、GET single、POST create、PUT update、DELETE）。Customer 字段含 id/email/phone/first_name/last_name/gender/birthdate/country/order_count/total_spent/total_credit/accepts_marketing/last_order_at/groups/addresses/metafields/code/is_blacklisted/attributes 等，字段级已核对（postman.easystore.co Customers 详情页）。scope: read_customers/write_customers。
- [官方支持] 订单/交易记录同步（收入归因、复购信号来源） — Orders REST（GET list /api/3.0/orders.json、GET single、DELETE、POST create、POST cancel、POST refund、PUT cancel-refund、PUT update）+ Transactions REST（GET list /api/3.0/orders/:order_id/transactions.json、GET single、POST create）。Order 对象含 attribution_location_id / attribution_user_id / sales_attributions{staff,location} 字段——可直接做归因回执（谁/哪个门店促成了这单）；Order 亦嵌 point_earning / point_redemption（积分本单发生/核销情况）。Transaction 对象含 amount/currency/gateway_type/gateway_title/gateway_method/status(-3..4)/error_code。scope: read_orders/write_orders（Transactions 未见独立 scope，随 Orders 一并授权，未在 scopes 页逐条列出——存疑）。
- [有限支持] 忠诚度积分：读取/调整顾客积分余额（复购唤回分层依据） — Customers > Points（导航栏确认两端点：GET Retrieve customer points、PUT Manual adjust customer's point）。端点存在（Postman 左侧目录已确认），但详情面板（具体路径/参数/返回字段）未能在本轮抓取到——技术原因是该 SPA 用虚拟滚动，多次点击后仍只加载了同级的 Credits/Vouchers 详情，Points 详情正文未渲染出来。已列入假设台账，需要后续单独访问确认 exact path。帮商家本身的忠诚度"积分系统"（赚取规则/兑换规则）来自 Help Center 文章，是后台功能，未在其中提及任何 API/webhook（见 support.easystore.co 积分文章）。
- [官方支持] 顾客储值余额（Credits）：可作为复购唤回的代金激励发放/核算 — PUT /api/3.0/customers/:customer_id/credits/adjust.json（相对调整）、PUT /api/3.0/customers/:customer_id/credits/set.json（设为定值）。字段级已核对：body 仅需 adjustment_amount + description；响应无 body。Customer.total_credit 字段可读取余额快照。
- [有限支持] 优惠券/请评奖励（Vouchers）：查询顾客名下券、标记已核销 — GET /api/3.0/customers/:customer_id_or_code/vouchers.json、GET /api/3.0/customers/:customer_id_or_code/vouchers/:voucher_code/use.json。两端点在官方文档中均标注"(Coming soon)"——即已写入文档但尚未上线，现在还不能拿来建。另注："标记券已核销"这条官方文档把 HTTP method 写成 GET（语义上应是写操作），大概率是文档笔误，未上线前无法验证真实行为——已列入假设台账。
- [官方无此能力] 转介绍/推荐计划（Referral Program）追踪与自动化 — 无（EasyStore 后台 Channels > Referral Program 是纯后台功能：唯一链接+佣金百分比/固定额+确认周期，Business/Growth 套餐专属）。已核对：OAuth scopes 官方清单（read/write ×10 类 + read_currencies 共 21 个）里没有任何 referral 相关 scope；Postman Customers 目录下也没有 Referral 子项；Help Center 的 Referral Program 文章通篇只讲后台配置，完全未提 API/webhook/第三方集成。结论：这是纯商家自服务功能，FIKIRTIVE 拿不到读写口子，也拿不到事件通知。
- [官方支持] 接入方式：OAuth 授权 + app 类型（对外市场 vs 仅自己/客户用） — Partner Dashboard 建 app（唯一 app 类型）→ 三步 OAuth：/oauth/authorize?app_id&scope&redirect_uri → 回调校验 HMAC + shop 需以 easy.co 结尾 → POST https://{shop}/api/3.0/oauth/access_token.json 换永久 access_token → 请求头 EasyStore-Access-Token。EasyStore 不像 Shopify 分"public/private/custom app"三种类型——只有一种 app，创建后立刻可访问 API（"No, you can create the app...access to the API before the review process"，来自官方 Notion《EasyStore App》FAQ）。分发有两条路：①"Public to Everyone"——上架 EasyStore App Store，需送审（发邮件到 dev@easystore.co，附功能说明/演示视频/测试账号，再在 app 详情页点"Submit app review"）；②"Private share by link"——app 详情页拿到专属安装链接直接发给单一客户/自家店铺安装，全程免审核。这条②就是我们对号 FIKIRTIVE 自用/给单店接入的路径。
- [有限支持] Webhook 事件通知（触发请评/复购/归因回执的实时信号源） — Webhooks REST（GET list /api/3.0/webhooks.json、GET count、GET single、POST create、PUT update、DELETE）。官方文档给出的可订阅 topic 清单本身自相矛盾（同一官方 Postman 页面两处描述不一致）：A 处（字段参考表）列了 app/uninstall, store/update, customer/create, customer/update, customer/delete, product/create, product/update, product/delete, order/create, order/update, order/cancel, order/paid, order/partially_fulfilled, refund/create, fulfillment/create, fulfillment/update, currency/create, currency/update, currency/delete, location/create, location/update, location/delete；B 处（创建 webhook 的 body 描述）列了 app/uninstall, store/update, product/create, product/update, product/delete, customer/create, customer/delete（缺 customer/update）, order/create, order/update, order/paid, order/cancel, order/partially_paid（拼法与 A 不同：partially_paid vs partially_fulfilled）, fulfillment/create, fulfillment/update, fulfillment/cancel（A 没有）, refund/create, channel/inventory_update（A 没有）。两份清单都是当前（2026-07-10）线上文档原文，未做任何取舍——建集成前必须实测确认真实可订阅的 topic 值。

**接入门槛:**
- 免费注册 EasyStore Partner 账号（partners.easystore.co/signup）即可进 Partner Dashboard 建 app、拿 Client ID/Secret——无需资质审核这一关。
- Development store（沙盒）：1 年有效期、订单数上限 100 单（官方原文：development store... comes with a 1-year validity and full feature access, but is limited to 100 orders，来自搜索结果对 developers.easystore.co 内容的引用，未逐字核对原页；已列入假设台账建议二次确认）。
- app 建好即可直接调用 API（免审核）——这一步就能开始接你自己的店或客户的店。
- 只有当你要把 app 上架到 EasyStore App Store 面向所有商家开放时，才需要送审：发邮件到 dev@easystore.co，主题《EasyStore App Publish Application》，附功能说明+演示视频+测试账号，再在 app 详情页点『Submit app review』按钮。
- OAuth 回调环节官方要求校验 HMAC 签名，且 shop 参数必须以 'easy.co' 结尾才算合法回调——这是接入时的硬性校验点。

**红线:**
- Webhook 送达明确不保证——官方原文（今天 2026-07-10 仍在线，非历史陈述）："Webhook delivery isn't always guaranteed."（webhooks/limitations 页）以及 "As webhook notifications are not guaranteed, we recommend implementing reconciliation process for data accuracy... via a long-polling mechanism"（webhooks/best-practices 页）。EasyStore 官方明确要求：不能只靠 webhook 做请评/复购唤回这类营收关键触发，必须叠加轮询对账兜底。
- 同一份官方 Postman 文档内 webhook topic 清单前后不一致（见上方 capabilities 备注的 A/B 两份清单差异）——这是文档自身的矛盾，不是我方误读，建 webhook 集成前必须拿真实 app 测一遍才能定案。
- Referral Program（转介绍计划）完全没有 API/webhook/scope 暴露——只能后台手工配置，程序化读写和事件订阅都拿不到。
- Vouchers（券）相关两个端点官方标注"(Coming soon)"，现在调用大概率打不通或行为未定义，不能现在就往生产计划里排。
- 官方文档全程未披露任何具体限频数字（次/秒、次/分钟）——只给了 X-RateLimit-Remaining / X-RateLimit-Limit 两个响应头名字，建议做法是"exponential backoff"/"暂停-恢复"，没有可提前设计死的固定阈值。
- webhook 响应必须 10 秒内回 200，否则 EasyStore 视为未送达（"If your response exceeds 10 seconds or has a non-200 status code, EasyStore will assume your webhook did not receive the data."）——回调处理逻辑必须做成异步快速 ack。

**限频/配额:**

**做不到(设计不许画):**
- 不能程序化读写 EasyStore 的转介绍/推荐（Referral Program）——无 scope、无端点、Help Center 原文通篇零 API 提及。
- 不能现在就接 Vouchers（顾客名下券查询/核销）——官方标注 Coming soon，未上线。
- 不能只靠 webhook 做"实时触发"假设——官方两次明文声明送达不保证，必须叠加轮询对账，否则请评/复购唤回会漏单。
- 不能提前把限频具体数字（如"每秒 N 次"）写进架构设计——官方没给数字，只给了响应头名字，设计上只能做成自适应退避，不能写死阈值。
- 不能假设 EasyStore 有 Shopify 那种"public app / private app / custom app"三分类概念——EasyStore 只有一种 app，区别只在"要不要审核上架市场"，产品文案和接入引导不能照搬 Shopify 的三分类心智模型。

**假设台账:**
- Points（积分）端点具体路径/参数/返回字段未核实到——Postman 左侧目录已确认存在『GET Retrieve customer points』『PUT Manual adjust customer's point』两个端点名，但详情正文因该文档站是虚拟滚动 SPA、多次点击后仍加载了相邻 Credits/Vouchers 的内容，Points 正文始终没有渲染出来。需要后续单独一轮，用更精确的滚动/点击定位到 Points 详情面板取字段级数据。
- Points/Credits 是否需要独立的 scope 未核实——官方 API Access Scopes 页只列出 read/write 各 10 类 + read_currencies 共 21 个 scope，其中没有单独命名的 points/credits/vouchers scope，推测是随 read_customers/write_customers 一并授权，但未找到官方原文明确说明这点。
- Transactions 是否有独立 scope 也未核实——同上，scopes 页没有 read_transactions/write_transactions 字样，推测随 read_orders/write_orders 一并授权，未见官方原文明说。
- 存在 Storefront API 4.0（documenter.getpostman.com/view/8990364/2sA3Bn6CN，来自官方 Notion《EasyStore App》页面的 APIs 小节引用）——本轮只探查了 3.0，4.0 是否新增/取代了 loyalty、referral 相关能力完全没看，需要专门再排一轮。
- development store 沙盒『1 年有效期 / 100 单上限』的说法，来源是 WebSearch 自动摘要引用 developers.easystore.co 的内容，我没有逐字重新核对该页原文本身是否就是这个数字——建议下一轮直接访问该页原文确认。
- Vouchers『标记已核销』端点官方文档把 HTTP method 标注成 GET（语义上是写操作）——可能是文档笔误也可能是真实设计，因为该端点标注 Coming soon 尚未上线，此刻无法用真实调用验证，只能存疑挂起。
- webhook 可订阅 topic 的两份官方清单（field-reference 表 vs create-webhook body 说明）互相矛盾，没有做取舍——这不是我方遗漏，而是官方文档本身当前（2026-07-10）就是这样两份不一致的原文，需要建 app 实测才能定案，不能凭空选一份当权威版本。

**官方来源:**
- https://developers.easystore.co/docs/api
- https://developers.easystore.co/docs/api/authentication
- https://developers.easystore.co/docs/api/getting-started
- https://developers.easystore.co/docs/api/getting-started/scopes
- https://developers.easystore.co/docs/api/getting-started/response-codes
- https://developers.easystore.co/docs/api/getting-started/api-call-limit
- https://developers.easystore.co/docs/api/webhooks
- https://developers.easystore.co/docs/api/webhooks/limitations
- https://developers.easystore.co/docs/api/webhooks/best-practices
- https://developers.easystore.co/docs/api/development-store
- https://postman.easystore.co/
- https://documenter.getpostman.com/view/8990390/TzRYc4mn
- https://easystore.notion.site/EasyStore-App-1b8533fd35ff4434b578178d0fa3f887
- https://easystore.notion.site/Create-app-c9d6aba41c1248738f2a3e57a0352a20
- https://easystore.notion.site/Distribute-app-7264dfc8f8d34935b2e3187d3e8e3fd1
- https://support.easystore.co/en/article/point-system-loyalty-program-1i74do1/
- https://support.easystore.co/en/article/set-up-referral-program-i43q4v/
