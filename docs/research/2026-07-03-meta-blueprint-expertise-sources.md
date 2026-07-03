# Meta 专家知识库 · 深研源清单与覆盖边界(P0)

> 生成:2026-07-03 深度研究 Workflow(7 域研究 → 逐条对抗核实 → 归并)。产物 = `packages/otto/src/knowledge/meta-expertise.data.ts`(带引用知识模块)。**本文件是 P0 Task 3 的留痕;知识库本体在代码里,由 `validateKnowledgeBase` 守引用地板。**

## 方法(反捏造铁律落地)
- **只用公开官方/可核对资料**:Meta Business Help Center、Meta for Business best-practice、ad-objectives 页、官方 case study。构建时曾含一处可核对第三方页(get-ryze.ai),已在 **2026-07-03 引用复核 follow-up**(见文末)换成官方 Engagement 目标页,现全部为 Meta 第一方源。**门控课程正文(需报名)拿不到,不收。**
- **逐条对抗核实**:每条候选 claim/benchmark 由独立 verifier 打开引用 URL 核对(源支持 + 非逐字复制 + 未过期),不过关即弃。
- **数字型 benchmark 只在可访问正文中被证实才保留**,否则宁缺不造。

## 覆盖(逐域条数,共 56 条 / 63 个源)

| 域 | 条数 |
|---|---|
| objectives | 10 |
| bidding | 12 |
| targeting | 13 |
| creative | 6 |
| measurement | 4 |
| algorithm | 3 |
| diagnosis | 8 |

## 保留的可核对 benchmark(5 条)

- **cost-per-lead and lead volume**: 60% lower CPL and 125% more leads (instant forms + website forms strategy) — `objectives-leads-instant-forms-performance`
- **Cost per result improvement** (conversions): 34.5% lower — `creative-reels-vertical-9-16-aspect-ratio`
- **Engagement perception** (engagement): 79% prefer vertical format — `creative-vertical-video-consumer-preference`
- **Cost per action reduction** (conversions): 4.8% lower with vertical sound-on video — `creative-audio-quality-reels-conversion`
- **learning_phase_stabilization** (stable_cost_prediction): ~50 optimization events per 7 days — `algorithm-learning-phase-mechanism`

> 原第 6 条 **Quality Ranking Percentile**(`diagnosis-quality-ranking-impact`)已在 2026-07-03 引用复核中软化下架:具体百分位分档无法第一方复核(官方页仍只返回标题)、第三方页之间互相矛盾且不署 Meta 出处,故删去 benchmark 与具体百分比,仅保留定性描述。详见文末 follow-up 与下方诚实缺口。

## 诚实缺口(核实不到 → 一律丢弃,不臆造)

- Ad recall lift × awareness — dropped in objectives batch; the 4%-17% (avg 9%) range could not be verified (citation returned title only)
- Reach frequency default × awareness/reach — the '2 impressions per 5-7 days default' claim was unverifiable and dropped
- Advantage+ campaign budget CPA reduction × conversions — the 'average 4.6% CPA decrease' claim could not be verified (page returned title only) and was dropped
- Minimum ROAS efficiency × value-optimized conversions — no verifiable public benchmark; the minimum_roas entry was dropped on a 404 citation
- CTR / CPC / CPM / ROAS / frequency benchmark ranges × any objective — no industry benchmark numbers survived; the measurement batch retained only definitional/tooling claims (all metric-value pages returned title only)
- Reels safe-zone text-placement percentages (14% top / 35% bottom / 6% sides) — unverifiable, dropped from creative
- Stories 15-second / 3-second brand-reveal timing and preference stats (52% / 46% / 58% / 31%) — unverifiable (language barrier), dropped from creative
- Vertical phone screen-time (90%) × engagement — unverifiable, dropped from creative
- Learning-phase daily pacing variance (±25%) × delivery — could not be confirmed from pacing docs, dropped from algorithm
- Combine-adsets cost-per-purchase improvement (68%) and creative-quality sales lift (12%) × conversions — appeared fabricated / uncitable, dropped from diagnosis
- Quality-ranking percentile tiers (Bottom 20% / 35th-55th / 55th+) × diagnosis — **软化(2026-07-03 复核)**:官方 About Quality Ranking 页仍只返回标题无正文,第三方页彼此矛盾(Sprinklr 记 Average=35th-55th,wittelsbach 记 Above=top 35%/Average=middle 35-65%)且均声明非 Meta 官方口径,具体百分位无法证实。`diagnosis-quality-ranking-impact` 保留定性 claim(Below/Average/Above Average 三档、用户反馈+低质属性信号、Below Average 对应更高投放成本),删去具体百分比与 benchmark 字段,不臆造

