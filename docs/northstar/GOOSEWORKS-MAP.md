# Gooseworks 方法论地图 —— 给 FIKIRTIVE 的弹药库

> 一页话给 founder:Gooseworks 那 125 个 GTM 技能里,**装它的壳(对外开放 API、白标、LinkedIn 爬取、
> Apollo 买人头)一律不碰**;值钱的是它每个技能里那套**方法论**——它怎么打分、要什么证据、
> 长成什么模板。我们十工具过堂全判「勉强」,病根是「界面数字漂亮、聪明那层是查表套话」。
> 这份地图把「病根」逐条对上 Gooseworks 里治它的那套方法,精确到可以照抄的 Phase / 打分公式 /
> 证据要求 / 输出模板,并配一段「抄进来后我们的产出长什么样」的示范(用 Aisyah 的 KL 面包店做例子)。
>
> **三条纪律(贯穿全文)**
> 1. 宪法硬排除永不复活:对外开放 API/MCP、白标、违 ToS 集成、PDPA 个人数据爬取(第四节点名)。
> 2. Meta Ad Library / Google Ads Transparency Center 是**官方公开的广告透明工具 = 合法公开数据**;
>    LinkedIn 爬取 / Apollo·Crustdata 买人头 = ToS 灰黑 + 个人数据,产品面永不碰。
> 3. 我们抄的是**方法**,不是它的实现:Gooseworks 用 Apify 爬公开库,我们可直连官方 API 或用商家自己
>    授权的账号数据。方法论无版权,爬取管线才有法律味。
>
> 目录:一、方法论弹药(对表十工具)· 二、产品功能候选(Wave B/C,founder 用脚投票)·
> 三、BELCORT 自用(founder 的 GTM)· 四、不碰清单。

---

## 一、方法论弹药 —— 逐条对上十工具的病根

> 排序按 EFFECTIVENESS-LEDGER 的「离及格线远近」。每个工具:**病根 →(抄哪个技能的哪段方法)→
> 我们升级成什么 → 示范产出**。示范里的数字是演示用(原型 mock),真数据接通前照这个骨架长。
> 规格文字华语,生成/prompt 保持英文,UI copy sentence case。

---

### 工具 1 · 客服草稿与 AI 接客(排最前:唯一藏「会砸招牌」硬伤)

**病根:** ①halal 认证草稿冒充认证、能被 auto-send;②裸子串匹配选错答案发错价;③三档语气是前后缀贴纸;
④翻译是两句写死的无关话。

**抄这几段方法:**

- **`disqualification-handling` 的「Email Hard Rules」+ 按类路由** —— 它的铁律是「no lies, no false
  claims, no jargon, one CTA max, no false urgency」,并且把每条 lead **按类别路由到不同处理**(REFERRAL /
  NURTURE / DECLINE / SPECIAL-FLAG),而不是硬答。抄它的**「有些问题不该答,该路由」**的骨架:
  含 `certified/认证/halal cert` 的意图 → 不生成营销式回答,直接路由到 escalation(交人)。
- **`inbound-lead-qualification` 的「先抽维度再判、unknown=澄清而非默认」** —— 它每条 lead 先抽
  {产品/意图/公司/角色} 维度再打分,并规定 **`unknown` 不当中性、更不当默认,而是降权 + 标记**;
  `>3 个维度 unknown → insufficient_data`。抄它治裸子串:**先抽实体(哪个产品 + 什么意图)再匹配;
  价格意图必须先命中产品才回该产品价;命中价格意图但无产品匹配 → 回澄清,绝不默认 pandan 蛋糕价。**
- **`sales-call-prep` 的「communication styles + 如何 adapt」** —— 它把语气分 data-driven /
  operational / relationship-oriented,每种给「how to adapt」的**真重写规则**,不是贴前后缀。抄它做三档语气:
  按语域**真重写同一句 core**(casual / neutral / formal),合并重复问候与 emoji,formal 档去掉冷冰冰的
  「Dear customer」。
- **`end-to-end-news-signal` 的「conference face-to-face test」伦理闸** —— 它规定敏感话题(裁员/数据泄露)
  自动化外发前先过「你敢不敢当面这样说」的闸。抄成客服的 **compliance 闸**:凡涉认证/法律/宗教声明,
  confidence 再高也不 auto-send,强制交人。

**升级成:**
1. **compliance 闸(先修,S)** —— knowledge 里加一条 `intent: certification`;命中 → 永不 auto-send、
   永不生成「没猪没酒 = halal」这类冒认证的话,路由到「Otto 建议交给老板回」+ 预填诚实草稿:
   「我们全程用 halal 备料,但目前**没有 JAKIM 官方认证**;要我帮你把这句照实回给客户吗?」
2. **匹配改「实体 + 意图」两步**(M)—— 抽 `{productId, intent}`,价格意图无产品匹配 → 回澄清。
3. **三档语气真重写**(M)—— 每条 KB 自带 casual/neutral/formal 三份写法,而非全局套壳。
4. **翻译绑 knowledge id**(M)—— 每条 KB 带一份马来版;真翻译落地前,按诚实原则先撤按钮。

**示范产出(客户问 "is your cake halal certified?"):**
```
意图识别: certification  → compliance 闸触发,不 auto-send
Otto 给老板的草稿(诚实版):
  "Thanks for checking! All our ingredients are halal-sourced and our kitchen
   has no pork or alcohol. We're not JAKIM-certified yet, so I want to be upfront
   about that. Happy to share our supplier list if that helps 🙏"
系统提示: 这条涉及认证声明,已交给你确认,不会自动发出。
```
对照旧版「everything is halal, no pork no alcohol」自动发出——这就是砸招牌与不砸招牌的差别。

---

### 工具 2 · CRM 分群与热度(排第二:一处「自相矛盾」当场碎信任)

**病根:** 最大批发户 RM3,120 被预测 RM0;热度理由死查表;唤回不按在险金额排;唤回按钮建空待办;
「静默」三套定义;人话建群够不到 heat/lifecycle;分群不显示值多少钱。

**抄这几段方法(这是全库和 CRM 最对味的三个技能,建议整套搬):**

- **`churn-risk-detector` 的加权信号引擎** —— 核心公式 `Risk Score = Σ(signal_weight × signal_present)`,
  权重 **Critical=25 / High=15 / Medium=8 / Low=3**,分档 **Red 70-100(act this week)/ Orange 40-69 /
  Yellow 20-39 / Green 0-19**,每档配**行动截止日**。信号表可直接本地化到面包店(verbatim 精神):
  「gone silent 30+ days = High」「competitor mention = High」「export/大额未复购 = Critical」。
  卡头必带一行钱:**「Total at-risk = RM X (Y% of book)」**。每个 save play 带 root-cause 假设 + 3 步动作
  + 一句**不露馅的话术**(铁律:绝不说「we noticed you might be leaving」)。
