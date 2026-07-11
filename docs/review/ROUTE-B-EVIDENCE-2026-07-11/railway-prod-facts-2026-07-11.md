# Railway 生产事实(2026-07-11,控制面亲查,只读;founder 委托)

> Provenance:Observed(railway CLI,登录身份 tools@belcort.com,项目 FIKIRTIVE)。
> 全程未打印任何密钥值;变量只取名字 + 少数非敏感开关的值。

## 部署

| 服务 | 最新 production 部署 | commit | 部署方式 |
|---|---|---|---|
| worker | 2026-07-09T21:41:26Z,SUCCESS(deployment `25718112…`) | **元数据无 commitHash**(只有镜像指纹 sha256:0fb06f41…) | CLI `railway up`(cliCaller=claude_code) |
| web | 2026-07-10T11:37:02Z,SUCCESS | **元数据无 commitHash** | CLI `railway up`(cliCaller=claude_code) |
| (对照)旧部署 | 2026-07-06,REMOVED | bff7f502(当时走 repo 触发) | nicksgan-belcort |

**发现:CLI 目录上传式部署不带 commit 记录 → 当前生产内容无法从 Railway 反查对应代码版本。**
状态账旧记录「web deploy 7ed7ac22」为部署 ID 而非 commit。生产真相只能靠部署时间 +
当事 session 记录推断:worker ≈ 2026-07-09 晚间的本地目录,web ≈ 2026-07-10 的本地目录,
两者均早于 #226/#227/#228(07-11 合并),故 L1 发布链、07-11 治理件不在生产。

## worker production 环境变量(21 个,名字全量)

ANTHROPIC_API_KEY, BYTEPLUS_API_KEY, DATABASE_URL, FAL_KEY, GENERATION_PROVIDER,
OTTO_DEFAULT_VIDEO_MODEL, R2_*(4), RAILWAY_*(9), STORAGE_DRIVER

安全开关值:`GENERATION_PROVIDER=byteplus`(**真钱供应商在生产是开着的**),`STORAGE_DRIVER=r2`。
**`SENTRY_DSN` 未设** → 生产 worker 无报错监控(回答 founder 请求包第 5 题:没有)。
无任何 `PUBLISH*`/`META*`/`MEDIA_PROXY_SECRET`/`PUBLIC_BASE_URL` 变量 → 与 E4 结论一致:
L1 发布链即便部署了也是 fail-closed。

## 对审计的影响

1. 发版可追溯性缺口(release provenance):生产 ↔ commit 对不上,属 Gate 0 一级运营发现。
2. 真钱面:byteplus LIVE + 0 用户 → 唯一能花钱的人是 founder 自己;是否切回 mock 到上市前,
   属 founder 决定(选项已在报告中呈)。
3. 观测性:生产无 Sentry;founder 之前答「不知道」——现在答案是「没有」。
