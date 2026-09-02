# Auth access journey references

> **状态：Mobbin MCP verified — 2026-09-01。研究证据，不是 implementation authority。**

## Founder-selected flow

- Mobbin shared flow: <https://mobbin.com/flows/2b9e0315-3654-482e-b877-f8da3736939f?utm_source=copy_link&utm_medium=link&utm_campaign=flow_sharing>
- Founder decision (2026-09-01): Fikirtive Login flow 以这条 flow 作为指定处理方向。
- Research constraint: 必须通过 Mobbin MCP 阅读与提取；不得用网页搜索、普通浏览器截图或记忆替代。

## Verification boundary

2026-09-01，Founder 补充 App / flow 名称后，受委派的轻量 sub-agent 通过 Mobbin MCP 精确找到：

- App：Linear；platform：web；flow：`Logging in`。
- Flow ID：`2b9e0315-3654-482e-b877-f8da3736939f`。
- Mobbin actions：`Logging In`、`Verifying`。
- 共 8 screens；顺序 ID：
  1. `b7c17da1-eac4-4a8d-b7e9-2b8d6ef30f66`
  2. `3997d60f-bea7-4068-af79-3942a664072e`
  3. `1681f134-0c3a-4003-93bc-a6f158f0e100`
  4. `27d5ce11-de67-49c0-a92c-49ea46d00b09`
  5. `6283263c-110a-489d-849b-d028795f3762`
  6. `0fd9e21f-1222-4074-a683-762db55d93bb`
  7. `fa5eecc4-532f-4cc2-a6e8-56814eefbf89`
  8. `3e4c96cc-b973-44eb-a665-c1045c5a39c4`

Mobbin MCP 的 `search_flows` 提供 flow metadata 与 screen ordering，`search_screens` 提供 screen image 与 ID；没有独立逐屏文本 API。以下只记录从返回图片可直接读到的内容，不补写看不到的状态。

## Verified flow anatomy

### Login hub — screen `3997d60f-bea7-4068-af79-3942a664072e`

- Title：`Log in to Linear`。
- Primary：`Continue with email`。
- Alternatives：`Continue with Google`、`Continue with SAML SSO`、`Log in with passkey`。
- Remembered-method hint：`You used email to log in last time.`。
- Footer：`Don’t have an account? Sign up or learn more`。

### Email step — screen `27d5ce11-de67-49c0-a92c-49ea46d00b09`

- Title：`What’s your email address?`。
- One email field；CTA：`Continue with email`。
- Escape hatch：`Back to login`。

### Verification step — screen `fa5eecc4-532f-4cc2-a6e8-56814eefbf89`

- Title：`Check your email`。
- Explains that a temporary login code was sent to the entered address。
- Code input；CTA：`Continue with login code`；escape hatch：`Back to login`。
- Empty-code 与 filled-code 两种状态均由 screen evidence 证实。

## Borrow / do not copy

Fikirtive 应借鉴：一个简洁 login hub 聚合可用方法；email 是最强入口；记住并提示上次使用的方法；email 与 code 各自成为独立、低干扰步骤；每个深层步骤都可返回 login hub。

Fikirtive 不复制：Linear 品牌与具体文案、示例邮箱、SAML / passkey 等未接通的方法，以及该 flow 未证明的 password、forgot / reset、错误、loading、成功 callback 或 destination 行为。Fikirtive 对这些状态的设计必须来自当前真实 auth contract 与独立验收，不能伪称是 Linear evidence。