- **`expansion-signal-spotter` 的乘法排序** —— `Score = Signal Strength × Account Value × Timing`。
  **Account Value 2.0×(top-20%)/1.5×(mid)/1.0×**;**Timing 2.0×(本周)/1.5×(本月)/1.0×(>30 天)**。
  抄它治「唤回不按在险金额排」:让**最大值 × 最新触发**的客户浮到最顶,而不是按 id `slice(0,3)`。
- **`customer-win-back-sequencer` 的时间衰减 + 预填草稿** —— `Win-Back Score =
  (Change × Addressability × Value) / Time Decay`,衰减除数 **1.0(3-6 月甜区)/1.2(6-12)/1.5(12-18)/
  2.0(18+)**。它输出**预填好的多封序列**,不是空待办。抄它:唤回按钮直接吐一条**用真实字段拼的草稿**
  (金额/节律/渠道全带),店主改一句就能发。

**升级成(逐条打死 ledger 的 7 个 gap):**
- 热度理由从 `heatReason()` 死查表 → **现读现拼真实字段**:「她每周五订,已 8 单/RM640,这周五那单看着要来了——先备货」。
- `predictedNextMyr=0` → dormant 显示**复购潜力**(历史客单/上次金额 + 「距上次 39 天,已超正常节律」)。
- winBack `slice(0,3)` → **按 (lifetime × 近期贡献) 降序**,卡头「3 位静默中,合计 RM5,510 在险」。
- 空待办 → **预填草稿**。
- 三套 dormant 定义 → **一个阈值常量**(如 daysSince > 该客正常间隔 ×1.5),三处共用。
- 建群编译器加词:hot/warm/cold→heat、new/regular/vip/dormant→lifecycle、at risk→churnRisk。
- 分群头加一行经营读数「生涯 RM9,400 / 预计下次 RM1,300」,列表按群价值轻排序。

**示范产出(唤回卡):**
```
⚠️ Needs win-back — 3 dormant, RM5,510 at risk

1. Muthu · wholesale · lifetime RM3,120 / 18 orders · silent 39 days (usual cadence 21d)
   Why now: your biggest buyer, 60 boxes/week, silent past his normal rhythm.
   [Draft ready] "Hi Muthu! Your Tuesday delivery slot is open again this week —
   want me to pencil in your usual 60 boxes? 🥐"

2. Firdaus · RM2,260 · silent 23 days   3. Ethan · RM130 (walk-in, low priority)
```
对照旧版「Muthu 预计下次 RM0 + 空白待办 Win back Muthu」。

---

### 工具 3 · Hook 生成器与工厂量产(排第三:换个产品就露馅的假象)

**病根:** `generateHooks()` 无视 productId,任何产品吐同一批 5 条(默认恰好对上 RM68 礼盒);
hook 不标角度不教策略;变体矩阵不接信号;风格卡是灰块;「变体」只是同图换裁切。

**抄这几段方法:**

- **`ad-angle-miner` 的角度银行 + 打分 + 证据** —— 这是 Hook 工厂该长成的样子。它的**角度分类表**带
  「Ad Power」:Pain(High)/ Outcome(High)/ Identity(Med)/ Fear(Med)/ **Competitive displacement
  (Very high)**/ Social proof(High)/ Contrast(High)。每条角度带 **打分**(Evidence 30% /
  Emotional 25% / Differentiation 20% / ICP 15% / Freshness 10%,满分 100,Tier 1 = 70+),
  并带 **proof quotes + source count + emotional register + recommended format**。核心原则可直接贴产品文案:
  **「最好的 hook 不是脑暴出来的,是从真人已经在说的话里挖出来的」**。
- **`trending-ad-hook-spotter` 的三变体公式** —— 每个角度出 3 个变体:**Newsjack / Contrarian / Practical**,
  hook 公式 `[钩子] + [你独有的角度] + [绑当下的 CTA]`。抄它给「配对推荐」:**挑 1 条稀缺 + 1 条价值,别挑两条同角度。**
- **`content-repurposer` 的开头铁律** —— 「first line must hook without finishing the sentence」。

**升级成:**
- hook = f(品类/价位/卖点):礼盒走送礼/办公室/节日,单品走早餐场景/感官/日常稀缺(修「产品盲」)。
- 每条 hook 加**角度徽标 + 一行「为什么值得测」**:`[稀缺]「制造错过恐惧」`。
- 风格卡换 NS_IMAGES 真图 + 一行「适合什么」。
- 每条挂轻信号(接现有情报「POV 短视频是本月最强格式」),对高潜格子做视觉提示。

**示范产出(Aisyah 选 RM8.5 Kaya 可颂,点「为 Kaya 可颂生成」):**
```
Kaya croissant · RM8.50 · 早餐单品 → 角度组合:感官 + 日常稀缺 + 场景

[感官·Outcome]  "That first crack of a warm kaya croissant. 7am, fresh batch."
                → 为什么: 单品靠口感冲动,把「酥脆一瞬」放大。配特写视频。
[稀缺·Fear]     "We bake 40 kaya croissants a morning. They're gone by 9."
                → 为什么: 制造错过恐惧,单品也能有 FOMO。配空盘镜头。
[场景·Identity] "Your 8am pick-me-up before the Monday meeting."
                → 为什么: 绑上班族日常场景,把可颂变成一种习惯。
推荐配对: 挑 [稀缺] + [感官],别挑两条同角度。
```
对照旧版:任何产品都吐「RM68 feeds the whole office」。

---

### 工具 4 · Campaign 提案引擎(病根最典型:卖结果的引擎,产出零个下单指令)

**病根:** 全场没一条帖含 CTA/价格/下单路径;只报生成成本不预测结果;反哺循环说了没做;
是「帖子清单」不是「战役弧线」;调度智慧在 trend 库却没进产出。

**抄这几段方法:**

- **`campaign-brief-generator` 的消息架构 + 「What We're NOT Doing」** —— 它的 Phase:Channel Strategy(封顶
  2-4 个渠道)→ **Messaging Architecture(3 条核心消息:Primary / Secondary-A proof / Secondary-B contrast,
  每条 = claim + Evidence 证据点 + ICP 段 + 渠道匹配)**→ Content Calendar(带 working title)→
  Success Metrics(**按漏斗阶段的 KPI + 一个 north star**)。抄它的**「每条消息必带一个 Evidence 证据点」**——
  这就是把「氛围标题」升级成「有主张 + 有凭据」的钥匙。还有它独有的 **「What We're NOT Doing」** scope 护栏。
