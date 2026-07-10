# FIKIRTIVE 全产品重新审计章程（approved to start）

> Founder 授权：2026-07-11。可以重新质疑 FIKIRTIVE、Otto、产品心智、商业模式、架构与 UI/UX 的全部既有假设。
> 边界：这是重新取证与提出选项的授权，不自动修改 `docs/BLUEPRINT.md`；若结论冲突，先走 founder 的 §7 修宪流程。

## 1. 唯一目标

找到最可信、最简单、最有用的产品形态，使用户能够获得行业龙头级能力，并由 Otto 在清晰授权下完整协助或代为执行；体验必须丝滑、人性化、容易上手。

不把以下任何一句当答案：

- “工具越多越完整”；
- “agent 能做所以用户会信任它做”；
- “界面漂亮所以工作流成立”；
- “代码已合 main 所以能力已交付”；
- “旧文档拍过板所以不再需要证据”。

## 2. 必须同时竞争的四个产品 thesis

| Thesis | 核心心智 | 必须证明 | 失败信号 |
|---|---|---|---|
| A. 专业工具城市 | 一处拥有各行业最佳工具，Otto 会操作全部 | 用户需要广度，也能找到正确入口 | 选择过载、功能收藏馆、Otto parity 永远追不上 |
| B. Otto-native operator | 用户说结果，Otto 规划、执行、请批、交回执 | 信任、可控、成功率足以让 UI 退居后台 | 黑箱、误操作、审批疲劳、专业用户失去控制 |
| C. Outcome workspace | 围绕获客/创作/发布/成交结果组织证据闭环 | 一个闭环能持续带来可测结果 | 变成另一套项目管理器，专业能力变浅 |
| D. Progressive hybrid | 新手从 Otto/结果进入，专业用户按需展开工具 | 两种入口共享同一 capability 与状态 | 两套产品、导航割裂、实现/维护成本翻倍 |

审计开始时不选赢家。每个 thesis 用同一证据尺评分；也允许提出第五个更强方案。

## 3. 十条审计车道

### A. 用户与需求

- 明确第一 ICP、付费人、操作者、审批人；
- 重建真实 JTBD、当前替代品、切换成本与最痛时刻；
- 分离 founder 直觉、用户原话、行为数据与推断。

交付：`ICP/JTBD evidence map`、十个高风险假设、必须访谈/观察的空白。

### B. 产品 thesis 与范围

- 用四个 thesis 重画同一用户旅程；
- 对每个现有 capability 做 `keep / deepen / hide / combine / kill / later`；
- 检查“全行业龙头 tools”是可实现的能力标准，还是无止境 feature list。

交付：产品 thesis scorecard、能力组合原则、明确的“不做”。

### C. Otto 自主性与信任

- 定义 observe / suggest / draft / ask / execute / monitor / recover 七档授权；
- 每个 action 标出风险、审批公式、幂等、撤回、receipt 与 owner scope；
- 检查 Otto 与 UI 是否调用同一 typed capability，而非维护两套实现。

交付：autonomy ladder、approval policy、receipt contract、失败恢复旅程。

### D. 信息架构与 UI/UX

- 从首次进入、第一次成功、每日回访、异常恢复四条旅程审计；
- 检查导航、canvas、mission、tool、inbox、library 是否争夺产品主场；
- 同时做新手、专业用户、mobile 与 accessibility；
- 以真实任务完成率、步骤、犹豫点和等待感验收，不只看截图。

交付：现状 journey map、三种 IA 方案、可点击原型/截图盲评、设计系统缺口。

### E. 能力真实性

- 每个 capability 分为 `schema / UI shell / implemented / integrated / staged / production / externally verified`；
- 对 Otto 现有 skill 与 parity todo 建同一 truth table；
- 找出“UI 有按钮但闭环不成立”和“代码存在但用户到不了”的断层。

交付：capability truth matrix、top broken promises、vertical proof 候选。

### F. 增长与商业

