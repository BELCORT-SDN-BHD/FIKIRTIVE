# 终局全城施工总令(ENDGAME-CITY-ORDER)

> **文件性质**:northstar-immersive **终局版本**的施工总令(华语,宪法 9)。founder 2026-07-09 拍板:**"以终为始,直接做一个全部版本的(包括 Wave B),包括真实图片,一次过走一轮。"**
> 效力:本文件 = 舰队每个 worker 的**总纲**;分区细节引用 `IMMERSIVE-COMPOSITION-BLUEPRINT.md` §五(逐区契约)与 `WHATPASS-V2-CANDIDATES.md`(Wave B 逐条);设计法 = `docs/design-system/design-rules.md`(v3)。冲突时:蓝图宪法 > 本总令 > 分区契约旧文。
> 本总令包含**三个新总设计决定(D1-D3)**,来自 2026-07-09 founder 发起的第一性原则重推(sidebar 收纳 + Otto history 之问)。这三条是**待 founder 走城验证的设计假设**,按"原型层默认全做、founder 用脚投票"方针先建后判。

## 〇、三个总设计决定(全城必须遵守)

### D1 容器模型:Campaign 是唯一的"事"容器;Studio 是自由创作台;不存在 Projects

- 老板脑子里只有三样东西:**"我在办的事"(Campaign)、"我随手做的东西"(Studio)、"我的员工"(Otto)**。设计只许这三个概念。
- **Campaign = 唯一的"事"容器**:为这件事发生的一切**自动**长在它身上 —— 对话切片、画布产物、帖子、广告、效果数据。Campaign 详情页 = 收纳本身。
- **Studio(创作台)= 画布的家**:不为任何事的随手创作都在这,零整理压力。任何 Studio 产物可**升格挂进 campaign**(一键,升格不是搬家;Otto 观察到关联时主动建议)。
- **废除**:导航里的 HISTORY 分组、Projects 树、任何第三种收纳容器。历史去处 = Otto 那条流(搜索)+ Campaign 容器 + Studio recents。

### D2 Otto = 一条连续对话流(零收纳、零线程管理)

- 心智模型 = **你和某个员工的 WhatsApp 单聊**:一条时间线,没有"多线程管理"这个概念。
- **dock(48px ⇄ 380×520)和 `/otto` 全屏页 = 同一条流的小窗/大窗**。不是两个对话,永远不是。
- 每条消息自动带**context chip**(发生在哪个区/哪个 campaign,如 `Merdeka` `Canvas` `Inbox`);点 chip 深链回那个现场。
- **Campaign 详情页的"对话"tab = 这条全局流按该 campaign 过滤后的视图** —— 同一条流,两种看法。找旧对话 = 去那件事的页面看,或全局流里搜。**永远不存在"这段对话该放哪"** —— 问题被设计消灭,不是被整理解决。
- store 层:单一 message stream(append-only,带 `context` 字段),废除多 thread 心智;`threadForContext` 语义改为"按 context 过滤同一条流"。

### D3 Research = 燃料,不是 campaign 的目的

- Campaign 一句话流程:**目标 →(引用资料库 research,缺了 Otto 现查)→ 提案 → 内容 → 排期/投放 → 效果回流下一次提案**。
- Research 产出(TrendSnapshot:趋势、受众洞察)进**资料库**(与品牌记忆并列的市场记忆),任何 campaign 引用,也可完全独立存在("这周什么在火"不必为任何事)。趋势页挂 Campaign 组之下,campaign 详情"资料"tab 引用它。

### 新导航 IA(immersive-nav.tsx 重排;路由**保持现有路径**,只改组织)

```
Brand(→ 首页)
[Create]  ← 唯一 INK 主按钮,→ Studio canvas
首页        /home
Studio      /create/canvas(组内:Canvas · Storyboard · Factory · Ideas · Create home)
Campaigns   /campaign/list(组内:Campaigns · Trends 资料库)
排期 Schedule /schedule/plan
收件箱 Inbox  /inbox/shared
客户 CRM     /crm/contacts
分析 Analytics /analytics/overview(组内:Overview · Reports · Ads)
资产 Assets   /assets/my-stuff(组内:My stuff · Library · Templates · Discover · Brand memory · Brand kit · Cast)
设置 Settings /account/settings(组内:Account · Credits · Connections · Wallet · Automation · Team)
――――
Balance 钉底(coral credit 币 + Top up)· Identity
```

