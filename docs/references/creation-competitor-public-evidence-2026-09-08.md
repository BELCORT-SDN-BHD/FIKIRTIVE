# Creation 竞品公开证据：HeyOz、Grok Imagine、Higgsfield

研究日期：2026-09-08。范围：官方公开网页与帮助文档；未登录、未生成、未付费，也未测试账户内操作。

本文是 reference，不是当前范围、优先级、Founder 批准或验收。产品参照为 [BLUEPRINT](../BLUEPRINT.md)：让中小商家提供产品背景，亲手或由 Otto 完成同一创作动作，并追踪输入、结果、状态与花费。

## 证据等级与边界

- **官方文档描述**：厂商明确写出的操作路径或规则；仍不等于本次行为测试通过。
- **营销主张**：官网介绍、演示、效果和速度承诺；不能视为一致性、质量或转化提升的证明。
- **未验证**：公开来源没有充分说明，或需要账户内观察及真实生成才能确认。

检索只采用 heyoz.com、higgsfield.ai、x.ai 与 docs.x.ai 的第一方内容。不采用名称类似的 Grok 镜像站、第三方测评或非官方 Open Higgsfield 文档。网页会更新；日期表示本次检索时间，不表示功能上线日期。

## HeyOz：把品牌与产品导入放在创作前面

