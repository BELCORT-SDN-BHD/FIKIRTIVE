# FIKIRTIVE 总蓝图(城市总体规划)

> **文件性质 —— 先读这个**
> 这是 founder 与总审查员共同起草的**最终版构想(终稿候选)** —— 生效以第七章修订表"批准"列为准;founder 合并 = 定稿。它回答"这座城是什么、往哪长、什么永远不变"。
> **任何 agent 不得修改此文件**("不可改" = 仅可经第七章流程修订;唯一例外:第三章区划图是快照,总审查员可随地质报告更新)。代码与本文件冲突时,以本文件为准,直到 founder 亲口改变主意。
> 修订权:founder 本人,或 founder 明确授权的总审查员 session。修订必须走 PR 且 founder 合并。
>
> **配套文件金字塔**(从"强制力"到"参考",越上层越不可违抗):
>
> | 层 | 文件 | 谁维护 | 性质 |
> |---|---|---|---|
> | 宪法 | `docs/BLUEPRINT.md`(本文件) | founder + 总审查员 | **不可改** |
> | 法律 | `.claude/CLAUDE.md`(合并纪律)+ CI 围栏 + `money-safety-review` skill | 总审查员 | 机器强制(CI)+ 约定强制(合并纪律) |
> | 建筑规范 | `docs/review/REVIEWER-PLAYBOOK.md` | 总审查员 | 审 PR 必查 |
> | 判决记录 | `docs/research/GRILL-VERDICTS-2026-07-03.md`(拍板会 O/G/C 等分卷)+ `DECISION-INVENTORY-2026-07-02.md`(更早决定) | 拍板会追加 | 产品决策档案 |
> | 地质报告 | `docs/review/CODEBASE-MAP-*.md` / `EXPANSION-SEAMS.md` / `LIVE-SURFACE-*.md` | 大变更后可更新 | 深度参考 |
> | 总设计(和声) | `docs/design/2026-07-03-harmony-0*.md` 七件(数据模型/Parity/工厂路线/costing 输入+模型/第二账道/UIUX+gamification) | founder + 总审查员 | 分区 spec 的上位约束 |
> | 施工图 | `docs/superpowers/specs/` + `plans/` | 每个建设 session | 逐楼图纸 |

---

## 一、这座城是什么

**FIKIRTIVE = 一座给中小商家的 agentic marketing OS —— 从东南亚起步,终点是全球的世界级平台。**
滩头阵地 = 马来西亚/东南亚(本地语言、本地支付、本地渠道是先手优势,不是天花板);每一个架构决定都按全球尺度做(多币种/多市场定价/多语言/渠道可插拔从第一天就是骨架,不是补丁)。住户是不懂营销、不懂 AI 的老板 —— 他们雇不起营销团队,所以这座城给他们一个**超级员工:Otto**。

**双模城市 —— 这是卖点的根(founder 2026-07-03 定调)。**
每一栋楼都必须是**真实、完整、人可以亲手操作的工具**:真正的 CRM、真正的 campaign 管理、真正的排期表 —— 功能深度对标 Salesforce / HubSpot,**不依赖 Otto 也完全能用**。
**卖点在上面一层:Otto 能替用户操作这一切的 100%。** 竞品卖工具,FIKIRTIVE 卖"完整的工具 + 一个会用全部工具的超级员工"。两个都是真的:楼是真的楼,员工是真的员工。

**Otto 是差异化,不是遮羞布。** Otto 是"营销界的 Claude Code":有技能注册表、有品牌记忆、有异步工厂、有人工闸门。用户可以只跟 Otto 说话把事做完,也可以随时亲手进任何一栋楼自己操作 —— 两条路通向同一份数据。

**终局形态(城市群全景)**:一个完整营销操作系统 ——
内容创作(图/视频/分镜)→ 投放(Meta/TikTok/Lazada/Shopee)→ 数据分析 → 排期发布 → **CRM + campaign 管理 + 自动回复(客服)** → 资产管理。每一环都人工可操作,每一环 Otto 都能 100% 代劳。今天建成的是创作区和广告区的地基;CRM/campaign 管理/回复/更多平台是已规划的新区(见第六章,功能清单以 Salesforce/HubSpot 全量分析为底稿)。

**只有一扇门。** 曾经的 /simple + /pro 双门设计已废除。Pro/agency 是未来往上加的**楼层**,不是并排的另一栋楼。"双模"不是第二扇门 —— 同一个 app 里,Otto 和人工操作的是同一批楼。

---

