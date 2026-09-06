> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# Adobe GenStudio(创始人所说的 "GenSpace")— Benchmark 报告

## 0. 消歧(先说结论)

Adobe 没有叫 "GenSpace" 的产品。创始人指的几乎肯定是 **Adobe GenStudio**,而它其实是三层东西,容易混:

| 名称 | 是什么 | 关系 |
|---|---|---|
| **Adobe GenStudio**(伞品牌) | "Content Supply Chain solution"(内容供应链解决方案)— 不是单一产品,是一组产品的打包故事:Workfront(项目/审批)+ AEM Assets(企业 DAM)+ Firefly(生成模型)+ Express(轻量创作)+ GenStudio for Performance Marketing + **GenStudio Foundation**(统一入口界面,2026-03-31 起免费 provision 给全部 Workfront 客户)([adobe.com/products/genstudio](https://business.adobe.com/products/genstudio.html), [Workfront 26.Q2 release](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/release-26-q2/26-q2-release-overview)) | 母体 |
| **GenStudio for Performance Marketing (GS4PM)** | 单一 app:用 genAI + 品牌护栏批量生成广告/邮件 → 审批 → 一键投放 Meta/Google/TikTok 等 → 回收表现数据闭环。2024-10 GA([Adobe 新闻稿](https://news.adobe.com/news/2024/10/101424-genstudio-for-performance-marketing)) | **本报告主体** — 与 FIKIRTIVE 最对标 |
| **Firefly / Express** | Firefly = 底层生成模型 + 独立创作平台(消费者版 + 企业版);Express = 轻量设计工具。两者都被嵌进 GS4PM | 引擎/配件 |

2026 年还新增了 sibling:**GenStudio for Content Marketing**(长文档/视频 → 成套 campaign/文章)和 **GenStudio for Commerce Media Networks**([Summit 2026 新闻稿](https://news.adobe.com/news/2026/04/adobe-introduces-brand-intelligence))。

---

## 1. 产品定位一句话 + 定价模型

**一句话**:企业级 "genAI-first 营销内容供应链" — 让营销团队在品牌护栏内批量生成 paid social / display / email 创意,走完审批,直接 traffic 到广告平台,再用 AI 属性级归因告诉你哪种创意在赚钱。

**定价(重点:他们怎么收钱)** — 完全不公开报价、纯企业 quote 制([Capterra](https://www.capterra.com/p/10022340/GenStudio/), [DWAO](https://dwao.in/blog/adobe-genstudio-pricing)),但打包结构公开(法务 [Product Description](https://helpx.adobe.com/legal/product-descriptions/adobe-genstudio-for-performance-marketing---product-description.html)):

- **Base license 含**:10 个 Power Users + 20 个 Collaborator Users + 5 个 Brands + 2TB 存储 + **60,000 Generative Actions/年** + 25M 行 insights 数据
- **Generative Action** = 用量计费单位。1 次 email/paid media/display 生成 = 5 actions;单区块重新生成 = 1 action;**brand validation(品牌校验)和自动打标 = 0 action,免费**([Concepts 文档](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/intro/concepts))
- **扩容包**:每 5 个 Power Users 的加购包附带 +30,000 actions/年;actions 超量可单独加购
- 收费逻辑 = **双层席位(创作者贵、审批者便宜)× 用量 credits × 容量(brands/存储/数据行)** 三轴混合
- 对照:Firefly 消费者版 ~US$9.99–$199.99/月 的 credits 阶梯(Standard/Pro/Premium;各家转述价格有出入,**具体档位价未核实**,[costbench](https://costbench.com/software/ai-image-generators/adobe-firefly/));GS4PM 本身没有任何 SMB 价位,坊间无公开合同数字(**估计年费六位数美元级,未核实**)。

---

## 2. 功能总清单(by sub-area)

价位档说明:GS4PM 只有一个企业档(base license + 加购),所以下面标注 [base] / [加购或另购 SKU] / [beta]。主要来源:[官方 Release Notes 2024.10–2026.06](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/release-notes)、[Concepts](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/intro/concepts)、[MAX 2025](https://news.adobe.com/news/2025/10/adobe-max-2025-genstudio)、[Summit 2026](https://news.adobe.com/news/2026/04/adobe-introduces-brand-intelligence)。

### A. Brand Governance(品牌治理)— 他们的核心卖点
| 功能 | 做什么 | 档 |
|---|---|---|
| **Brands / Products / Personas** | 三种 first-class 记录:品牌(guidelines、tone、logo、色板、channel 级准则)、产品描述、目标人群 — 生成时全部作为护栏注入 | base(5 brands) |
| **Add from URL**(2026.05) | 贴一个已发布网页 URL,自动抽取信号建 Brand/Product/Persona | base |
| **Brand validation + brand score** | 生成时实时校验是否合规、给品牌分;手动重查不耗 actions | base,免费 |
| **Compliance checks** | 对 Brand + 平台规范 + ADA(无障碍)三重检查;受监管行业的 claims 合规走 extensibility add-ons | base + 加购 |
| **Brand Intelligence**(2026.04) | 从静态 guidelines 升级为**持续学习引擎**:吃 review 反馈、批注、拒绝/通过记录,动态更新品牌理解,并开放给 AI agents 调用 | 新 SKU/未明 |
| **Data governance** | 有害内容/偏见/脏话拦截,"Can't generate" 硬挡 | base |
| **Content Credentials**(beta 2026.01) | 生成资产嵌入可验证的真实性元数据(C2PA) | beta |

### B. Create(创作/生成)
| 功能 | 做什么 | 档 |
|---|---|---|
| **Create Canvas / Horizon Canvas** | prompt 驱动生成整版广告/邮件,批量出 variants,协作实时编辑(Editor/Viewer 角色,2026.05) | base |
| 支持渠道 | Meta ads、LinkedIn ads、Display/Banners、Email(最多 10 个 pod 区块)、TikTok in-feed video、YouTube Shorts、CTV 广告(genAI 场景组装)、ChatGPT Ads、Paid Media 泛类 | base(逐季新增) |
| **Templates** | 上传 HTML5 zip、AJO/Marketo/第三方 email 模板;Express templates 直接 WYSIWYG 编辑;starter templates;logo swap(多品牌换标);template code editor | base |
| **Variants 引擎** | 一次生成多变体;富文本;CTA rephrase;图片 swap;多比例导出 HTML/JPEG/PNG | base |
| **GenExpand / resize** | AI 扩图改 aspect ratio,一素材适配全 placement | base |
| **多语言** | 12+ 种语言直接生成;**40+ 语言 out-of-the-box 批量翻译**(Azure OpenAI) | base |
| **Firefly Image Model 4 / 4 Ultra + Custom Models** | 图片生成;可在 FIM4 上训自有品牌风格模型 | base / 加购 |
| **Firefly Foundry**(MAX 2025) | 用整个 IP 库深度调优专属模型(图/视频/音频/vector/3D) | 另购,天价级 |
| **Firefly Design Intelligence "StyleIDs"**(MAX 2025) | 把设计系统训成可生成 layout/组件排布的模型 | 另购/beta |
| **Content Production Agent**(beta) | 对话式 agent:读 brief → 自动产出多渠道成套内容 | beta |
| **Photoshop & Figma plugins**(2025.10) | 设计师在原工具里做 on-brand 个性化广告 | base |
| **Real-Time CDP audience 接入**(2025.11) | 直接选 CDP 人群来个性化创意 | 需另购 RT-CDP |
| 底层文案模型 | Azure OpenAI 的 GPT 系列(第三方 LLM)+ 自家 Firefly 出图 | — |

### C. Content(资产库,DAM-lite)
| 功能 | 做什么 | 档 |
|---|---|---|
| **Content library** | 存/搜/复用已审批资产;**AI 自动打属性标签(免费,不耗 actions)**;色彩标签筛选;metadata 编辑 | base(2TB) |
| **AEM Assets / Content Fragments 集成** | 企业 DAM 深度打通;预审批模块化 email 内容直接 swap | 需另购 AEM |
| **SDK / custom DAM 连接** | extensibility framework 接第三方 DAM | base |

### D. Review & Approval(审批)
| 功能 | 做什么 | 档 |
|---|---|---|
| 内建 **Reviews & Approvals** | 干系人审批框架,GA 起就有 | base |
| **Workfront Proof 集成**(2025.01→06 GA) | 审批模板、多级审批流、批注 | 需另购 Workfront |
| **Campaigns** | 按营销战役组织所有 experiences | base |
| **Agency System of Record**(2026.04) | 内外部(agency)团队协作时保留治理与归档 | 新 SKU/未明 |

### E. Activation(投放/发布)— 护城河所在
| 渠道 | 状态 |
|---|---|
| **Meta Ads Manager** | GA:图片、单视频、多比例、App Promotion campaigns(2026.06) |
| **Google CM360** | GA:display + video 直发 |
| **Google Ads Demand Gen** | YouTube Shorts 投放(2026.06) |
| **Google Marketing Platform** | beta coming(MAX 2025) |
| **LinkedIn Campaign Manager** | GA |
| **TikTok** | in-feed video ads 创建+审批+投放(2026.03) |
| **Amazon Ads** | GA(display) |
| **Innovid/Flashtalking** ad server | GA/beta |
| **ChatGPT Ads** | 端到端(2026.05–06)— 首批 ChatGPT 广告通道 |
| **Pinterest / Reddit / The Trade Desk** | Adobe 官方 blog 提及 streamlined trafficking(**细节未核实**,[blog](https://business.adobe.com/blog/the-next-era-of-performance-marketing-with-genstudio)) |
| **CTV via MNTN** | 新集成(2026.04) |
| Email/owned | 导出 + Adobe Campaign v8 / AJO / Marketo 模板通道 |
| 工程细节 | draft 保存、失败重试 — 投放可靠性有专门打磨 |

### F. Insights(表现洞察闭环)— 第二个真正聪明的部分
| 功能 | 做什么 | 档 |
|---|---|---|
| 跨渠道 insights 面板 | 汇集 Meta、TikTok、LinkedIn、Innovid、CTV(MNTN)表现数据 | base(25M 行) |
| **Content Intelligence Featurization V4**(2026.03) | 给每个创意自动打**属性级标签**(CTA/Offer/Logo/情绪语气/13 项视频质量特征),属性 × CTR/CPA/CPC 相关性归因 | base |
| **Text Attribute Insights** | 分析文案的情绪与说服技巧和表现的相关性(限英文) | base |
| **Ad Refresh** | 用表现数据 + 创意属性,几次点击换掉疲劳素材、加码有效素材([产品页](https://business.adobe.com/products/genstudio/performance-marketing/ad-refresh.html)) | base/新 |
| **Ad Recommendations / Next Best Creative**(2026 roadmap) | 主动建议该 refresh/放量哪条;自动按最优属性组装下一条素材 | coming |
| CSV 导出、CPA by Action Type | 运营细节 | base |

### G. 平台/生态(伞级)
- **GenStudio Foundation**:统一 dashboard 看 plans/projects/assets/insights(免费 provision)
- **Agent Orchestrator** 家族:Content Production Agent、Workflow Optimization Agent(Workfront)、Brand Concierge、Audience Agent、Account Qualification Agent、Marketing Agent for Microsoft 365 Copilot([TELUS Digital 综述](https://www.telusdigital.com/insights/digital-experience/article/how-adobe-ai-agents-are-evolving-customer-experience))
- **GenStudio for Content Marketing**、**3D Digital Twin**(NVIDIA 合作)、**Commerce Media Networks**

---

## 3. SMB 视角(马来西亚/东南亚)

**SEA SMB 真会用的(需求真实存在)**:
1. **Brand kit 三件套 + 生成时校验** — SMB 老板最怕 AI 出来的东西"不像我的店";这是刚需
2. **一次生成多变体 + 改比例** — FB feed/story/reel 一套素材全尺寸,是每天的痛
3. **40+ 语言批量翻译** — 马来西亚 BM/英/中三语市场直接命中;这是 GS4PM 里对 SEA 最有共鸣的单一功能
4. **Meta + TikTok 直接投放** — SEA SMB 的两大主战场,不用切 Ads Manager
5. **属性级创意归因 + Ad Refresh** — "哪种图会赚钱、哪条疲劳了该换" 是 SMB 问 agency 最多的问题
6. 轻量审批(老板过一眼再发)

**企业级虚胖(SEA SMB 用不上/够不着)**:
- 起步 10 Power Users + 企业合同 — **定价维度上 SMB 完全不可及**;G2 评价也集中抱怨 seat 成本高、初始配置复杂([G2](https://www.g2.com/products/adobe-genstudio-for-performance-marketing/reviews))
- 前置依赖重:发挥全力要买 Workfront(审批)+ AEM Assets(DAM)+ RT-CDP(人群)— 三个都是企业 SKU
- CM360 / Trade Desk / Innovid / CTV / ChatGPT Ads / Amazon Ads — SEA SMB 几乎为零
- Firefly Foundry / StyleIDs / 3D Digital Twin / Agency System of Record / claims-compliance add-ons / 25M 行 insights — 纯大企业
- Email 为一等公民 — SEA SMB 的私域在 **WhatsApp**,GS4PM 完全没有 WhatsApp/LINE/Shopee/Lazada 概念 → **这就是 FIKIRTIVE 的空档**
- Prompt 工程有学习曲线(专家评测也承认要反复试,[Perficient](https://blogs.perficient.com/2025/05/13/adobe-genstudio-for-performance-marketing-for-beginners/))

---

## 4. FIKIRTIVE 候选映射(仅供创始人决策,不做推荐)

| GS4PM 功能簇 | 候选楼层 | 中性 tradeoff |
|---|---|---|
| Brands/Products/Personas 三件套 + brand kit | **资产区**(存放)+ **创作区**(生成时注入) | 三 record 结构清晰、Otto 也能读;但要防变成"填表作业"——Adobe 靠 URL ingest 解这个 |
| **Add Brand from URL**(网站→自动建品牌档案) | **创作区 / 资产区**(onboarding 机制) | 建置成本低(爬页面+抽取),对"5 分钟开箱"体验杠杆极大;风险是抽取质量参差 |
| Brand validation / brand score(生成时校验) | **创作区** | 免费校验(不耗 credits)符合 FIKIRTIVE credits 心理学;但打分模型要维护 |
| **Brand Intelligence**(从审批/批改行为持续学习) | **存疑**(横切:创作区 + Otto memory) | 与已规划的 Brand-memory rebuild 天然重叠;做的话 Otto 每次被 founder 拒稿都变训练信号;成本在数据管道 |
| Create Canvas + 模板 + 批量 variants + 改比例 | **已有对应楼**(创作区:canvas、4-variant、video flow 已建) | 差距项 = 模板系统(HTML5/email 模板)和整版广告(图+文案+CTA 一体)而非单素材 |
| 多语言生成 + 40+ 语言批量翻译 | **创作区** | SEA 三语市场高杠杆、便宜(LLM 翻译);注意 BM 口语化质量要人工抽查 |
| Email 多 pod 生成 | **建议不要**(现阶段) | SEA SMB email 弱;WhatsApp 才是私域 → 自动回复区已占这个位 |
| Reviews & Approvals(多级审批、批注) | **Campaign 管理区** 或 **Agency 楼层** | 单老板 SMB 只需"过一眼"级;多级审批只在 agency 场景成立 — 两档分开做还是只做轻档,是产品决策 |
| Meta / TikTok activation(创意→直接开投) | **已有对应楼**(Meta connector + G7 ad-build/ad-write);TikTok = 未来 | GS4PM 证明"生成→投放不出 app"是核心卖点;FIKIRTIVE 已在此路上 |
| CM360 / Trade Desk / CTV / ChatGPT Ads / Amazon | **建议不要** | SEA SMB 无此需求;每个 ad-server 集成维护成本高 |
| 跨渠道 insights + **属性级创意归因**(featurization) | **分析区** | 完整版(视频质量 13 特征)重;但轻量版(LLM 给素材打 tag → join 表现数据)成本可控,直接回答"哪种创意有效" |
| **Ad Refresh / Next Best Creative**(疲劳检测→一键换血) | **Campaign 管理区** + **分析区**(闭环);天然是 Otto 技能形状 | 强差异化候选;但依赖上面的属性归因先建好;涉 spend-path 要走既有 money-gate |
| Content library + AI 自动打标 | **资产区** | 生成物已在 canvas;补"自动 tag + 可搜"即中量级增强 |
| Real-Time CDP 人群→个性化创意 | **CRM 区**(存疑) | FIKIRTIVE CRM 区建成后,"按客群生成不同版本"是同构玩法;前置依赖 CRM 数据质量 |
| Content Production Agent(brief→成套内容) | **已有对应楼**(Otto 本体) | Adobe 把它当 beta 卖点;FIKIRTIVE 的宪法就是这个 — 不是要抄,是要比它覆盖面广 |
| Agency System of Record | **Agency 楼层** | 概念可借(agency 操作留痕、品牌方保治理);企业版复杂度不必 |
| Generative Actions 计费结构 | **已有对应楼**(credits 引擎) | 参考点:双席位 × credits × 容量三轴;以及"校验免费、生成收费"的消耗边界设计 |
| Workfront 式项目管理 / GenStudio Foundation dashboard | **建议不要**(项目管理);**存疑**(统一 dashboard 概念) | 全局"我的 campaign 都在哪"一页概览是好想法;做成 PM 工具则背离 SMB 简单性 |

---

## 5. 他们的 AI/agent 打法 vs Otto-operates-100% 的差异化空间

**Adobe 的打法**([Summit 2026](https://news.adobe.com/news/2026/04/adobe-introduces-brand-intelligence)):
- **Agent 是 feature,不是员工**:每个 agent 垂直嵌在一个产品里(Content Production Agent 在 GS4PM、Workflow Optimization Agent 在 Workfront、Brand Concierge 面向消费者对话),由 Experience Platform **Agent Orchestrator** 编排;agent 可以被"assign 成项目协作者"
- **共享大脑 = Brand Intelligence**:agents 共用一个持续学习的品牌理解层 — 这是他们架构里最深刻的一步
- 模型策略:文案用第三方(Azure OpenAI GPT),图像用自家 Firefly("commercially safe" 商用安全是核心卖点)+ Content Credentials 溯源

**差异化空间(对照 FIKIRTIVE 宪法:每层楼是真工具 + Otto 100% 可操作)**:
1. **覆盖率**:Adobe 的 agents 是点状的 — 只自动化被选中的工作流,大量 UI 操作 agent 碰不到;"Otto 能操作每一层楼的每一个按钮"在 Adobe 体系里不存在,他们的产品面积太大、SKU 太碎,做不到
2. **一个雇员 vs 一堆 agent SKU**:Adobe 要凑齐闭环需买 GS4PM + Workfront + AEM + RT-CDP,agents 分属各产品;FIKIRTIVE 是一个 app 一个 Otto
3. **市场空档**:整套打法定价和实施复杂度把 SEA SMB 完全挡在门外;且无 WhatsApp/本地渠道
4. **要警惕的**:Adobe 验证了"agent 需要结构化品牌上下文才可靠"(Brand Intelligence)和"brief→成套内容"的对话式入口(Content Production Agent)— 方向正确性已被他们背书,FIKIRTIVE 不能只有生成,没有品牌上下文层

---

## 6. 值得偷的设计(4 个)

1. **"校验免费、生成收费"的 credits 边界** — brand validation、自动打标、重查都是 0 消耗,只有产出新内容才耗 Generative Actions([Concepts](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/intro/concepts))。用户敢反复检查、不心疼 credits,合规行为被定价结构鼓励。FIKIRTIVE credits 引擎可直接采用这条边界原则。
2. **Brand/Product/Persona 从 URL 一键 ingest**(2026.05 release)— 贴网址自动建品牌档案,把最重的 onboarding 作业变成 30 秒。对 SMB "开箱即用"是杀手锏:贴 IG/官网 → Otto 自动生成 brand kit 草稿 → 老板确认即可。
3. **属性级创意归因 → Ad Refresh 闭环** — 生成时给每个素材打属性标签(CTA/offer/logo/语气),投放后表现数据按属性回流,系统告诉你"带真人+限时 offer 的图 CTR 高 40%",再一键组装下一条([Ad Refresh](https://business.adobe.com/products/genstudio/performance-marketing/ad-refresh.html))。这是"创作区↔分析区↔Campaign 管理区"三楼联动的完美 Otto 技能形状,而且轻量版(LLM 打 tag + join insights)对 FIKIRTIVE 成本可控。
4. **Brand Intelligence:审批行为 = 训练信号** — 每一次拒稿、批注、改写都被吃进品牌理解层,guidelines 从死文档变活的([Summit 2026](https://news.adobe.com/news/2026/04/adobe-introduces-brand-intelligence))。FIKIRTIVE 已有 Brand-memory 计划;这里的启发是数据来源:不用额外让老板"维护品牌手册",Otto 从老板的日常批改里学。

*(第 5 个半个:双席位 Power/Collaborator 定价 — 创作者贵、审批者便宜,天然适配 agency 楼层"agency 操作 + 客户只审批"的结构;是否引入多席位概念是定价决策,仅列为候选。)*

---

### 主要来源
- 官方:[GS4PM 产品页](https://business.adobe.com/products/genstudio/performance-marketing.html) · [Release Notes 2024.10–2026.06](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/release-notes) · [Concepts](https://experienceleague.adobe.com/en/docs/genstudio-for-performance-marketing/user-guide/intro/concepts) · [法务 Product Description](https://helpx.adobe.com/legal/product-descriptions/adobe-genstudio-for-performance-marketing---product-description.html) · [GA 新闻稿 2024.10](https://news.adobe.com/news/2024/10/101424-genstudio-for-performance-marketing) · [MAX 2025](https://news.adobe.com/news/2025/10/adobe-max-2025-genstudio) · [Summit 2026 Brand Intelligence](https://news.adobe.com/news/2026/04/adobe-introduces-brand-intelligence) · [内容供应链扩展 2025.03](https://news.adobe.com/news/2025/03/adobe-expands-genstudio-content-supply-chain) · [Ad Refresh](https://business.adobe.com/products/genstudio/performance-marketing/ad-refresh.html) · [Workfront 26.Q2](https://experienceleague.adobe.com/en/docs/workfront/using/product-announcements/product-releases/release-26-q2/26-q2-release-overview)
- 第三方:[G2 评价](https://www.g2.com/products/adobe-genstudio-for-performance-marketing/reviews) · [Capterra](https://www.capterra.com/p/10022340/GenStudio/) · [DWAO 定价综述](https://dwao.in/blog/adobe-genstudio-pricing) · [Perficient 上手评测](https://blogs.perficient.com/2025/05/13/adobe-genstudio-for-performance-marketing-for-beginners/) · [TELUS Digital agent 综述](https://www.telusdigital.com/insights/digital-experience/article/how-adobe-ai-agents-are-evolving-customer-experience) · [costbench Firefly 定价(未核实)](https://costbench.com/software/ai-image-generators/adobe-firefly/)

**未核实标注汇总**:Pinterest/Reddit/Trade Desk 投放细节(仅 Adobe blog 一处提及);Firefly 消费者档位具体价格(第三方转述互有出入);GS4PM 实际合同金额(无公开数字);Brand Intelligence / Agency System of Record 是否单独收费(Adobe 未披露)。