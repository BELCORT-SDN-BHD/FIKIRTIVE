# WHAT-Pass 判决记录(拍板会输出,持续累积)

> **O 区:已封卷(2026-07-03)。** 14 簇全部有判决。

> founder 逐批拍板的正式记录;harmony 设计与蓝图 v2 的直接输入。

## O 区(2026-07-03 拍板)

| 项 | 判决 | 内容 |
|---|---|---|
| O-08 定价 | **定调** | **席位订阅 + credits 用量双轨(Zoho 式)**:全部 feature 用量走 credits,座位数叠加收费。具体档位随 G 区细化。 |
| O-01 + O-06 | **要,绑定顺序** | 对客 AI agent 要做,但 **O-06(护栏+试驾场)是硬前置**,顺序如 money-gate 一样不可绕。 |
| O-02 + O-05 | **要,routine 授权模型定调** | "自动的手、有闸的钱包":执行自动,花钱/对外发布默认停下等批准。**例外 = 用户明确设定的 routine**(例:每周一 per 用户时区,研究 trend → 做 posts → 自己发):routine 创建时的明确确认 = 预授权,执行免逐次审批。这就是蓝图"定时任务/自主 Otto 必须 founder 共同设计花钱闸"的第一轮设计:授权发生在 routine 定义时,配预算上限 + 范围声明 + kill switch + 事后摘要。远期:手机 App 作为 routine 管理面。 |
| O-11 | **不要(开放)** | skill 永久 BELCORT 内部编写。理由(founder):我们是全平台不是单 feature,内部处理更好控制。 |
| GTM 节奏 | **定调** | **Content creation 最先上线赚钱**。不走 funding,直接市场变现,利益最大化。 |
| UIUX | **升格宪法** | 除 agent-operates-100% 外,UIUX 是第二卖点/留存支柱。标杆 = Apple;gamification 参考 Duolingo 但因面向专业用户,做 **minimal gamification**(具体形态 harmony 阶段设计)。 |

### O 区第二批判决(founder 2026-07-03)
| 项 | 判决 | 内容 |
|---|---|---|
| O-04 品牌记忆自养 | **要**(默认确认) | "懂你"层;补"从批改学习" |
| O-07 Otto 绩效面板 | **要(简版)**(默认确认) | 周报级起步 |
| O-09 NL vs 可视 builder | **要,分域**(founder 修正) | **创作域保留可视画布**(canvas 的灵感本来自 Grok —— Grok 正式加入对标名单);**规则/自动化域**(flows/routine/分群)才用"Otto 写可读规则文件替代拖拽画布" |
| O-10 效果反哺闭环 | **要**(founder 升级:"也很重要") | 建设顺序仍是归因/分析先立,但判决为要,不是以后 |
| O-12 就地 AI 按钮 | **要**,设计关键(founder 强调) | **设计原则候选:就地按钮 = Otto 的手,不是第二个匿名 AI** —— 同一大脑、同一记忆、coral 身份;harmony 阶段出交互方案 |
| O-13 connectors → 团队协作 | **Slack/Notion connectors 不要;团队协作 FEATURE 要**(founder 转向) | 在 FIKIRTIVE 内做 team collab(多席位、协作、审批)—— 直接支撑席位收入模型;新簇,归 G 区细化 |
| O-14 对外 MCP | **不要(永久)** | founder 定案:"如果会用其他 LLM,代表我们的 Otto harness 不够好,就代表 FIKIRTIVE 不好。不要有这个机会。" —— 不留逃生口,质量压力全压在 Otto 上;外部 agent 永不获得操作面 |
| 差异化叙事 | **确认** | 首发 = "SEA 的创作超级员工"先赚钱;投放闭环第二章;"一个员工 + 100% 覆盖"为结构承诺 |

## 追加判决(founder 2026-07-03 深夜)

| 项 | 判决 | 内容 |
|---|---|---|
| Credit 消费明细(用户侧+官方侧) | **要** | 用户在 Account → Credits 看到分类消费明细(Otto 对话 / 图 / 视频 / 未来任何花费点,可展开单笔);官方在 /admin/cost 扩同口径全租户聚合。**纯只读展示层,零钱路风险** —— CreditLedger 的 refId/kind 结构本来就携带分类,只差 UI。宪法推论:未来任何新花费点必须走同一账本 → 自动进明细,不许旁路。 |
| 收钱绝对正确(不多扣/不漏扣) | **重申为最高铁律**(已是宪法第 2 条的实质) | 架构现状:reserve→settle 账本事务、幂等键+partial-unique 索引防双扣(数据库级)、SETTLE/REFUND 互斥、三类回收器防漏、money-safety-review + 总审查员双闸看守。2026-07-02 审计 P0=0。 |
