# 仪表盘接线(runbook,不是状态表)

> 上线债 #1(#793)。这一页描述**仓库里已经存在的形状**,以及**必须在生产侧一次性做完、
> 仓库永远证明不了的那几步**。仓库能证明代码存在,不能证明 Sentry project 建了、DSN 配了、
> alert rule 存在、探针在拉、通知真的送到人手上。任何一项没有当场验过就写 `Unknown`。
> 本页不授予 deploy、变量修改或外部服务写入权限。
>
> 事故发生时的诊断顺序在 `docs/ops/incident-visibility.md`;这一页只管**平时**的接线。

---

## 一、这一票之前的盲区(为什么要做)

| 盲区 | 之前 | 现在(仓库形状) |
| --- | --- | --- |
| 商家浏览器里崩了 | 一条信号都没有,只能等商家开口 | `instrumentation-client.ts` + `app/global-error.tsx` 把浏览器崩溃送出去 |
| 系统放弃掉的活 | 七条死信队列只建不看 | `/api/ops/dlq` 巡检七条队列,非空即 503 并上报 |
| 谁在拉探针 | 没有人拉 `/api/health` | 三个免费 uptime monitor 的定义写在下面(生产侧动作) |
| 谁会被通知 | 零推送 | 一条 Sentry alert rule 的定义写在下面(生产侧动作) |

---

## 二、仓库里已经可以验证的部分

### 浏览器错误上报

- `apps/web/instrumentation-client.ts` —— Next.js 在 hydrate 前执行。没有
  `NEXT_PUBLIC_SENTRY_DSN` 就完全不 init(本地与 CI 零副作用),判据在
  `apps/web/lib/sentry-browser.ts`,被 `lib/__tests__/sentry-browser.test.ts` 穷举。
- `apps/web/app/global-error.tsx` —— 根 layout 自己炸掉时唯一还会渲染的东西。它自带
  `<html>/<body>`,把事件送出去,并把 Next.js 的 `digest` 显示给商家:那一串是把商家
  截图和服务端日志对上的唯一钥匙。
- 采样与隐私:`tracesSampleRate: 0`(不采性能追踪)、`sendDefaultPii: false`
  (绝不自动附带 IP / cookie / 请求头)。**商家的 data 商家的权利**:崩溃报告是诊断
  信号,不是把商家资料搬去第三方的通道。
- **不接 `withSentryConfig`**:那条路要在构建期把 source map 传给外部服务,需要一枚
  构建期凭据。没有它照样收得到事件,只是堆栈是压缩后的。要不要接见第四节。

### 死信巡检

七条死信队列(单一名单在 `packages/core/src/dead-letters.ts`,新增队列漏登记会被
`dead-letters.test.ts` 抓住):

| 队列 | 放弃掉的是什么 |
| --- | --- |
| `ingest.dlq` | 商家刚上传的素材,探测元数据失败 |
| `render.dlq` | 成片渲染 |
| `refgen.dlq` | 参考图生成 |
| `gen.dlq` | 分镜 / 会话生成(**花过钱的**) |
| `caption.dlq` | 字幕转写($0) |
| `research.dlq` | Otto 深度研究(**花过钱的**) |
| `publish.dlq` | 定时发布 |

- `GET /api/ops/dlq` —— 免鉴权(和 `/api/health` 同一个理由:外部 uptime 服务没有 session)。
  - `200 {"ok":true,"deadLetters":"clear"}` = 七条**全部查得到,且一条不剩**
  - `503 {"ok":false,"deadLetters":"backed-up"}` = 有死信
  - `503 {"ok":false,"deadLetters":"unknown"}` = 有队列查不到、计数读不懂,或库读不到
  - **只有「查得到且是空的」才配 200**:一个证明不了自己看得见的探针报平安,比没有探针
    更坏。少一条队列(例如 worker 还没建 `ingest.dlq`)一律算 unknown,不算 clear。
  - 外面读得到的只有这三个字:**没有条数、没有队列名、没有任何商家数据**。明细走 Sentry。
  - 这条路径是**只读**的:一次 SELECT,不建队列、不写任何一行。
  - 两次真查之间至少隔 30 秒(免鉴权路由不能变成 DB 压力源)。
