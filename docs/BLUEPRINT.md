# FIKIRTIVE 总蓝图(城市总体规划)

> **文件性质 —— 先读这个**
> 这是 founder 与总审查员共同定稿的**最终版构想**。它回答"这座城是什么、往哪长、什么永远不变"。
> **任何 agent 不得修改此文件。** 代码与本文件冲突时,以本文件为准,直到 founder 亲口改变主意。
> 修订权:founder 本人,或 founder 明确授权的总审查员 session。修订必须走 PR 且 founder 合并。
>
> **配套文件金字塔**(从"强制力"到"参考",越上层越不可违抗):
>
> | 层 | 文件 | 谁维护 | 性质 |
> |---|---|---|---|
> | 宪法 | `docs/BLUEPRINT.md`(本文件) | founder + 总审查员 | **不可改** |
> | 法律 | 根 `CLAUDE.md`(合并纪律)+ CI 围栏 + `money-safety-review` skill | 总审查员 | 机器强制 |
> | 建筑规范 | `docs/review/REVIEWER-PLAYBOOK.md` | 总审查员 | 审 PR 必查 |
> | 地质报告 | `docs/review/CODEBASE-MAP-*.md` / `EXPANSION-SEAMS.md` / `LIVE-SURFACE-*.md` / `DECISION-INVENTORY-*.md` | 大变更后可更新 | 深度参考 |
> | 施工图 | `docs/superpowers/specs/` + `plans/` | 每个建设 session | 逐楼图纸 |

---

## 一、这座城是什么

**FIKIRTIVE = 一座给东南亚(首发马来西亚)中小商家的 agentic marketing OS。**
住户是不懂营销、不懂 AI 的老板 —— 他们雇不起营销团队,所以这座城给他们一个**超级员工:Otto**。

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
2. **钱路神圣。** money-in 只有 `grantCredits`(Stripe webhook + admin 授予);spend path(genRequest 闸 → startGen → 幂等键 → provider 调用 → reserve/settle)的任何 diff 必过 `money-safety-review`。**每笔真实花费逐笔问 founder —— "问"就是上限,没有代码上限。**
3. **Otto 运营契约(五条铁律)**:① 计费透明、只显示 credits 永不显示美元 ② 花钱前必审批 ③ 状态诚实(失败自动退款、重试绝不双扣)④ 建议按钮引导下一步 ⑤ One Otto —— 新能力永远 = 新 skill,不是新 app。
4. **审批的数学**:`needsApproval = (cost=spend) ∥ (effect=write ∧ reach=external)`。三字段缺一即取最危险值(fail-closed)。这条公式是城市的电闸,不许出现绕过它的旁路。
5. **定价永不硬编码。** 目标毛利 40–50%;图约 2.5x、视频近成本卖、**利润主要在 Otto 本身**。credits 与美元锚定(1 credit = $0.10,内部 ×10 记账)。**结构定调(2026-07-03,G 区拍板)**:席位订阅(创作席+审批席双档)+ credits 用量双轨;功能全开、档位卖规模;credits 滚存上限制(以 costing 为准 —— **任何定价决定 costing 先行**);**MYR 为主货币 + 分市场差异定价(最大化 margin)**;通道费透明直传;**永久禁止任何 "unlimited" 类报价**(founder 2026-07-03:"Otto 自动化的时候我们就糟糕了" —— agent 自动化使不限量承诺变成本敞口)。
6. **租户铁幕。** 一切数据 ownerId 隔离;身份永远来自 session(requireOwner),永远不信客户端传的 org/owner。跨租户读一个字节 = 事故。
7. **双模原则 + Otto 全操控(2026-07-03,founder 定为最高设计要求)。** 每个功能区必须满足两条:(a) **人工可完整操作** —— Otto 不在也是一个能打的产品;(b) **Otto 可 100% 操控 FIKIRTIVE 能操控的一切**。保证机制是结构性的,不靠自觉:
   - **单一动作层**:UI 按钮和 Otto skill 调用**同一个** server action,禁止两套业务实现(`generate`→`startGen`←canvas 按钮 = 范本);
   - **Parity Manifest**:action ↔ skill 对照表 + 明示豁免,CI 扫描 —— 新 action 没登记就合并不进去;
   - **读的对等**:每个人工可见的数据面都有对应 free/read skill(Otto 不做瞎子操作员);
   - **上下文桥**:当前视图/选中项注入每轮对话,"把这个改成 9:16"里的"这个"必须可解析;
   - **三类豁免写死**:市政厅(admin)永久豁免、纯视觉微操、账户安全操作(人亲自来);
   - **审批经济学不变**:全操控 ≠ 全自动,花钱与外部写照旧过闸。
