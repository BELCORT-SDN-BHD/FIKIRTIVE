> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。Grok 是 canvas 的原始灵感来源(founder 2026-07-03 正式加入对标)。

# Grok Imagine(xAI)竞品研究报告(Benchmark for FIKIRTIVE)

研究日期:2026-07-03。x.ai / grok.com 官方页面反爬(403),官方数字尽量以 docs.x.ai(可抓)与多家可靠二手报道交叉验证;冲突处标注 未核实。**内部基线**:founder 2026-06 屏幕录像的分析已沉淀在 `docs/superpowers/specs/2026-06-27-otto-feature-decisions.md`(45 项 WHAT/HOW pass)与 `2026-06-24-fikirtive-product-concept.md` —— 本报告重点是"现在的 Grok"与"六月之后的变化"。

**公司背景速览**:xAI 于 2026-05-06 并入 SpaceX(SpaceXAI 事业部,Grok + X + Colossus 同一实体)。当前对话模型 Grok 4.3(1M context),Grok 4.5(1.5T 参数 V9 底座)2026-06-28 起在 SpaceX/Tesla 内部私测。Grok Imagine 团队风格:3 个月上线、每日迭代、"故意少宣传功能"(reference-video conditioning、带全历史的 extend 都存在但不营销)。([clickup 时间线](https://clickup.com/learn/topic/ai/tools/grok/news/)、[basenor](https://www.basenor.com/blogs/news/5-grok-updates-you-should-know-about-right-now)、[Latent Space 访谈 xAI Imagine 成员 Ethan He](https://www.latent.space/p/video-agents))

---

## 1. 产品定位一句话 + 定价模型

**一句话**:Grok Imagine 是 xAI 的消费级图像+视频生成产品,2026 年的核心动作是把它从"逐条 prompt 出图"升级成 **Imagine Agent Mode——无限画布上的自主创意 agent**(计划→批量生成→挑选→图生视频→拼接→导出,全程节点可视),用订阅档位(而非按次计费)收钱。

**他们怎么收钱(重要)**:纯订阅 + 档位配额,**没有 credit 商店**;API 才按量计费。

| 档位 | 月付 | Imagine 相关权益 |
|---|---|---|
| Free | $0 | **Imagine 生成已基本关闭**(2026-03-19 起全面付费墙;仅剩 Grok chat 内 ~10 张图/天,无视频)([alloypress](https://alloypress.com/news/grok-imagine-is-dead-for-free-users);另有来源称仍有少量额度,冲突,未核实) |
| X Premium | $8 | 图像为主,低配额;日视频上限 ~50(Musk 口径,未核实) |
| SuperGrok Lite | $10(2026-03-25 上线) | 480p、6 秒短片、基础额度;**无 Agent Mode** |
| SuperGrok | $30 | 720p、10–15 秒、~100–200 高质量生成/天;**Agent Mode 完整访问**;custom templates |
| X Premium+ | $40 | 720p + X 平台权益;日视频 ~100(未核实) |
| SuperGrok Heavy | $300 | 最高配额(日视频 ~500)、优先算力、实验功能优先 |

来源:[felloai pricing](https://felloai.com/grok-pricing/)、[costbench](https://costbench.com/software/ai-chatbots/grok/)、[jingrey limits guide](https://jingrey.com/ai-tech/grok-usage-limits-guide/)。**消费端配额官方从不公布**,以上均为二手拼图,精确数字 未核实;有付费用户抱怨实际可用量远低于标称([aiveed](https://aiveed.io/blog/supergrok-30-month-still-worth-it-2026))。

**API(Imagine API,console.x.ai,官方数字)**([docs.x.ai models](https://docs.x.ai/developers/models)):
- `grok-imagine-image` $0.02/张 · `grok-imagine-image-quality` $0.05/张(1K/2K 双分辨率)
- `grok-imagine-video` $0.05/秒 · `grok-imagine-video-1.5` $0.08/秒(480p 档更便宜,~$0.01/秒,未核实)
- 视频含音频约 **$4.20/分钟**——约为 Veo 3.1($12/分钟)的 1/3、Sora 2 Pro($30/分钟)的 1/7([openrouter](https://openrouter.ai/x-ai/grok-imagine-video)、[digitalapplied](https://www.digitalapplied.com/blog/grok-imagine-video-1-5-ai-video-marketing-2026-guide))
- 开发者数据共享计划送最高 $175/月 API credits;SDK 兼容 OpenAI/Anthropic 接口

**收钱机制的精髓**:先免费养成依赖 → 2026-03 一刀切付费墙 → $10 Lite 当漏斗 → **Agent Mode 锁在 $30 档当升档钩子** → Heavy $300 收重度用户。生成本身不按次计费(和我们的 credit 计量是两种世界观)。

---

## 2. 功能总清单(标注:六月已分析 vs 新增/变化)

图例:🟢 = 六月录像已分析(在 45 项清单里) · 🆕 = 六月中之后新增/明确 · 🔄 = 有实质变化

### 2a. Imagine Agent Mode(无限画布 agent)——我们 canvas 的原始灵感

- 🟢 **无限画布代替 chat**:一句 brief → agent 画出节点树 "plan → generate variants → select best → image-to-video → stitch → export",顺序执行,全程可视。(2026-05-01 Musk 宣布,web 端灰度;beta 于 04-30 被 testingcatalog 提前发现)([codersera](https://codersera.com/blog/grok-imagine-agent-mode-launch-2026/)、[testingcatalog](https://www.testingcatalog.com/xai-debuts-imagine-agent-in-grok-with-open-canvas-ai-workspace/))
- 🟢 **节点级交互**:点任意节点 reprompt 单步、**branch 出 A/B 分支**、中途塞新参考图,不用整条 pipeline 重跑。
- 🟢 **四个预置 workflow 模板**(agent 入口,不是素材模板):**Create Worlds**(风格锚定的世界观资产组)、**Short Film**(一分钟多场景叙事,自动拼接)、**UGC Product Stories**(产品主图→网红风带货短片)、**Brand Identity**(brief→logo/色板/包装/营销物料)。每个模板生成 6–12 张 storyboard 面板再拼成片。([beginnersinai](https://beginnersinai.org/grok-imagine-agent-mode-explained/)、[aivideobootcamp](https://aivideobootcamp.com/blog/grok-imagine-complete-guide-2026/))
- 🟢 **agent 能力**:批量出图、画布内自然语言改图(原图旁边出改后版)、图生 6 秒视频、多 clip 自动拼接(转场+节奏)、导出成品;**风格贯穿**——"改第 1 幕的调色,agent 把整条片的 look 带过去"。
- 🟢 底层:Aurora(自回归 MoE,逐 patch 生成,非 diffusion);编辑/拼接混用传统工具(FFmpeg 等)。
- 限制(现状):单 clip 6 秒、720p 天花板(拼接不解锁 1080p);长片角色一致性会漂;**web-only**(iOS/Android 无 Agent Mode);上线时画布内无原生音频(Video 1.5 后是否打通,未核实)。
- 🆕 **Projects + 并行多 agent + library search**(2026-06 中,随 Video 1.5 一起推):作品自动归入左侧栏 **Projects**;同一项目可**并行开多个 agent**(不用等上一条生成完);**自然语言搜索自己的生成库**。([techtimes](https://www.techtimes.com/articles/318635/20260618/grok-imagine-video-15-goes-live-xai-tops-ai-video-leaderboard-86-percent-below-sora.htm))——注意:这三件与我们清单 #6/#11/#31 完全重合,我们 06-27 已拍 要,Grok 随后正式上线 = **方向被验证**。

### 2b. 模型层(六月最大变化)

- 🔄 **Grok Imagine 1.5**(图像,Aurora 系):05-30 preview 亮相,06-03 上 API,Musk 06-17 正式宣布;Artificial Analysis 图像榜 #1(Elo 1404,当时)。([x.ai 官宣页](https://x.ai/news/grok-imagine-1-5)(反爬)、[basenor updates](https://www.basenor.com/blogs/news/grok-imagines-biggest-updates-video-quality-mode-more))
- 🆕 **Grok Imagine Video 1.5**(2026-06-16 GA,六月最重磅):
  - **音频/语音与视频同一 pass 生成**(架构级变化,不是后期贴)——音效、环境声、对白都对得上动作,语音更清晰同步;
  - clip 上限 **15 秒**(1.0 是 10 秒);720p;
  - **Video 1.5 Fast**(消费端默认):6 秒 720p 约 25 秒出片(旧模型 40+ 秒,快 ~40%);
  - Image-to-Video Arena **Elo 1473(+52),i2v 榜第一**,压过 Seedance 2.0、Kling 2.6、Veo(720p 口径);
  - API 定价 $0.08/秒(≈$4.20/分钟含音频,比 Sora 2 Pro 便宜 86%)。([techjacksolutions](https://techjacksolutions.com/ai-brief/ai-video-news-grok-imagine-video-15-launches-25-second-gener/)、[techtimes](https://www.techtimes.com/articles/318635/20260618/grok-imagine-video-15-goes-live-xai-tops-ai-video-leaderboard-86-percent-below-sora.htm)、[buildfastwithai](https://www.buildfastwithai.com/blogs/grok-imagine-video-1-5-review-2026))
- 🔄 **Quality Mode / Speed Mode 双模式**(2026-05,具体日期两说:05-06 vs 05-22,未核实):Quality = 更锐利质感、更准的光、文字渲染大幅提升;Speed = 便宜快。API 侧对应 `image` vs `image-quality` 两个 SKU。
- 🟢 生成模式:Normal / Fun / Custom(精调光线/氛围/机位参数)/ Spicy(成人,年龄验证,仅 iOS/Android,Premium+/SuperGrok 档)。
- 未营销但存在(Ethan He 访谈证实):**reference-video conditioning**(类 cameo 的参考视频条件生成)、**带全部历史上下文的 video extension**。

### 2c. 单资产编辑器(per-asset editor)

- 🟢 图像:多图合成(最多 3 张源图)、风格迁移、自然语言改图(换背景/换装/加物体)、crop、**13 种图像宽高比**、1K/2K 分辨率。
- 🟢 视频:**Extend**(每次 +2~10 秒,可迭代到 **30 秒上限**;03-02 上线 Extend from Frame,04-21 增强——能读原 prompt/原 clip,续片音频连贯)、7 种视频宽高比、480p/720p。
- 🟢 原生同步音频(无后期步骤)。
- **没有的**:原生 upscale 到 1080p+(承诺"soon",至今 720p 天花板,用户靠 Topaz 外挂 4K)、ControlNet 式姿态/深度控制、消费端 seed 复现、正式的角色一致性系统(靠 reference 硬扛)。([aivideobootcamp](https://aivideobootcamp.com/blog/grok-imagine-complete-guide-2026/)、[topazlabs](https://www.topazlabs.com/tools/grok-imagine-upscaler))

### 2d. 模板 / 库 / 分发

- 🔄 **Custom templates(用户自建+可分享)**(2026-04-21):上传一张图做成可复用模板(photo-to-photo / photo-to-style / edit-to-video),**可分享给其他用户**;SuperGrok web 独占;视频模板限 6 秒。([piunikaweb](https://piunikaweb.com/2026/04/21/new-grok-update-custom-templates-smarter-video-extensions/))——我们 #29/#30 只拍了官方模板库,"用户自建可分享模板"没拍板。
- 🟢 风格化预置模板(Chibi 等,2026-03 起)。
- 🆕 library search(见 2a)+ Projects 归档。
- 🟢 **Post to X**:移动端长按 share sheet 直接发 X,**prompt→发布全程 90–180 秒、零下载步骤**;桌面端多数地区没有此按钮;**没有原生排期**(用 X Premium scheduler 会丢 attribution 和 C2PA 元数据)。
- Discover/公共 feed:本轮未见官方文档化(六月录像里有;现状 未核实)。

### 2e. Agent 周边(Imagine 之外,但同属 Grok 生态)

- 🟢🔄 **Tasks(定时任务)**:cron 式定时跑 prompt(每日/每周/每月/自定义),结果推 app 内或 email;free 档 2 条/天,付费最多 ~10 条周/月任务。🆕 **正在把 Tasks 升级成 Automations**:每条 routine 可**选 skill、选模型**(testingcatalog 从代码痕迹发现,未正式发布)。([grok.com/tasks](https://grok.com/tasks)、[testingcatalog automations](https://www.testingcatalog.com/xai-is-working-on-automations-feature-for-grok/))
- 🆕 **Connectors**:7 个原生 connector(Gmail/GCal、Drive、OneDrive、Outlook、Teams、SharePoint、**Salesforce 读写**)+ catalog 第三方 OAuth + **自带 MCP server**(要求公网可达);Business/Enterprise 由管理员开通。([docs.x.ai connectors](https://docs.x.ai/grok/connectors))
- 🆕 **X hosted MCP server**(2026-06-30):任何 agent(Grok、Cursor、Claude…)零配置拿 X 实时数据。([basenor](https://www.basenor.com/blogs/news/x-launches-hosted-mcp-grok-and-ai-agents-get-real-time-data))
- 🆕 **HeyGen HyperFrames connector**(06 中):Grok 回答一键转成品视频。
- 🟢(我们拍了 不要)**Grok Build**(终端/IDE coding agent,即六月录像里的 Build 模块):05-29 公测(grok-build-0.1,256K ctx),06-22 加 `/goal` 长任务自主模式,正在测 **Parallel Agents(最多 8 个并行)+ Arena Mode(多 agent 同题对比)**;原生 MCP。([releasebot](https://releasebot.io/updates/xai)、[testingcatalog arena](https://www.testingcatalog.com/xai-tests-parralel-agents-and-arena-mode-for-grok-build/))——产品本身与我们无关,但它的 agent UX 模式(见 §6)值得看。

---

## 3. SMB 视角(马来西亚/SEA 中小商家用得上吗)

**能打动 SMB 的**:
- **便宜且快**:$30/月吃到饱(配额内),视频成本约市面 1/3–1/7;一句话 brief → UGC Product Stories 模板直接出"网红带货风"短片——这就是 SEA SMB 想要的东西。
- **零学习成本**:无剪辑技能要求;agent 把分镜/生成/拼接全包。
- 移动端 prompt→发布 <3 分钟(但只能发 X)。

**对 SEA SMB 的硬伤(FIKIRTIVE 的空间)**:
1. **分发错位**:只有 Post to X;SEA SMB 活在 **Meta/IG/TikTok/WhatsApp/Shopee**,Grok 一个都不接,也没有排期(scheduler)。
2. **没有品牌记忆**:无 brand kit、无跨 session 品牌一致性(角色一致性还会漂);每次都要重新喂。
3. **没有营销闭环**:纯素材生产,不碰 ads 投放、不看 ROAS、不管 CRM/回复——它是"创意车间",不是"营销 OS"。
4. **定价对 SEA 不友好**:纯 USD,$30/月 ≈ RM130+ 才有 Agent Mode;免费档已死,试用门槛高。
5. **团队/agency 能力弱**:消费级单人产品;Business/Enterprise 只到 connector 管理层面。
6. 720p 天花板、6 秒基础 clip(拼接有剪切感)、内容审核对真人/IP 严格、Spicy 模式对品牌客户是形象风险。
7. 配额不透明 + 实际可用量缩水的口碑问题(Trustpilot 式抱怨在发酵,[aiveed](https://aiveed.io/blog/supergrok-30-month-still-worth-it-2026))。

**一句话**:Grok Imagine 把"生成"做到了又快又便宜又好,但**从生成到生意之间的所有环节(品牌、渠道、投放、回款)都是空的** ——那正是 FIKIRTIVE 的地盘。同时警惕:它的 API 便宜到可以成为**我们的上游供应商候选**($4.20/分钟含音频,i2v 榜第一)。

---

## 4. FIKIRTIVE 候选映射(⚠️ 仅候选,founder 拍板)

我们已经采纳了它的主骨架(canvas/agent 双栏、image/video 节点、模板、per-asset 编辑器、tasks——45 项清单里 41 项 要)。下面聚焦"**他们有、我们还没拍板的**":

| # | Grok 有的 | 我们的现状 | 候选问题(WHAT 层) |
|---|---|---|---|
| C1 | **节点级 reprompt + branch A/B**(点任意步骤单独重跑、分叉对比,不重跑整条) | 我们 canvas 有节点,#25 variant stack 是资产级;"分叉整段 pipeline" 未拍板 | 要不要把 branch/A-B 做成 canvas 一等公民? |
| C2 | **多 clip 自动拼接成片**(转场、节奏、调色贯穿全片) | #43 批量 auto-video = 批量生成 N 条,**不含拼接成一条长片**;#20 extend 是单 clip 加长 | 要不要"agent 拼长片"能力?(叙事广告/短剧向) |
| C3 | **Workflow 级模板**(UGC Product Stories、Brand Identity = 整条 agent pipeline 一键跑) | #29/#30 是素材模板;#8 quick-start brief 是表单 | 要不要把 goal tiles 升级成"完整 pipeline 模板"? |
| C4 | **用户自建 + 可分享模板** | 未拍板(#29 是官方模板库) | 要不要 UGC 模板/社区分享?(SMB 场景价值存疑) |
| C5 | **Speed/Quality 双模式**(同功能两档质量/价格) | #44 = 固定 1 图 + 1 视频模型,无用户选择 | 要不要在不开模型选择器的前提下给"快/精"两档?(天然映射 credits) |
| C6 | **同 pass 原生音频+对白**(Video 1.5 架构能力) | #23 video sound 拍了 复用(现有 fal/BytePlus 能力) | 供应商层问题:BytePlus Seedance 音频路线 vs Grok Imagine API 作候选 provider |
| C7 | **reference-video conditioning**(参考视频控制生成,类 cameo) | #12 reference 一致性 = 图像参考 | 以后:要不要视频级 reference? |
| C8 | **Automations:每条定时任务可选 skill + 模型** | #38 tasks 拍了 要(重建),但没定"per-routine 配置"设计 | Tasks 设计时是否吸收"routine = prompt + skill + 档位"模型?(我们还要叠 spend gate) |
| C9 | **library 自然语言搜索** | #31 拍了搜索(Full/Compact) | 只是确认:语义搜索 vs 关键词,HOW 层再定 |
| C10 | **自带 MCP / connector catalog**(开放接第三方) | G6 = 定向连 Meta/TikTok/Lazada/Shopee | 大概率 不要(SMB 不自带 MCP),记录在案即可 |
| C11 | **移动端 share-sheet 秒发**(prompt→发布 <3 分钟、零下载) | #36 publish slot 拍了 要(Meta/IG 向) | 把"零下载、三分钟"当我们 publish 的体验基线? |

**已被验证的决定**(Grok 六月中正式上线、与我们 06-27 清单撞车):Projects 侧栏(#11)、并行多 agent(#6)、library search(#31)——我们不是在抄冷门,是押中了他们的 roadmap。

---

## 5. 他们的 agent 打法 vs Otto

**Grok Imagine Agent 的世界观**(Ethan He,[Latent Space](https://www.latent.space/p/video-agents)):
- **"视频模型的智能来自 LLM,不来自视频数据"** → agent = LLM 做计划/改写 prompt/自我批评,diffusion 只是它调用的一个工具(还有 FFmpeg、图像编辑器);prompt 改写阶段的推理时间常超过像素生成。
- 循环:plan → generate → critique → iterate;"一分钟视频"这种单模型做不了的任务靠多轮编排完成。
- 下一步:2026 内 video agent 到"可投广告"的生产级;远期赌 generative UI 和 world model。
- 打法:3 个月上线、天天迭代、功能故意少宣传、拿速度+成本打(不打 feature parity)。

**逐项对比**:

| 维度 | Grok Imagine Agent | Otto(FIKIRTIVE) |
|---|---|---|
| 定位 | 创意域单点 agent(生成→成片) | 跨域 super-employee(brief→素材→投放→分析→回复) |
| 界面 | agent 住在画布里,计划=可视节点树 | canvas 是 home,Otto 是对话操作员 + 画布产出 |
| 钱 | 订阅吃到饱(档位配额),**没有单次 spend gate** | credit 计量,**spend gate 是一等公民**(每次花钱先批) |
| 自主度 | brief 后全自主跑完 pipeline,节点可中途干预 | 花钱/不可逆动作必须人批;多步自主 spend 明确未开 |
| 记忆 | 无持久品牌记忆(session 内风格贯穿而已) | Brand Brain / memory 是核心件(#42 要加强) |
| 数据/连接 | connector + MCP 通用件,X 实时数据 | 定向 Meta/TikTok/Lazada/Shopee + ads 分析(G6) |
| 定时 | Tasks→Automations(prompt+skill+模型) | #38 tasks 要,叠 spend gate 才能跑 |
| 模型 | 全自研垂直栈(Aurora/Video 1.5,自建存储) | 编排外部 provider(fal/BytePlus…),供应商可换 |

**要点洞察**:
1. 他们的 agent 和我们的 Otto 在"编排哲学"上是同一派(LLM 计划 + 工具调用 + 迭代),差别在**商业模式决定架构**:他们订阅制所以敢全自主;我们按次花真钱,所以 gate 架构反而是护城河(agency/客户场景必须有审批)。
2. 他们把"agent 的计划"画成节点树给用户看——这是**信任设计**,和我们 plan card/OttoTrace 是同一问题的两种解;他们的解更适合创意迭代(可点、可分叉),我们的解更适合花钱审批(一总价、一确认)。
3. 他们自研模型自建存储(5PB 级,egress 比存储贵)是资本打法;我们做编排层,模型市场打架(Grok vs Seedance vs Veo)对我们是**降价红利**。

---

## 6. 值得偷的设计

1. **计划即节点树**:agent 接到 brief 先把 plan/generate/select/stitch/export 画在画布上再执行——用户没花一分钱之前就看到"它准备干什么"。天然适配我们的 spend gate:**节点树 + 总价 = 更强的 plan card**。
2. **节点级重跑,永不整条重来**:点单个节点 reprompt、branch A/B、中途塞参考图。对花真钱的产品更重要(重跑 = 再花钱,粒度越细省越多)。
3. **Workflow 模板当 agent 入口**:UGC Product Stories(产品图→带货短片)这个模板本身就是为 SMB 写的,我们的 goal tiles 可以直接升维成"一键整条 pipeline"。
4. **风格贯穿指令**:"改第 1 幕调色,整条片跟着变"——把一致性做成 agent 的默认行为而不是用户的手工活。
5. **Speed/Quality 双 SKU**:同一功能两个价位(API 侧 $0.02 vs $0.05/张),完美映射 credit 计量:默认快省、precious 场景升 Quality。
6. **发布零摩擦基线**:移动端 prompt→已发布 <3 分钟、无下载步骤。我们 #36 publish(Meta/IG)应以此为体验标尺。
7. **Projects 自动归档 + 并行 agent + library 语义搜索**:已在我们清单(#11/#6/#31),他们的落地形态(左侧栏 Projects、"不等上一条"的并行)可作 HOW 参考。
8. **Automations = prompt + skill + 模型 per routine**:比裸 cron 好的抽象,#38 设计时直接吸收(再叠我们的预算上限/gate)。
9. **Agent 锁中档当升档钩子**:Agent Mode 只给 $30+,$10 Lite 当漏斗——印证"agent 是最强付费理由",对我们的订阅分层(credit 之上的 Otto 订阅)是定价弹药。
10. **反面教材也偷**:配额不透明 → 付费用户信任流失;我们的 credit 余额/成本透明(#39 显示层)反而是卖点,继续做实。

---

## 附:六月内部分析 → 现在的 delta 一览

| 变化 | 日期 | 对我们的含义 |
|---|---|---|
| **Video 1.5**:同 pass 音频+对白、15 秒、快 40%、i2v 榜第一、$4.20/分钟 | 06-16 | 供应商格局变了;视频"含对白"成为消费级预期 |
| **Projects / 并行多 agent / library search** 正式上线 | 06 中 | 与我们 #11/#6/#31 撞车 = 方向验证 |
| Imagine 1.5(图像,Aurora 系)preview→API | 05-30→06-17 | 图像质量线还在抬升 |
| **Tasks → Automations**(per-routine skill+模型)开发中 | 06(未发布) | #38 设计参考 |
| X hosted MCP + HeyGen connector + connector catalog | 06-30 / 06 中 | 他们在铺 agent-to-data 管道(通用件路线) |
| Grok Build:`/goal` 自主模式、8 并行 agent、Arena Mode 测试 | 06-22 起 | 我们拍了 不要 Build,但 UX 模式可参考 |
| 免费档 Imagine 付费墙(03-19)+ Lite $10(03-25)+ custom 模板(04-21)+ Quality Mode(05)+ Agent Mode(05-01) | 六月录像前 | 录像里应已可见,但当时未逐项记录定价/日期,本报告补齐 |
| Grok 4.5 私测(1.5T 参数);xAI 并入 SpaceX | 06-28 / 05-06 | 背景:算力和资本压强还在加 |