## 二、城市宪法(永不协商的原则)

1. **安全 > 效率 > founder 易管理** —— 三优先级,顺序不可倒。"易管理" = file-system 风格:可读文件 + 简单开关,没有埋起来的东西(技能框架就是范本)。
2. **钱路神圣。** money-in 只有 `grantCredits`(Stripe webhook + admin 授予);spend path(genRequest 闸 → startGen → 幂等键 → provider 调用 → reserve/settle)的任何 diff 必过 `money-safety-review`。**开发/验证阶段的每笔真实供应商花费逐笔问 founder —— "问"就是上限,没有代码上限**(产品内用户自助花费走第 3/4 条的审批与计量,不在此列)。**账本推论**:未来任何新花费点必须走同一账本(credits 账道或第 5 条的通道费账道)→ 自动进消费明细,不许旁路。
3. **Otto 运营契约(五条铁律)**:① 计费透明 —— spend 面只显示 credits 永不显示美元;money-in(买包/订阅)显示当地法币(MYR 等) ② 花钱前必审批 ③ 状态诚实(失败自动退款、重试绝不双扣)④ 建议按钮引导下一步 ⑤ One Otto —— 新能力永远 = 新 skill,不是新 app。
4. **审批的数学**:`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`。三字段缺一即取最危险值(fail-closed)。这条公式是城市的电闸,不许出现绕过它的旁路。**两类明示例外**(都是"审批发生在别处",不是没有审批):①turn 计量类花费(Otto LLM/search 等,按轮 reserve→settle,余额即闸);②routine 预授权(审批发生在 routine 创建时,配预算上限/范围声明/kill switch/事后摘要)。
5. **定价永不硬编码,毛利有地板。** **定价规则(2026-07-03 终案)**:每个收费点毛利率(售价−成本)/售价 **≥45%**,目标区 45-50%(不含人工);内容生成市场定位**中下**;**利润主场 = Otto(劳动 margin 2.0x)+ seats**;任何新收费点定价前 costing 先行。credits 与美元锚定(1 credit = $0.10,内部 ×10 记账)。**效率良心条款**(founder:"不让用户花冤枉钱"):margin 赚在倍率上,**永不赚在浪费上** —— 任何让用户多烧 token 的低效(冗余重发/臃肿上下文/多余步数)按缺陷处理,降本工程(prompt caching 等)永远优先于涨价。**结构定调(2026-07-03,G 区拍板)**:席位订阅(创作席+审批席双档)+ credits 用量双轨;功能全开、档位卖规模;credits 滚存上限制(以 costing 为准);**MYR 为主货币 + 分市场差异定价(最大化 margin)**;通道费透明直传且**单独账道收取,永不混入 credits**(credits = 我们的服务;通道费 = 代收过路费,两条独立账道);**永久禁止任何 "unlimited" 类报价**(founder 2026-07-03:"Otto 自动化的时候我们就糟糕了" —— agent 自动化使不限量承诺变成本敞口)。
6. **租户铁幕。** 一切数据 ownerId 隔离;身份永远来自 session(requireOwner),永远不信客户端传的 org/owner。跨租户读一个字节 = 事故。
7. **双模原则 + Otto 全操控(2026-07-03,founder 定为最高设计要求)。** 每个功能区必须满足两条:(a) **人工可完整操作** —— Otto 不在也是一个能打的产品;(b) **Otto 可 100% 操控 FIKIRTIVE 能操控的一切**。**(a) 无例外**(判例:总审查员曾提议"报表引擎由 Otto 替代",被 founder 否决 —— "Otto 是在建设很棒的基建上的自动化操作员",人工面就是卖 seats 的根)。**租户 org 内部同样要阶级制度**(用户侧 RBAC:创作席/审批席 + org 内角色,与团队协作/审批流同件设计)。保证机制是结构性的,不靠自觉:
   - **单一动作层**:UI 按钮和 Otto skill 调用**同一个** server action,禁止两套业务实现(`generate`→`startGen`←canvas 按钮 = 范本);
   - **Parity Manifest**:action ↔ skill 对照表 + 明示豁免,CI 扫描 —— 新 action 没登记就合并不进去;
   - **读的对等**:每个人工可见的数据面都有对应 free/read skill(Otto 不做瞎子操作员);
   - **上下文桥**:当前视图/选中项注入每轮对话,"把这个改成 9:16"里的"这个"必须可解析;
   - **就地按钮 = Otto 的手(O-12)**:界面内的 AI 小按钮不是第二个匿名 AI —— 同一大脑、同一记忆、coral 身份,走同一动作层;
   - **builder 分域(O-09)**:创作域保留可视画布(Grok 式);规则/自动化域不做节点画布,由 Otto 写"人看得懂、改得动"的规则文件(人工面 = 规则文件编辑器 + 开关);
   - **豁免写死(四类)**:市政厅(admin)永久豁免;纯视觉微操;账户安全操作(人亲自来);**money-in —— 充值/购买 credits,Otto 永不代办**(founder 2026-07-03 例示的"真危险类");
   - **审批经济学不变**:全操控 ≠ 全自动,花钱与外部写照旧过闸。
