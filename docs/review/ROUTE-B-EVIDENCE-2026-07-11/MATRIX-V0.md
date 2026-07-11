# FIKIRTIVE 能力真相矩阵 v0(D7 Gate 0 综合)

> 基线:`main@b5a48d0f`(2026-07-11)。综合自 9 份 `.orchestration/evidence/` 分片 + Railway 生产事实 + founder 五答 + 本地旅程走查。
> 性质:**取证综合(控制面亲做),非判断**。四 thesis 记分卡属 Gate 1,留给 advisor + founder。
> 证据规则:Observed=代码/迁移/测试/生产/走查亲核;VCS=Verified current source;Inference=推链;Hypothesis=待测;Unknown=无证据不补故事。

---

## 〇、贯穿全审计的地面真相(每个分片独立撞到同一堵墙)

1. **生产真相系统性不可核验(release provenance 断裂)。** 【已验】生产 web/worker 都用 `railway up` 目录上传部署,**元数据无 commitHash**(控制面亲查 Railway);状态账旧记的 `7ed7ac22` 是**部署 ID 不是 commit**,在本地 git 历史里 `git cat-file` 解析不出。9 个分片全部因此把 `stage_prod` 系统性降级为 Unknown。→ **无法回答「用户今天摸到的是哪版代码」。这本身是 Gate 0 一级运营发现。**
2. **用户与收入 = 0。** 【已验 · founder 原话】还没有用户、只有 founder;Stripe 零成交;生产无 Sentry。Gate 0 worksheet 22 处【待定】自 2026-07-04 从未填写。→ **一切 ICP/JTBD/商业结论只能是 founder 直觉或 Hypothesis,不存在「用户证据」层。**
3. **文档-代码-记忆三层漂移普遍。** CODEBASE-MAP(07-02 基线)已多处过时(analytics 从占位升级为真实);northstar 文档声称已建的东西 main 上不存在(GM-05);memory 记的「3 用户」与 repo worksheet「0 用户」冲突(已按 founder 07-11 原话修正为 0)。→ 旧文档只证明「曾经决定过」,判 stage 只认代码。

---

## 一、按区综合(143 matrix 行 → 分区结论)

图例:`integrated`=main 代码全链成立(代码+测试为证);`implemented`=路径在但入口不通/半落地;`schema`=只有表/迁移;`不存在`=判决有、代码零。**所有 `stage_prod` 一律 Unknown**(见 §〇.1),下表只列 `stage_main`。

### A. 创作区 + 资产区(E1)—— 最成熟,但有入口断层
- **integrated**:无限画布、i2v/t2v、多参考图、整段参考视频、抽帧、storyboard 全链、My Stuff、Brand memory v2(6-tab + living collections)、产品 URL 建档、直传哈希复验(D19)。
- **旅程走查活体验证**【已验】:登录→canvas 生成图→扣费 100→99→节点落画布,mock $0 全走通。
- **断层**:①**canvas 点不出 4 变体**——服务端硬顶 4,但唯一调用点恒送 count=1(founder 2026-07-06 定的默认),4 变体只在 Otto 聊天 proposePack 出现;走查亲见生成框写「Cost: 1 credit」出单图。北极星宣传图画「4 variants」与实况不符。②Library/Templates/Discover 三面**不在主导航**,仅深链可达(代码在,用户到不了)。③Templates 面是硬编码静态数组,不是 TemplateBundle 后台注册表(同名易误认)。④stitch($0 版,昨天判决)代码零命中。⑤A/B 分叉判决与代码两头空。⑥付费卡防误删只有前端拦截,服务端硬闸未验证。

### B. Otto 本体(E2)—— 技能翻倍,但两条宪法承诺无实现
- **integrated**:25 个技能(07-02 时 16,+9);streaming 聊天链;审批公式(仅 generate needsApproval);needMoreInfo 刨根问底;品牌记忆注入;meta 专家/research/prompt 技能;otto-resume 后台 verdict(fail-closed 不注入 startGen);**F23 已修**(ACTION_CARD/BUILD_CARD 流式渲染,但晚于 prod 部署→prod Unknown);prompt caching(引擎 Phase 1)。
- **旅程走查**【已验】:Otto 聊天在无 LLM key 时**静默转圈、零错误提示**(server log `AI_LoadAPIKeyError`)——违反宪法 11「状态诚实」,与前任交接书「Otto 聊天不流畅」同源。
- **断层**:①**上下文桥(宪法 7 第四层)代码零实现**——`viewContext/activeView/currentView` 全零命中,「把这个改成 9:16」的「这个」无解析通道;buildContextSystemMessage 只注入 brandContext/refs/activeJob。②**live reflection 只完成一半**——聊天侧 SSE 实时,canvas 侧仍 4 秒轮询(未推送化)。③引擎 Phase 2(技能分域装载)零代码,25 技能仍全静态挂载。④6 个新技能在 TOOL_STEP_LABELS 无条目(流式 UI 不显步骤)。

