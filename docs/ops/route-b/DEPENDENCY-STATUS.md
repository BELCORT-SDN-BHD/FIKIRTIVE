# 路线乙 · 依赖与块状态板（五本账之二）

> 顺序 v3（执行合同 §四）。状态：`未开` / `在途` / `已交付(块报告链接)`。
> 六级状态是行级的（在矩阵里）；本板只看块级里程碑与依赖。
> **2026-07-16 D-038 当前执行口径**：产品施工继续冻结于既定安全点；本板的块级「已交付」只表示历史施工里程碑，不等于商业 Phase‑1 已通过。恢复产品列车前，内容、真实发布、完整 Customer Engagement CRM 与总计划「七·甲」release gates 必须全部闭合。

| 块 | 名 | 依赖 | 状态 | 块报告 |
|---|---|---|---|---|
| B0 | 发布契约与覆盖矩阵 | — | **已交付**（#240 @ `1b1414d9`，founder 签署 2026-07-11T18:01Z） | `reports/B0-REPORT.md` |
| B10 | 安全带全量（P0 六项+数据信任横切） | B0 | **在途**：P0-2/3/5 第一批已收（#242/#243/#246/#255）；#273 毛利地板闸+P0-1 备份工具面落地；生产执行项=供给单 A 节 | — |
| B9 | 引擎横切（接口冻结先行） | B0 | **接口冻结四权已放行；产品 lane 当前冻结**：#253 经 #260 补落合并 `f9a7fd9e` 生效（D-026；B9 v0.9 六契约）；员工引擎 Phase 1（WO-OTTO-PHASE1）r002 历史上已启动（#300/#304），现冻结于已有 head/claim，sanitation 完成且 Founder 明示放行前不得续施工或签发后续 B3/B9 工位 | — |
| B2 | 量测 L0 + 分析（数据契约先行） | B0 | **数据契约冻结四权已放行**（拆分版 v1.2；#253 误合栈式父分支后经 #260 补落合并 `f9a7fd9e` 生效——D-026；观测流门机制=设计草案随 B8 再冻，两反例为 B8 必闭继承项——D-026） | — |
| B8 | Campaign + Contact/Identity/Segment 底座 + 缺失大陆 | B0（不等债清） | **底座 schema 已落、完整范围未交付；R-010 硬停**：#314 合并 `8e07dd9e`（5 新模型/加性外键等）只证明原 11 行 slice 的 schema 里程碑；其 ContactIdentity 唯一键、Contact consent 字段与 Campaign `utmBase` 和已冻结 B2 v1.2 契约互斥。D-038 不选择哪份合同胜出；相关施工须先经独立 Founder-approved schema alignment。D-034 旧 B8 稿不再代表完整 Phase‑1 CRM；B5～B8 横切功能与 release gates 仍待施工/验证，产品冻结中 | — |
| B1 | A′ 壳 8 切片（PR-0/切片1 已合 #232/#236） | B0 | 未开（切片顺序按 lane2 重排） | — |
| B3 | 创作 L-C | B0、B9 接口（已冻结） | **批1b 全清**：壳+四泳道 $0 双执行器落 main（#261/#264/#266/#267/#271/#272），债 84→36；批2 spend 批就绪（前置 #273 毛利闸已上线）。**v0.4 甲案原子勘误（D-031）**：批2 四工位拆 **-P（证明层/执行器，留批2）/ -W（界面接线，移批3）**——W-B3-E **停手上报重排**（非已完成）、F/G/H 同拆；批2 = W-B3-E-P/F-P/G-P/H-P（推荐序 F-P→G-P→E-P/H-P），批3 = 四件 -W（依壳↔项目桥；开工门 #253 已于 2026-07-12 合并）。**批2 全清（2026-07-14）**：四工位全落 main——F-P=#280 `478d4d49`、G-P=#279 `992c4f59`、H-P=#282 `b93c6c56`、E-P=#307 `84108e27`（E-P 结案态=ESCALATION 交付+两案裁决 D-035；「随 W-B3-E 片交付」六行保持 spec-ready 待 -W 合龙，行级证据见 `matrix/03-B3.md` 行注）；批3 四件 -W 待 WO-OTTO-PHASE1 r002 交付后列车化编排（签发纪律与合并列车结构=D-036） | — |
| B4 | 发布 L1（Reminder-assisted + Direct） | B0 | **历史施工批1a 已交付，release 未完成**：四工位落 main（#265/#268/#275/#276）；Reminder-assisted 与 Direct 须按同一 release SHA 分开通过自动化/mock、内部 UI/device、受控真实 email/Meta 三层证据。现无任一模式被本板预称 release-certified | — |
| B5 | Customer Engagement Inbox + WhatsApp 首渠道 | provider-neutral connector 契约；WABA 身份（供给单） | 未开；Phase‑1 首个 adapter=Gupshup，但核心不得依赖它 | — |
| B6 | 统一回执 + 可选经营事实 connectors | provider-neutral receipt/connector contract | 未开；EasyStore 可选且不阻塞 CRM 核心 | — |
| B7 | Campaign/Broadcast + Lifecycle/Workflows | B5/B2；B6 回执缝可增量接入 | 未开；老客唤回只是 playbook，不以 EasyStore 为开工门 | — |
| B12 | 收钱三闸 + 真实 Stripe 收款 | 各块 code-complete | 未开 | — |
| B11 | 全城联验（golden journeys 逐块生长；Otto 联验写死 sonnet 级） | 逐块生长、最后只验 | 未开 | — |
| B13 | 发射台（割接/监控/法务/PDPA） | 法务文本=Meta 递审硬前置（施工期完成） | 未开 | — |

## 外部等待位（供给清单对应）

| 钥匙 | 影响块 | 状态 |
|---|---|---|
| Meta 商业验证 + App Review | B4（通电重验） | 材料施工期办（Q4 细化） |
| WABA 新号 + 正式接入 | B5 | 等供给 A 节 |
| 可选 EasyStore adapter 载体 | B6（仅该 adapter 真验） | 非 Phase‑1 核心前置；选用时再由商家自助授权并单列真验 |
| GBP API | 并行泳道薄试 | 递审窗口一批递 |
| L0 短链域 | B2 | 等供给 A 节 |
| Sentry DSN ×2 | B13 | 等供给 A 节 |