- **`feature-launch-playbook` 的 positioning block + outcome hook** —— headline 铁律「**outcome-driven, not
  feature-driven**」(带 bad/good 例子);proof point = 指标或 before/after;email 给 **3 个 A/B 主题**
  (outcome / curiosity / direct)。positioning block = headline + subhead + **proof** + **CTA**——正是我们缺的那截。
- **漏斗角色标注(来自 ledger 自己 + `launch-positioning-builder` 的 Where-to-Deploy 表)** —— 每条 entry
  加 role 标签:**Launch / Proof / Urgency / Close**,让 7 条帖成一条弧线而非模板填空。
- **预测结果的手法借 `churn-risk-detector` 的「派生系数 + 一个硬数字」** —— 提案卡加一行「预期产出」,
  用**上期系数**派生一个带前提的预测(不是拍脑袋)。

**升级成:**
- 每条 hook 升级成**「钩子 + 机制」两段**,至少 2 条带明价与截单动作;hook 旁加 caption/CTA 草稿。
- 提案卡加**「预期产出」**行:用上期 Raya 表现派生。
- learnings **逐条落到 entries**(补一条 FB B2B 帖兑现「Facebook drove corporate bulk orders」)。
- 每条加 **role 标签**(Launch/Proof/Urgency/Close)+ 建议时段(9–10am 有理由)。

**示范产出(Merdeka 礼盒战役,7 条帖的其中 3 条):**
```
Goal: 100 pre-orders. Expected output: ~90-110 pre-orders (按你 Raya 系数
      320 credits → 约 100 单,前提是 3 条视频有 2 条跑起来).

ce-01 [Launch · post Sat 9am]  Hook: "Merdeka box is back — and this year it's bigger."
      Mechanism: "RM68, DM or bio link to order. First 40 boxes only."
ce-03 [Proof · post Tue 9am]   Hook: unboxing reel (learnings: reels beat flat lays)
      Mechanism: "Watch the reveal → link in bio."
ce-05 [Urgency · post Thu 9am] Hook: "18 boxes left. Cut-off is Aug 30."
      Mechanism: on-screen price RM68 + countdown (trend ts-02: works best with on-screen price)
+ ce-07 [Close, B2B] "Corporate Merdeka gifting? WhatsApp us for 10+ boxes." (兑现漏掉的 FB learning)
```
对照旧版:7 条氛围标题,零下单指令,只报「Estimated total: 320 credits」。

---

### 工具 5 · 报表与周报人话(温度到位,但报的全是虚荣数还专挑好数字说)

**病根:** 全是平台虚荣指标零订单零营收;专挑好数字把下滑 4% 点击包装成「没事」;创意归因写死 4 行;
广告块只按 CTR 排、只显示花费。

**抄这几段方法(报表类是全库最系统的一块,三个技能共用一套骨架,直接搬):**

- **`periodic-sales-performance-review` / `pipeline-review` 的「两层报告 + 三件套」** —— 每份报告都是
  **60 秒 exec summary 叠在 detailed diagnostic 上**,exec 顶部永远是三件套:**Red Flags / Green Lights /
  Top 3 Actions**。铁律:**每条建议都强制配「触发它的那个数据点 + expected impact + owner」**;并且有一张
  **pattern→prescription 表**(「qual <40% → 收紧 ICP」)。反虚荣铁律 verbatim 精神:
  **「40 meetings means nothing at 15% qualification」**——正对我们「reach +18% 但 clicks −4% 却说没事」。
- **`sales-performance-review` 的 effort-impact 2×2 + grade** —— 每个 initiative 打 **A-F grade**,
  再进 **Scale Up / Optimize / Maintain / Question(2 周内修不好就砍)** 四象限。抄它治广告块:
  **按回报排 + 给留/停建议**,而不是按 CTR 排只显示花费。
- **`sequence-performance` 的「读真回复、分清 copy vs targeting」** —— 「high open + low reply = copy 问题;
  >20% not-relevant = targeting 问题,重写文案救不了坏名单」+ 一个 **Kill List** 桶。抄它治周报:
  点出张力后**给出对症的下一步**,而不是笼统「no attention needed」。

**升级成:**
- **Results 块顶到最上**:「Orders 312 · 104% ▲」「Revenue RM9,360 ▲14%」;广告块显示回报「RM45 → RM380,8.4× 回本」。
- **点出张力 + 给动作**:「看的人多了(reach ▲18%),点进来反而少了(clicks −4%)——下一条 reel 加一句更清楚的『现在下单』」。
- 创意归因挂**她真实例子 + 样本量 + 诚实置信度**:「你的可颂翻面 reel vs 慢镜头菜单摇移,快开头赢了。基于 6 条内容,当趋势看别当铁律」。
- 广告块**按 ROI 排 + 留/停**:「Merdeka box RM45→18 单(RM380)· 继续」「Kopi tiramisu RM60→2 单(RM40)· 停,在亏钱」。

**示范产出(周报开头):**
```
This week — quick read:
🟢 Green lights: Revenue RM9,360 (▲14%), 312 boxes sold (104% of goal)
🔴 Red flags: link clicks −4% — fewer people are clicking through to order
🎯 Top 3 actions:
   1. Next reel: add a clearer "order now" line (clicks are the only sales predictor, and they softened)
   2. Pause "Kopi tiramisu" ad — RM60 spent, 2 orders, it's losing money
   3. Put more budget behind the Merdeka unboxing reel — RM45 → RM380, 8.4× return
```
对照旧版:「A good week… nothing else needs your attention」,对 −4% 只字不提。

---

### 工具 6 · 广告诊断与分析洞察(全城最扎实,但系统性绕开钱、缺最狠两个动作)

**病根:** 只讲 CTR/CPC 从不换算每单花多少/赚多少;动作永远只有「再造一条/换一版」;
cost-per-order 把咨询混进订单摊薄;英雄洞察不随视角走;基准值拍脑袋。

**抄这几段方法:**

- **`ad-campaign-analyzer` 的「钱 + 判决 + 显著性」** —— 它给每条广告一个 **verdict:Scale / Optimize /
  Pause**,把浪费量化成**一个硬钱数**「Total estimated waste: RM X (Y% of spend)」,浪费信号阈值 verbatim:
  **零转化(花了 >RM X,0 单)/ CPA > 3× target / CTR < 50% 均值**。显著性带样本门槛:**「100 clicks per
  variant for CTR, 30 conversions per variant for CPA」**,verdict 三选一「Statistically significant /
  Not enough data / Too close to call」。Action Plan 分 **Immediate / This Month / Next Month**。
- **`ad-spend-allocator` 的 Efficiency Index** —— `Efficiency Index = Conversion share ÷ Spend share`,
  **>1.0 = under-invested(该加预算)/ <1.0 = over-invested(该砍)**。这正是我们缺的「加预算/暂停」两个动作的判据。
