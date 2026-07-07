# Staging 环境 + 发版流程设计(A 线-1 · 2026-07-08)

> 创始人 2026-07-07 指示:「关于 staging 的,那个也请你设计好。包括接下来每个版本要如何设计这样。」
> 本 spec = staging 环境的目标定义 + 今后每个版本的发版流程。**待 founder 过目后动工**;
> 文中逐项标注「现状✅」(已存在、已验证)与「待建🔨」(需 founder 批准后实施)。
> 现状事实的操作手册见 `docs/runbooks/staging.md`(同 PR 收编)。

---

## 0. 现状一句话

staging 已于 2026-07-06 建成(Railway 第二环境,DB 已隔离✅),但**生成走 byteplus 花真钱❌、
与 prod 共用同一个 R2 bucket❌、部署靠手动 `railway up`❌**;prod 侧仍是「merge main 即上线」:
push main → Railway 自动部署 web+worker → web 容器每次启动先跑 `prisma migrate deploy`
(`apps/web/Dockerfile:35`)→ 直接改 prod 库。无 tag、无 GitHub Release、无 CHANGELOG。
另:repo 迁入 BELCORT-SDN-BHD org 后 main 已有 ruleset 硬保护(`protect-main`:强制 PR +
required status checks + 禁删除/强推)——AGENTS.md 与 ci.yml 里「无分支保护」的说法已过时,属现状事实修正。

---

## 1. staging 环境定义

**平台:现状✅** Railway 项目 `FIKIRTIVE`(`b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`)的
`staging` 环境(与 `production` 并列),服务 `web` + `worker` + 专用 `Postgres`。
URL:https://web-staging-7901.up.railway.app 。不另起新平台。

**四条铁律(staging 的存在意义):**
1. **绝不连 prod 数据库。** 现状✅ —— staging 用自己的 Railway Postgres(`postgres.railway.internal`),prod 的 Neon 不被引用。
2. **staging 永不花真钱(宪法 2)。** 现状❌ —— 生成 provider 仍是 `byteplus`。待建🔨:`GENERATION_PROVIDER=mock`(代码已内建 $0 确定性 mock provider,且无法识别的值一律回落 mock —— fail-safe,`packages/generation/src/index.ts`);Stripe 换 `sk_test_…` + staging 自己的 webhook secret(环境复制自 prod,**大概率带着 live key,需第一时间核实**);Meta 侧 `META_GRAPH_MOCK=1`。
3. **存储与 prod 隔离。** 现状❌(共用 bucket `artlio`,内容寻址所以低风险,但备份任务与清理策略会互相掺沙子)。待建🔨:独立 R2 bucket `artlio-staging`(同一 Cloudflare 账号,新建 API token 只授这个 bucket)。不用 local driver —— Railway 容器无持久盘,重部署即丢文件。
4. **不对公网裸奔。** 现状✅(基本满足)—— Better Auth 登录墙在 production build 下 fail-closed(`apps/web/proxy.ts`),且注册后还需邮箱在 `AUTH_ALLOWED_EMAILS` 白名单内才可用。待建🔨(可选,优先级低):HTTP basic-auth 外层(挡爬虫与登录页探测);现有登录墙已挡住实质访问,此项不阻塞其它切片。

**env 差异表(prod vs staging 目标值):**

| 变量 | production | staging(目标) | 现状 |
|---|---|---|---|
| `DATABASE_URL` / `_POOLED` | Neon prod | `${{Postgres.DATABASE_URL}}`(staging 专用) | ✅ 已隔离 |
| `GENERATION_PROVIDER` | `byteplus`(真钱) | `mock`($0) | ❌ 仍 byteplus |
| `BYTEPLUS_API_KEY` / `FAL_KEY` | 真 key | 删除/留空(mock 不读) | ❌ 复制自 prod |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | ⚠️ 未核实(疑为 live) |
| `STRIPE_WEBHOOK_SECRET` | prod endpoint 的 | staging 自建 test-mode endpoint 的 | ⚠️ 未核实 |
| `R2_BUCKET`(及 R2 凭证) | `artlio` | `artlio-staging` | ❌ 共用 |
| `BETTER_AUTH_URL` 等三个 URL | prod 域名 | staging URL | ✅ 已覆盖 |
| `AUTH_ALLOWED_EMAILS` | 真用户 | 只留 founder + 测试员 | ⚠️ 未核实 |
| `META_APP_ID/SECRET` | 真 app | `META_GRAPH_MOCK=1`,凭证留空 | ⚠️ 未核实 |
| `SENTRY_DSN` | prod 项目 | 留空或独立项目(免报警噪音) | ⚠️ 未核实 |