### C. 钱路 + 租户 + 市政厅(E3,Opus)—— 全审计最扎实的区
- **integrated(VCS 双核)**:账本五操作 + 三条 partial-unique 幂等索引;reserve→settle→refund 三方调用;**视频定价与 2026-07-03 终案逐项一致**(720p5s=8/10s=14/参考=16/OTTO_LLM_MARGIN=2.0);Stripe 充值链(按 session.id 幂等);用户侧 credit 消费明细;beta 100cr;**租户铁幕无新 model 漏挂**(L0 六表已挂 TENANT_MODELS);冒充 30 分钟/禁写/留痕(逐字核实 1800s);**夜间 pg_dump→R2 备份已真落地接线**(非仅骨架)。
- **断层**:①**毛利地板 ≥45% 无数值 gate**——只有「非 flat-priced 视频不可卖」的定性拦截,不算百分比;地板靠「flat 表已 floor」人肉假设。②**实质可卖视频模型 = seedance-2-fast 一家**(其余 fal 模型≈零毛利被拦)。③**search 3x 定价决定代码零实现**。④**X-02 授信只落地一半**(单笔≤1000 有闸,日累计≤3000 无实现)。⑤X-04 双人确认零代码。⑥市政厅 section 数三方对不上(RBAC 8 / admin 页 16 / 工单称 11)。