- **`ad-to-landing-page-auditor` 的 message-match** —— 广告→落地页 6 维连续性打分,可轻量化成「广告 →
  下单路径」的一致性检查(广告说 RM68,帖里/DM 里有没有明价与下单动作)。

**升级成(逐条打死):**
- 每卡 evidence 顶部加一行钱:「RM3.60 per purchase · box sells RM68」;亏钱的 ad-08 → 「This ad is
  losing money — RM38 per purchase against a RM68 box」。
- **动作分档**:赢家主动作 =「Put more budget behind this」;亏钱输家主动作 =「Pause this ad(0 成本止血)」;
  覆盖 加预算/暂停/复制/重做 四种手。
- cost-per-order 分母**只数 purchases**(176 单 → RM7.30/单),messages 单列「Order enquiries: 38」。
- insight 跟 view 走:Owner 视角换成钱的英雄句「214 orders at RM6 each — cheapest since May」。
- 砍掉不可对标的 reach-growth 行,每行挂口径来源「Meta 官方 F&B 均值」。

**示范产出(诊断卡):**
```
ad-08 · "Kopi tiramisu promo"   Verdict: ⛔ PAUSE (losing money)
  RM76 spent → 2 purchases = RM38 per purchase, against a RM68 box.
  Efficiency index 0.3 (spends 12% of budget, drives 4% of orders).
  → Action: Pause this ad now. Zero cost, stops the bleed.

ad-01 · "Merdeka unboxing reel" Verdict: 🚀 SCALE
  RM310 → 86 purchases = RM3.60 per purchase. Cheapest converter this month.
  → Action: Put more budget behind this (efficiency index 2.1).
```
对照旧版:ad-08 只说「受众不对 → Rebuild」,赢家只说「Make 3 more」。

---

### 工具 7 · 趋势资料库(够本地能照做,但是「营销101摘要」不是「专属情报」)

**病根:** 量化断言没基准/样本/时间窗;一半来源自引黑箱;带动作的建议其实是通用最佳实践;
只有抓取日没有新鲜度/置信度;缺「洞察→动作」桥。

**抄这几段方法:**

- **`trending-ad-hook-spotter` 的证据句 + 衰减窗** —— 每个 trend 必带**engagement 信号**「X likes across
  Y platforms in Z hours」+ 一个**会衰减的 run-by 窗口**,urgency 分档「Run today(峰值 24-48h)/
  This week(3-5 天)/ Worth testing」。抄它把裸「2-3×」变成有 n、有基线、有日期的证据句。
- **`signal-scanner` 的 recency 衰减乘子** —— verbatim:**`<24h=1.5 / 1-3d=1.2 / 3-7d=1.0 / 1-2w=0.8 /
  2-4w=0.5`**。抄它给每条趋势一个新鲜度标(High/Watch/Cooling)。
- **`competitive-strategy-tracker` 的 append-only timeline + 「our interpretation」** —— 「单次扫描是快照,
  timeline 才看得出轨迹」;每条变动带**「对你的含义」**。抄它做「洞察→动作」桥。
- **`review-intelligence-digest` / `kol-content-monitor` 的证据纪律** —— 每条断言带 source + date +
  frequency count;**多源出现 = 更高置信**(kol 的 Convergence 信号:3+ 来源同周 = publish-now 触发)。

**升级成:**
- summary 改成**带基线 + 样本 + 日期**的证据句:「去年 Merdeka 追踪的 40 个 KL F&B 账号里,拆盒 reel
  收藏中位数 210 vs 平铺 68,3.1 倍(Google Trends · merdeka gift box MY · 8/1–8/31)」。
- 来源落到**可复核切片** + 自研来源给**方法脚注**(加 optional `method` 字段)。
- 每条加 **confidence(High/Watch/Cooling)+ freshness(「本月信号,开跑前 7 天复核」)**。
- 每条带一个**「本地 + 有反例、可反驳」的独家钩子**:「本月 KL 办公区 3pm 取餐 POV 完播 62% vs 门店空镜
  38%,但吉隆坡以外反而空镜赢」。
- 加 `appliedAs / nextMove` 字段,在 campaign 详情显示「这条趋势 → 计划里的动作」。

**示范产出(趋势卡):**
```
Merdeka gift-box reels · confidence: High · freshness: recheck by Aug 24
  Evidence: across 40 KL F&B accounts last Merdeka, unboxing reels saved 3.1×
            (median 210 vs 68 flat-lays). Source: our tracked-account panel + Google Trends MY.
  Local edge: 3pm office-pickup POV completes at 62% in KL CBD, but loses to
              storefront shots outside KL — don't blindly copy.
  → Applied as: pre-order window Aug 24–31, 3 unboxing reels front-loaded.
```
对照旧版:「outperform 2–3× on saves」(相对谁?样本多大?来源:Deep research)。

---

### 工具 8 · 排期建议与队列(管道扎实,但「建议」是冻结的默认表、永远不会变聪明)

**病根:** best-time 是写死行业默认表从不个人化;建议 chip 丢掉「日」只应用「时」;只在空日贴 chip 不审已排帖;
逐平台定制全是手动旋钮没大脑。

> 诚实说:全库没有一个技能是「从账号历史学最佳发帖时间」的现成方法——这块的**真智能要等后台接通真实
> postMetrics**(ledger 已定性为「等后台点亮」)。但有三段方法现在就能抄,把「演」做诚实:

**抄这几段方法:**

- **两态模型(借 `signal-scanner` 的 cold-start 精神 + ledger 自己的建议)** —— 冷启动态明确标注
  **「Still learning — using KL bakery averages」**;有数据后才切**派生自 postMetrics 的个人化建议**
  「Your last 4 Sunday 10am posts averaged 9.1K reach — 2.4× weekday」。别在 mock 里假装已个人化。
- **`content-repurposer` / `content-brief-factory` 的渠道原生规则** —— 每个平台的语气/长度/标签差异是**已知规则**
  (X 更短、TikTok 更随意、IG first comment 放标签)。抄它做**一键「Adapt for X/TikTok/IG」**:复用现有生成管线
  自动重写语气+长度,以 diff 呈现,替掉「Same as main caption」的空 placeholder。
- **`ad-campaign-analyzer` 的「建议带口径来源」** —— 每条 best-time 理由挂来源标签(「KL bakery averages」/
  「your own Sunday posts」),而不是「Sunday brunch browsing」这种任何城市都能贴的话。

**升级成:**
- best-time 分两态,冷启动标注来源;chip 显示「Sat 9am」并**同时 set 日期 + 时间**(修只应用「时」的 bug)。
- 对**偏离窗口的已排帖**给行内提示 +一键改期(movePostDate 已存在):「This IG post is set for 2pm;
  best Saturday window is 9am. Move it?」