## 覆盖边界说明

多条来源(尤其 facebook.com/business/help 帮助中心页与部分 developers 页)在抓取时只返回页面标题、无正文,或返回非英文(马来语等)本地化内容无法核对,因而对应 claim 与 benchmark 被相应批次丢弃(objectives 丢 6、bidding 丢 2、targeting 丢 3、creative 丢 10、measurement 丢 14、algorithm 丢 10、diagnosis 丢 3,合计 48 条)。多个链接返回 HTTP 404(如 help/905095143159925、help/2292063697690873 等失效链接),无法验证即弃用。凡是 benchmark 数字无法在可访问正文中复核的,一律不保留、不臆造。跨批次去重合并了三处同一原理:learning phase 50 事件/7 天(algorithm+bidding+diagnosis 合入 algorithm-learning-phase-mechanism)、成本控制灵活度权衡(bidding+diagnosis 合入 bidding-control-flexibility-tradeoff)、标准 pacing 匀速投放(bidding+algorithm 两条视角互补,均保留)。auction overlap 在 targeting(投放机制)与 diagnosis(排障)语境不同,各自保留一条。

## 版权

所有 claim 均为对 Meta 官方文档/帮助中心及少量第三方页面要点的提炼与改写(distilled),非逐字复制原文;每条 entry 至少保留一条可核对的 citation,数字型 benchmark 仅在可访问正文中被证实时才保留。

## 源(master list,63)

