# Staging 使用手册(现状版 · 2026-07-06 建成,2026-07-08 收编)

> 收编自 2026-07-06 canvas 分支的 `docs/ops/staging.md`(该分支未合并,文档险些丢失)。
> 本文写**现状**(怎么用、怎么部署、怎么看日志);目标态与待建项见
> `docs/superpowers/specs/2026-07-08-staging-and-release-process-design.md`。
> **本文件不含任何密钥/密码** —— 全部密钥在 Railway 环境变量里;DB/登录密码在 founder 处。

## TL;DR
- **URL:** https://web-staging-7901.up.railway.app
- **Railway:** 项目 `FIKIRTIVE`(`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`),环境 **`staging`**(与 `production` 并列)。
- **服务:** `web` + `worker`(手动 `railway up` 部署分支)+ `Postgres`(staging 专用库)。
- **隔离:** staging 有**自己的** Railway Postgres;prod 的 Neon 库(`neondb`)与 staging 零关联。
- **登录:** email/password(不需要 Google)。founder 账号 `tools@belcort.com`(founder-admin;邮箱已在 staging 库里直接标记为已验证)。
- **⚠️ 生成 provider:`byteplus` → staging 上每张图/每条视频都花真钱**(宪法 2!测试前三思;改成 mock 是待建 S1 切片的第一件事)。
- **⚠️ 存储:** `r2`,**与 prod 共用同一个 bucket**(内容寻址、低冲击,但要知道)。

## 它是怎么建成的(以及隔离在哪)
- 用 `railway environment new staging --duplicate production` 建成 → 复制了 prod 的服务配置 + **全部** secrets(secrets 只存在 Railway 上,agent 全程看不到值)。
- staging 库 = 只在 staging 环境里 provision 的专用 Railway `Postgres` 服务。staging 的 `web`+`worker` 的 `DATABASE_URL` 与 `DATABASE_URL_POOLED` = `${{Postgres.DATABASE_URL}}`(解析到 `postgres.railway.internal`)。prod 的 `DATABASE_URL`(Neon)未被改动。
- 域名/登录相关变量已按 staging 覆盖:`BETTER_AUTH_URL`、`NEXT_PUBLIC_BETTER_AUTH_URL`、`AUTH_URL` = 上面的 staging URL。

## ⚠️ 已知坑 / 事故记录(2026-07-06)—— 必读
`railway environment new --duplicate` **会立刻用复制来的配置自动部署**,包括复制来的
prod `DATABASE_URL`(Neon)。建环境时的一次一次性 staging 部署因此对 **prod 的 Neon 库**
跑了 `prisma migrate deploy`(web 容器每次启动都会先跑迁移,见 `apps/web/Dockerfile:35`)。
- **实际影响:零** —— 该分支没有新增 migration,迁移是 no-op(已用 `git diff main..HEAD -- packages/db/prisma/migrations` 为空验证,prod schema/数据未变)。
- **正确建环境流程(彻底避开这个窗口):**
  1. `railway environment new staging --duplicate production`;
  2. **立刻**给 staging provision 专用库并覆盖 `web`+`worker` 的 `DATABASE_URL` + `DATABASE_URL_POOLED` —— **不要**用 `--skip-deploys`,让它重新部署、把还挂在 prod 库上的自动部署顶掉;
  3. 然后才做其它事。
- **教训:** duplicate 之后要默认「服务已经在用复制来的 prod DB URL 自动部署了」,第一件事永远是隔离数据库。

## 铁律(每个 agent,不可协商)
- **每次 `railway up` / 跑迁移 / 改变量之前:** 先 `railway status`,确认输出 `Environment: staging`。**绝不**在 `production` 上操作。
- **绝不**在 link 到 `production` 的目录里 `railway up`(那等于直接部署 prod)。
- **绝不**对 prod 跑迁移。staging 的迁移只打 staging 的 Postgres。
- staging 生成**当前仍花真钱**(`byteplus`);staging 资产写进**与 prod 相同的 R2 bucket**。

## 部署一个分支到 staging
```bash
PROJ=b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d
railway link -p $PROJ -e staging -s web
railway status | grep -i Environment        # 必须打印: Environment: staging
railway up --ci --detach                     # 把当前目录部署到 staging web
railway link -p $PROJ -e staging -s worker && railway up --ci --detach   # worker 同理
```

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
# 1. 注册
curl -X POST "https://web-staging-7901.up.railway.app/api/better-auth/sign-up/email" \
  -H "Content-Type: application/json" -d '{"email":"<email>","password":"<pw>","name":"<name>"}'
# 2. 在 staging 库里直接标记已验证(BetterAuthUser → 表 ba_user)
psql "<staging DB url>" -c "UPDATE ba_user SET \"emailVerified\"=true WHERE email='<email>';"
# 3. 然后即可登录: POST /api/better-auth/sign-in/email
```

## 看日志 / 查变量
```bash
railway logs -e staging -s web       # 或 -s worker
railway variables -e staging -s web --kv | grep <KEY>
```

## 未记录待补(建环境时没留档,S1 切片核实后回填此处)
- staging 的 `STRIPE_SECRET_KEY` 是 live 还是 test?(duplicate 复制了 prod 全部 secrets,**疑为 live,优先核实**)
- staging 的 `AUTH_ALLOWED_EMAILS` 白名单现值(除 founder 外还有谁)。
- staging 的 `META_APP_ID/SECRET`、`SENTRY_DSN`、`RESEND_API_KEY` 是否被复制、是否该清空。
- staging 的 web/worker 是否连着 GitHub 自动部署触发器(duplicate 是否连 trigger 一起复制了)——若在,track 的是哪个分支。
- staging Postgres 的规格与磁盘水位。