- 每个平台 tab 加一键「Adapt for X/TikTok/IG」。
- 防双发标签人话化:「Sent once only — even if it had to retry.」

**示范产出:**
```
Best time to post (Still learning — using KL bakery averages)
  🟢 Sat 9–10am · reason: KL bakery weekend browsing peak [source: category avg]
  ⚠️ Your IG post is scheduled Tue 2pm — outside every recommended window. [Move to Sat 9am?]
  [Adapt this caption for TikTok] → shorter, more casual, trending-sound cue (shown as diff)
```

---

### 工具 9 · 首页信息架构(最接近过关,但首屏答错老板开门最想问的两件事)

**病根:** 顶栏 KPI 零营收零订单、唯一 MYR 是「你花的钱」;第一屏完全没有「谁在等我回」;
credit balance 易被误读成营收;「3 running」把没批草稿也算进;唯一洞察仍以 reach 为锚。

**抄这几段方法:**

- **`inbound-lead-triage` 的 urgency 分档 + 「谁先回」队列** —— 它按**「Respond NOW <1h / TODAY <4h /
  <24h / nurture」**把杂乱收件箱排成 SLA 桶,每条附推荐动作 + 预填草稿。抄它做首页**「Needs you」triage 带**:
  按 **金额 × 等待时长** 排,每行深链到对话/联系人。
- **`churn-risk-detector` 的「一个硬钱数」头** —— 「Total at-risk = RM X」。抄它:triage 带头显示
  「回一句就变钱」的总量。
- **`periodic-sales-performance-review` 的 Team Snapshot(this vs prior + change)** —— 抄成营收 KPI 卡带 delta。
- **三件套 Red Flags / Green Lights / Top 3 Actions** —— 首屏洞察落到生意结果,不锚 reach。

**升级成:**
- 第一张卡改**营收**:「Orders this week · RM2,180 · ▲ 6 位客户下单」;reach 降为第二卡说人话「68.4K 人看到 · 约 40 条询问」。
- campaign 上方加**「Needs you」triage 带**,3 行按 金额×等待 排,深链收件箱/联系人。
- credit balance 明确标「FIKIRTIVE credits · 1,240」并降到次要。
- running 只数 `status===ACTIVE`:「2 running · 1 draft」。
- 洞察落到生意:「Your Sunday croissant reels pulled the most order DMs — line up two more?」

**示范产出(首屏顶部):**
```
Orders this week          Reach                    FIKIRTIVE credits
RM2,180  ▲ 3 more orders  68.4K seen · ~40 DMs     1,240 (top up)

⚡ Needs you — reply and it turns into money (RM3,620 waiting)
  • RM300 meeting-room breakfast — waiting 22 min      → [Reply]
  • Halal question from a customer — waiting 1 hr       → [Reply, routed for your OK]
  • Muthu (RM3,120 wholesaler) — silent 6 weeks          → [Win back]
```
对照旧版:三卡里唯一 MYR 是「Credit balance 1,240 MYR」,收件箱一条不露。

---

### 工具 10 · 自动化配方库(信任四件套是真功夫,但产出不记结果、且不是真的「库」)

**病根:** run 历史只记「干了什么」不记「赚了什么」;叫「库」实际是 3+3 预设死 + 空白表单;
「读数据→起草」没有数字到动作的连线;Otto 建议一条商家已有的规则;最有牙齿的配方默认关着没人推销。

**抄这几段方法(这是全库对「配方库」最关键的三个,建议做成架构):**

- **`client-onboarding` 的 `<!-- execution -->` 配方 schema** —— 全库最值钱的一个结构:每条策略挂一个
  **机器可读的 YAML 标签**,字段 verbatim:`pattern` / `signal_type` / `signal_keywords` / `target_titles` /
  **`estimated_leads`** / **`estimated_cost`** / `skills_required`。`pattern` 是枚举:`signal-outbound` /
  `content-lead-gen` / `competitive-displacement` / `event-prospecting` / **`lifecycle-timing`** / `manual`。
  这就是把「一条打法」变成**可安装、可路由、带成本/产出预估的配方**——正是「配方库」名副其实的地基。
- **`client-packet-engine` 的执行路由 + 成本闸 + dry-run** —— 它读 `pattern` 标签查到 skill-chain,
  在**「pitch-packet 沙盒模式(不真发、不付费)」**里跑,带**硬成本上限**(默认 $5/家,80% 预警,
  单次调用 >$2 暂停)。这套「路由 + 沙盒 + 花费闸」正好嫁接我们已有的信任四件套(花费闸/急停/范围/历史)。
- **`competitor-monitoring-system` / `signal-detection-pipeline` 的 per-channel cadence 表** —— 每条配方 =
  一个**带频率的定时任务**(weekly/bi-weekly/monthly)+「看什么」。抄它把配方做成有节律的循环,不是一次性动作。
- **`churn-risk-detector` / `signal-scanner` 的 outcome 字段** —— run/rule 加 `outcome` + `spent` 并排:
  「Posted the kaya-croissant story · 8 credits → 340 views, 12 DMs, 3 pickup orders」。

**升级成:**
- run/规则加 **outcome 字段**并排 spent(activity log → outcome log)。
- 做成**真目录**:一排按结果分类的可安装配方卡,每张标「同类店铺成效」,点卡即预填向导。四条面包店真配方:
  **①找回没付订金的预订(lifecycle-timing)②老客回流(win-back)③节庆开订 + waitlist(campaign)
  ④缺货补货提醒(sold-out→waitlist)**——正好对上上面四个技能的方法。
- 「读数据→起草」把洞察带进动作:「Read last week: Tue reels pulled 3× the DMs, durian sold out by noon.
  So I front-loaded 2 reels Tue/Thu and opened durian pre-orders Monday.」
- Otto 建议一条**她没有、从真实行为长出来的**规则。
- 最聪明那条(sold-out follow up)**默认亮起 + Recommended 标 + 结果导向推销**:「Turns a sold-out post into
  a pre-order list — shops using this recover ~1 in 5 lost buyers」。

**示范产出(配方卡 + run 记录):**
```
📦 Recipe: Sold-out → waitlist          [Recommended] · shops recover ~1 in 5 lost buyers
   When a product sells out, auto-reply to new askers with a pre-order waitlist.
   Trust: spend-capped · emergency stop · scope = this account · full history
   [Install]  est. cost 4 credits/run · est. outcome ~1 in 5 buyers recovered

   Last run · 8 credits → outcome: 340 views · 12 DMs · 3 pickup orders recovered
```
对照旧版:「Posted the kaya-croissant story, flagged 2 chats」(纯活动流水)+ 空白表单。

---

### 本节小结:哪些是「加字段 + 换 mock」,哪些是「真架构」

给 Wave C 排期用:

| 病根性质 | 抄法 | 工作量 |
|---|---|---|
| CRM 分群、报表、广告诊断、Campaign、Hook 的「聪明层」 | 加打分公式/证据字段 + 换专业级 mock,基本不动交互 | 内容工程可并行,风险低 |
| 客服 compliance 闸 + 实体匹配 | 加一条 gate + 匹配改两步,正确性改动 | 小,最紧急 |
| 首页营收 KPI + Needs-you triage 带 | 数据已在库里(CRM totalOrdersMyr、waiting-owner 线程),重排 + 深链 | 中,投产比最高 |
| 自动化「配方库」+ outcome 字段 | 做成 `<!-- execution -->` schema + 执行路由 + 沙盒/花费闸 + 真目录 | 大(L),单独立项 |
| 排期个人化、广告真回报 | 冷启动态现在做诚实;个人化态等后台真数据 | 分两步,别提前造管线 |

---

## 二、产品功能候选 —— Wave B/C 追加,founder 用脚投票

> 从目录里挖出**适合 SEA 中小商家、合法合宪**的新功能点子。每条:人话名 / 一句实用性 / 原型层做法 /
> 合法性注记 / 落哪个区。排序按「对 Aisyah 这类商家的即时价值」。

### B1 · 同行广告透视(Competitor Ad X-ray)⭐ 最强候选
- **一句话:** 商家输入对手店名,就看到对手此刻在 FB/IG 投的**真广告**(文案、图、跑了多久、花费/触达区间)。
- **原型做法:** 抄 `ad-creative-intelligence` + `competitor-ad-teardown` 的方法——按 **hook 类型聚类**
  (Fear/Outcome/Question/Social-proof/Contrarian),**用广告「跑了多久」当赢家信号**(长跑 = 验证过的赢家),
  找出「对手都没打的角度 = 你的白空间」。数据源:**Meta Ad Library + Google Ads Transparency Center 官方公开 API**。
- **合法性:** ✅ 官方公开广告透明工具 = 合法公开数据(欧盟《DSA》强制、Meta/Google 自建)。直连官方 API,
  不用 Gooseworks 那层 Apify 爬取。**不碰任何个人数据。**
- **落区:** 广告诊断区旁开一块「同行在投什么」,或趋势库。

### B2 · Review 智能消化 → 品牌记忆(Voice-of-Customer mine)
- **一句话:** 把商家自己和对手的公开评价嚼碎,吐出「客户原话证据 + 痛点词 + 异议地图 + 对手弱点」,喂给品牌记忆和文案。
- **原型做法:** 抄 `review-intelligence-digest` 的 **5 个分析镜头**(Proof Points 带数字的最高价值 / Pain
  Language / Objection Map 带频次 / 竞品置换信号 / 买家用词),每条带 verbatim 引用 + 角色 + 日期。
  **SEA 适配:** G2/Capterra 换成 **Google Business 评价、Shopee/Lazada 评价、Facebook 评价**。
- **合法性:** ✅ 公开评价内容(商家自己的 + 对手的)。用官方评价 API 或商家授权账号,不碰个人档案。
- **落区:** CRM「客户之声」子区 / 客服 KB 自动补料 / Hook 工厂的角度来源。

### B3 · AEO 可见度(被 AI 助手推荐了吗?)⭐ 净新、最有前瞻性
- **一句话:** 顾客越来越问 ChatGPT/Perplexity「KL 最好的 kaya croissant 在哪」——这功能测**你的店有没有被 AI 推荐**,
  并告诉你怎么被推荐。
- **原型做法:** 抄 `aeo` 全套方法:①自动生成 ~50 条「买家会问 AI 的问题」(从商家描述派生,人可编辑);
  ②把每条打给多个 AI 引擎;③打分 **mention rate / prominence / share-of-voice vs 对手**;④网站按 **6 维**
  (Positioning Clarity / Structured Content / Query Alignment / Technical Signals / Content Depth /
  Comparison Content)评「AI 可读性」/10;⑤给修法(加 FAQ、做对比页、改首页首句)。
- **合法性:** ✅ 只查 AI 引擎 + 爬商家**自己**的网站。零个人数据、零对外爬取。成本见第三节(要 API key)。
- **落区:** 趋势库旁 / 首页新增「AI 可见度」卡。这是 SEA 发现渠道从 Google 转向 AI 答案的对冲,值得 founder 重点看。

