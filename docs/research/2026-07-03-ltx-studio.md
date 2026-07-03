> **性质**:对标研究(地质报告层,可演进)。FIKIRTIVE 候选映射仅为 founder WHAT-pass 的候选项,不是决定。研究日期 2026-07-03。

# LTX Studio (Lightricks) 竞品研究报告

> 调研日期 2026-07-02/03。官网已从 ltx.studio 迁移到 **ltx.io**(301 跳转)。主要来源:官方定价页 https://ltx.io/studio/pricing 、产品主页 https://ltx.io/studio 、各 feature 页(下文逐条引用)、官方博客 https://ltx.io/blog/top-ltx-studio-features 、第三方评测 https://vijaytalksai.com/ltx-studio-review/ 。页面带 Cyber Monday/Black Friday 促销残留,原价与促销价并存,以原价为准。

---

## 1. 产品定位一句话 + 定价模型

**一句话定位**:Lightricks 旗下的"AI 影视制作全流程套件"——从剧本 → 分镜 → 逐镜头生成 → 时间线剪辑 → 成片/pitch deck 导出,一个浏览器里做完,主打电影人、广告代理、品牌内部工作室("The AI platform for video production. A creative suite for filmmakers, advertisers, & creative teams" — https://ltx.io/studio )。自家开源模型 LTX-2 / LTX-2.3 + 聚合第三方模型(Veo/Kling/Seedance/FLUX/Nano Banana)。

**他们怎么收钱(核心)** — 订阅 + 月度 credits(用量)双层,加三道价值闸:

| 计费机制 | 细节 |
|---|---|
| **订阅档** | Free $0(一次性 800 credits)/ Lite $15/月(8,000 credits)/ Standard $35/月(28,000 credits)/ Pro $125/月(110,000 credits)/ Enterprise 定制。年付 8 折(https://ltx.io/studio/pricing) |
| **Credits = 用量货币** | 原名 "computing seconds"(计算秒),2025-26 改名 credits("同一个余额,换个更直观的名字" — 官方 FAQ)。视频按输出秒计费,模型越贵、分辨率越高扣越多;余额在 app 顶部实时显示 |
| **闸 1:商用授权** | Free/Lite 仅 **Personal use license**(不可用于任何商业/营销/收酬内容);**Commercial use license 从 Standard($35)起** —— 商用授权本身是付费墙 |
| **闸 2:模型分层** | LTX-2.3、Z-Image 全档可用;Nano Banana 2/Pro、FLUX.2 Pro、Veo 2、Kling 2.6/3.0 Pro、Seedance 2.0、ChatGPT Images 2.0 从 Standard 起;**Veo 3.1 系列只在 Pro($125)** —— 第三方旗舰模型当 upsell 杠杆 |
| **闸 3:功能分层** | AI Storyboards、Pitch Decks、Elements 保存、买额外 credits:Standard 起;3 协作者/项目、按需 top-up:Pro;Brand Kit、组织管理、SSO、custom model training:Enterprise |
| **退款** | 付款 14 天内、用量 ≤1,200 credits 可退(官方 FAQ) |
| **另有 LTX API** | 模型 API 单独计价(https://ltx.io/model/api/pricing ),与 Studio 订阅分开 |

具体"每模型每秒扣几 credits"官方未公开数值表(第三方评测也确认拿不到,https://vijaytalksai.com/ltx-studio-pricing-explained/ )——**未核实**,只知 Veo/Kling 类扣得远比 LTX-2.3 快。

---

## 2. 功能总清单(按子领域)

### 2a. 项目与入口(Projects / 起点)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Projects + Sessions** | 每个创意一个工作区,内含互通的 Gen Space / Storyboard / Timeline / Pitch Deck;Gen Space 里生成按 Session 分组管理(https://ltx.io/blog/top-ltx-studio-features) | 全档 |
| **四种起点** | From Script(上传 .txt 剧本)/ With a Concept(一句话概念)/ From an Image / From a Video(https://ltx.io/studio) | 全档 |
| **多语言剧本** | 任何语言剧本可上传,但结果会被翻成英文(script-to-video FAQ) | 全档 |

### 2b. Script → Storyboard(剧本拆解 + 分镜)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **AI Storyboard Generator**(2025 重构版,自称快 5 倍) | 剧本自动拆成 **scenes → shots 两级结构**,生成逐镜头画面;生成前先给你看完整 shot breakdown(每场几个 shot、对应剧本文字)(https://ltx.io/studio/platform/ai-storyboard-generator) | **AI 生成版 Standard 起**;Blank Storyboards(手动空白板)Free 就有 |
| **Element 自动抽取** | 剧本里的人物/物件/场景自动抽成可复用 Elements,先审后生成 | Standard 起 |
| **帧级三层控制** | project / board / frame 三个层级分别可调;每帧可用 prompt、**手绘 sketch**、或上传图片来定制 | 同上 |
| **模型/画幅前置选择** | 生成前选 FLUX 或 Nano Banana 出图模型 + 统一 aspect ratio | Standard 起 |
| **动态预览 + 导出** | 分镜可加 motion 变 animatics(动态分镜),导出 MP4;一键导出 PDF pitch deck | 同上 |
| **数量上限** | scenes/frames 有硬上限,达到时应用内警告(官方 FAQ,具体数字未公布) | — |

### 2c. Shot Editor(逐镜头编辑)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Shot Video Editor** | 每个 shot 控制 shot type / camera angle / framing / style / duration(https://ltx.io/studio/platform/shot-video-editor) | 全档(高级控制随档位) |
| **Camera Motion Presets** | dolly / crane / pan / tilt / handheld / static 一键套用,可再叠 prompt 微调(官方博客) | 全档 |
| **Keyframes + Advanced camera controls** | 关键帧定义运动路径(zoom/pan/tilt/rotate);第三方评测提到 3D orbit、tracking、往画布上 sketch 物体(https://dupple.com/tools/ltx-studio ,细节**未核实**) | Free 就列 "Advanced camera controls" |
| **Retake** ⭐ | 选中一段 **2–16 秒**的视频区间,只重生成这一段(改台词/情绪/动作),模型强参考前后帧保持衔接——不用整镜重出(官方博客) | 全档(未明示,**未核实**) |
| **场景微调** | 光线、天气、动作等 scene-level 调整;AI 建议辅助 | — |

### 2d. Elements(角色/一致性)= 他们的招牌
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Elements(四类)** | Character / Location / Object / Other(logo、材质、光效),**@ 符号在 prompt 里 tag 引用**,全项目一致;改一次全项目传播(官方博客) | 保存/自建 Elements **Standard 起**;自动抽取的项目内可用 |
| **AI Character Generator** | 文字建人设(外形/服装/性格),编辑即时同步到所有场景;入景时自动匹配光影(https://ltx.io/studio/platform/character-generator) | 全档 |
| **Face Switch** | 生成角色后上传真人照片替换脸——真人像植入 | 同上 |
| **Face Motion Capture + Lip Sync** | 面部表演捕捉 + AI 对白自动对口型 | 同上 |
| **角色配音位** | Character Element 可绑定voice,跨场景对白声音一致 | — |

### 2e. Style / Set(风格与美术)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Style presets** | cinematic / sketch / cartoon / branded looks 等预设风格,一键统一全项目视觉(https://ltx.io/studio) | 全档 |
| **Reference 引导** | 上传参考图定全项目 aesthetic(pitch deck FAQ:上传品牌参考图自动套用) | 全档 |
| **Location Elements** | 场景当资产存,复用保持环境一致 | Standard 起(保存) |

### 2f. 生成引擎(Gen Space)
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Text-to-Image / Text-to-Video / Image-to-Video / Video-to-Video Control** | 独立生成工作区,支持文字+图混合引导 | Free 起(基础) |
| **Audio-to-Video** ⭐ | 上传音频(MP3/WAV/AAC/OGG/MOV/M4A),生成节奏/口型/运镜跟着音频走的视频;音频锁定后可换机位重出画面(官方博客) | Free 就列 |
| **模型舱** | 自家 LTX-2.3 Fast/Pro(开源模型 LTX-2 的托管版)+ Veo 2/3.1(Fast/Lite)+ Kling 2.6/3.0 Pro + Seedance 2.0 + FLUX.2 Pro + Nano Banana 2/Pro + Z-Image + ChatGPT Images 2.0 + Topaz(放大) | 见第 1 节模型分层 |
| **Upscale(图+视频)+ SDR→HDR** | 放大与 HDR 增强 | Upscale Lite 起;HDR Free 列 |
| **B-roll 生成 / 背景与物体移除** | 按场景描述生成 B-roll;AI 去背景/去物体(https://ltx.io/studio/platform/ai-video-editor) | — |

### 2g. Voice / Dialogue / Audio
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Text-to-speech 配音** | 按风格定制的 TTS voiceover,直接进时间线,帧级音画同步 | — |
| **AI 配乐 / 音效** | 音乐同步、sound effects、加音乐(https://ltx.io/studio/platform/add-audio-to-video) | — |
| **AI Dubbing(175+ 语言)** ⭐ | 克隆原 speaker 声音译成 175+ 语言 + 自然对口型(UGC/Ad Editor,https://ltx.io/studio/platform/ad-editor) | 对照表中 Dubbing 为高档功能(**具体档位未核实**) |
| **AI Voice Editor(rescript)** | 打字改台词,保持同一声音+口型——"创作者念错 CTA / 价格变了"不用重拍 | 同上 |
| 与 **ElevenLabs** 有官方合作案例(https://ltx.io/studio 案例区) | — | — |

### 2h. Timeline / 成片 / 导出
| Feature | 做什么 | 价位档 |
|---|---|---|
| **AI Timeline Editor** | 时间线剪辑:trim、transitions、变速、倒放、翻转;AI auto-edit 粗剪;表情/口型/转场微调(https://ltx.io/studio/platform/ai-video-editor) | "Editing tools" Lite 起;"Editing space" 高档(对照表) |
| **不能导入自己素材剪辑** | 只能剪平台生成的内容;图片/剧本可当参考导入(官方 FAQ)——重要局限 | — |
| **导出** | MP4、**XML(NLE 交接,即 "Editing packages")**、PDF pitch deck、ZIP 全资产包 | XML/编辑包高档;无水印 Lite 起 |
| **Captions / 字幕** | 加字幕(TikTok 编辑器场景) | 对照表高档(**未核实**) |
| **平台重构编辑器** | UGC & Ad Editor(一条素材→多版本广告)、TikTok / Instagram / YouTube Video Editor、智能 resize(AI 延伸背景适配任意画幅) | Book a Demo 导向,偏企业档(**未核实**) |

### 2i. 自动化(Flows)⭐ 2025-26 新王牌
- **Flows, node-based automation**:节点画布(prompt 节点→出图→出视频→放大),连线成 pipeline,**一键批量跑**;prompt 节点支持 @ 引用 Brand Kit 元素;**smart caching:没变的节点直接复用上次结果,只重跑输入变了的节点**(https://ltx.io/blog/ltx-studio-flows ; https://x.com/LTXStudio/status/2052429654942973953)。Free 有基础版,Standard 起 "advanced"。

### 2j. 协作 / Pitch / 组织
| Feature | 做什么 | 价位档 |
|---|---|---|
| **Project collaboration** | 分享项目、他人查看或共同编辑,分镜实时同步 | 基础分享全档(**未核实**);**3 collaborators/project = Pro**;无限协作者 = Enterprise |
| **Pitch Deck Generator** | 从项目一键生成 PDF 提案:synopsis、角色档案、色板、mood board、场景视觉(https://ltx.io/studio/platform/pitch-deck-generator) | **Standard 起** |
| **Brand Kit** | 企业级:集中管理品牌 Elements(角色/物件/logo/字体/风格/色彩),Creative Admin 管控,更新即全组织传播,多子品牌各自 Kit(https://ltx.io/blog/introducing-brand-kit-in-ltx-studio) | Enterprise |
| **Organization Management** | 组织级 credit 分配与用量报表、SSO、集中计费(ACH/wire)、SOC2/ISO/GDPR、增强数据隐私(输入输出不训练模型)、custom LTX-2.3 model training、multi-language video versioning、AI creative strategists 人工服务、专属 AM 培训、SLA | Enterprise |

### 2k. 平台边界
- 纯 web、**desktop only,无手机版**(官方 FAQ);footer 出现 "LTX Desktop" 产品(**是什么未核实**)。
- 剧本只收 .txt。
- G2 4.4/5;**Trustpilot 1.5/5**(88% 一星,集中在扣费/退款/导出失败投诉,https://vijaytalksai.com/ltx-studio-review/)。

---

## 3. SMB 视角(马来西亚/东南亚中小商家)

**真会用的:**
- **Storyboard → 首帧确认 → 再花钱出视频** 的漏斗本身——先看便宜的图、认可了才烧贵的视频秒数,天然省钱,SMB 直觉能懂。
- **UGC & Ad Editor 三件套**:改台词不重拍(价格改了/念错 CTA)、一条素材智能 resize 到全平台画幅、**dubbing 175+ 语言**——对 BM/华语/淡米尔/英语混市场是真痛点。
- **Camera presets + style presets**:老板不会说"dolly in",点一下就有,零 cinematography 门槛。
- **Retake 局部重拍**:只烧坏掉那 2-16 秒的 credits。
- **Pitch deck 一键 PDF**:本地小 agency 拿去过客户审批极实用。
- **Audio-to-Video**:已有语音广告/podcast 的商家直接变视频。

**企业级虚胖(SMB 用不上,标注):**
- Brand Kit 组织管控、SSO、SOC2/ISO、org-wide credit 分配报表、custom model training、AI creative strategists、multi-language versioning、无限协作者——全是 Enterprise 销售话术层。
- 电影级两层 scene/shot 分镜、XML 交接 NLE、animatics——面向 filmmaker/TV network,SMB 拍 15 秒 Raya 促销用不到。

**SMB 痛点(他们的软肋):**
- **商用授权藏在 $35/月 Standard**:$15 Lite 对商家是陷阱(personal only)——SMB 真实入场价 ≈ RM165/月,还没算 credits 烧得快。
- Credits 黑箱:官方不公布每模型每秒扣多少,失败重试照扣;Trustpilot 1.5 星的扣费/退款投诉就是 SMB 信任杀手。
- **做完视频就断头**:不发布、不排期、不投放、不看效果——SMB 还得自己搬去 Meta/TikTok。

---

## 4. FIKIRTIVE 候选映射(仅候选,创始人拍板)

| LTX 功能簇 | 候选去处 | 权衡 |
|---|---|---|
| Script→scene→shot 自动拆解(含 .txt 上传入口) | **已有对应楼(部分)**:分镜卡 F1-F3 + Otto 刨根问底 | 我们靠对话取需求,他们靠剧本文件;差在"已有完整脚本的用户"没有导入快路。加"贴稿子直接出分镜"= Otto 一个 skill 的事 |
| Elements @tag 一致性(角色/物件/场景/其他) | **已有对应楼(部分)**:资产区 + 分镜卡 entityIds(@引用实体) | 我们已有 @ 实体与参考图;LTX 多在**自动抽取**(brief→自动铸实体)与 Location/Object/Other 类型细分。候选:Otto 起分镜时自动把新角色/产品沉淀进资产区 |
| 每镜头结构化控制(shot type/camera angle/motion presets) | **创作区 / 分镜卡增强** | F v1 是自由文本 prompt(seedream/seedance skill 拼);LTX 给结构化下拉/预设。候选:分镜卡每镜头加 preset 字段,喂给 seedancePrompt。代价:UI 复杂度 vs 现在"Otto 替你写 prompt"的简洁 |
| Retake(2-16 秒段落重生成) | **创作区(G 之后)/ 存疑** | 对应我们"单帧重出"的视频版。省钱心智极好,但依赖模型支持段内重绘(BytePlus/Seedance 是否支持**未核实**) |
| Style/reference 项目级统一 | **资产区(品牌记忆)** | 我们的品牌记忆已朝这方向;LTX 的"一张参考图定全项目风格"是轻量做法 |
| Voice/TTS/lip-sync/角色配音 | **创作区 / 存疑** | 视频带对白是广告刚需,但成本与供应商(ElevenLabs 类)是新钱路,需单独议 |
| Dubbing 175+ 语言 + rescript 改台词 | **创作区(SEA 杀手锏候选)** | 马来西亚多语市场契合度极高;同上,新供应商新钱路 |
| Timeline/final cut NLE + XML 导出 | **建议不要(v1)/ 存疑** | 重投入的剪辑器;我们的成片=直接投放素材,不走 NLE 交接。若做,只需"多 clip 顺序拼接导出" |
| Pitch deck PDF 一键导出 | **Agency 楼层** | 分镜卡已有全部素材(标题/goal/镜头/首帧图),渲染成 PDF 成本低、agency 收费场景强 |
| Flows 节点自动化 | **建议不要(作为 UI)** | 他们用节点画布解决"重复批量"——**Otto 就是我们的 Flows**;让用户拖节点违背"tools + super-employee"论。但其 **smart caching(只重跑变了的节点)** 思想值得进 Otto 的批量重出逻辑 |
| UGC resize(AI 延背景适配画幅) | **创作区 / 排期区之间** | 一素材多平台画幅是排期发布的真实前置;fal/BytePlus 有无对应能力**未核实** |
| 协作(3 席/项目) | **Agency 楼层** | 我们 org 模型已有多人;差的是"项目级邀请外部客户看分镜"——agency 审批场景 |
| 模型分层 + 商用授权闸 + credits 顶部实时余额 | **定价机制参考(非楼)** | 见第 6 节 |

**LTX 有、我们分镜卡 F1-F3 缺的(逐条,给 F4/G 之后的 backlog):**
1. **scene→shot 两级层级**(F 是扁平 shots 列表);
2. **剧本文件导入**入口;
3. **每镜头结构化 camera/shot-type/motion 预设**(我们纯 prompt 文本);
4. **手绘 sketch / 上传图片定帧**(我们只有 @实体参考图);
5. **项目级 style preset 一键统一**;
6. **动态分镜(animatics)预览 + MP4 导出**;
7. **PDF pitch deck 导出**;
8. **分镜协作/分享给客户审**;
9. **角色配音/对白位**(镜头带 dialogue 字段);
10. **画幅(aspect ratio)前置统一设置**(我们分镜卡有没有**未核实**——若无,G 之前该有);
11. 帧数上限的**应用内预警 UX**(我们有 zod caps,但报错不等于预警)。
   反向:我们有而他们没有的——**先问清楚再铺卡(刨根问底)**、**双 prompt(首帧+视频)显式可编辑**、**聚合审批+幂等钱路**、以及做完直接进排期/投放。

---

## 5. 他们的 AI/agent 打法 vs Otto-operates-100%

**LTX 的打法 = "AI 辅助的工具箱 + 用户编排"**:
- AI 用在**生成与拆解**(剧本自动分镜、Element 自动抽取、auto-edit、AI 建议),但**没有 agent**——没有一个对话实体替你从 brief 跑到成片。
- 他们对"自动化"的答案是 **Flows 节点画布**:用户自己搭 pipeline、自己批量跑。这是 ComfyUI 式的 pro-user 思路,门槛留给了用户。
- Enterprise 档卖 "**AI creative strategists**" ——本质上他们的"super-employee"是**卖人头服务**,不是产品。
- 流程终点是**导出**(MP4/XML/PDF):不发布、不排期、不投放、不复盘。

**FIKIRTIVE 的差异化空间:**
1. **Otto 就是 Flows**:LTX 让用户学节点连线,我们让 Otto 听一句话就把同样的 pipeline 跑掉——且每个环节仍是可手动操作的真实工具(宪法原则)。"你要 10 个版本?Otto 帮你跑" vs "请自己搭 canvas"。
2. **闭环到分发**:LTX 断在导出,我们分镜→生成→排期→发布→分析→CRM 一条街。SMB 要的是"广告上线有生意",不是 MP4 文件。
3. **钱透明 vs credits 黑箱**:他们不公布每次生成扣多少、失败照扣、Trustpilot 1.5 星;我们已有 per-card 定价 + 聚合审批 + 幂等去重("生成全部首帧 N·X credits"先看清再花)。这是可以正面打的信任差。
4. **对话式需求萃取**:LTX 假设你已有剧本/概念;Otto 刨根问底把"做个广告"变成合格 brief——SMB 恰恰没有剧本。

---

## 6. 值得偷的设计(2-5 个)

1. **Retake 局部重生成(2-16 秒段)** —— "只修坏的那一段"同时省钱、省时、保连贯,和我们"改文字→清该帧图→单帧重出"同一哲学,视频版可进 G 之后的 backlog(https://ltx.io/blog/top-ltx-studio-features)。
2. **Element 自动抽取 + @tag**——从 brief/剧本自动铸角色/产品/场景为可复用资产,用户只做确认。我们已有 @实体,缺"Otto 自动沉淀进资产区"这半步;对品牌记忆楼是天然肥料。
3. **Flows 的 smart caching**——批量 pipeline 里"输入没变的节点直接复用上次结果"。Otto 批量重出/重跑分镜时同样该做:只重生成被编辑过的镜头(我们 F3 清 `firstFrameGenerationId` 已是这个思想,值得升格为通则)。
4. **一键 PDF pitch deck**——分镜卡数据一渲染就是客户审批文件,对 Agency 楼层是低成本高感知的收费点(https://ltx.io/studio/platform/pitch-deck-generator)。
5. **三闸定价术**(商用授权档 + 模型分层 + 功能分层)——把"商用权利"和"旗舰模型"本身做成 upsell,而不是只按用量收钱;对我们"video 近成本卖、靠 OTTO 赚 margin"的既定策略是现成参照(定价永不硬编码,只作机制参考)。同时引以为戒:credits 黑箱 + 扣费投诉是他们 Trustpilot 1.5 星的直接来源——**余额实时可见 + 花钱前明码审批**要当成产品卖点保住。
