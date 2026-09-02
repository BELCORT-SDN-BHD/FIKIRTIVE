# Auth access journey

> **状态：Founder approved and frozen — 2026-09-01。Review fixture 已通过 Founder 视觉验收；已授权 production convergence。**  
> **上游权威：** `docs/BLUEPRINT.md`、`../../information-architecture/product-map.md`、`../../information-architecture/surface-contract.md`、现有 Better Auth contract。  
> **研究证据：** [`references.md`](references.md) 的 Founder-selected Linear `Logging in` flow。

## 1. Who and success

**For：** 想直接回到工作、不想先理解 authentication 方法的小生意 Founder。

**One-sentence success：** Founder 从任一受保护入口进入一个安静、可信的 Fikirtive login journey，用最少决定完成登录，并安全回到原本要去的 destination；失败、恢复或验证都不会把人困住，也不会暴露账号是否存在。

## 2. Foundation finding

- 冻结 IA 已把 Auth 定义为 merchant shell 外的独立 access journey；它不是 Home、Settings 或 Otto surface。
- Mobbin MCP 已验证 Linear 的 8-screen `Logging in` flow：login hub → email → temporary code；Google、SAML、passkey 与 signup 从 hub 分流。
- Fikirtive runtime 已有 email + password、email code、conditional Google、signup、email verification、forgot / reset password 与安全 redirect；这些是真实能力，不能因视觉收敛而删除。
- 当前 `/login` 是大型 two-column marketing page，email + password 直接成为首页；它不符合 Founder 选择的 Linear 式低干扰 access journey。
- 当前 signup verification callback 写死到 legacy `/otto`；它与冻结 IA 及“回到原 destination”的 journey 不一致。
- 当前本地 review 环境没有可用账号数据库与邮件服务；因此视觉 fixture 可以先验收，但正式 Auth closure 必须在独立 local test-auth environment 走真实 code、link、reset 与 callback。

## 3. Journey contract

### A1 — Login hub

- 使用一个居中、minimal 的 public Auth shell；不显示 application navigation，也不使用第二个 marketing landing page。
- Title 使用 `Log in to Fikirtive`；第一主动作是 `Continue with email`。
- 只显示 server 实际启用的方法。Google 未配置时完全隐藏；SAML、passkey 与其他 future methods 不预造 disabled buttons。
- `You used … last time` 只有存在可信的本机 method hint 时显示；它不能成为身份或权限判断。
- Footer 只保留 `Create an account` 与必要 legal links。

### A2 — Email and verification

- `Continue with email` 进入独立 email step；一个 email field、一个 primary CTA、一个 `Back to login`。
- 默认完成方式是 temporary email code；code step 清楚回显目标 email、支持 resend、换 email 与返回 login hub。
- Password 是已存在账户的替代登录方式，不与 code 在第一屏抢主层级；选择后进入独立 password state，保留 show / hide 与 `Forgot password`。
- Google 直接进入 provider flow；失败返回同一 hub 并给出可恢复 feedback。

### A3 — Recovery and account creation

- Forgot password：email request 使用不暴露账号存在性的 neutral success；reset link 一次有效并说明 expiry。
- Reset password：完成后回到 login hub，不假装 reset 自动建立 session。
- Signup：保留 shop name、email、password 与 email verification；成功后回到发起 signup 前的安全 destination，没有 destination 时进入 canonical Home。
- Email verification 必须先显示即时可读状态，再交给真实验证 endpoint；expired / used / missing token 可回到 login。

### A4 — Destination, trust and accessibility

- 所有入口保留同一个 sanitized `from` destination；login、Google、code、signup verification 与 recovery 完成后不得各自发明 redirect。
- 任何错误不得确认某 email 是否有账号；认证与 tenant 权限仍由 server principal 决定。
- Loading 防止 double submit；Back / Forward 恢复合理步骤，不重复发送 code 或重放成功动作。
- 关键状态需要 keyboard、screen reader、visible focus、autofill 与 one-time-code 支持；mobile 与 desktop 都可完成，因为 Auth 不是 desktop-only dashboard。

## 4. Single source of truth and DRY

1. Auth capability、session、provider 与 verification：现有 Better Auth server contract。
2. Safe destination：唯一 redirect sanitizer / callback contract；所有 Auth routes 共用。
3. Auth visual shell：`components/auth`；Login、Signup、Recovery 与 Verification 不各画一套品牌壳。
4. Form controls、Alert、OTP、Spinner、focus 与 tokens：现有 Design System primitives。
5. Auth method availability：server configuration；client 不猜 provider 是否存在。
6. Screen pattern 与 research：本目录；Linear 只提供 interaction hierarchy，不拥有 Fikirtive business rules。

## 5. Checkable acceptance criteria

