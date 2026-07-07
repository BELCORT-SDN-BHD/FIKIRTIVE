# Staging 使用手册(两级版 · 2026-07-06 建成,2026-07-07 S1 落地)

> 2026-07-07 S1 切片执行:staging 升级为**两级**(founder 当日拍板原话:「可以做一个完全 mock 的
> staging,另外一个就是完全像 prod 的 staging,就两步骤…最后一个像 prod 的 staging 就是在第一
> mock 过后的 last checkup before real prod」)。设计背景见
> `docs/superpowers/specs/2026-07-08-staging-and-release-process-design.md`。
> **本文件不含任何密钥/密码** —— 全部密钥在 Railway 环境变量里;DB/登录密码在 founder 处。

## TL;DR —— 两级模型

| | **`staging`(第一级 · 全 mock)** | **`staging-live`(第二级 · 像 prod)** |
|---|---|---|
| 用途 | 日常手测/冒烟:登录、UI、排期、生成流程(假图) | 上 prod 前的**最后一道人肉检查**:真生成、真出图 |
| URL | https://web-staging-7901.up.railway.app | https://web-staging-live.up.railway.app |
| 生成 | `GENERATION_PROVIDER=mock`(web+worker,$0,确定性假产物) | `byteplus`(**真钱**;每次真实花费仍逐笔问 founder,宪法 2) |
| Stripe | test 占位符(见下),真扣款不可能 | 同左 —— **永远只放 test key**。理由:真实信用卡扣款永远不是测试数据;Stripe live 只在 prod 由 founder 亲自小额验证 |
| 数据库 | staging 专用 Railway Postgres | staging-live 自己的全新 Railway Postgres(建环境时自动 provision,空库) |
| 存储 | R2 bucket `artlio`(**仍与 prod 共用**,待办 ①) | 同左(复制自 staging,同一待办) |

- **Railway:** 项目 `FIKIRTIVE`(`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`),环境 `staging` 与
  `staging-live`(与 `production` 并列;staging-live 于 2026-07-07 用
  `railway environment new staging-live --duplicate staging` 建成,环境 ID `5f2cadda-60c3-406b-b62a-af694ef54ded`)。
- **服务:** 每个环境各有 `web` + `worker` + `Postgres`。
- **登录:** email/password(不需要 Google)。founder 账号 `tools@belcort.com`(founder-admin)。
  ⚠️ staging-live 是**空库** —— 首次使用需按下面「建/修一个登录」一节重新注册 + 标记已验证。

## 2026-07-07 变更记录(S1 执行,变量名单;值不入文档)

对 `staging`(第一级):
- `GENERATION_PROVIDER=mock` —— web 与 worker 都显式设置(代码本就 fail-safe:凡不是
  `byteplus`/`fal` 的值一律落 mock,`packages/generation/src/index.ts` `createGenerationProvider`)。
- `STRIPE_SECRET_KEY` —— 原值是 **`rk_live_…`(live 限权 key,duplicate 从 prod 复制来的)**,
  已替换为占位符 `sk_test_PLACEHOLDER_ASK_FOUNDER`。代码已核实可安全降级:client 懒构造
  (`apps/web/lib/stripe.ts`)、billing 调用全部 try/catch(`apps/web/lib/billing-actions.ts`)——
  billing 页显示不出充值包、webhook 验签 400,但**不可能产生真实扣款**。
- `STRIPE_WEBHOOK_SECRET` —— 同上,替换为 `whsec_PLACEHOLDER_ASK_FOUNDER`。
- web 与 worker 各 redeploy 一次,`/api/health` 返回 `{"ok":true,"db":"up","worker":"up"}`。

对 `staging-live`(第二级,建环境时从 staging 复制,再覆盖):
- worker `GENERATION_PROVIDER=byteplus`(建环境命令里原子设置;`BYTEPLUS_API_KEY` 随复制继承)。
- web `GENERATION_PROVIDER=byteplus`(web 代码不读它,纯粹为了变量表不误导审计者)。
- web `BETTER_AUTH_URL` / `NEXT_PUBLIC_BETTER_AUTH_URL` / `AUTH_URL` = https://web-staging-live.up.railway.app 。
- Stripe 两个占位符随复制继承(= 第二级天生没有 live key)。

## ⚠️ founder 待办(S1 收尾,按优先序)

1. **R2 bucket 隔离(agent 无权限,只能 founder 做)。** 本机两套凭证都试过:S3 API
   `CreateBucket` 与 Cloudflare REST API 均被拒(现有 token 是 bucket 级授权 —— 这本身是好事)。步骤:
   1. Cloudflare dashboard → R2 → Create bucket → 名字 `artlio-staging`;
   2. R2 → Manage R2 API Tokens → Create API Token → 权限 Object Read & Write,**只勾 `artlio-staging`**;
   3. 把新 token 的 Access Key ID / Secret Access Key 填进 Railway `staging` **和** `staging-live`
      的 web+worker:`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`,并把 `R2_BUCKET=artlio-staging`;
   4. 跑一次 CORS/lifecycle 配置(直传上传必需):
      `set -a && source <新凭证文件> && set +a && R2_BUCKET=artlio-staging APP_ORIGIN=https://web-staging-7901.up.railway.app I_UNDERSTAND_THIS_TOUCHES_PROD=yes node scripts/tools/r2-configure.mjs`
      (staging-live 的 APP_ORIGIN 再跑一遍)。
   在此之前 staging 资产继续写进与 prod 共用的 `artlio`(内容寻址、低冲击,但备份/清理会掺沙子)。
