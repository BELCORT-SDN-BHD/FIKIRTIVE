# B9 引擎横切 · 引擎接口冻结 spec（v0.1 骨架——控制面规范性判断稿）

> 2026-07-12。epoch `claude-20260712-03`。性质：**冻契约不冻实现**——本 spec 冻结的是接口形状与语义，扫描器/实现行号可继续演进（B10 车道并行改扫描器不构成移动靶）。
> 状态：骨架（规范性判断=控制面亲笔）→ Heavy worker 填证据层（现状 file:line/TS 签名/测试枚举）→ 控制面终审 → 顾问 → **SOL 跨族复审后才 spec-ready**（D-015③）。
> 人话：给 Otto 的「发动机舱」定接口标准，后面每个块加新能力都插同一套插座，不许各拉各的线。

## 一、范围与矩阵行映射

B9 块（`docs/ops/route-b/matrix/09-B9.md`）21 行；本 spec 冻结其中的**六个契约**；明示排除：Otto 用户可感技能的产品语义（归各功能块）、市政厅（永久豁免）。

## 二、冻结对象（六契约）

### 契约 1 · Skill 注册表 + 分域装载（E2-19，缝 1 扩展）
- `defineOttoSkill` 现有三字段之上**新增 `domain` 字段**，闭集：`core / create / assets / schedule / ads-analytics / campaign / crm-inbox / account`（core 域常驻装载）。
- 装载协议：按 `viewContext.zone` + 确定性意图规则选域装载（宪法 10：确定性代码，不靠模型天赋路由）；回滚开关 env 一个（全静态挂载=现状）。
- 出生纪律：本 spec 冻结后，**任何块的新 skill 出生即带 domain**（缝 1 六处登记升七处）。
- 待 worker 填证：25 技能现状域划分表、每域前缀 token 估算（P0.5 Phase 2 spec 已有底，核对时效）。

### 契约 2 · 上下文桥（E2-20，宪法 7 第四层——代码零的宪法承诺）
- 形状（冻结）：`viewContext = { view: string, zone: Domain, selection: Array<{kind: "generation"|"node"|"post"|"campaign"|"contact"|…, id: string}>, activeJobId?: string }`。
- 注入点：每轮 system message 的 brandContext 同级新段；UI 端上报=页面挂载/选中变更时写入会话态（推送，非轮询）。
- 验收活体：「把这个改成 9:16」在 B3 第一个旅程里可解析（`selection[0]`）——B3 依赖此契约，是 B9 先行的主因。
- 待填证：buildContextSystemMessage 现状、OttoChatStream 注入链。

### 契约 3 · Parity 三态语义与债清偿协议（E2-15/16）
- 三态 `skill / exempt(四类闭集) / todoSkill` 语义冻结；**债只降不升**（棘轮），新增豁免类别=修宪。
- 随块清零协议：块验收=`parity-debt.md` 该块债全清（B0 已挂行）；基线文件唯一写权=控制面收口 PR。

### 契约 4 · TOOL_STEP_LABELS 一致性闸（修 H1 断层①）
- 冻结：registry ↔ TOOL_STEP_LABELS 机器一致性检查（新 skill 无 label = CI 红，fail-closed 替代现状 fail-open 静默）。
- 待填证：现缺 label 的 6 技能清单（MATRIX-V0 B 断层④）。

### 契约 5 · 读对等端口（B0-77/78 行族，宪法 7「读的对等」）
- 冻结：read-skill 一律 `cost:"free", effect:"read"`，走 ctx ports（缝 1），**skill 内禁直连 Prisma**；Otto 首页数据面（债 41-49,84）的端口清单。

### 契约 6 · live reflection 事件面（E2-21，宪法 11 v2.6）
- 冻结：后台完成→界面感知 ≤ 秒级；推送优先（SSE/事件总线）、短轮询兜底；「后台已完成而界面不知」按缺陷处理。canvas 侧 4s 轮询→推送化的接口约定（实现归 B3）。

## 三、对标锚清单（§六 水准判官格式）

| 锚 | 版本 | 关键旅程 | 通过阈值 |
|---|---|---|---|
| 宪法 7 四层结构保证 | v2.11 | 单一动作层/Parity/读对等/上下文桥 | 四层全部有机器闸或活体验证 |
| Higgsfield Supercomputer / Agentforce（对标地图·Otto 本体行） | 2026-07 | agent 操作全城而非一区 | 每功能块 Otto 话术全绿（B11 联验，sonnet 级——宪法 10） |
| 引擎效率（宪法 5 效率良心） | — | 每轮前缀 token | 分域装载后 core+单域 ≤ 待 worker 实测基线的 50%（数字随证据层定稿） |

## 四、假设台账

| 假设 | 依据 | 验证法 |
|---|---|---|
| 域闭集 8 项够用 | 宪章 12 区归并 | B8 设计需求单吸收后复核 |
| selection.kind 闭集可枚举 | A′ 65 页对象类型 | B3/B8 spec 对表 |
| campaignId 接线点属契约 5 端口 | 试产需求单（待吸收） | Campaign 设计 PR 返回后 v0.2 |

## 五、冻结条件与状态

- v0.1 骨架（本稿）→ worker 证据层 → v0.2 吸收 B8 试产「数据契约需求单」的引擎侧诉求 → 控制面终审 → **SOL 跨族复审（额度恢复后）** → spec-ready（矩阵 09-B9 相关行迁级随冻结 PR）。
- 開放问题：①domain 与 A′ 左轨导航 zone 是否 1:1（差异处谁迁就谁）②contextBridge 的隐私边界（selection 注入是否过滤跨租户引用——宪法 6）。