### D. 排期发布 + 渠道(E4,Opus)—— 代码 integrated,但 fail-closed 惰性,用户价值不成立
- **integrated(代码)**:排期 3 视图 + Composer;ScheduledPost/PublishAttempt 数据模型 + 三重幂等(索引 `PublishAttempt_one_applying_per_post`);L1a 连接层(#219)+ L1b 发布链(#227 四片);签名媒体代理;单一发布动作层(web/worker 共用 core,不分叉);Meta OAuth/读/写 v1v2;平台可插拔缝。
- **断层**:①**整条 L1 在 main 也是 fail-closed**——canPublish DEFAULT false + App Review 未过 + MEDIA_PROXY_SECRET 未设,四层任一未满足即 refuse/404。代码全,用户价值零。②**媒体契约疑点坐实**(FIK-1 正红测):IG 非 JPEG 一律 `transcodeToJpeg` 抽单帧,feed/carousel 挂视频会被静图化,无 video container 分支。③**organic kill-switch 只读不可写**——founder 目前无法主动拉 organic 断电闸(对比 ads 有 setAdsWritesPaused)。④**X/Twitter 判决要+定价 1cr/4cr,代码零**(无 schema/adapter/config)。⑤TikTok/Shopee/Lazada 仅分析区「soon」占位。⑥channel adapter 的 insights 全 notImpl,发的帖无回读表现闭环。

### E. 分析 + L0 + 认证 + 观测(E5)
- **integrated**:分析 Phase A(真实 KPI/reach/OTTO insight)、per-ad 面板、诊断卡(挂 Otto 对话非页面按钮)、Better Auth 三层 allowlist、proxy 认证墙、心跳+health 端点。
- **断层**:①**L0 量测脊柱六表完全悬空**——迁移合了,零 app 层读写,无 redirect/事件写入/UI(全审计「代码 vs 承诺」落差最干净的一条)。②短链 redirect(D4-2)代码零、文档编号仓库查无。③**GM-05 文档声称已建 vs main 只有一个 localStorage 欢迎浮层**(E5 信心最高的纵深候选)。④O-07 周报判决要、零代码。⑤**生产无 Sentry**(founder 答+控制面查实)。⑥审计/心跳失败静默降级。

### F. 架构缝(H1)—— 新链都走了缝,但一致性靠人工
- 九缝定义清晰;L1/排期/L0 三个新链**都走了正确的缝**未私拉电线;Parity Manifest 是唯一带 ratchet 硬闸的清单(债务基线 84 静止未涨未降);CI 把 catalog:check + lint:parity 升为硬门。
- **断层**:①skill 注册表↔TOOL_STEP_LABELS 无机器一致性检查(fail-open 静默);②卡片五道缝无机器闸(F23 类错配靠人工发现);③**第十缝(本地化包)100% 停留文档层**,宪法未修、代码零痕迹。

### G. 安全/运营(I1)—— 主体扎实,五个原始观察
- **扎实**:token AES-GCM 加密、SSRF 守卫(含 DNS-rebinding)、presigned URL 隔离、webhook 验签、CI 六道安全围栏、冒充禁写 12+ 覆盖点。
- **断层**:①**research.ts 是唯一遗漏 sanitizeError 的持久化错误路径**(裸 e.message 落库,job 内跑外部 URL)。②**Otto 外部内容摄入无防注入标注**——researchWeb/ingestProduct 把外部原始文本直接拼进 LLM 上下文,`untrusted/ignore instructions` 全零命中(纵深候选)。③仓库自建限流仅 1 处(auth email);花钱路径靠 credit 经济闸非请求频率闸。④7 条 DLQ 全裸建无消费者。⑤render/caption/ingest 三类 job 无定时 reaper。

### H. 用户与商业(AF1)—— 证据层空集
- **0 用户 / 0 收入**(founder 已验);Gate 0 worksheet 22 空白;ICP 仅 founder 单方转述,全库无用户原话/访谈/waitlist;顾客一号 Saranghaeyo 是外部 OSINT 非产品内使用;credit 包具体 RM 数字**故意只在 Stripe 后台**(只读 repo 结构性不可见);伙伴清单已产出但「去谈=founder 出马」尚未接洽;X 1cr/4cr 定价被 PAGE-INVENTORY 写得像已实现但代码零。
- **对齐正例**:credit 定价数字代码=文档完全吻合(10s Seedance 毛利卡 45% 地板线上,供应商涨价即击穿)。

### I. Off-main(OM1)—— 已建未上岸
- 原型城 65 页 UI 只活在大分支(#203 northstar-immersive,领先 main 122/落后 16,**不含 L0/L1 后台**);#202 北极星原型城 88 files;5 个分支已并入 main 未清理;22 条 worktree-agent-* 分支是并行会话噪音。
- **⚠️ OM1 的「54c1de0b 错位」提名已撤销(控制面 git 亲核 + FIK-1 交叉确认,2026-07-11)**:不是错位,是三个不同对象——`origin/claude/northstar-immersive`(#203 远端 head)= `54c1de0b`;`~/Desktop/FIKIRTIVE` 本地主 checkout = `763a28e6`(是 immersive 远端的祖先,即落后的旧本地检出,受保护脏 worktree);`wt-lcf`(`claude/lc-f-home-ideas-lighting`,无远端)从 immersive 远端头切出零新 commit,故 HEAD 恰=`54c1de0b`。**状态账无误,不作为审计发现。**

---

## 二、Top broken promises(承诺≠实况,原始观察,按落差幅度粗排,不评分)

1. **L0 量测脊柱**:六表悬空,零 app 代码。这是「缺失大陆前五」之首,承诺整个证据闭环的地基,实况=纯 schema。
2. **X/Twitter 发布**:founder 2026-07-07 拍板定价、PAGE-INVENTORY 写成既定文案,代码连 schema 都没有。
3. **GM-05 开店完成度 onboarding**:northstar 文档称「已建成四步 checklist」,main 只有一个一次性欢迎浮层。
4. **L1 发布链**:代码 integrated 但四层 fail-closed,production 用户彻底不可达;且媒体契约会把视频静图化(红测在途)。
5. **canvas 4 变体**:宣传画「4 variants」,画布实际出 1 张(走查亲见)。
6. **上下文桥(宪法 7)**:宪法明文要求,代码零实现。
7. **毛利地板 ≥45%**:宪法级承诺,无数值机器 gate,靠人肉假设。
8. **Otto 聊天状态诚实(宪法 11)**:依赖失败时静默转圈不提示。
9. **live reflection**:定调为北极星地基,canvas 侧仍 4 秒轮询。
10. **search 3x / X-02 日累计 / X-04 双人确认**:判决有,代码半或无。

## 三、Vertical-proof 候选(分片以原始观察形式提名,选择权留 founder)

- **A(纵深真实闭环候选)**:创作区是唯一 integrated 且走查跑通的区——「创作一张图→扣费」已活体验证。若选一条能短周期证明的完整闭环,创作→(某处)出结果是现成地基。
- **B(诚实建造纵深候选)**:GM-05 文档 vs 代码落差,是「代码已合≠能力交付」最干净的教学案例。
- **C(安全纵深候选)**:Otto 外部内容→LLM 无防注入标注,建议专项渗透式验证(静态搜索已提名,未实测)。

## 四、给 advisor + founder 的判断锚点(Gate 1,本文件不作答)

四 thesis(A 专业工具城 / B Otto-native operator / C Outcome workspace / D Progressive hybrid)记分,必须建立在:0 用户前提、创作区是唯一活体成熟区、L0/L1/发布链均未对用户成立、钱路扎实但可卖模型仅一家。**这些是判断的输入,不是判断本身。** 记分卡走 Gate 1 双顾问 + founder。