2. **Stripe test key 换占位符。** dashboard.stripe.com → 右上角切 **Test mode** → Developers →
   API keys → 复制 `sk_test_…`,然后:
   `railway variables --set "STRIPE_SECRET_KEY=sk_test_…" -e staging -s web`(staging-live 同理)。
   webhook:Test mode → Developers → Webhooks → Add endpoint,URL 填
   `https://web-staging-7901.up.railway.app/api/stripe/webhook`,拿到 `whsec_…` 填进
   `STRIPE_WEBHOOK_SECRET`(staging-live 用自己的 URL 建一个 endpoint)。
   没换之前:staging 上充值流程测不了(billing 页无包可选),其余功能不受影响。
3. **清掉第一级 staging 上的真钱 key(纵深防御)。** agent 的删除操作被权限闸挡下(超出本次
   授权范围),留给 founder 或下次授权会话:
   `railway variables delete BYTEPLUS_API_KEY -e staging -s worker`
   `railway variables delete FAL_KEY -e staging -s worker`
   `railway variables delete FAL_KEY -e staging -s web`
   (mock 不读这些 key,删掉后即使有人误把 provider 翻回 byteplus,代码也会因缺 key 直接报错而不是花钱。)
4. **staging-live 首次部署。** 建环境只自动部署了 Postgres;web/worker 是 GitHub 源
   (track `main`),CLI 无法代触发(报 `No GitHub installation found`)。下一次 main 有 push 会
   自动首发;若急用,Railway dashboard → staging-live → web/worker → Deploy 手点。
   首次部署完成后:注册 founder 账号(空库)→ SQL 标记已验证(见下)→ 过一遍登录。
5. **两个「复制自 prod、要不要留」由 founder 定夺:**
   - `RESEND_API_KEY`(staging web 上是真 key)—— 留着 = staging 能发真邮件(方便测试),
     删掉 = 零误发风险。
   - `META_APP_ID` / `META_APP_SECRET`(staging web 上是真值)—— spec 里设想的
     `META_GRAPH_MOCK=1` 在 Railway 上**无效**(代码只在非 production build 且值为 `fixture`
     时才走 mock,`apps/web/lib/meta-graph.ts:94`),所以要么留真值(staging 连的是真 Meta app,
     谨慎测试),要么清空(Meta 相关页面报错但无真实动作风险)。

## 原「未记录待补」清单 —— S1 核实结果回填

- ~~staging 的 `STRIPE_SECRET_KEY` 是 live 还是 test?~~ **核实:曾是 `rk_live_…`(live 限权 key),
  2026-07-07 已替换为 test 占位符**(见变更记录)。
- ~~`AUTH_ALLOWED_EMAILS` 现值~~ **核实:只有 `tools@belcort.com`(founder 一人)。**
- ~~`META_APP_ID/SECRET`、`SENTRY_DSN`、`RESEND_API_KEY` 是否被复制~~ **核实:META 两值与
  RESEND_API_KEY 被复制(处理见待办 ⑤);`SENTRY_DSN` 两个服务上都不存在(无需清理)。**
- ~~web/worker 是否连着 GitHub 自动部署触发器~~ **核实:是 —— 两个服务的 source 都是
  `toolsbbb/FIKIRTIVE`、track `main`、`checkSuites=false`(不等 CI 绿就部署)。staging-live
  复制了同样的触发器。**(发版流程 S2/S3 会重新安排谁 track 什么。)
- staging Postgres 的规格与磁盘水位 —— 仍未核实(CLI 不直接暴露;dashboard 里看)。

## 铁律(每个 agent,不可协商)

- **每次 `railway up` / 跑迁移 / 改变量之前:** 先 `railway status`,确认输出 `Environment: staging`
  或 `staging-live`。**绝不**在 `production` 上操作;每条 railway 命令都显式带
  `-e staging`(或 `-e staging-live`),不依赖 link 状态。
- **绝不**在 link 到 `production` 的目录里 `railway up`(那等于直接部署 prod)。
- **绝不**对 prod 跑迁移。各级 staging 的迁移只打各自的 Postgres。
- **staging-live 生成花真钱**(byteplus):每次真实生成测试前逐笔问 founder(宪法 2);
  第一级 staging 是 mock,随便测。
- 存储在待办 ① 完成前仍写**与 prod 相同的 R2 bucket**。

## 它是怎么建成的(以及隔离在哪)