### B4 · 品牌记忆(Brand memory:语气 + 视觉一次提取,永久喂生成)⭐ 治本
- **一句话:** 让商家一次性从自己的网站/IG 提取品牌语气(do/don't、爱用词/忌用词)和视觉(颜色/字体),
  之后**每一次 Hook/Campaign 生成都自动对上品牌**,不再吐通用句。
- **原型做法:** 抄 `brand-voice-extractor`(6 维语气 + Do/Don't 块 + 爱用/忌用词表)+ `visual-brand-extractor`
  (色源优先级:CSS var→theme-color→显式 CSS→Tailwind;吐一个 `{primary_color, accent_color, font_heading,
  font_body, logo_url...}` JSON)。二者**免费**跑在商家自己的页面上,吐一个持久「品牌记忆」对象,
  `content-asset-creator` 直接消费同一个 JSON——**提取一次,永久按品牌生成**。
- **合法性:** ✅ 读商家自己的站,零第三方爬取、零个人数据。
- **落区:** 作为地基喂 Hook 工厂 + Campaign(直接治「产品盲/通用句」病根)。建议 Wave C 优先,ROI 高。

### B5 · 同行内容雷达(Competitor content radar,去掉 LinkedIn)
- **一句话:** 每周告诉商家「对手这周发了什么、哪些主题你没覆盖」。
- **原型做法:** 抄 `competitor-content-tracker` 的**内容缺口表**(主题 × 谁在讲 × 你在讲),但**只用 blog/RSS +
  公开 FB/IG 页**,**砍掉它的 LinkedIn profile 爬取**。用 `blog-scraper` 的 RSS 自动发现(免费无 key)。
- **合法性:** ✅ 去掉 LinkedIn 后干净(RSS 是出版方主动 syndicate 的公开内容)。
- **落区:** 趋势库。

### B6 · 对比页 / AI 答案抢占器(Comparison & snippet builder)
- **一句话:** 为「X vs Y」「best X in KL」这类查询,自动生成能抢占 Google 精选摘要**和** AI 引用的对比/FAQ 页。
- **原型做法:** 抄 `serp-feature-sniper`(按摘要类型逆向 Google 奖励的确切格式:段落 40-60 词 / 列表 5-8 项 /
  表格;winnability 主要看**现任持有者的弱点**)+ `content-brief-factory`(用真实客户用词定义「对手漏掉的 gap」)。
  与 B3(AEO)联动:AEO 找出缺口 → 这个功能补页。
- **合法性:** ✅ 公开 SERP + 商家自己的页。
- **落区:** 首页 IA / 内容工程。

### B7 · 客户之声合成(Voice of Customer synthesizer)
- **一句话:** 把 WhatsApp/DM/评价里的零散反馈聚成排好序的主题,告诉你「客户最想要什么、什么在赶客」。
- **原型做法:** 抄 `voice-of-customer-synthesizer` 的**「3+ 客户 OR 3+ 来源才算一个主题」**阈值(无需 embedding
  的可解释聚类)、4 级情感(Positive/Neutral/Negative/Critical-churn)、每主题带频次 + 3 条 verbatim 引用 +
  归属 owner。**多源印证 = 最高置信。**
- **合法性:** ✅ 商家自己的对话/评价数据(授权)。
- **落区:** CRM / 报表。

### B8 · 竞品定价/菜单监测(Pricing & menu watch)
- **一句话:** 对手把礼盒从 RM68 改到 RM75、上了新套餐,你第一时间知道。
- **原型做法:** 抄 `competitive-pricing-intel`(变动严重度表:改价=High、改计价模式=Critical;用**真实 ICP 场景的
  有效价**而非标价定位)+ `web-archive-scraper`(**Wayback 当免费的变动侦测基线**,keyless)。
- **合法性:** ✅ 公开定价页 + 公共 Wayback 存档(Internet Archive 官方 API)。零个人数据。
- **落区:** 趋势库 / CRM 竞品子区。

### B9 · 客户故事生成(Customer story builder)
- **一句话:** 一条满意的 WhatsApp 好评 → 一篇案例 + 社媒短文 + 数据卡,一键成型。
- **原型做法:** 抄 `customer-story-builder` 的 **Problem→Decision→Solution→Result** 骨架 + Hero/Problem/
  Result/Recommendation 引用分类 + **specificity 闸**(拒绝「improved results」这类空话,要「3× pipeline」)+
  **permission 闸**(发布前标记需客户同意)。
- **合法性:** ✅ 商家自己的客户数据 + 明确的同意闸。
- **落区:** 内容工程 / Campaign。

### B10 · 本地 newsletter 赞助发现(SEA 版,成长型商家用)
- **一句话:** 帮商家找到目标客户在读的本地 newsletter/社群,按契合度和 CPM 排序该赞助谁。
- **原型做法:** 抄 `sponsored-newsletter-finder` 的 **5×5 打分(/25)+ 硬性 shortlist 门槛 + 按订阅量分档的 CPM
  基准 + 「对手已赞助 = 已验证契合」**。对 Aisyah 这类小店优先级低,对成长型 SMB 有用。
- **合法性:** ✅ 基于公开 web search 的发现,不碰个人数据。
- **落区:** 排期 / Campaign(渠道拓展)。

---

## 三、BELCORT 自用 —— founder 推广 FIKIRTIVE 时立即能用

> 这些是 founder **自己的 GTM**(不是产品功能)。凡涉第三方 API key 与真实付费,**一律标「要花钱,须 founder
> 逐笔点头」**(宪法 2:开发/验证期每一笔真实付费调用都要 founder 明确 per-spend 确认;delegated「你决定」不覆盖具体开支)。

### C1 · 竞品追踪(origami / plane / arcads 等 AI 营销工具对手)
- **能用什么:** `competitor-monitoring-system`(playbook)的 **per-channel cadence 表**——blog 周更、社媒周更、
  广告双周、评价月度、季度重跑基线;`competitor-ad-teardown` 逆向它们的付费漏斗 + 推断预算集中度 + 找脆弱点 → 反打;
  `competitive-strategy-tracker` 的 **append-only timeline**(看对手是在加速逼近还是远离你的定位)。
- **数据源 / key:** Meta Ad Library + Google Ads Transparency(**官方 API 免费**)+ 评价 API + RSS(免费)。
  若走 Gooseworks 原装 Apify 爬取:**要 `APIFY_API_TOKEN`,约 $5/1,000 条广告** → **要花钱,须逐笔点头**;
  直连官方 API 可省这笔。
- **成本档:** 官方 API 路线 ≈ $0;Apify 路线 ≈ 每次扫 $1-3。

### C2 · AEO 可见度监测(FIKIRTIVE 被 AI 助手推荐了吗)⭐
- **能用什么:** `aeo` 全套——生成 50 条「SEA 小商家会问 AI 的问题」(如「best AI marketing tool for a small
  shop in Malaysia」),打给多个引擎,盯 mention rate / share-of-voice vs origami/plane/arcads,按 6 维审自己的官网。
- **数据源 / key:** **要 OpenAI key(生成+分析必需)+ Perplexity/Gemini/Grok key(被监测引擎)**;Firecrawl 爬自己站。
- **成本档:** **约 $2-5/次运行(50 问 × 3 引擎)。要花钱,须 founder 逐笔点头。** 建议低频(月度)跑。

### C3 · SEO 内容引擎(FIKIRTIVE 自己的自然流量)
- **能用什么:** `seo-content-engine`(playbook)的链路:audit → 缺口(按 **search volume × commercial intent ×
  difficulty** 排)→ 按漏斗 TOFU/MOFU/BOFU 建关键词架构 → 日历 → 起草(套 brand-voice)→ 内链 → 发布监测;
  `content-brief-factory`(每篇 brief = 竞品拆解 + 客户用词 gap,不是关键词密度表);`programmatic-seo-planner`
  (5 因子加权 0-100 选 pSEO 模式);`topical-authority-mapper`(pillar-cluster 内链矩阵)。
- **数据源 / key 两档:**
  - **免费档:** `seo-traffic-analyzer` **纯 WebSearch/WebFetch,零 key、零成本**(适合起步)。
  - **付费档:** `seo-domain-analyzer` 走 Apify 爬 Semrush/Ahrefs 公开页,**要 `APIFY_API_TOKEN`,约
    $0.50-3/次(含 3 个对手)** → **要花钱,须逐笔点头。**
- **成本档:** 免费档 $0;付费档每次 $0.5-3。建议先用免费档跑通,要更硬的数字再上付费。

### C4 · 竞品广告创意情报 + 置换角度
- **能用什么:** `ad-creative-intelligence`(对手 hook 分布 + 长跑广告 = 赢家)+ `review-intelligence-digest`
  跑对手的 G2/Capterra 评价,挖**竞品置换角度**(他们 1-2 星差评 = 你的攻击点)。
- **数据源 / key:** Meta/Google 官方广告透明工具(免费)+ 评价 API 或 Apify(付费档 → 逐笔点头)。
- **成本档:** ≈ C1。

### C5 · 定位 + 战役文案(纯推理,零成本)
- **能用什么:** `launch-positioning-builder`(April Dunford 填空式定位声明 + Where-to-Deploy 表)、
  `campaign-brief-generator`(3 核心消息 + What-We're-NOT-Doing 护栏)、`feature-launch-playbook`
  (按 Tier 1/2/3 缩放发布物料)、`email-drafting`(PAS/BAB/AIDA 框架库 + 主题模式)、
  `messaging-ab-tester` 的**变体生成方法**(测不同角度而非改词)。
- **数据源 / key:** **纯推理,零 API、零成本。** 注意:`messaging-ab-tester` 的**投放/部署环节**若走
  LinkedIn/cold-email 就落进第四节禁区——**只用它的变体生成方法,别用它的 LinkedIn/邮件外发管线。**
- **成本档:** $0。可立即用。

> **BELCORT 用 vs 产品用的红线:** 第四节的 LinkedIn 爬取 / Apollo 买人头 / cold-email 外发,**BELCORT 自己
> 也不该用**(PDPA + ToS 同样适用于 founder)。上面 C1-C5 全部避开了这些,只用官方公开数据、商家自己的站、
> 或纯推理。若 founder 想做 outbound,用第四节里标了「reusable 合法方法论」的那几个(email-drafting 的框架、
> icp-persona-builder 的画像 schema),配**商家自己合法获取**的联系人,别碰爬取管线。

---

## 四、不碰清单 —— 因 ToS/PDPA/宪法排除,永不进产品

> 一句理由制。分四组。**注意:有几个技能「爬取脏、但内含一段合法方法论」**,标 ⚠️——那段方法可供 BELCORT
> 内部参考或未来配合法数据源,但**爬取管线本身永不进产品、founder 也不该跑**。

### 4A · LinkedIn 个人数据爬取(硬红线 —— PDPA 个人数据 + LinkedIn ToS)
| 技能 | 一句理由 |
|---|---|
| `linkedin-commenter-extractor` | 爬指定帖下评论者的姓名/职位/主页 = 未经同意的 PII 采集 |
| `linkedin-influencer-discovery` | 从 360 万人预索引库批量拉 PII(含邮箱) |
| `linkedin-post-research` | Crustdata 拉 LinkedIn 帖 + 作者 PII |
| `linkedin-profile-post-scraper` | 监控具名个人的 LinkedIn 动态 |
| `linkedin-job-scraper` | 非个人数据但违 LinkedIn 反爬 ToS |
| `champion-tracker` | 反复 enrich 具名个人的 LinkedIn 档案 ⚠️(内含 0-4 ICP 契合打分,方法可参考) |
| `kol-engager-icp` | 批量爬 KOL 帖下互动者 PII + enrich |
| `pain-language-engagers` | 爬痛点帖 + 互动者 PII ⚠️(内含 pain-vs-solution 关键词分类法,方法可参考) |
| `competitor-post-engagers` | 爬对手帖下互动者 PII + Apollo enrich |
| `kol-discovery` | 聚合具名作者 LinkedIn 帖活动 ⚠️(内含 composite KOL 打分公式,需换合法数据源) |
| `linkedin-outreach` / `linkedin-outreach-campaign` | 在爬来的库上自动加好友/私信(ToS + 消息自动化风险) |
| `job-posting-intent` | LinkedIn 职位爬取(非个人数据但违 ToS)⚠️(内含意图打分框架:招聘=预算信号,方法可参考) |

### 4B · 数据经纪买人头(PII enrichment —— PDPA + 数据来源不合规)
| 技能 | 一句理由 |
|---|---|
| `apollo-lead-finder` | 从数据经纪揭露个人邮箱/电话 |
| `crustdata-supabase` | Crustdata 把个人 PII(邮箱/经历/技能)灌进库 |
| `company-contact-finder` | Crustdata/SixtyFour 拉决策人 PII |
| `tam-builder` | 公司层 firmographic 较干净,但 persona watchlist 会 enrich 真人 ⚠️(内含 0-100 加权 ICP 打分 + 分层,方法可参考) |

### 4C · 平台 ToS 爬取 / 会议名单 PII(中低敏感,仍不进产品)
| 技能 | 一句理由 |
|---|---|
| `twitter-scraper` | 公开内容但违 X ToS(Apify 爬取) |
| `luma-event-attendees` / `get-qualified-leads-from-luma` | 采集活动参与者社媒档案(拿不到邮箱但仍是 PII) |
| `conference-speaker-scraper` | 讲者虽自公开,仍属爬取 PII(低风险但不进产品) |
| `find-influencers` | TikTok 创作者数据,平台 ToS 风险 |

### 4D · Cold-email 外发机器 + 爬取驱动的 outbound 管线(PDPA 同意 + CAN-SPAM/反垃圾)
| 技能 | 一句理由 |
|---|---|
| `cold-email-outreach` / `setup-outreach-campaign` | 向经纪来的联系人群发未经请求的冷邮件(PDPA 同意 + 送达合规)⚠️(84 天冷却/去重的 hygiene 规则合法可参考) |
| `signal-scanner`(capability) | 建在 Apify LinkedIn 爬取 + 真人 signals 表上,最强 PII 依赖 ⚠️(`activation_score = strength × recency × account_fit` 衰减公式合法可参考,已用于工具 7/10) |
| `signal-detection-pipeline` / `outbound-prospecting-engine`(playbooks) | 整条管线 = 爬 LinkedIn → 群发陌生人 |
| `end-to-end-{funding,hiring,leadership-change,news}-signal` | discover→qualify→draft→launch,依赖 Apollo/LinkedIn 爬取 + cold-email ⚠️(其「事件→连接强度→框架+时机」的级联方法合法,BELCORT 若配合法数据可参考;产品面不接爬取) |

### 宪法层面另附(不是技能,是整类做法)—— 永不复活
- **对外开放 API/MCP、白标 FIKIRTIVE**:宪法硬排除,不做「让别人白牌我们引擎」。
- **违 ToS 的第三方集成**(如上述 LinkedIn/X 爬取管线内嵌进产品)。
- **PDPA 个人数据爬取**:任何未经数据主体同意、从第三方平台抓取自然人 PII 的功能,永不进产品。

> **一句话总纪律:** 我们抄 Gooseworks 的**打分公式、证据纪律、报告骨架、配方 schema**;我们不抄它的**爬取管线**。
> 官方广告透明工具、商家自己授权的数据、纯推理框架——够我们把十工具从「勉强」抬到「站得住」,不需要碰任何红线。

---

*文档版本 v1 · 依据 EFFECTIVENESS-LEDGER(十工具过堂)+ Gooseworks 125 技能全量通读(capabilities/composites/
playbooks)。第一节是 Wave C 内容工程的直接施工素材;第二节供 founder 用脚投票;第三节标了每笔成本,动真钱须逐笔点头;
第四节是永不复活的红线。*