- [Awareness Ad Objective: Improve Brand Awareness & Reach](https://www.facebook.com/business/ads/ad-objectives/awareness)
- [Traffic Ad Objective: Grow Website Traffic & Reach New Visitors](https://www.facebook.com/business/ads/ad-objectives/traffic)
- [Using Engagement Ads Objective in Your Advertising Campaigns](https://www.facebook.com/business/ads/ad-objectives/engagement)
- [Generate Leads with Online Forms](https://www.facebook.com/business/ads/ad-objectives/lead-generation/lead-ads-with-forms)
- [Meta Advantage+ App Campaigns: Increase App Installs with Ads](https://www.facebook.com/business/ads/meta-advantage-plus/app-campaigns)
- [Facebook Ad Auctions Explained](https://www.facebook.com/business/ads/ad-auction)
- [Understand the customer journey lesson](https://www.facebook.com/business/learn/lessons/customer-journey)
- [About lowest cost | Meta Business Help Centre](https://en-gb.facebook.com/business/help/721453268045071)
- [Meta Bid Strategy Guide](https://www.facebook.com/business/m/one-sheeters/facebook-bid-strategy-guide)
- [About Highest Value | Meta Business Help Center](https://www.facebook.com/business/help/168777633739990)
- [About cost cap | Meta Business Help Centre](https://en-gb.facebook.com/business/help/272336376749096)
- [About Cost and Bid Controls | Meta Business Help Center](https://www.facebook.com/business/help/491846184627504)
- [About Bid Cap | Meta Business Help Center](https://www.facebook.com/business/help/272503946776144)
- [About ROAS goal | Meta Business Help Center](https://www.facebook.com/business/help/1113453135474912)
- [About Advantage+ campaign budget | Meta Business Help](https://www.facebook.com/business/help/153514848493595)
- [Meta Advantage+ Campaign Budget: Ad Spend Automation Tool](https://www.facebook.com/business/ads/meta-advantage-plus/budget)
- [About ad set spend limits with Advantage+ campaign budget](https://www.facebook.com/business/help/454681230514942)
- [About campaign budgets and ad set budgets](https://www.facebook.com/business/help/458847204894307)
- [Best practices for minimum budgets | Meta Business Help Centre](https://en-gb.facebook.com/business/help/203183363050448)
- [About Daily Budgets | Meta Business Help Center](https://www.facebook.com/business/help/190490051321426)
- [Pacing and Scheduling - Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/pacing-and-scheduling)
- [About Bid And Budget Pacing | Meta Business Help Center](https://www.facebook.com/business/help/571961726580148)
- [About Meta bid strategies | Meta Business Help Centre](https://en-gb.facebook.com/business/help/1619591734742116)
- [About custom audiences | Meta Business Help Center](https://www.facebook.com/business/help/744354708981227)
- [About Lookalike Audiences | Meta Business Help Center](https://www.facebook.com/business/help/164749007013531)
- [Lookalike Audiences - Marketing API - Documentation - Facebook for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/lookalike-audiences)
- [Dynamic Targeting with Campaign/Ad Set Conversion Lookalike Audience - Facebook for Developers](https://developers.facebook.com/ads/blog/post/v2/2014/11/06/campaign-conversion-lookalike/)
- [About Specific Targeting | Meta Business Help Center](https://www.facebook.com/business/help/273363992030035)
- [Advantage+ Audience: Ad Campaign Audience Targeting | Meta for Business](https://www.facebook.com/business/ads/meta-advantage-plus/audience)
- [Targeting Expansion - Marketing API - Facebook for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/advantage-targeting)
- [About Overlapping Audiences | Meta Business Help Center](https://www.facebook.com/business/help/1679591828938781)
- [Understanding auction overlap | Meta Business Help Centre](https://en-gb.facebook.com/business/help/537699989762051)
- [Combine ad sets and campaigns to reduce audience overlap | Meta Business Help Center](https://www.facebook.com/business/help/2419480091640105)
- [Best Practices for Reaching a Broad Audience with Dynamic Ads | Meta Business Help Center](https://www.facebook.com/business/help/338460790267195)
- [About Audience controls and Audience suggestions | Meta Business Help Center](https://www.facebook.com/business/help/938372127764391)
- [Create, Edit and Use Saved Audience | Meta Business Help Center](https://www.facebook.com/business/help/570332443495822)
- [Best Practices for Building B2B Lookalike Audiences | Meta for Business](https://www.facebook.com/business/industries/b2b/media/lookalike-best-practices)
- [The Science of the Hook: How to Supercharge Your Reels Performance](https://www.facebook.com/business/news/the-science-of-the-hook-how-to-supercharge-your-reels-performance)
- [Instagram & Facebook Reels: Create Short Video Ads](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)
- [Get Creative with Vertical Video](https://www.facebook.com/business/news/get-creative-with-vertical-video)
- [Reels Ads updates: new performance features, automated creative and suitability solutions](https://www.facebook.com/business/news/reels-ads-updates-performance-features-automated-creative-suitability-solutions)
- [Ad Measurement: A/B Testing Ads on Facebook & Instagram](https://www.facebook.com/business/measurement/ab-testing)
- [Simplifying Ad Measurement for a Social-First World | Meta for Business](https://www.facebook.com/business/news/click-attribution)
- [Conversion Lift Testing for Incrementality Measurement | Meta Business Help Center](https://www.facebook.com/business/measurement/conversion-lift)
- [Conversion Lift Percent | Meta Business Help Center](https://www.facebook.com/business/help/673450219767299)
- [Conversion Tracking - Meta Pixel - Documentation - Meta for Developers](https://developers.facebook.com/docs/meta-pixel/implementation/conversion-tracking/)
- [Set Up and Install the Meta Pixel | Meta Business Help Center](https://www.facebook.com/business/help/952192354843755)
- [Conversions API - Documentation - Meta for Developers](https://developers.facebook.com/docs/marketing-api/conversions-api/)
- [About Conversions API and How it Can Help You Improve Your Ads on Facebook and Instagram | Meta Business Help Center](https://www.facebook.com/business/help/2041148702652965)
- [Understanding and optimizing your ad campaign | Meta Developers](https://developers.meta.com/horizon/resources/optimize-ad-campaign/)
- [About the Learning Phase | Meta Business Help Center](https://www.facebook.com/business/help/112167992830700)
- [About Learning Limited | Meta Business Help Centre](https://www.facebook.com/business/help/269269737396981)
- [Significant Edits and Learning Phase | Meta Business Help Center](https://www.facebook.com/business/help/316478108955072)
- [Last Significant Edit | Meta Business Help Center](https://www.facebook.com/business/help/942374239243867)
- [About Quality Ranking | Meta Business Help Center](https://www.facebook.com/business/help/303639570334185)
- [About Ad Relevance Diagnostics | Meta Business Help Center](https://www.facebook.com/business/help/403110480493160)
- [How to Use Ad Relevance Diagnostics | Meta Business Help Center](https://www.facebook.com/business/help/436113280262012)
- [Auction Overlap Rate | Meta Business Help Center](https://www.facebook.com/business/help/714172578779451)
- [Creative fatigue recommendations in Meta Ads Manager | Meta Business Help Centre](https://www.facebook.com/business/help/1346816142327858)
- [Frequency | Meta Business Help Center](https://www.facebook.com/business/help/1546570362238584)
- [About breakdowns, metrics and filtering in Meta Ads Manager | Meta Business Help Center](https://www.facebook.com/business/help/264160060861852)
- [View Meta ad results by platform, device and placement in Ads Manager | Meta Business Help Center](https://www.facebook.com/business/help/1098535543548363)
- [About landing page view optimization | Meta Business Help Center](https://www.facebook.com/business/help/417293491972212)

## 2026-07-03 引用复核 follow-up(P0 整片接地评审的两处非阻断改进)

复核只做接地(grounding)修正,不改动实质 claim 文字之外的任何东西;凡无法核对的一律软化/删除,绝不臆造。

1. **`objectives-engagement-sub-objectives` 换官方源(第三方 → 第一方)。** 原引 get-ryze.ai 博客(全库唯一非第一方源)。复核时官方 Engagement 目标页 `facebook.com/business/ads/ad-objectives/engagement` 可核对,正文明列 messages / video views / post engagement(另有 event responses),支持该 claim。已把 citation 换成该官方页;get-ryze.ai 同时从 master source list 删除(64 → 63),知识库现 100% Meta 第一方源。claim 未改。

2. **`diagnosis-quality-ranking-impact` 软化具体百分位分档。** 原 claim/benchmark 断言 Bottom 20% = Below Average、35th-55th = Average、55th+ = Above Average。复核结论:官方 About Quality Ranking 页(含 en-gb / ?locale=en_US 变体)仍只返回标题、无正文;可搜到的第三方页彼此矛盾(Sprinklr:Average=35th-55th;wittelsbach:Above=top 35%、Average=middle 35-65%)且都声明这些百分位是各自解读、非 Meta 官方口径;该分档作为区间划分本身也不自洽(20-35 与 55-56 留空档)。因无第一方来源可证实、且不存在能证实该分档的可加引用,遂删去具体百分比与 `benchmark` 字段,claim 软化为定性表述(Below/Average/Above Average 三档、用户反馈+低质属性信号如 engagement bait/sensationalized language/withholding information、Below Average 对应更高投放成本 CPM/CPC),保留原 About Quality Ranking 官方 citation。可核对 benchmark 计数 6 → 5(仍 ≥ 测试地板 5)。

变更后仍 `validateKnowledgeBase` 全绿、`meta-expertise.test.ts` 17 测试通过、knowledge/ 目录 typecheck 干净。