- 不是 `clear` 就上报一次 Sentry,两句固定标题(**故意不带条数**,否则条数一变就开新
  issue、alert rule 跟着重复轰炸;条数在 payload 的 `total` / `offenders` 里):
  - `Dead-letter queues are not empty: <队列名>` —— 有活被放弃了,去看那些活
  - `Dead-letter queues could not be read: <队列名>` —— 队列本身读不到,去看队列
  - 两句都带 tag `probe=dead-letters`,所以下面那条可选 alert rule 一条就能收全。
- **为什么巡检住在 web 而不是 worker 的 reaper tick**:最需要出声的那一刻恰恰是 worker
  卡死或崩溃重启的那一刻,跑在 worker 里的巡检那时正好也不跑。放在 web 侧,一个外部探针
  同时替 web、DB 和死信三件事作证,worker 死透了它照样出声。代价是**探针必须真的被人拉**
  —— 见第三节。
- 计数**直接查 job 表**,不读 pg-boss 在 `pgboss.queue` 上的缓存计数 —— 那份缓存只有
  pg-boss 的 supervisor 会刷新,而 web 侧句柄 `supervise: false`,刷新只可能来自 worker。
  读缓存等于说「worker 死了之后我就一直报 0」,恰好废掉上一条承诺。场地证据在
  `apps/web/lib/__tests__/dlq-watch-live.test.ts`:真 Postgres、真 pg-boss、全程无
  supervisor,写一条死信之后缓存计数仍是 0 而探针照样变红。

### 已有的活性探针(这一票没有改语义,只是照抄 #796 的口径)

两个端点回答的是**两个不同的问题**,把它们当成一件事是这一页 r1 的错(判官 r1 P1):

