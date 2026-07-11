# D 车道旅程走查(本地跑 main@b5a48d0f,2026-07-11)

> 环境:本地 dev server(port 3000)+ 隔离审计库(5433/fikirtive_audit)+ `GENERATION_PROVIDER=mock`($0)。
> 全新用户视角(auditor@fikirtive.test,零历史)。Provenance:Observed(控制面亲自浏览器走查)。
> 这是对「main 代码真相」的体验核验,不是 production 真相。

## 走通的路径(第一次成功 = 创作一张图)

| 步骤 | 结果 | 证据 |
|---|---|---|
| 落地页 /login | 干净的双栏登录页,左侧价值主张「Run real campaigns without becoming a marketer」+ 三条卖点(含「direct publish is coming soon」诚实标注) | 截图 |
| Magic link 登录 | dev 模式把链接写 `.data/last-magic-link.txt`,verify 后进 /otto | Observed |
| 首次进入 /otto | 空态引导卡「Get Otto ready」(加角色/产品 + 教品牌)+ 前门「Hi auditor — what should we make today?」+ 4 目标卡(Sell a product / Announce a sale / Get more followers / Make a video)+ 100 credits | 截图 |
| Otto 聊天 | **失败**:发消息后 Otto 无回应;server log `AI_LoadAPIKeyError: Anthropic API key is missing`。聊天是产品主场,但本地无 LLM key 时硬失败、界面无任何错误提示(静默转圈) | preview_logs `[otto/stream] run failed OTTO-S1151MKZ` |
| Canvas 直接生成图 | **成功**:点 canvas 生成图标 → 弹提示框「Cost: 1 credit」→ 填词 → Generate → ~6s 后图片节点落画布,余额 100→99 | 截图(蓝色块=mock 占位),余额扣减 |

## 与 E1 证据的活体互证

- **单张不是 4 变体**:canvas 生成框明写「Cost: 1 credit」,产出一个节点 —— 坐实 E1 结论(CANVAS_IMAGE_DEFAULT_COUNT=1,用户在 canvas 点不出 4 变体)。北极星卖点图里画的是「4 variants」,与实况不符。
- **钱路活体验证**:reserve→settle→余额刷新在 mock 下完整走通,1 credit 精确扣减,无双扣。

## 摩擦点(原始观察,不评分)

1. **Otto 聊天静默失败**:无 LLM key 时不提示、不降级、只转圈 —— 与蓝图第 11 条「状态诚实/宕机点被接住」冲突。这与前任交接书记录的「Otto 聊天不流畅」吐槽同源。(注:生产有 ANTHROPIC_API_KEY,此失败是本地环境所致;但「依赖失败时界面不给用户任何信号」是代码行为,生产同样适用于 key 额度耗尽/供应商宕机。)
2. **前门与 canvas 两个入口的关系不直观**:目标卡(Sell a product 等)走 Otto 聊天(需 LLM),canvas 直接生成走 $0 图 —— 新用户不知道两者区别,聊天挂了会以为整个产品坏了。
3. **空态引导卡「加角色/产品」「教品牌」**是好的 onboarding 信号,但都指向需要先做的前置工作,与「零学习曲线/一次会话见成果」(宪法 v2.9)有张力。

## 未走(受限)

- Otto 完整对话链(propose→approve→generate)= 需真实 LLM key,属真实花费,未测(宪法 2)。
- 视频生成、发布排期、Meta 连接 = 需真实供应商/OAuth,本地跳过。
- Production 真相(app.fikirtive.com)= 登录墙 + 无审计账号,未走认证态。