8. **明确不盖的楼**(拍板过,别再提案):Build 终端 coding agent、独立通用 Chat、Spicy/18+ NSFW、**开放第三方 skill 生态**(skill 永久 BELCORT 内部编写)、**对外 MCP/API 让外部 agent 操作 FIKIRTIVE**(founder:"如果会用其他 LLM,代表我们的 Otto harness 不够好,就代表 FIKIRTIVE 不好。" —— 操作这座城的 agent 永远只有 Otto)、**白标**(founder 2026-07-03:"我要的就是 FIKIRTIVE 变成世界级别的平台" —— 平台不贴别人的牌,Otto 永不改名换脸)、**任何 unlimited 类报价**(与 Otto 自动化互斥,成本敞口)、**Slack/Notion 类工作工具 connectors**(O-13 拍板:SEA SMB 主场在 WhatsApp/Meta/TikTok/Shopee,不在欧美知识工作者工具)。
9. **语言约定**:spec/skill 文档用华语(founder 复审);生成 prompt 一律英文;UI 文案 sentence case。
10. **技能为弱模型设计(2026-07-03 入宪)。** Otto 运行时永远是 cost-efficient 档模型(sonnet 级),不是 Fable/Opus。因此一切 skill 的专业判断必须**冻进确定性代码/schema/模板**(prompt-skills 是范本),质量来自结构不来自模型天赋;换更强模型是加分,不是前提。
11. **UIUX 是第二支柱(2026-07-03 入宪)。** 除"Otto 全操控"外,UIUX 是留住与吸引用户的核心卖点。质感标杆 = **Apple**;交互趣味参考 Duolingo 但克制 —— 面向专业用户只做 **minimal gamification**(GM 卷已拍 2026-07-03:**GM-02 里程碑/GM-03 目标进度/GM-04 周报语气/GM-05 开店完成度 = 要;GM-01 streak = 不要**;三条边界与方案见 `docs/design/2026-07-03-harmony-06-uiux-gamification.md`)。落地机制:单一设计系统(.gb)不许分叉;每个用户可感的面必须过设计审(不只 runtime QA);设计基准 = Analytics 屏(已有 gold standard)。

---

## 三、区划图(现状快照 —— 本章豁免"不可改",总审查员随地质报告更新)

> 快照:2026-07-03,基线 main ≈ #117。注:本章 F 指分镜的第 1-4 步,与审计编号 F01-F44 无关。

图例:✅ 通电运营 · 🌙 建成断电(等钥匙:重连/App Review/env)· 🔧 建成没挂门牌(功能全好,导航不可达)· 🚧 空地立了牌子 · 📋 图纸阶段