⚠️ 项在 S1 切片中逐一核实并改正;核实结果回填 `docs/runbooks/staging.md`。

---

## 2. 发版流程(今后每个版本怎么走)

### 2.1 目标态(端到端)

```
分支 → PR(CI 三关绿:check / web-build / test)
    → 合并 main
    → staging 自动部署(Railway staging 服务 track main)      【待建🔨 S2】
    → 冒烟清单(§3 模板;登录/生成 mock/充值 test-mode/排期)
    → founder 或测试员在 staging 过一遍手
    → promote 上 prod = 把验过的 main SHA 推进 release 分支     【待建🔨 S3】
    → Railway production 服务 track release,自动部署 + 自动迁移
    → 打 tag vYYYY.MM.DD-n + GitHub Release
```

核心改变:**把「push main 即上 prod」改成「main 上 staging,promote 上 release 才上 prod」。**
自动迁移(容器启动即 `migrate deploy`)不必改 —— 它从此只在 promote 时碰 prod 库,而且同一套
migration 已先在 staging 库跑过一遍。

### 2.2 Railway 上怎么实现 promote(三个方案,推荐 A,待 founder 拍板)

- **方案 A(推荐):release 分支 = prod 的部署触发器。**
  一次性操作:Railway dashboard 里把 `production` 环境的 web+worker 的 tracked branch 从
  `main` 改成 `release`;`staging` 环境的 web+worker 接上 GitHub、track `main`。
  之后每次发版:`git push origin <验过的mainSHA>:release`(恒为 fast-forward)。
  优点:promote 是一条有审计痕迹的 git 命令,agent 可代跑、founder 可核对;tag 天然对齐;
  回滚可精确到 SHA。缺点:多一条长期分支(用 ruleset 同样保护起来)。
- **方案 B:prod 断开 auto-deploy,每次发版在 Railway dashboard 手点 deploy。**
  优点:零 git 变化。缺点:手点无审计、容易点错环境、agent 无法代跑 —— 不符「安全>效率>易管理」。
- **方案 C:GitHub Actions 监听 tag push 调 Railway API 部署。**
  优点:打 tag 即发版一体化。缺点:要把 Railway token 放进 GitHub secrets,多一块要维护、
  会坏的 CI;上线冲刺期不值。

**迁移步骤(方案 A,一次性,S3 切片):**
1. 从当时的 prod 在跑 SHA 建 `release` 分支并 push;给它加 ruleset(禁删除/强推)。
2. Railway `production` 环境 web+worker:tracked branch `main` → `release`(dashboard 操作,founder 或授权 agent)。
3. Railway `staging` 环境 web+worker:接 GitHub、track `main`、开 auto-deploy(S2 亦可先行)。
4. 验证:合并一个无害 docs PR → 确认 prod **没有**部署、staging 部署了;再 promote → 确认 prod 部署。

**过渡期折中(Railway 改线之前,即现在):** 「push main 即上 prod」暂时不变,因此凡需 staging
手测的改动(§3),必须在**合并前**把 PR 分支手动 `railway up` 到 staging 测过(命令见 runbook)
—— 即「先测后合」,测完才 merge。这正是 2026-07-06 canvas 分支的实际做法,延续即可。

### 2.3 版本号 · 发版记录 · 回滚

- **版本号:** 简单日期版 `v2026.07.08-1`(promote 当天日期 + 当日第 n 次)。不用 semver ——
  单产品连续交付,semver 的语义没有承载对象,日期版一眼可读(易管理)。
- **发版记录:** GitHub Releases,`gh release create v2026.07.08-1 --generate-notes`
  (自动聚合两次发版间的 PR 标题)。**不维护 CHANGELOG 文件** —— 少一份会漂移的文档;
  若 founder 想要面向用户的更新说明,再单独起(标注:此为备选项)。