- 核验用户为什么付费、按什么单位付费、价值出现多快；
- 区分工具订阅、usage、outcome、managed operator 与 marketplace 模式；
- 评估渠道、留存 loop、毛利、provider 风险与支持成本；价格仍只来自 config，不写死。

交付：business-model options、unit-economics ranges、distribution wedge、kill metrics。

### G. 竞争与行业龙头基准

- 按用户任务比较 Canva/Adobe、Meta/TikTok、HubSpot/Shopify、Zapier、agent 产品等当前一手体验；
- 不做 logo wall；逐项记录 leader 的最短成功路径、质量、可控性与迁移成本；
- 标出 build / integrate / partner / link-out 的正确边界。

交付：task-level benchmark、leader gap、9 个 expansion seam 的映射。

### H. 技术与数据架构

- 审计 typed capability runtime、queue、event/evidence spine、owner boundary、exactly-once 与 observability；
- 找出随工具数增长会线性/平方爆炸的接口；
- 判断哪些旧分支可切片、哪些应按规格重建。

交付：current/target architecture、migration slices、risk register、验证配方。

### I. 安全、合规与运营

- secrets、权限、tenant、钱路、外部写、删除与审计回执；
- production/main 漂移、部署、reaper/DLQ/backups、供应商故障；
- 模型 over-agency、prompt injection、错误审批与人类接管。

交付：threat model、credential rotation plan、operational readiness gates。

### J. 品牌、语言与体验语气

- FIKIRTIVE / Otto 命名、承诺、SEA 场景、华语/English/Malay 清晰度；
- 检查“专业”是否变成复杂，“AI”是否遮蔽用户结果；
- 所有 UI copy 继续 English sentence case，spec/skill 继续华语。

交付：positioning options、message hierarchy、voice/copy test。

## 4. 证据规则

每条结论必须标成：

- `Observed`：代码、生产、用户行为、测试、访谈原话；
- `Verified current source`：当前一手外部资料；
- `Inference`：从证据推导，写明链条；
- `Hypothesis`：需要测试；
- `Unknown`：没有证据，不补故事。

旧文档只证明“曾经决定过”，不能证明今天仍正确。代码只证明“实现了”，不能证明用户价值。模型意见只算建议，不算用户证据。

## 5. 顺序与 founder gates

1. **Gate 0 · Ground truth**：完成 repo/production/capability/user-evidence inventory；不改产品。
2. **Gate 1 · Thesis**：Codex + verified Fable（不可用则 clean-room SOL Ultra）提交 thesis scorecard；founder 选产品心智或启动蓝图修宪。
3. **Gate 2 · One vertical promise**：只选一个可在短周期证明的完整用户结果；founder 批承诺与成功指标。
4. **Gate 3 · Experience**：先做 journey/原型/盲评，再定 UI；品牌/旗舰体验由 founder 定稿。
5. **Gate 4 · Architecture**：把获胜旅程映射到 expansion seams、capability handles、数据/风险；钱路/tenant/schema 由 founder 批。
6. **Gate 5 · Build and evidence**：小 PR 落地，生产与真实外部动作仍逐项受闸；结果回填 scorecard。

## 6. 第一轮交付，不先写代码

第一轮只产五件套：

1. 当前 capability truth matrix；
2. 现有核心旅程的 friction/断层地图；
3. 四个 thesis 的 10-star scorecard；
4. 一个 vertical proof 推荐与两个备选；
5. founder decision brief：保留、推翻、修宪或试验。

在 Gate 1 前，已批准的 L1 bug red test、安全凭据 inventory 等“不改变产品 thesis”的工作可继续；任何新大壳、整包 #203 合并或新 feature continent 暂停。

## 7. 成功标准

- 新用户能在无教学情况下完成第一次真实结果；
- 专业用户随时能看到、接管、修改与验证 Otto 的行动；
- UI 与 Otto 不产生两套 capability parity；
- 每个外部动作有授权、幂等、状态与 receipt；
- 产品范围由一条可复用原则控制，而不是无限工具清单；
- founder 得到少量高质量决定，不再被后台 session 与模型切换打断。