8. **明确不盖的楼**(拍板过,别再提案):Build 终端 coding agent、独立通用 Chat、Spicy/18+ NSFW、**开放第三方 skill 生态**(skill 永久 BELCORT 内部编写)、**对外 MCP/API 让外部 agent 操作 FIKIRTIVE**(founder:"如果会用其他 LLM,代表我们的 Otto harness 不够好,就代表 FIKIRTIVE 不好。" —— 操作这座城的 agent 永远只有 Otto)、**白标**(founder 2026-07-03:"我要的就是 FIKIRTIVE 变成世界级别的平台" —— 平台不贴别人的牌,Otto 永不改名换脸)、**任何 unlimited 类报价**(与 Otto 自动化互斥,成本敞口)。
9. **语言约定**:spec/skill 文档用华语(founder 复审);生成 prompt 一律英文;UI 文案 sentence case。
10. **UIUX 是第二支柱(2026-07-03 入宪)。** 除"Otto 全操控"外,UIUX 是留住与吸引用户的核心卖点。质感标杆 = **Apple**;交互趣味参考 Duolingo 但克制 —— 面向专业用户只做 **minimal gamification**(形态在 harmony 设计阶段定)。落地机制:单一设计系统(.gb)不许分叉;每个用户可感的面必须过设计审(不只 runtime QA);设计基准 = Analytics 屏(已有 gold standard)。

---

## 三、区划图(现状:哪栋楼在什么状态)

图例:✅ 通电运营 · 🌙 建成断电(等钥匙:重连/App Review/env)· 🔧 建成没挂门牌(功能全好,导航不可达)· 🚧 空地立了牌子 · 📋 图纸阶段

### 中央区 —— Otto 本体 ✅
16 个注册技能(1 个花钱技能 `generate`,唯一)。刨根问底资讯门、seedream/seedance prompt 精通(唯一 prompt 权威)、分镜卡(F1-F3,$0)、品牌记忆、web research、视觉参考。模型 = sonnet 主力 + 同级 failover;每轮 reserve→settle 计费。
**待建**:分镜 F4(首帧付费生成,过 money-review)、闸②(make all 视频)、连贯模式。