- **零 HISTORY 分组**。左下角 Otto 入口 = dock(常驻),不入 nav。
- 导航状态系统不变(§N3:rest 透明/hover accent/active secondary,零 coral)。
- Campaign 详情页 tabs:**总览 · 日历 · 内容 · 投放 · 对话(过滤流)· 结果 · 资料(引用的 trends/brand)**。

## 一、世界圣经(mock universe 扩容 —— 让城"真实")

单一源不变:`components/northstar/_mock.ts`(Roti Bulan Bakery / Aisyah Rahman / Bangsar KL / MYR)。**扩容到"真店的密度"**:

1. **三个 campaign,三种状态**(走城时能看到全生命周期):
   - `Merdeka Week Bakes`(ACTIVE,进行中:部分已发有结果、部分排期中、2 条待批);
   - `Raya Open House 礼盒`(DONE,已完结:完整效果数据、复盘、learnings 喂给下一个);
   - `TikTok 新品 croffle 上市`(DRAFT,提案刚出:日历卡待批、预估总价)。
2. **联系人 20+**(马来/华/印裔真实感姓名混合、头像、渠道身份、lifecycle 阶段、consent/勿扰样例、来源 campaign);**deals 金额与 contacts.totalOrdersMyr 必须同源一致**(修掉已知漂移)。
3. **对话 12+**(WhatsApp/IG/FB 混合:在聊、Otto 接管中、已解决、超时未答、公开评论、CTWA 广告进线带来源),消息含**图片消息**样例。
4. **排期帖 30 天密度**(已发 12+ / SCHEDULED 8+ / DRAFT 5+,逐平台变体、first comment、防双发样例)。
5. **资产/生成历史 40+ 条**(图/视频/分镜/工厂批次,含失败可重试样例),**每条带真实图片**。
6. **TrendSnapshot 6+**(Merdeka 烘焙趋势、KL 咖啡店 TikTok 趋势等,带来源引用与日期、关联 campaign)。
7. **Otto 全局流历史 60+ 条消息**(跨三周:campaign 策划、canvas 生成、inbox 接管、分析解读、审批请求…每条带 context chip 数据;这条流是 D2 的血)。
8. **credit ledger、connections(5 渠道)、team 3 人、automation rules/routines、知识库** 全部同源、口径一致。

### 图片纪律(全城硬规则)

- **图源** = `images.unsplash.com`(热链,`?w=800&q=80` 参数);头像 = `i.pravatar.cc/150?img=N` 或 Unsplash 人像。**禁止编造 photo ID** —— 世界圣经里建一个 `NS_IMAGES` 目录(烘焙产品 24+ / 店景生活 12+ / campaign 主视觉 6+ / 人像 20+),**每条 URL 必须 `curl -sI` 验证 HTTP 200 后才入库**,验证记录写进 PR。
- 全城**只从 `NS_IMAGES` 取图**(同一家店的视觉一致性);零 placeholder 灰块、零 broken image。
- 用 `<img>`(原型层不走 next/image),必须带 alt 与固定宽高比容器(防布局跳动)。

## 二、分区施工令(每区一个 Opus worker;契约 = 蓝图 §五 该区 + WHATPASS 该区全量候选)

**通用要求(每个 worker)**:
- 读:本总令 → `IMMERSIVE-COMPOSITION-BLUEPRINT.md` 自己区的契约 → `WHATPASS-V2-CANDIDATES.md` 自己区的候选表 → `docs/design-system/design-rules.md` → `IMMERSIVE-STORE.md`。
- **Wave B 候选默认全做**;标注"太深奥"的做最轻原型(占位 UI/最小闭环);排除表永不做。每个做出来的候选在代码注释标 `[wave-b]` 一行(founder 走城投票的锚点)。
- 一切状态经 `_store.ts`(可 append 新 action,**只许文件尾追加**,注明区名);禁 fork useState 持有 mock 副本。
- GalleryFrame 套壳页一律**原生重建**(参照 native 样板:crm-contacts / account-settings / immersive-home)。
- 图片只从 `NS_IMAGES` 取;交互死胡同 = 缺陷(每个读面必须接回下一步动作)。
- coral 预算(非工作态 ≤6 处)、§F/§D/§8 全遵、`bash scripts/check-northstar-imports.sh` + `pnpm --filter web exec tsc --noEmit` 必绿后才 push。