- `staging`:2026-07-06 用 `railway environment new staging --duplicate production` 建成
  → 复制了 prod 的服务配置 + **全部** secrets(secrets 只存在 Railway 上,agent 全程看不到值)。
- `staging-live`:2026-07-07 用 `railway environment new staging-live --duplicate staging
  --service-config worker variables.GENERATION_PROVIDER.value byteplus` 建成 —— 从 staging(而非
  production)复制,所以**天生带着 mock 的 Stripe 占位符**,且完全不存在「复制到 prod DB URL」
  的窗口(见下方事故记录):staging 的 `DATABASE_URL` 是引用变量 `${{Postgres.DATABASE_URL}}`,
  复制后自动解析到新环境自己的 Postgres。
- 每级各有专用 Railway Postgres;prod 的 Neon 库(`neondb`)与两级 staging 零关联。
- 域名/登录相关变量已按各级覆盖:`BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL`、`AUTH_URL`。
  ⚠️ staging-live 的 `NEXT_PUBLIC_BETTER_AUTH_URL` 是 build 时烘进前端的 —— 该值在变量改好
  **之后**的第一次构建(待办 ④)才会生效。

## ⚠️ 已知坑 / 事故记录(2026-07-06)—— 必读

`railway environment new --duplicate` **会立刻用复制来的配置自动部署**,包括复制来的
prod `DATABASE_URL`(Neon)。建环境时的一次一次性 staging 部署因此对 **prod 的 Neon 库**
跑了 `prisma migrate deploy`(web 容器每次启动都会先跑迁移,见 `apps/web/Dockerfile:35`)。
- **实际影响:零** —— 该分支没有新增 migration,迁移是 no-op(已用 `git diff main..HEAD -- packages/db/prisma/migrations` 为空验证,prod schema/数据未变)。
- **正确建环境流程(彻底避开这个窗口):**
  1. **永远从 staging 复制,不从 production 复制**(staging 的 DB 变量是环境内引用,复制天然安全 —— staging-live 即按此建成,零事故);
  2. 若必须从 production 复制:**立刻**给新环境 provision 专用库并覆盖 `web`+`worker` 的 `DATABASE_URL` + `DATABASE_URL_POOLED` —— **不要**用 `--skip-deploys`,让它重新部署、把还挂在 prod 库上的自动部署顶掉;
  3. 然后才做其它事。
- **教训:** duplicate 之后要默认「服务已经在用复制来的 DB URL 自动部署了」,第一件事永远是核实数据库指向。
- **补充(2026-07-07):** GitHub 源的服务(web/worker)duplicate 时**不会**自动首发(只有
  image 源的 Postgres 部署了);CLI 也无法代触发 GitHub 构建(`railway redeploy --from-source`
  报 `No GitHub installation found`)—— 首发靠下一次 main push 或 dashboard 手点。

## 部署一个分支到 staging(手动;与 GitHub 自动部署并存)

```bash
PROJ=b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d
railway link -p $PROJ -e staging -s web
railway status | grep -i Environment        # 必须打印: Environment: staging
railway up --ci --detach                     # 把当前目录部署到 staging web
railway link -p $PROJ -e staging -s worker && railway up --ci --detach   # worker 同理
```
(staging-live 同理,把 `-e staging` 换成 `-e staging-live` —— 但注意 staging-live 的定位是
「验 main 上已合并的东西」,一般不该往它上面推未合并分支。)

## 对 staging 库跑迁移(从本地)

```bash
# 取公网代理 URL(含密码 —— 不要提交、不要写进任何文档):
railway variables -e staging -s Postgres --kv | grep DATABASE_PUBLIC_URL
DATABASE_URL='<那个 url>' pnpm --filter @fikirtive/db exec prisma migrate deploy
```

## 在 staging 建/修一个登录(staging 没有邮箱收发)

better-auth 挂载在 **`/api/better-auth`**;email/password 已启用且 `requireEmailVerification: true`。
邮箱必须在 `AUTH_ALLOWED_EMAILS` / `FOUNDER_ADMIN_EMAILS` 白名单里(founder-admin ⇒ 经 `isFounderAdmin` 成为 owner)。
```bash
# 1. 注册(staging-live 把域名换成 web-staging-live.up.railway.app)
curl -X POST "https://web-staging-7901.up.railway.app/api/better-auth/sign-up/email" \
  -H "Content-Type: application/json" -d '{"email":"<email>","password":"<pw>","name":"<name>"}'
# 2. 在对应环境的库里直接标记已验证(BetterAuthUser → 表 ba_user)
psql "<staging DB url>" -c "UPDATE ba_user SET \"emailVerified\"=true WHERE email='<email>';"
# 3. 然后即可登录: POST /api/better-auth/sign-in/email
```

## 看日志 / 查变量

```bash
railway logs -e staging -s web           # 或 -s worker;staging-live 换 -e staging-live
railway variables -e staging -s web --kv | grep <KEY>
```