1. `/login` 首屏是 minimal login hub；没有 merchant navigation、dashboard 或大型营销 panel。
2. Email、code、password 各自是独立 step；所有深层 step 都能明确返回 login hub。
3. Email code 是 email primary completion path；password 作为清楚但次要的 alternative 保留。
4. 只渲染真实启用的 provider；未配置 Google、SAML 或 passkey 不出现。
5. Code 可输入、paste、resend、换 email；empty、invalid、expired、failed 与 busy 都有可恢复状态。
6. Password 支持 show / hide、forgot password、wrong-credential generic error 与 busy state。
7. Signup、email verification、forgot password 与 reset password 使用同一 Auth shell 和同一 interaction language。
8. 任何 request / error copy 都不泄露 email 是否存在。
9. 所有成功路径回到经过 sanitize 的原 destination；没有 destination 时回 canonical Home，不写死 legacy `/otto`。
10. Back / Forward、refresh 与 retry 不重复提交、重复发 code 或进入 redirect loop。
11. 360px mobile、1440×900 desktop、keyboard-only 与 screen reader 核心 journey 均可完成。
12. Review fixture 不伪装真实登录；正式验收使用 local test-auth environment 覆盖 code email、verification link、password reset 与 provider callback。
13. Existing auth behavior tests、scoped lint、typecheck 与 production build 通过；新增 journey tests 钉住 method visibility、state transitions、neutral errors 与 destination preservation。

## 6. Delivery order

1. 建立 `/product-patterns/auth` review fixture，覆盖 hub、email、code、password 与 recovery representative states；不连接真实账号。
2. Founder 视觉与 flow 验收后，收敛 shared Auth shell 与 production routes。
3. 建立 local test-auth environment，走完真实 email code、verification、password reset、Google 与 original-destination return。
4. 完成 authenticated cross-surface QA 后，Auth 才能从 runtime convergence backlog 关闭。

## 7. Non-goals

- SAML、passkey、2FA、session management、workspace switcher 或 enterprise security policy。
- 改写 Better Auth、tenant identity、database schema、email provider 或 production credentials。
- 把 Auth 变成 marketing landing page、onboarding redesign 或 Otto conversation。
- 在 review fixture 中加入 auth bypass，或把 fixture session 当成 production authentication。

## 8. Decision record

| 日期 | 状态 | 记录 |
|---|---|---|
| 2026-09-01 | Founder-selected reference | Founder 指定 Mobbin Linear Login flow，并要求严格使用 Mobbin MCP。 |
| 2026-09-01 | Research verified | Mobbin MCP 精确核实 Linear `Logging in` flow ID、8-screen ordering、login hub、email 与 email-code states。 |
| 2026-09-01 | Review candidate | 基于冻结 IA、verified Linear evidence 与 current Fikirtive auth contract 建立；等待 Founder 批准和冻结，尚未授权 implementation。 |
| 2026-09-01 | Approved and frozen | Founder 明确回复“批准”；冻结本 journey contract，并授权先制作 `/product-patterns/auth` review fixture。正式 Auth routes 仍须在 fixture 获得 Founder 验收后才收敛。 |
| 2026-09-01 | Review fixture ready | `/product-patterns/auth` 已实现 hub、email、code、password、recovery、signup、provider disclosure 与 success handoff representative states；typecheck、scoped lint、pattern tests、Design System audit 与 production build 通过。浏览器已完成 1280×720 核心分支、Back / Forward、零 console error 与 360px 无横向溢出检查；等待 Founder 视觉验收。构建仍会正确警告本地未设置 production auth secret / base URL，这些凭据不属于 review fixture。 |
| 2026-09-01 | Founder visual acceptance | Founder 明确回复“ok 可以”；review fixture 的 visual direction 与代表性 flow 获得验收，下一步按冻结 spec 收敛 shared Auth shell 与正式 routes。 |
| 2026-09-01 | Production convergence ready | 正式 `/login`、`/signup`、`/forgot-password`、`/reset-password` 与 `/verify-email` 已共用 Auth shell 和安全 destination contract；login hub、email code primary path、password alternative、neutral recovery 与 route-backed Back / Forward 已收敛。149 项 scoped tests、typecheck、scoped lint、Design System audit、360px browser check 与 production build 通过；等待 Founder 对正式 routes 的视觉验收。真实邮件、数据库、verification / reset link 与 provider callback 仍须在 local test-auth environment 验收，不能以 fixture 或静态检查代替。 |
| 2026-09-01 | Founder production visual acceptance | Founder 在正式 `/login?from=/create` 验收后明确回复“好的，继续。”；正式 Auth visual direction 与未登录 journey 获得接受。Auth 不因此关闭：local test-auth environment、真实 email / callback 与 authenticated return 仍是已命名 closure seams。 |