| # | 区 | 范围 & 本令新增重点 |
|---|---|---|
| Z1 | 首页 + 全局 | 首页按 D1/D2 重排(招呼条、KPI、"进行中的事"= campaign 卡、Studio recents、Up next);全局搜索(范围加"Otto 流内搜");通知审批中心;legal 保持 |
| Z2 | Studio·画布心脏 | canvas 主场(GOAL 全表 + MagicPath 手感:双 rail 收编、对象手柄/谱系线/贴附工具条/Type to imagine/多选 Stitch/A-B 分叉/@Image N)、asset-viewer、media-editor;产物卡带"挂进 campaign"升格动作(D1) |
| Z3 | Studio·量产间 | create home(front door)、storyboard 四步、factory 出片间(风格卡/Hook 生成器/批量变体矩阵/总价确认形态)、ideas;+ WHATPASS 三章 26 条 |
| Z4 | Campaign 脊梁(旗舰) | list + **详情容器页(7 tabs,D1 的物理载体)**、workbench、proposal-card、calendar、pack-confirm、trends 资料库(D3);+ WHATPASS 五章 campaign 侧;三个 campaign 三状态全走通 |
| Z5 | 排期 | plan/calendar/queue/composer/share-preview;+ WHATPASS 四章 14 条(best-time 建议、逐平台预览、断链检查等);帖卡带 campaign 归组角标→深链回容器 |
| Z6 | 收件箱 + 生命周期 | 5 页 + WHATPASS 二章 **63 条全量**(WABA 模板库/Flow 表单/接管开关/人插手即停/溯源/未答清单/自愈知识库/CTWA 来源/群发+跟进/满意度/商品卡/收款链接/配方库…);这是 Wave B 最大区,完整体优先于速度 |
| Z7 | CRM | contacts/profile/segments/deals;+ WHATPASS 一章 31 条(CSV 导入向导、查重合并、自定义字段、lifecycle 阶段、热度标签、预测字段、大单提醒、报价收款链接、活动时间线、待办) |
| Z8 | 分析 + 广告 | overview(§D 金标准,**全城优先级最高的一页**)、reports(构建器+品牌化报告)、ads performance/builder/multi-platform;+ WHATPASS 六章 18 条 + 五章 ads 侧 |
| Z9 | 资产 | my-stuff/library/templates/discover/brand-memory/brand-kit/cast 七页原生;+ WHATPASS 七章 14 条(brand intelligence 校验、Soul-ID 式人设卡);Discover/Library 全真图瀑布流 |
| Z10 | 设置集群 | account/credits/top-up/connections/wallet + automation rules/routines + team members/approvals;+ WHATPASS 八章 21 条(Agency 楼层占位、审批工作台丝滑);两账道区分条 |

**Foundation(先行串行,Z 系全部依赖)**:
- F1 世界圣经:按 §一扩容 `_mock.ts` + `NS_IMAGES`(curl 验证)+ `_selectors.ts` 收敛跨区读 + 修金额/渠道漂移。
- F2 循环系统 + 壳:`_store.ts` 改单流模型(D2:message stream + context chips + 过滤 selector)、nav 新 IA(D1)、dock 重建(同流小窗;`/otto` 全屏大窗;§O3 dock 按路径隐藏)、kit 合并(蓝图 §3.1 全清单)。

**Integration(Z 系之后)**:跨区深链走通清单(蓝图 §四主动线逐条点击验证)、eventLog 全区着床、coral 预算全城 sweep、typecheck/fence/tests/build 四关全绿。

## 三、铁律(全程)

1. 只动原型目录(`apps/web/app/(northstar)/**`、`apps/web/components/northstar/**`)+ 本 docs;**零后台 import**(fence 脚本必过)。
2. 原型阶段只走缝 7;**永不碰钱路**(花费点只画确认闸形态)。
3. push 纪律:worktree 独立作业,`git pull --rebase` 重试 ×6 后 push 到 `claude/northstar-immersive`;永不推 main。
4. 发现与蓝图冲突 → 停手报告(蓝图赢)。
5. 质量基准 = Fable-5 grade:审计闸逐区打分,< A 重修。

## 修订记录

| 日期 | 修订 | 依据 |
|---|---|---|
| 2026-07-09 | v1 终局总令(D1-D3 + 世界圣经 + 图片纪律 + 分区令) | founder 2026-07-09 口令"以终为始直接做全部版本(含 Wave B + 真实图片)" |
