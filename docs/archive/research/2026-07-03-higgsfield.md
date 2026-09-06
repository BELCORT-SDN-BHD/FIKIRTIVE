> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# Higgsfield AI 竞品研究报告(Benchmark for FIKIRTIVE 创作区)

研究日期:2026-07-03。来源以官方页面为主(higgsfield.ai),第三方评测为辅;所有不确定项已标注 未核实。

**公司背景速览**:创始人 Alex Mashrabov(前 Snap 生成式 AI 负责人,其前创业公司 AI Factory 以 $166M 卖给 Snap),联创 Yerzat Dulat、Mahi de Silva。2026-01 估值 $1.3B(Series A 累计 ~$130M+),2025 底 ARR $200M → 2026-06 ARR $500M,传闻正以 $5B 估值募 $300–500M。自称 15M+ 用户、12,000 企业客户、390 家 Fortune 500 在用。([TechCrunch](https://techcrunch.com/2026/01/15/ai-video-startup-higgsfield-founded-by-ex-snap-exec-lands-1-3b-valuation/)、[TechTimes](https://www.techtimes.com/articles/319394/20260630/ai-video-startup-higgsfield-hits-500m-revenue-eyes-5b-funding-round.htm)、[TheNextWeb](https://thenextweb.com/news/higgsfield-supercomputer-enterprise-marketing-nvidia))

---

## 1. 产品定位一句话 + 定价模型

**一句话**:Higgsfield 是一个"聚合所有前沿图像/视频模型 + 自家审美层(Soul、Cinema Studio、运镜预设)+ 营销成品工厂(Marketing Studio/UGC Factory)+ 创意 agent(Supercomputer)"的 AI 创意平台——本质是把'拍片'变成订阅制 SaaS,再往上长出一个会自己干活的创意员工。

**他们怎么收钱(重要)**:订阅费 + 信用点(credits)双层,再叠 add-on:

| 档位 | 月付 / 年付折合 | Credits/月 | 关键差异 |
|---|---|---|---|
| Free | $0 | ~10/天 | 有水印、模型受限 |
| Basic(未核实,一来源提到) | $5(年付) | 70 | — |
| Starter | $15 | 200 | 只开放部分模型(**无 Veo 3 系**) |
| Plus | $49 / 年付 $39 | 1,000 | 全模型解锁 |
| Ultra | $129 / 年付 $99 | 3,000(可扩到 9,000) | 全模型 + 365 天"unlimited pass" |
| Business/Team | $89/席 / 年付 $62/席 | 1,500/席共享池 | 2–15 席 |
| Enterprise | 定制 | 定制 | 专属算力、SOC 2 |

来源:[官方 pricing](https://higgsfield.ai/pricing)(页面 JS 渲染,数字取自 [vo3ai 拆解](https://www.vo3ai.com/higgsfield-ai-pricing)与 [yangsweb 评测](https://www.yangsweb.com/blog/higgsfield-ai-review-alternatives-pricing),两者略有出入,精确数字需以官方页为准,标注 部分未核实)。

**收钱机制的精髓**:
- **Credits 当月清零、不滚存**;补充包 ~$5/100 credits、90 天过期(未核实)。制造持续续费压力。
- **"Unlimited" 是钩子不是主菜**:① *Seedance Unlimited* = 30 天 add-on,无限生成 **Enhanced Seedance 2.0 Fast**(走普通队列、480/720p、8/15 秒,官方 BytePlus 合作;可随时切回 credit 模式走优先队列)([官方博客](https://higgsfield.ai/blog/seedance-unlimited));② Ultra 年付送 365 天 unlimited pass,但**只能选一个模型**且多为图像/旧模型(Nano Banana 2 / Wan 2.6 / Seedance 1.5 Pro / Kling 2.6)。第三方批评:8 个"unlimited"模型里 6 个是图像模型([yangsweb](https://www.yangsweb.com/blog/higgsfield-ai-review-alternatives-pricing))。
- **Agent 也烧 credits**:Supercomputer 里连文字请求都按 prompt 复杂度和所选 LLM 扣 credits;每次生成前**先展示预估 credit 成本、用户批准才执行**。
- **重要限制**:Unlimited 模型和免费生成**只在 higgsfield.ai 网页端有效,MCP/CLI/Canvas/Supercomputer 上不可用**([geo.higgsfield.ai](https://geo.higgsfield.ai/higgsfield-ai-pricing-and-plans-2026))。
- 真实成本(第三方实测,含 3–5 次迭代废片):Kling 3.0 每条可用视频 $0.61–1.03;Veo 3.1/Sora 2 $3.36–9.33。Trustpilot 3.2/5(1,200+ 评论)。

---

## 2. 功能总清单

### 2a. Supercomputer(创始人点名的"超级计算机")——务必消歧

**它不是 GPU 集群,是 Higgsfield 的创意 agent 产品**(chat 界面的"创意员工"),名字纯营销。([官方 supercomputer-intro](https://higgsfield.ai/supercomputer-intro))

它实际做什么:
- **自然语言 brief → 成品**:"给我的球鞋做个 TikTok" → agent 自己拆计划、选模型选预设、报价(credits)、等你批准、生成、交付到 Projects。
- **AI Employees(预置专职 agent)**:Cartoon Animator(24 skills)、Motion Designer(43 skills)、Podcast Producer(4 skills)、Product Photographer(24 skills)。
- **Skills**:可安装、可复用、可跨团队分享的 workflow,slash command 触发(/montage、/cinematic);**可从 Claude / Claude Code / Codex / ChatGPT 导入 skills 和 memory**。
- **Connectors**:Slack、Drive、Notion、Gmail、Figma 等 30+。
- **Memory**:跨 session 记住项目上下文("再来一张像第三张那样的")。
- **Scheduled Tasks**:每日广告变体、每周竞品分析、每月内容日历。
- **LLM 可选/自动路由**:Claude Opus 4.7/4.6、Sonnet 4.6、GPT-5.5 Pro、Gemini 3.1 Pro;orchestrator 自动挑"更便宜更快"的模型。
- **Supercomputer 2.0(企业版)**:基于 NVIDIA Agent Toolkit + Nemotron,编排 35+ 模型、20+ 生产 pipeline(TV 广告、产品 reels、Amazon listing、AI 播客),含 policy guardrails、权限管控、合规审计(roadmap);定位为"从创意到发布到优化的完整营销生命周期"。案例:14 天、<$50 万做出 95 分钟 AI 电影《Hell Grind》。([TheNextWeb](https://thenextweb.com/news/higgsfield-supercomputer-enterprise-marketing-nvidia))
- 价位:走同一套订阅 credits(Starter 起即可用,未核实是否全档开放)。

### 2b. 视频生成(模型聚合 + 运镜层)

- **模型库(16+)**:Seedance 2.0(首个原生音视频一体:lip-sync/SFX/音乐同步)、Kling 3.0(4K 写实)、Kling o1(推理型复杂分镜)、Kling 2.6/2.5 Turbo/2.1、Veo 3.1(4K 电影感)、Wan 2.7/2.6(速度-画质平衡、v2v restyle)、Sora 2(注意:OpenAI 已宣布 Sora 2026-04 关停网页端、2026-09 API 退役)、MiniMax Hailuo 02。([官方 ai-video](https://higgsfield.ai/ai-video))
- **生成模式**:Text-to-Video、Image-to-Video、Video-to-Video(风格/物体替换)、Draw-to-Video、First/Last Frame(首尾帧锁定)、Motion Control(上传参考视频控制节奏动作)、Character Locking(跨镜头角色一致)。
- **Camera Controls(招牌差异化)**:65 个一键运镜预设,含 Bullet Time、Crash Zoom In/Out、Dolly Zoom、FPV Drone、Snorricam、Crane Up/Down、Robo Arm、360 Orbit、Whip Pan、Hyperlapse、Timelapse 系列等,可叠加最多 3 轴运动。([官方 camera-controls](https://higgsfield.ai/camera-controls))
- **Cinema Studio(专业电影套件,已迭代到 3.x)**:选机身(RED/Sony/IMAX/ARRI/Panavision)、球面/变形镜头、焦距、光圈/景深/bokeh、传感器尺寸,16-bit 级画面、21:9 画幅,Photography/Videography 双模式。([官方](https://higgsfield.ai/cinematic-video-generator))
- 价位:Starter 只有部分模型;Plus 起全模型;Seedance Unlimited 为付费 add-on。

### 2c. Soul(自研图像模型)+ 角色一致性

- **Soul 2.0**:自研"高审美"图像基础模型,主打时尚感、文化梗理解(懂网络俚语/潮流语汇),text-to-image + image reference 双模式。([官方 soul-intro](https://higgsfield.ai/soul-intro))
- **20+ 审美 presets**:Editorial Street Style、Old Smartphone、Y2K Studio、Frutiger Aero、Subtle Flash、Siren 等——免 prompt 工程,一键出"有品味"的图。
- **Soul ID(角色一致性)**:上传 ≥20 张本人/角色照片,~3 分钟训练出数字分身,跨风格/姿势/光线锁定同一张脸;训练后不限量生成。这是他们 UGC/带货人设的地基。
- **Soul Inpaint**:在保持 Soul 审美的前提下改/加/换图中任意元素。
- **其他图像模型聚合**:Nano Banana Pro(draw-to-edit、最多 8 张参考图、原生 4K)、GPT Image 2、Seedream 4.5、FLUX、Reve、Kling O1。([官方 ai-image](https://higgsfield.ai/ai-image))

### 2d. UGC / 广告工厂(对 SMB 最要害的一块)

- **Marketing Studio**(上线 30 天 68,000 用户):一个 prompt 出营销成片。流程:①贴产品 URL(自动抓名称/描述/图)或传 ≤5 张图 → ②选 40+ 预置 AI avatar 或用 Soul 2.0 文字定制 → ③选模式 → ④出片免后期。**10 种模式**:UGC(手机感对镜头口播)、Tutorial、Product Review、Unboxing、UGC Virtual Try-On、TV Spot(广播级)、Hyper Motion(纯 CGI 产品英雄镜头)、Pro Virtual Try-On(街拍编辑风)、Wild Card(AI 全权导演)、Ad Reference(**上传竞品/参考广告,AI 拆解结构后套到你的产品上**)。含 Hook templates(前 3 秒开场模板)、分镜可视化、一个 prompt 混多格式。引擎为 Seedance 2.0。([官方 marketing-studio-intro](https://higgsfield.ai/marketing-studio-intro))
- **UGC Factory**:40+ 现成模板(自带运镜+场景设定),生成 4 个关键帧 + 全音频同步 + 背景 + 角色表演。([官方博客](https://higgsfield.ai/blog/Higgsfield-UGC-Factory-Explained))
- **Lipsync Studio**:聚合 6 个对嘴模型(Speak v2、lipsync-2、InfiniteTalk、Kling AI Avatar、Kling Lipsync、Veo 3),脚本/音频 → 会说话的 avatar 成片,可用自己的 Soul ID 当主播。([官方](https://higgsfield.ai/lipsync-studio))

### 2e. Apps(一键模板小工具,官网列 41 个/8 类;有来源称 85+,未核实总数)

([官方 apps](https://higgsfield.ai/apps))
- **Professional**:Virality Predictor(发布前评估 hook 爆款潜力)、Similarity Score(查 IP 相似度/侵权风险)、Expand Image(扩图)、Angles 2.0(多角度)、Shots(一图出 9 机位)。
- **Enhance & Style**:Skin Enhancer、AI Stylist(虚拟试衣)、Relight(重打光)、Outfit Swap、Style Snap。
- **Face & Identity**:Face Swap、Headshot Generator(职业头像)、Character Swap 2.0、Recast(视频换角色)、Video Face Swap。
- **Video Editing 类 app**:ClipCut、Urban Cuts(卡点穿搭视频)、Video Background Remover、Breakdown、Japanese Show。
- **Ads & Products**:Click to Ad(**商品链接直接变 UGC 广告**)、Billboard Ad、Truck Ad(车身广告)、Bullet Time Scene/White(产品旋转展示)。
- **Games & Characters / Extras / Trending Templates**:Game Dump、Plushies、AI Meme Generator、Skibidi、Mukbang、K-pop Idol 等蹭热梗模板。

### 2f. 编辑工具

- Inpaint / SOUL Inpaint(文字圈选修改)([官方 edit](https://higgsfield.ai/edit))、Expand Image、Relight、Background Remover(图+视频)。
- **Video Upscale**:平台内 720p→4K;经 **Adobe Plugin**(Premiere Pro / After Effects 插件)可上 8K + Draw to Edit(在帧上画草图做 inpaint)。
- **Popcorn**:AI 分镜/故事板工具,角色、镜头、光线全程一致,任意帧可改,可导出继续生成。([官方 popcorn](https://higgsfield.ai/popcorn))
- 已知短板:**没有时间线剪辑器**,成片要出去外部剪([yangsweb](https://www.yangsweb.com/blog/higgsfield-ai-review-alternatives-pricing))。

### 2g. API / Agent 接入面(他们的"被 agent 操作"布局)

- **Higgsfield Cloud API**(cloud.higgsfield.ai):REST + 官方 Python SDK([GitHub](https://github.com/higgsfield-ai/higgsfield-client)),开发者按 key 调用生成。
- **Higgsfield MCP**(2026-04-30 上线,mcp.higgsfield.ai):**一个 hosted MCP 端点暴露 30+ 图像/视频模型**,OAuth 登录、无需 API key,**订阅 credits 直接通用**;官方宣称支持 Claude(web/Cowork/Claude Code)及任何 MCP 客户端;能力含生成 4K 图、15s 视频、Soul 角色训练、视频分析+爆款评分、剪辑工具。([官方 mcp](https://higgsfield.ai/mcp))
- **Higgsfield CLI**(higgsfield.ai/cli):给 coding agent 用的命令行入口。
- 第三方接入:make.com 连接器、各转售 API 平台。
- 限制:unlimited/免费额度不走 MCP/CLI。

---

## 3. SMB 视角(马来西亚/东南亚 SMB 真会用 vs 企业级虚胖)

**真会用(高价值)**:
- **Marketing Studio 的 URL→广告**:Shopee/Lazada/自家网店链接贴进去直接出 UGC 广告——这是 SEA 电商 SMB 的梦中场景。
- **UGC Factory + Lipsync avatar**:没预算请 KOL/拍摄的小商家,用 AI 口播 + 试穿 + 开箱模板量产投放素材。
- **Soul ID**:老板/店员本人训练成数字分身,长期当品牌脸出内容——对靠"人设"卖货的 SEA 市场极对味。
- **Camera Controls 一键运镜**:不懂摄影术语也能出"贵"的画面,拉开与竞品档口的观感差。
- **Trending Templates**(Skibidi/Mukbang 之类):SEA TikTok 文化重度依赖蹭梗,这类一键热梗模板消耗量大。
- **Seedance Unlimited add-on**:量产测素材时不心疼 credits。
- **Virality Predictor / Similarity Score**:发布前预判 + 避免侵权,对小团队是真保险。

**企业级虚胖(SEA SMB 基本用不上,标注)**:
- **Cinema Studio 的 ARRI/IMAX/变形镜头/16-bit** —— 虚胖:电影级 DoP 控制对卖辣椒酱的店家没意义。
- **Supercomputer 2.0(NVIDIA/Nemotron/SOC 2/合规审计)** —— 虚胖:纯 Fortune 500 叙事。
- **95 分钟 AI 电影 pipeline、AI 播客 pipeline** —— 虚胖。
- **多 LLM 手动选择(Opus vs GPT-5.5 Pro)** —— 对 SMB 是噪音,auto 路由才是对的默认。

**SMB 的坑(FIKIRTIVE 可反打)**:credits 月清零 + 迭代废片烧钱(一条可用 Veo 视频实际 $3–9);"unlimited"名不副实的暗模式;**全程 USD 计价、无 BM/中文/东南亚本地化**;Trustpilot 3.2 分、高峰期排队;**生成完不管发布**(消费者版无排期/发布/广告投放闭环——这正是 FIKIRTIVE 的地盘)。

---

## 4. FIKIRTIVE 候选映射(仅候选,创始人定夺;中性列 tradeoff)

| Higgsfield 功能簇 | 候选归属 | Tradeoff 备注 |
|---|---|---|
| 多模型聚合生成(图+视频) | **已有对应楼(创作区)** | FIKIRTIVE 已走 BytePlus Seedream/Seedance;是否学他们"聚合 N 家模型"是成本/复杂度 vs 卖点的取舍——聚合=更强卖点但吃利润和运维 |
| Camera Controls 运镜预设 | **已有对应楼(创作区)** | #85 motion presets 已是同方向;可选项:把预设库从"几个"扩到"几十个+可叠加",差距只是广度 |
| Soul ID 角色一致性(训练品牌人设) | **创作区 + 资产区** | 训练成本和存储归属要想清:人设是"资产"(brand memory 的脸),生成入口在创作区;跨区引用是加分也是耦合 |
| Marketing Studio(URL→整条广告、10 模式、Ad Reference 逆向竞品广告) | **创作区(强候选)** | 对 SEA 电商杀伤力最大的一簇;Ad Reference 模式与 Meta ads library 搜索(已有 MCP 能力)可以连成"看到竞品广告→仿结构出片";但整活量大,需分期 |
| UGC Factory 模板库 / hook 模板 | **创作区** | 模板=运营内容不是代码,符合"file-system 式自管理"哲学(像 skills 一样是可读文件);缺点是要持续养库 |
| Lipsync avatar / 数字人口播 | **创作区(存疑)** | 依赖第三方对嘴模型,成本与授权(真人肖像)风险;SEA 需求真实存在 |
| Apps 热梗模板(Skibidi 等) | **创作区(存疑)** | 消耗型流量功能,养库成本高、生命周期短;若做,SEA 本地梗是差异化 |
| Virality Predictor / Similarity Score | **分析区 或 创作区** | "发布前评分"放创作区顺手,"归因到历史表现"放分析区更深;可先做轻量版(Otto 用 LLM 评 hook) |
| Popcorn 分镜/storyboard | **创作区(存疑)** | 对拍系列内容的用户有价值,但 FIKIRTIVE canvas 的多变体流(#88/#89)已部分覆盖"一图多方案" |
| Inpaint/扩图/重打光/upscale/背景移除 | **创作区** | 补齐编辑工具箱是迟早的事;逐个都是独立可排期的小楼 |
| Scheduled Tasks(每日广告变体/每周竞品分析) | **排期区 + Otto** | 与 Otto scheduled skills 天然同构;他们证明了 SMB 会为"定时自动出素材"付钱 |
| Supercomputer(agent 聊天→计划→报价→批准→执行) | **已有对应楼(Otto 本体)** | 直接验证 FIKIRTIVE 论文;他们的 approve-before-spend = 我们的 ask-before-spend + canvas cost-confirm,已在做 |
| AI Employees(预置专职 agent 打包) | **Otto(存疑)** | 是包装术:同一 agent 换皮+skill 集;FIKIRTIVE 哲学是"一个 Otto"(super-employee),拆成多员工与既定方向相悖——但可作为 skill 分组的展示方式 |
| Connectors(Slack/Notion/Gmail…) | **建议不要(现阶段)** | SMB 主战场在 Meta/TikTok/WhatsApp,不在 Notion;做了是企业虚胖 |
| Cloud API / MCP / CLI 对外开放 | **存疑** | "让别人的 agent 操作 FIKIRTIVE"与"卖 Otto"存在战略张力;先内后外 |
| Business 席位共享 credit 池 | **Agency 楼层** | 直接对上 agency 多客户场景;共享池+席位是成熟计费形态 |
| Adobe 插件 | **建议不要** | 专业剪辑人群不是 FIKIRTIVE 的 ICP |

---

## 5. 他们的 AI/agent 打法 vs Otto-operates-100% 的差异化空间

**他们的打法**:从"创意工具聚合"往上长 agent。Supercomputer = 一个只管**创意生产**的超级员工(brief→计划→报价→批准→生成→交付),搭配 skills/memory/connectors/scheduled tasks——架构上和 Otto 惊人同构(甚至支持从 Claude Code 导入 skills)。企业版 2.0 开始伸向"发布+优化"(完整营销生命周期),说明**他们正从创意端向 FIKIRTIVE 的全 OS 论文收敛**——但那是 NVIDIA 合作的企业级产品,不是给 SMB 的。

**关键结构性差异(= FIKIRTIVE 的空间)**:
1. **覆盖面**:Higgsfield 的 agent 只操作创意 district。消费者版**没有** CRM、没有自动回复、没有广告账户投放、没有排期发布、没有效果分析闭环。Otto-operates-100% 的差异化不在"生成得更好",而在"生成完的下一公里":素材→排期→投放→回复→归因,一个员工跑通。
2. **反馈回路**:他们的 Virality Predictor 是"预测";FIKIRTIVE 有真实 ads/organic 数据,能做"实测归因→反哺下一批素材"的闭环,这是聚合器做不到的。
3. **本地化**:USD 定价、英文文化梗、无 SEA 运营。MYR 计价 + BM/华语 + SEA 电商平台语境是空白区。
4. **警示**:他们同时满足"真工具可手操 + agent 可全操作"——是 FIKIRTIVE constitution 的最强同类证明,也说明这个模式护城河在**district 广度**而非单区深度。在创意单区硬拼他们(15M 用户、$500M ARR、自研模型)不现实;赢法是闭环。

---

## 6. 值得偷的设计(2-5 个)

1. **Approve-before-spend 的 agent 报价单**:Supercomputer 每次执行前列出预估 credits、用户点头才跑,连 LLM 对话都计价。FIKIRTIVE 已有 ask-before-spend + canvas cost-confirm,可以偷的是把它**产品化成统一的"报价卡"UI 模式**(计划 + 分项成本 + 一键批准),而不是散落的 confirm 弹窗。
2. **URL→成片的零输入起步**:贴一条商品链接,自动抓名称/描述/图,直接进广告生产线。把"冷启动 prompt 焦虑"干掉,是 SMB 转化的最短路径;与 FIKIRTIVE 的 brand memory/资产区天然契合(抓一次,永久复用)。
3. **把'品味'预设化**:Soul presets、65 个运镜预设、hook 模板——全是"把专业判断冻结成一键选项"。SMB 不想学 prompt;FIKIRTIVE 的 seedream/seedance prompt skills 已是同思想,可再往前一步做成用户可见的预设库(且预设=可读文件,符合创始人 file-system 管理哲学)。
4. **Ad Reference(逆向竞品广告)**:上传一条跑得好的广告,AI 拆结构套用到你的产品。配合 FIKIRTIVE 已有的 Meta ads library 搜索能力,可以连成"Otto 找到同类目爆款广告→拆解→照打法出你的版本"——比 Higgsfield 更闭环(他们只能手动上传)。
5. **"Unlimited 廉价模型"作留存杠杆(慎用)**:用一个便宜模型(如 Seedance Fast 慢队列)做不限量,昂贵模型走 credits——心理上"随便玩",利润上有护栏。FIKIRTIVE 视频本就近成本价卖,同构玩法可行;但要吸取他们的教训:unlimited 名不副实已招致口碑反噬(Trustpilot 3.2),条款必须诚实。

**主要来源**:[supercomputer-intro](https://higgsfield.ai/supercomputer-intro) · [pricing](https://higgsfield.ai/pricing) · [ai-video](https://higgsfield.ai/ai-video) · [camera-controls](https://higgsfield.ai/camera-controls) · [cinematic-video-generator](https://higgsfield.ai/cinematic-video-generator) · [soul-intro](https://higgsfield.ai/soul-intro) · [marketing-studio-intro](https://higgsfield.ai/marketing-studio-intro) · [ugc-factory](https://higgsfield.ai/ugc-factory) · [lipsync-studio](https://higgsfield.ai/lipsync-studio) · [apps](https://higgsfield.ai/apps) · [popcorn](https://higgsfield.ai/popcorn) · [mcp](https://higgsfield.ai/mcp) · [cli](https://higgsfield.ai/cli) · [seedance-unlimited 博客](https://higgsfield.ai/blog/seedance-unlimited) · [TheNextWeb(Supercomputer 2.0/NVIDIA)](https://thenextweb.com/news/higgsfield-supercomputer-enterprise-marketing-nvidia) · [TechCrunch(融资)](https://techcrunch.com/2026/01/15/ai-video-startup-higgsfield-founded-by-ex-snap-exec-lands-1-3b-valuation/) · [vo3ai 定价拆解](https://www.vo3ai.com/higgsfield-ai-pricing) · [yangsweb 评测](https://www.yangsweb.com/blog/higgsfield-ai-review-alternatives-pricing)