- `GET /api/health` —— **存活**:这个 Web 进程还答不答得出话。**HTTP 恒为 200**(#796 起),
  库读不到只把 body 里的 `db` / `worker` 写成 `unknown`,**状态码不变**。所以
  **拿它判断不出数据库好不好** —— 只盯它的非 200,一次库故障会全程绿着过去。
  `{ ok:true, db:"up|unknown", worker:"up|stale|unknown", workers:{…}, migrations:"applied|failed" }`,
  worker 心跳超过阈值显示 `stale`。
- `GET /api/ready` —— **就绪**:这个容器该不该接流量。**迁移未就位或 DB 不可达 → 503**;
  都正常 → 200。**数据库故障要靠这个端点才看得见。**
- 平台侧只有一个 HTTP 探针:`apps/web/railway.json` 的 `healthcheckPath`,它是**部署闸**,
  现指 `/api/ready`(C1b ② 之前误指恒 200 的 `/api/health`,等于没有闸)。重启不读 URL,
  走 `restartPolicyType: ON_FAILURE`(进程退出才触发)。诊断顺序见
  `docs/ops/incident-visibility.md`。

---

## 三、生产侧残留清单(仓库做不到,交 Founder 窗口)

> 这几步全部是外部服务的一次性动作。**这一票没有、也不会自动执行任何一条**;合并不等于
> 接通。每一条都附「怎么证明它真的成了」。

| # | 动作 | 在哪做 | 完成证据 |
| --- | --- | --- | --- |
| 1 | 确认 / 创建 Sentry project,取得 DSN | Sentry | 手上有 DSN 字符串(不进仓库、不进 issue) |
| 2 | web service 设 `NEXT_PUBLIC_SENTRY_DSN` | Railway → web | 变量存在;**改完必须重新构建**(`NEXT_PUBLIC_*` 在构建期被内联进浏览器包,重启无效) |
| 3 | web / worker service 确认 `SENTRY_DSN` 已设 | Railway | 变量存在;服务端事件能收到 |
| 4 | 建 alert rule(见下) | Sentry | 规则存在,且第 7 步真的收到过通知 |
| 5 | 建 uptime monitor ×3(见下:health / ready / dlq) | 免费 uptime 服务 | 三个 monitor 都存在、最近一次探测成功、通知渠道已验证 |
| 6 | (可选)接 source map 上传 | 需要构建期凭据 | 单独决定,不在这一票 |
| 7 | 受控端到端验证一次 | —— | 见第五节 |
| 8 | 待 #872 合并后,把 `NEXT_PUBLIC_SENTRY_DSN` 登记进 env 契约 | 仓库 | 契约文件里能查到这个名字 |

### Alert rule(至少这一条)

```
Name:   Production error — page Founder
When:   A new issue is created
        OR the issue changes state from resolved to unresolved
If:     the event's environment equals production
Then:   send a notification to <Founder 的渠道>
Rate:   最多每 30 分钟一次(同一 issue)
```

可选的第二条,给死信单独开一个更响的门(死信意味着**已经有商家的活被放弃了**,其中
`gen.dlq` 与 `research.dlq` 是花过钱的):

```
Name:   Dead letters — page immediately
When:   A new issue is created
If:     the event's tags match  probe  equals  dead-letters
Then:   send a notification to <Founder 的渠道>
Rate:   最多每 30 分钟一次
```

### Uptime monitor(三个)

免费托管即可(vendor-first,按当天的免费额度选,例如 UptimeRobot 或 Better Stack 的免费档;
**账号与凭据不进仓库**)。

三个端点各答一个问题,少一个就有一整类故障没人看得见:

```
Monitor 1  名称: fikirtive web (liveness)
           URL:  https://<生产域名>/api/health
           周期: 5 分钟
           告警: HTTP 非 200 —— 这里的非 200 只可能是「进程没了 / 域名打不开」
           加分: 关键字监控 "worker":"up" —— 抓 web 活着但 worker 死了的那一类
           注意: 这个端点**恒回 200**,数据库故障它照样 200。别拿它当 DB 监控。

Monitor 2  名称: fikirtive database (readiness)
           URL:  https://<生产域名>/api/ready
           周期: 5 分钟
           告警: HTTP 非 200(503 = 迁移没跑成,或 DB 不可达)
           为什么单开一个: #796 之后 DB 故障只在这里显形;没有这一条,库挂了整套监控全绿。

Monitor 3  名称: fikirtive dead letters
           URL:  https://<生产域名>/api/ops/dlq
           周期: 5 分钟
           告警: HTTP 非 200,连续 2 次失败才通知(容忍一次部署窗口的抖动)
```

---

## 四、这一票**没有**做的事(别当成已完成)

- 没有注册任何外部服务、没有写入任何真实凭据、没有触碰生产环境变量。
- 没有接 source map 上传 —— 生产堆栈是压缩后的。
- 没有性能追踪(`tracesSampleRate: 0`)、没有 session replay。
- 没有在管理面加死信面板。死信明细目前只在 Sentry 里看得到;要不要做成 admin 面(带
  tenant 约束与 capability 检查)是另一票。
- 没有碰 `/api/health` 与 `/api/ready` 的任何语义 —— 上面写的是 #796 定下的既有行为,
  这一票只是把 runbook 对齐到它。

---

## 五、接通验收(缺一条就只能说「代码在,送达未确认」)

沿用 `incident-visibility.md` 的通知闭环标准:

1. **浏览器崩溃**:在生产上让一个页面真的抛错一次(受控),确认 Sentry 收到、`surface`
   tag 是 `global-error`、`digest` 对得上服务端日志。
2. **死信**:确认 `/api/ops/dlq` 当前返回 200。要验 503 那一路,只在受控窗口里做,并在
   验完后把那条死信清掉 —— **不要**为了测试故意让商家的活失败。
3. **DB 可见性**:确认 `/api/ready` 当前返回 200,并确认 Monitor 2 指的是它而不是
   `/api/health` —— 指错了的话,库挂了整套监控依然全绿。
4. **探针**:把 monitor 暂停 / 指向一个必然失败的地址一次,确认通知真的送到人手上。
5. **去重**:确认同一个故障不会在 30 分钟内轰炸多次。
6. 全部证据写进当次 issue,附时间与命令;**不要**回写到本页变成新快照。