### 创作区 —— Canvas 工作台 ✅
无限画布、4 变体图 + 成本确认、i2v/t2v 视频、多参考图调理(#92)、整段参考视频(#97)、抽帧、付费卡防误删警告、失败态卡片。**这是用户的家(canvas-as-home)。**

### 资产区 ✅ + 🔧
My Stuff(Cast 实体 + Ads)✅、Brand memory ✅;**Library 🔧、Templates(4 个一键付费模板)🔧、Discover(灵感库)🔧 —— 三栋楼全建好了但没挂导航门牌**(已知缺口,等 founder 排优先级)。

### 广告区 —— Meta 🌙(等钥匙)
读(insights/列表)✅ 已通电;**写**(暂停/预算/ad-write v1)和**建**(整 campaign PAUSED 草稿,build=$0)已建成断电 —— 等 ads_management/pages_show_list 重连 + App Review。TikTok/Lazada/Shopee 是同一条渠道缝上的规划新楼。

### 排期区 🚧 + 分析区 🚧
两块空地立了"Coming soon"牌。排期(Buffer 式 3 视图)卡在 instagram_content_publish App Review;分析(ads+organic+history 全量)已有 spec。今天唯一活的分析 = Connections 里的 Meta 30 天洞察。

### 市政厅 —— 运营与账房 ✅
Admin 11 个 section 全活(模型开关/成本/授信/内容审/会话审/租户管理/冒充/审计日志);Stripe MYR 充值包 LIVE;100 免费 credits/新 org;冒充态禁写(F15 安全默认)。

### 地下管网 ✅
pg-boss 五条队列 + 三类回收器(gen/refgen/LLM 预扣)、ingest 哈希复验(D19)、render/caption 管线、R2 内容寻址存储、CI 双 job + 合并纪律。2026-07-02 全库审计 44 条全闭环。

---

## 四、交通系统(八条扩建缝 —— 新楼必须接管网,禁止私拉电线)

任何新功能都必须走这八条缝之一;绕缝直连 = 审查一票否决。每条缝的**完整施工配方**(步骤+已建成范例+绕过后果)在 `docs/review/EXPANSION-SEAMS.md`。

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

---

## 五、扩建守则(未来盖任何一栋楼的标准流程)

1. **图纸先行**:spec(华语)→ founder 过目 → plan(可带模型指派:Fable 做架构、Opus 做执行)。
2. **施工纪律**:TDD(RED→GREEN)、小批提交、走对应的缝、不越图纸改邻居的楼。
3. **验收三关**:CI 双绿(底线)→ 总审查员按 playbook 区域清单终审 → UI 改动附浏览器 runtime QA 证据。
4. **碰钱加一关**:money-safety-review 逐项过 + founder 逐笔批真实花费验证。
5. **入册**:合并后大变更由总审查员更新地质报告层(本文件不动)。
6. **谁都不许**:直推 main、自批自己的 PR、绕过任何一条缝、在 skill 里 import 花钱包。

---

## 六、还没盖的区(终局路线,方向已定、图纸未画)

**建设节奏(2026-07-03 定调):不走 funding,直接市场变现、利益最大化 —— Content creation 相关楼最先上线赚钱**,其余新区按收入贡献排队。

按 founder 的城市群构想,以下新区**方向锁定**,动工前必须各自出 spec 走第五章流程。
**新区的功能清单不凭空发明** —— 以 Salesforce + HubSpot 全量 feature 分析为底稿(`docs/research/`,2026-07-03 起),founder 逐项 WHAT-pass(要/不要/以后)拍板后才画施工图;每个新区同时满足宪法第 7 条双模原则(人工全操作 + Otto 100% 代劳)。

- **CRM 区**(客户/联系人/公司、线索与 pipeline、生命周期阶段、活动时间线 —— 对标 Salesforce Sales Cloud 核心 + HubSpot Smart CRM;全新区)
- **Campaign 管理区**(campaign 对象、预算、多渠道编排、归因、UTM、campaign 级报表 —— 对标两家的 campaign 体系;把现有"投放"升格为完整管理面)
- **多平台广告区扩建**:TikTok → Lazada → Shopee(渠道缝已铺好,每平台独立 PR + 独立安全测试,顺序按商业价值定)
- **排期发布区**(spec 已有,等 App Review)
- **全量分析区**(spec 已有)
- **自动回复/客服区**(共享收件箱、IG/FB DM、WhatsApp、chatbot、知识库 —— 对标 Service Hub / Service Cloud;全新区)
- **订阅层**(Stripe Phase 4;利润在 Otto 的定价哲学落地处)
- **定时任务/自主 Otto —— routine 授权模型已定调(2026-07-03 第一轮共同设计)**:用户明确创建 routine(例:每周一 per 用户时区,研究 trend → 出 posts → 自动发布)= 一次性预授权,执行免逐次审批;配套四件不可少 —— 预算上限、范围声明、kill switch、事后摘要。细化 spec 动工前仍需 founder 过目
- **手机 App(远期)**:routine 管理与审批的移动面(founder 2026-07-03 点名)
- **Agency/Pro 楼层**(多品牌管理,盖在现有楼上,不开第二扇门)
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
| 2026-07-03 | v1.2 第 7 条升格:Otto 全操控 = 最高设计要求,写入四层结构保证(单一动作层/Parity Manifest/读对等/上下文桥)+ 三类豁免(founder 口述,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.3 第六章新增市政厅 v2(团队阶级制度:矩阵驱动权限 + 钱的阶级 + 审批链 + staff 成员制)(founder 口述,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.4 O 区拍板入宪:定价双轨(席位+credits)/skill 永久内部/UIUX 第二支柱(第 10 条)/routine 授权模型/建设节奏 = 创作先行赚钱(拍板会第一批,总审查员执笔) | 待 founder 定稿 |
| 2026-07-03 | v1.5 O 区封卷:对外 MCP 永久不做入第 8 条("操作这座城的 agent 永远只有 Otto");O-09 分域/O-10 要/O-12 Otto 之手/O-13 团队协作(归 G 区) | 待 founder 定稿 |
| 2026-07-03 | v1.6 G 区封卷入宪:双档席位/功能全开/滚存上限制(costing 先行)/MYR+分市场定价/直传/unlimited 永禁/白标永禁/Agency 顺序 G-09→协作+G-11→G-10 | 待 founder 定稿 |