- **回滚(两层,数据先行):**
  1. **应用回滚(分钟级):** Railway dashboard → production 服务 → Deployments → 上一个成功
     部署 → Redeploy(最快,不动 git);随后在 git 侧把 release 指回上一个 tag 并在 main 上
     revert 问题 PR(让 git 与线上重新一致)。
  2. **数据回滚:** migration **不会**自动回退。破坏性迁移已有 CI 闸
     (`check-destructive-migrations.sh`);真出事走 Neon PITR 或夜间备份恢复
     (`docs/runbooks/db-backup.md`,先本地演练再动真库)。
  - 回滚后 24h 内在 issue 里补一句事故记录(何时/什么坏了/怎么回的)。

---

## 3. 给未来 agent 的规则(发版纪律)

**必须过 staging 手测(冒烟清单全绿 + founder/测试员点头)才可上 prod:**
- 用户可见的 UI/交互改动(页面、画布、Otto 对话流);
- 钱路(spend/credits/Stripe/生成计费 —— 另须过 money-safety-review);
- schema migration(必须先在 staging 库跑过同一套 migration);
- 登录/auth/权限;对外发布与渠道(Meta 等);worker 任务逻辑改动。

**可以不过 staging 手测、CI 绿即走(但仍必须 PR,绝不直推 main):**
- docs-only、注释/文案 typo、测试-only、CI/脚本-only 改动。

**冒烟清单模板(staging 上,每次发版前;S2 落进 runbook 后以 runbook 为准):**
- [ ] 登录:email/password 登入 founder 账号,进得了主界面;
- [ ] 生成(mock):画布上生成 1 张图 → 出图、落位、可选中;Otto 聊天生成 → 产物落画布;
- [ ] 生成(mock)视频:确认弹窗仍在(创始人裁决:视频保留花费确认);
- [ ] 充值:Stripe test-mode 走一单(测试卡),credits 到账;
- [ ] 排期:建一条排期,列表可见;
- [ ] worker:`railway logs -e staging -s worker` 无红色异常;
- [ ] 回归:上一版本的核心路径(登录→生成→下载)仍通。

---

## 4. 待建切片(2-3 个 PR/工单,依次做;本 spec 待 founder 过目后动工)

| 切片 | 内容 | 性质 |
|---|---|---|
| **S1 · staging 断真钱 + 隔离补齐** | Railway staging env 改:`GENERATION_PROVIDER=mock`、清 BYTEPLUS/FAL key、Stripe 换 test key + test webhook、建 `artlio-staging` bucket 并换 R2 凭证、核实表格里全部 ⚠️ 项;结果回填 runbook(文档 PR 随行) | env 操作(founder 或授权 agent)+ docs PR |
| **S2 · staging 自动部署 + 冒烟清单落地** | Railway staging web+worker 接 GitHub track `main` 开 auto-deploy;冒烟清单定稿进 `docs/runbooks/staging.md`;AGENTS.md 补发版纪律一节(顺带修正「无分支保护」过时表述) | Railway 操作 + docs PR |
| **S3 · prod 改线 release 分支 + 首次正式发版** | §2.2 迁移步骤 1-4;首个 tag `vYYYY.MM.DD-1` + GitHub Release;做一次回滚演练(redeploy 上一部署)并记入 runbook | Railway 操作 + docs PR |

依赖:S1 独立可先行(最急 —— staging 现在每张图都花真钱);S2 不依赖 S1;S3 依赖 S2(staging
自动部署就位后 prod 才好断开 main)。全部 Railway 操作凡涉及 production 环境,执行前必
`railway status` 确认环境,并逐项知会 founder。

---

## 5. 与宪法/现有闸的关系

- 宪法 2(先问再花钱):staging 全 mock 后,staging 上的任何测试不再产生真实花费 —— 本设计
  把「问」的需要从日常冒烟里消掉,真钱验证仍按宪法逐次问 founder。
- 宪法 6(租户铁幕)/ 5(通道费):不受本设计影响;staging 库与 prod 库物理隔离。
- CI 三关、blueprint 完整性闸、destructive-migration 闸、schema-drift 闸:全部保留不动,
  本设计只是在它们**之后**加了一道人肉 staging 闸与一道 promote 闸。
- 蓝图:未触碰 `docs/BLUEPRINT.md`;本设计为纯流程/环境事务,不涉产品范围。
