# Capability truth matrix — schema(D7 Gate 0)

> 基线:`origin/main@b5a48d0f`(2026-07-11)。行 = 一个用户可感的能力/承诺;列如下。
> 三种产品态分列:main 代码真相(`b5a48d0f`)/ production 用户真相(web deploy `7ed7ac22`,
> worker 服务 SHA 未知)/ staging 设计真相(`54c1de0b`,immersive 分支,非 main)。

## 列定义

| 列 | 含义 |
|---|---|
| `id` | 分片前缀 + 序号(E1-01 等) |
| `zone` | 蓝图区名(创作/资产/Otto/钱路/排期/广告/分析/市政厅/管网…) |
| `capability` | 人话名(founder 可读,不用内部代号) |
| `promise_source` | 这个承诺来自哪:蓝图章节 / 判决条目 / UI 按钮 / 文档(带指针);GRILL/harmony 类文档只证明「曾经决定过」 |
| `stage_main` | 七档阶梯对 main@b5a48d0f 的判定(取有证据的最高档) |
| `stage_prod` | 对 production 的判定(web=7ed7ac22;晚于它合并的一律 ≤integrated;worker SHA 未知则标 Unknown) |
| `gate` | 控制它的开关:env var / DB flag / 硬编码 / App Review 钥匙 / 无;注明 fail-closed 与否 |
| `evidence` | `文件:行` 指针列表,必须可复跑(git show / 测试名 / 命令) |
| `provenance` | Observed / Verified current source / Inference(写明链条)/ Hypothesis / Unknown |
| `gaps` | 断层观察:「UI 有按钮但闭环不成立」/「代码存在但用户到不了」/「合了 main 但 fail-closed」等,原始观察,不排序不评分 |

## 七档阶梯(判定标准)

1. `schema` — 只有 DB model/migration。
2. `UI shell` — 界面存在但无后端闭环(占位/Coming soon/死按钮)。
3. `implemented` — 代码路径完整(action/worker/queue)但用户入口不通或未接线。
4. `integrated` — main 代码里用户入口→后端→数据全链成立(以代码+测试为证)。
5. `staged` — 部署于 staging 且可用(需部署证据,repo worker 只能标 Unknown/待验)。
6. `production` — production 用户今天可达可用(以 prod SHA 与 flag 为证)。
7. `externally verified` — 有真实外部效果证据(真实发帖成功/真实付款/真实用户完成)。

Repo 侧 worker 最多判到第 4 档;5-7 档除非工单里给了部署事实,一律 `Unknown`。

## 证据规则(章程 §4)

结论五级标签必用;旧文档=「曾经决定过」;代码=「实现了」≠「用户价值成立」;模型意见不算证据。