### 中央区 —— Otto 本体 ✅
20 个注册技能(1 个花钱技能 `generate`,唯一)。刨根问底资讯门、seedream/seedance prompt 精通(唯一 prompt 权威)、**分镜卡全链已闭环**(第 1-3 步 $0 + 第 4 步首帧付费 #111 + make-all 闸② #114)、品牌记忆、web research、视觉参考。模型 = sonnet 主力 + 同级 failover;每轮 reserve→settle 计费。
**待建**:分镜连贯模式;Otto 深化三件(O-04 品牌记忆自养/O-07 绩效周报/O-10 效果反哺闭环,判决均为"要")。

### 创作区 —— Canvas 工作台 ✅
无限画布、4 变体图 + 成本确认、i2v/t2v 视频、多参考图调理(#92)、整段参考视频(#97)、抽帧、付费卡防误删警告、失败态卡片。**这是用户的家(canvas-as-home)。**

### 资产区 ✅ + 🔧
My Stuff(统一版,#103)✅、**Brand memory v2**(6-tab 知识库 + living collections + 产品档案与分类,#103/#113)✅;**Library 🔧、Templates(4 个一键付费模板)🔧、Discover(灵感库)🔧 —— 三栋楼全建好了但没挂导航门牌**(已知缺口,等 founder 排优先级)。

### 广告区 —— Meta 🌙(等钥匙)
读(insights/列表)✅ 已通电;**写**(暂停/预算/ad-write v1)和**建**(整 campaign PAUSED 草稿,build=$0)已建成断电 —— 等 ads_management/pages_show_list 重连 + App Review。TikTok/Lazada/Shopee 是同一条渠道缝上的规划新楼。

### 排期区 🚧 + 分析区 ✅(Phase A)
排期仍是空地(Buffer 式 3 视图,卡 instagram_content_publish App Review)。**分析区已通电**:Phase A 真实 ad-account KPI + reach 图 + OTTO insight(#116)+ 平台切换器(Meta live,TikTok/Shopee/Google/WhatsApp 占位,#117);剩余范围 = organic + history 全量。

### 住户服务中心 —— Account/Connections ✅
Account/Settings 页(#74):资料、credits + 消费记录、充值包购买、渠道连接管理(Meta 连接/重连/自治开关/kill-switch)、OTTO 行为设置。

### 市政厅 —— 运营与账房 ✅
Admin 11 个 section 全活(模型开关/成本/授信/内容审/会话审/租户管理/冒充/审计日志);Stripe MYR 充值包 LIVE;100 免费 credits/新 org;冒充态禁写(F15 安全默认)。

### 地下管网 ✅
pg-boss 五条队列 + 三类回收器(gen/refgen/LLM 预扣)、ingest 哈希复验(D19)、render/caption 管线、R2 内容寻址存储、CI(check/web-build/test 三 job,#105)+ 合并纪律。2026-07-02 全库审计 44 条全闭环。

---

## 四、交通系统(九条扩建缝 —— 新楼必须接管网,禁止私拉电线)

任何新功能都必须走这九条缝之一;绕缝直连 = 审查一票否决。缝 1-8 的**完整施工配方**在 `docs/review/EXPANSION-SEAMS.md`;第九缝配方在 `docs/design/2026-07-03-harmony-02-parity-manifest.md`(EXPANSION-SEAMS 有指针;CI 拦截为 warn→hard 两阶段,在建)。

| # | 缝 | 一句话 | 加什么走这条 |
|---|---|---|---|
| 1 | **defineOttoSkill** | Otto 的一切新能力 = 一个新 skill 文件(3 字段 + 注册五步) | 任何 agent 新能力 |
| 2 | **GenerationProvider** | 模型三表联动 + provider 映射,pre-charge/charged 错误边界 | 新生成模型/新供应商 |
| 3 | **Credit ledger** | reserve→settle/refund + 幂等键 + partial-unique 索引 | 任何新的收钱点 |
| 4 | **Channel foundation** | OAuth + 加密 token + Organization.settings(Meta 是范本) | TikTok/Lazada/Shopee/任何平台 |
| 5 | **Tenant model** | requireOwner + ownerId 全链路 + TENANT_MODELS 守卫 | 任何新数据模型 |
| 6 | **Queue/worker** | core 定义策略 → 两端 createQueue → handler + 回收器时间链 | 任何异步/长任务 |
| 7 | **.gb + shadcn** | 单一设计系统;coral 只属于 Otto | 任何新界面 |
| 8 | **ChatMessage 卡片五道缝** | kind 联合→占位→双渲染器→注入过滤→流桥名单,五处齐动 | 任何新卡片类型 |
| 9 | **Parity Manifest** | 每个新 action 出生即配 skill 或明示豁免,CI 拦截(宪法第 7 条的机器围栏) | 任何新 server action / 页面数据读取 |

---

## 五、扩建守则(未来盖任何一栋楼的标准流程)

1. **图纸先行**:spec(华语)→ founder 过目 → plan(可带模型指派:Fable 做架构、Opus 做执行)。
2. **施工纪律**:TDD(RED→GREEN)、小批提交、走对应的缝、不越图纸改邻居的楼。
3. **验收三关**:CI 全绿(底线)→ 总审查员按 playbook 区域清单终审 → UI 改动附浏览器 runtime QA 证据。
4. **碰钱加一关**:money-safety-review 逐项过 + founder 逐笔批真实花费验证。
5. **入册**:合并后大变更由总审查员更新地质报告层(本文件不动)。
6. **谁都不许**:直推 main、自批自己的 PR、绕过任何一条缝、在 skill 里 import 花钱包。

---

## 六、还没盖的区(终局路线,方向已定、图纸未画)

**建设节奏(2026-07-03 定调):不走 funding,直接市场变现、利益最大化 —— Content creation 相关楼最先上线赚钱**,其余新区按收入贡献排队。
**GTM 王牌(founder 2026-07-03):dev 团队用 FIKIRTIVE 来 market FIKIRTIVE 并大获成功** —— dogfood 即营销,成功案例本身就是最响的广告(也是最狠的 QA)。
**落地顺序 = 和声图 P1→P4**(见 `docs/design/2026-07-03-harmony-01-data-model.md` §六):P1 创作变现先锋(工厂三件套,**按 harmony-03 三波路线 + 升级票纪律**)→ P1½ 排期+Routine → P2 消息进场(WhatsApp+第二账道)→ P3 CRM+Campaign → P4 深化。**叙事节奏**:首发故事 = "SEA 的创作超级员工"(先赚钱);**投放闭环是第二章**(创作→广告一人跑通);"一个员工 + 100% 覆盖"是贯穿的结构承诺。
**定价落地**:档位数字以定价终案(判决记录·定价终案节)为准,全部落 config 层、永不硬编码;costing 模型输入已全部闭合(harmony-04)。**P1 必做护栏:BytePlus 资源包余量告警**(包烧完静默跳裸价,10s 档毛利 45%→13%)。

按 founder 的城市群构想,以下新区**方向锁定**,动工前必须各自出 spec 走第五章流程。
**新区的功能清单不凭空发明** —— 以 Salesforce + HubSpot 全量 feature 分析为底稿(`docs/research/`,2026-07-03 起),founder 逐项 WHAT-pass(要/不要/以后)拍板后才画施工图;每个新区同时满足宪法第 7 条双模原则(人工全操作 + Otto 100% 代劳)。

- **CRM 区**(**分阶段:respond.io 级 SMB-lite 起步 → 长到 Salesforce 级深度**,架构按终局设计;联系人主要从对话/广告自动进来,WhatsApp-first;帮商家收款 = 以后且起步不碰资金流)
- **Campaign 管理区**(**独立 Campaign 对象**,不升格 project —— founder:"要 scale 去 Salesforce 那种,干净最重要";预算/编排/归因/UTM/campaign 级报表)
- **多平台广告区扩建**:TikTok → Lazada → Shopee(渠道缝已铺好,每平台独立 PR + 独立安全测试,顺序按商业价值定)
- **排期发布区**(spec 已有,等 App Review;**发布基建必须平台可插拔** —— FB/IG 先行,TikTok/Shopee/Lazada 类全要,加新平台 = 加 adapter 不改核心)
- **全量分析区**(spec 已有)
- **自动回复/客服区**(**WhatsApp BSP = 第一波入场券**;共享收件箱/Comment-to-DM/AI 客服(O-06 护栏前置);对标 respond.io(KL 同城)+ ManyChat;生命周期 WhatsApp-first,**email 以后但必须建**)
- **团队协作 + 审批流(租户侧)**(O-13/G-11 拍板"要",founder 硬要求**非常丝滑的体验**:多席位协作、"小编做→老板批→才发布"、评论交接;与宪法第 7 条租户 RBAC 同件设计;Agency 依赖它)
- **账务透明(credit 消费明细)**(拍板"要":用户 Account→Credits 分类明细,Otto 对话/图/视频/search/未来任何花费点,可展开单笔;官方侧 /admin/cost 同口径聚合;纯只读展示层)
- **订阅层**(Stripe Phase 4;利润在 Otto 的定价哲学落地处)
- **定时任务/自主 Otto —— routine 授权模型已定调(2026-07-03 第一轮共同设计)**:用户明确创建 routine(例:每周一 per 用户时区,研究 trend → 出 posts → 自动发布)= 一次性预授权,执行免逐次审批;配套四件不可少 —— 预算上限、范围声明、kill switch、事后摘要。细化 spec 动工前仍需 founder 过目
- **手机 App(远期)**:routine 管理与审批的移动面(founder 2026-07-03 点名)
- **Agency/Pro 楼层**(多品牌管理,盖在现有楼上,不开第二扇门;**开工顺序已拍:G-09 行业开店模板 → 团队协作+G-11 审批 → G-10 多客户伞层**,其余 agency 件以后)
- **市政厅 v2 —— 团队阶级制度(founder 2026-07-03 点名)**:把现有 admin(11 个 live section + 五级角色矩阵,今天被 founder-only 闸挡着)升级为完整可扩的团队管理后台。设计轴:①阶级 = 矩阵驱动(SECTION_MATRIX 一张可读表,section × 角色 × 读/写/审批 —— 符合 file-system 易管理宪法);②**钱的阶级**:授信按角色设单笔/日累计上限,超限走 founder 审批链;③邀请/停用/审计全留痕(ActionEvent);④替换 founder-only 闸为真实 staff 成员制(现有 ba_user.role 双写与双 user-id 空间的脆弱点在此一并加固,见 playbook);⑤冒充权限按阶级收紧(F15 安全默认为底);⑥**Otto 永久豁免市政厅**(宪法第 7 条豁免①,admin 只许人操作)。

---

## 七、修订规则(本文件自身)

- 修订 = founder 亲自改,或明确授权总审查员起草 + founder 合并 PR。
- 每次修订在下表留痕。
- agent 若发现代码与蓝图冲突:**停手、报告、等裁决** —— 蓝图错了改蓝图(经 founder),不是"顺手让代码赢"。

| 日期 | 修订 | 批准 |
|---|---|---|
| 2026-07-03 | v1 初稿(Fable 5 起草,基线 main #106) | 待 founder 定稿 |
| 2026-07-03 | v1.1 双模原则入宪(宪法第 7 条)+ 第一章重写 + 第六章新区以 SF/HS 全量分析为底稿(founder 口述修订,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.2 第 7 条升格:Otto 全操控 = 最高设计要求,写入四层结构保证(单一动作层/Parity Manifest/读对等/上下文桥)+ 三类豁免(v1.7 起为四类)(founder 口述,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.3 第六章新增市政厅 v2(团队阶级制度:矩阵驱动权限 + 钱的阶级 + 审批链 + staff 成员制)(founder 口述,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.4 O 区拍板入宪:定价双轨(席位+credits)/skill 永久内部/UIUX 第二支柱(时为第 10 条,v1.7 顺延为第 11 条)/routine 授权模型/建设节奏 = 创作先行赚钱(拍板会第一批,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.5 O 区封卷:对外 MCP 永久不做入第 8 条("操作这座城的 agent 永远只有 Otto");O-09 分域/O-10 要/O-12 Otto 之手/O-13 团队协作(归 G 区) | 待 founder 定稿 |
| 2026-07-03 | v1.6 G 区封卷入宪:双档席位/功能全开/滚存上限制(costing 先行)/MYR+分市场定价/直传/unlimited 永禁/白标永禁/Agency 顺序 G-09→协作+G-11→G-10 | 待 founder 定稿 |
| 2026-07-03 | v1.7 C 区封卷:工厂 MVP(升级票纪律)+ money-in 豁免入第 7 条 + 新第 10 条"技能为弱模型设计"(原 10 顺延为 11) | 待 founder 定稿 |
| 2026-07-03 | v1.8 WHAT-pass 全卷封盘:双模无例外判例 + 租户 RBAC 入第 7 条;通道费独立账道入第 5 条;发布可插拔/CRM 分阶段/独立 Campaign 对象/WhatsApp 第一波/dogfood GTM 入第六章 | 待 founder 定稿 |
| 2026-07-03 | **v2.0 终稿候选**:harmony 六件套收录(总设计层入金字塔)、第九缝 Parity Manifest 入交通系统、P1→P4 落地顺序 + costing 动工闸入第六章 | **待 founder 终审合并** |
| 2026-07-03 | v2.1a 第一章定位:SEA = 滩头、终点 = 全球世界级平台(founder 口述;补 v2.1 留痕) | 待 founder 终审 |
| 2026-07-03 | v2.2 harmony-06 补件(UIUX 设计审可执行版 + 丝滑工程标准 + GM 候选)—— 兑现第 11 条悬空承诺;总设计层改七件 | 待 founder 终审 |
| 2026-07-03 | v2.2a GM 卷拍板入第 11 条:GM-02/03/04/05 要、GM-01 streak 不要(founder 拍板) | founder 已拍(口头) |
| 2026-07-03 | **v2.1 全量对齐修订**(5 员对抗审查 40+ findings):宪法 5 重写(≥45% 地板/效率良心真入宪,删"视频近成本卖"旧句)/宪法 2 加开发期限定+账本推论/铁律①法币边界/第 4 条两类例外/O-12 之手+O-09 分域入第 7 条/connectors 不要入第 8 条/九条缝改数/区划图刷新至 #117 并豁免不可改/第六章补团队协作+账务透明+包告警+Agency 顺序+叙事节奏/金字塔加判决记录层 | 待 founder 终审 |