**营销主张。** 首页描述从网站网址提取品牌与商品资料，再进入产品拍摄、试穿、AI 演员、广告模板及聊天 agent。Agent 展示按 Strategy、Production、Creative 组织，从策略到镜头、演员和成品。它证明厂商如何包装工作流，不能证明 agent 会先给用户批准计划、保存计划版本或逐步执行。[官网](https://heyoz.com/)

**营销主张。** 产品演示页给出“选形式 → 上传产品 → 生成演员演示”的路径，例子包括拿瓶讲解、护肤涂抹及手部特写。它未证明用户能单独绑定指定人物参考，也未证明商品标签、比例和手部接触能稳定保持。[Realistic actors holding products](https://heyoz.com/uses/realistic-actors-holding)

**公开定价说明。** Starter 为 $19.99/月、100 credits；Basic 为 $44.99/月、250 credits；Professional 为 $99.99/月、550 credits。页面区分普通图片 1 credit、专业图片 2 credits、视频依模型 5–15 credits，并声称 Generate 按钮在花费前显示价格。所有工具包含在各档方案，主要差别为额度、社交账户数与支持。页面还介绍站内图像/视频编辑。[Pricing](https://heyoz.com/pricing)

**同页冲突。** 定价页醒目文案把 Starter 的 100 credits 写成 100 static ads，但详细说明中常用专业图片为 2 credits，即约 50 张；两者只在图片档次不同的解释下成立。社交平台列表也出现 Facebook 与 YouTube 不一致。不要据此替 FIKIRTIVE 承诺产量或渠道支持。[Pricing](https://heyoz.com/pricing)

**未验证。** 历史记录结构、输入来源关系、下载规格、关页后任务恢复、失败退款、重复提交扣费、agent 计划批准和商品/人物参考的具体操作均未获得充分公开证据。

## Grok Imagine：必须区分消费者界面与底层 API

**官方产品文档。** Grok 网页及移动端提供 Imagine 图片/视频；账户同步对话、设置和订阅。它并未因此证明 Imagine 的所有资产和运行中任务都能恢复。[Grok overview](https://docs.x.ai/grok/overview)

**官方消费者规则。** FAQ 写明付费产品共享每周使用额度，Settings → Usage 展示使用比例与重置时间；用尽后可购买额外额度或升级。该页还明确：生成内容带 Grok 水印；720p 达到套餐上限后会自动降为 480p。具体账户的入口门槛、价格和剩余额度需要在登录界面核实。[Grok FAQ](https://docs.x.ai/grok/faq)

**API 能力，非网页验收。** Imagine API 官网介绍文字生图、自然语言修图、多图合成和人像加服装参考的试穿示例。它可作为技术能力线索，不能直接证明 grok.com 提供同一参考槽位或商家产品库。[Imagine API](https://x.ai/api/imagine)

**API 生命周期文档。** 视频工作流分别支持图片动画、参考图引导、视频修改与续接。生成以 request_id 查询 pending、done、failed、expired；完成结果是临时视频网址，需要及时另存。图生视频首帧与参考图引导是不同模式，不能在一次请求同时使用。这些是下游产品需要正确包装的能力与限制，不是消费者网页持久化承诺。[Video generation](https://docs.x.ai/developers/model-capabilities/video/generation)

**未验证。** 本次没有消费者界面证据证明：保存可复用商品/人物、agent 制作可批准的营销计划、批次来源关系、历史导出方式、离开页面继续生成以及失败后的额度处理。API 的 request_id 或临时链接不能填补这些空白。

## Higgsfield：商品、人物、模板与资产库形成可复用路径

**营销主张。** Marketing Studio 页面把模板、产品拍摄、UGC、广告、海报与 motion 放在同一产品工作流；可替换商品和人物、调整模板，海报元素被描述为可逐层编辑。同页一处写 100+ avatars，另一处写 40+，因此具体数量不作为可靠结论。[Marketing Studio introduction](https://higgsfield.ai/marketing-studio-intro)

**公开功能说明。** 商品可由网址导入名称、描述、图片，也可手动添加至多 5 张图片；产品可编辑并复用。人物可从库中选择或生成，支持命名、固定和跨 campaign 复用。流程是商品 → 人物 → 创意形式 → 多变体。该页的成片质量与秒级速度仍属营销主张。[Marketing automation](https://higgsfield.ai/marketing-automation)

**官方帮助文档。** Supercomputer 被描述为聊天式工作区：拆步骤、选择图片/视频/音频模型并组合结果。官方列举产品图、分镜后动画、研究后做视频；每次生成步骤按标准价格扣 credits，并在任务进行中展示累积花费。文档没有证明其在开始前给出完整可批准的总预算。[Supercomputer help](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer)

**官方帮助文档。** Assets 自动保存图、视频和音频；资产详情可进入修图、Turn to video、Recreate、Reference，以及下载。支持文件夹和批量操作。因此可用公开资料确认厂商描述了“生成结果继续成为下一次输入”的路径；不能据此声称断网恢复测试通过。[Account and Assets](https://higgsfield.ai/creator-hub/help-center/getting-started/whats-in-my-higgsfield-account)

**官方费用说明。** Generate 按钮预告 credits；Usage 显示生成扣费及失败返还，但记录可能只覆盖功能启用后的活动。失败通常数分钟内自动返还，某些模型例外。订阅额度到期不结转；credits 需有效订阅才能使用。该帮助页还写明自动化渠道包括 MCP、CLI、Canvas、Supercomputer 均消耗额度，不享有网页无限生成优惠。[Credits help](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work)

**需要实测的文档歧义。** Supercomputer 帮助页的比较表对其 Unlimited access 写 Web only，但同页正文又说每步付费，credits 文档也把 Supercomputer 列为始终扣费的渠道。不能把“在网页内”理解为 agent 生成免费；应以当前操作价格与账户条款核实。[Supercomputer help](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-supercomputer)、[Credits help](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work)

**未验证。** 本次公开抓取的 [Pricing](https://higgsfield.ai/pricing) 没有返回可核对的套餐价格，故不填历史价格。商品真实性、人物一致性、批量结果质量、下载实际编码、关页恢复、退款例外和 agent 前置批准都没有行为测试证据。

## 对 FIKIRTIVE 的研究含义（推论，不是新增范围）

| 值得进一步观察的问题 | 公开线索 | 与商家的关系 |
| --- | --- | --- |
| 商品与人物能否复用并分别绑定？ | HeyOz 产品导入；Higgsfield 商品/人物对象 | 同一瓶护肤品换人物做广告，无须每次重述事实。 |
| 成品能否直接修图、再动画、作为参考？ | Higgsfield Assets；Grok API 模式 | 商家修好标签后继续做视频，不应找不到上一版。 |
| Agent 的计划与支出何时可见？ | HeyOz 三段式演示；Higgsfield 多步及累积费用 | “做三版广告”可能涉及多次扣费，需要看懂具体动作。 |
| 规格、失败与结果保存是否诚实？ | Grok 分辨率降级与临时链接；Higgsfield 退款例外 | 已付费结果不能只存在浏览器内，720p 也不能被默认为实际交付。 |

最有价值的后续实测是同一条小商家任务：绑定一个商品和一个指定人物，先编辑图片，再生成短视频，检查历史、来源、规格、下载和恢复；分别记录“按钮存在”“动作成功”“花费结算成功”，不能互相替代。

CodeGraph: not used — 本任务仅检索外部公开资料；仓库只直接读取 Blueprint 与 references README，未调查应用实现。

## 补充：FIKIRTIVE 已批准设计与新增提案的边界

核对日期：2026-09-08。本节只映射当前 checkout 的批准文件，**没有运行应用或测试；所有当前 runtime 能力均未验证**。下列 `文件:行` 是可复查定位。Phase 3 的历史 implementation checkpoint、旧 acceptance 的 Pass，不当作今天运行通过。本文不创建新 spec，也不修改既有批准。

批准层次必须分开：Canvas pattern 已冻结的是设计与原型（`apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md:3`）；正式 Create/Canvas 接线由 Phase 3 单独授权（`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:122`）。Library fixture 获接受，但后端合同明确不授权 schema 或生产数据变化（`apps/web/design-system/patterns/library/README.md:118`、`apps/web/design-system/patterns/library/backend-handoff-contract.md:3`）。Reference picker 接受的是 review fixture；真实搜索、解析与来源保存仍有 production gate（`apps/web/design-system/information-architecture/frontend-convergence-phase-5-reference-picker-spec.md:44`）。

| 能力／阶段 | 已批准要求与精确来源 | 不可借竞品研究静默加入的范围 |
| --- | --- | --- |
| 入口与工作空间 | Create 只有 composer + Canvas history；进入唯一 full-screen Canvas，首句话保存为对话。`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:28`、`:79` | 模板商城、Discover feed、建议 prompt、第二个 Home；永久 agent 计划面板或 queue board 也非当前方向。`apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md:330` |
| 产品图片输入与理解 | Creation 可直接上传／引用，不要求先去 Library；理解过程以用户任务语言呈现。`apps/web/design-system/governance/content-disclosure.md:34` | 强制先建产品档案；独立收费的分析静默并入生成或自动执行。费用归属仍需业务合同。`:38` |
| 官方人物 + 商品／生成图 | `Product` 指向 Otto IQ ID；`Official avatar` 指向只读 catalog ID；生成图是 Generation ID，上传是 Asset ID。可同时选择多个可移除引用，发送与生成保存来源。`apps/web/design-system/information-architecture/reference-picker-contract.md:49`、`:57`、`:65` | 用外观类似人物的普通上传冒充官方 Avatar；从文件名猜 Product；复制产品 facts；整库／整个 Collection 作为引用。`:80` |
| 引用选择与交接 | `@` Recent、分类、跨类型搜索；Library `Use in Canvas` 与 `@` 交相同 typed ID，服务端重新解析。`apps/web/design-system/information-architecture/reference-picker-contract.md:19`；`apps/web/design-system/patterns/library/backend-handoff-contract.md:107` | 新 reference 类型、把 fixture 当正式 catalog、不可用引用静默丢弃或自动换演员。Production gate 仍要求真实合同，不可由设计批准推定已完成。`apps/web/design-system/information-architecture/frontend-convergence-phase-5-reference-picker-spec.md:46` |
| 修图、变体、图片转视频 | 选图后 Edit／Variations／Animate；新结果保留原稿并记录 durable lineage。`apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md:148`；`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:91` | 图层编辑器、手动视频时间轴、多镜头 storyboard 工作区或永久计划画布；这些不能从“竞品有”推导成本次范围。手动时间轴已列 non-goal。`:105` |
| 费用与 agent 步骤 | 下一次付费动作展示服务端 exact credits、输出数量、规格与 references；一次确认，未知结算恢复同一动作。`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:53` | 持续自动扣费授权、整场 campaign 一揽子批准或新的生成后 Approved gate。普通聊天持续授权另批；原 Canvas 明确没有生成后强制 Approved gate。`apps/web/design-system/governance/content-disclosure.md:27`；`apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md:142` |
| 历史与刷新恢复 | Canvas 节点、对话、结果和回执持久化；关闭页面不取消已付费任务；所有生成进入 Library。重开以 Fit to content 初始化。`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:61`、`:90` | 精确恢复 pan/zoom、临时 selection 或跨装置草稿：Phase 3 已明确延后，不可仍按早期 pattern 的笼统 autosave 承诺判缺陷。`:107` |
| 下载、后续使用 | Download / read-only share 作用于当前选中 Generation；Library detail 展示 prompt、refs、lineage。`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:65`、`:94`；`apps/web/design-system/patterns/library/README.md:73` | 自动发布、Campaigns、Schedule 或外部连接；Phase 3 将这些列为 deferred。`:66` |
| 语言与信息表达 | UI copy 为 English sentence case；工程文档华语。Otto 状态用任务语言，不显示内部模型／pipeline。`AGENTS.md:27`；`apps/web/design-system/governance/content-disclosure.md:22` | 多语言是 Blueprint 长期方向，未在本次读取的批准文件中找到完整语音语言、字幕或翻译规格。不能承诺特定口音、自动配音或新增语言选择器。`docs/BLUEPRINT.md:11` |

### 可沿已批准合同检查的连续场景

以下是研究／验收路线映射，**并未执行，也不是新的强制 UI 步骤**。先记录真实可用入口；缺失时区分“已批准接线缺口”与“尚未批准的新能力”。不因阶段表而新增向导。

| 检查阶段 | 要观察的结果 | 依据 |
| --- | --- | --- |
| 1. 上传商品图片并描述要做的商品图 | 无需先去 Library；图片以可辨认参考进入同一对话，付费前有准确报价；不能把图片自动当作新 Product facts。 | `apps/web/design-system/governance/content-disclosure.md:34`；`apps/web/design-system/information-architecture/reference-picker-contract.md:49` |
| 2. 生成商品图 | 结果成为新 Generation，有状态、规格、输入来源与费用回执；第一句话可从 Conversation 找回。 | `apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:87`、`:89` |
| 3. 官方 Avatar + 刚生成的商品图 → 下一张图或视频 | 两个明确且可移除的引用；官方人物保持 catalog ID，商品成品保持 Generation ID；确认卡仍保留两者。不应自动换人或把普通人物图称为官方 Avatar。 | `apps/web/design-system/information-architecture/reference-picker-contract.md:51`、`:54`、`:73`；`apps/web/design-system/patterns/library/backend-handoff-contract.md:118` |
| 4. 图片转视频或直接视频 | 下一次动作规格与费用清楚，源图不覆盖，视频在同一 Canvas；结果质量另实测，引用 ID 正确不等于画面一致性已证明。 | `apps/web/design-system/patterns/canvas/stitch-image-video-parity-spec.md:150`；`apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:91` |
| 5. 编辑、下载、回到历史 | 修改有新 lineage；下载当前选中对象；Library 找回图片和视频及其引用，不依赖收藏或是否仍放在 Canvas。 | `apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:64`、`:94`；`apps/web/design-system/patterns/library/README.md:76` |
| 6. 处理中刷新／离开再回来 | 原任务继续，状态与账务可恢复；不重复发送或收费；节点位置恢复，viewport 接受 Fit to content。退款未确认不得说已退。 | `apps/web/design-system/information-architecture/frontend-convergence-phase-3-create-canvas-spec.md:31`、`:56`、`:85`、`:90` |
| 7. 中文／英文任务输入与键盘 | 检查输入、组合输入法、引用名和对话内容是否保留，不把测试输入语言等同于已批准字幕／配音能力；Enter 换行、Shift+Enter 发送，picker 中 Enter 选中。 | `apps/web/AGENTS.md:9`；`apps/web/design-system/information-architecture/frontend-convergence-phase-5-reference-picker-spec.md:86` |

本轮没有找到独立命名为 typed-reference 的当前 spec；带类型引用的本次权威是 `reference-picker-contract.md`、Phase 5 production gate 和 Library backend handoff，未用旧计划补出新的授权。新页面、布局步骤或费用授权须按原 handoff 记录差异，而不能把本 research note 当批准（`apps/web/design-system/governance/frontend-integration-handoff.md:55`）。

CodeGraph: not used — worker 在非持图 worktree 用 `rg` 与直接读取完成批准来源映射；未调查 runtime 实现，未运行行为测试。
