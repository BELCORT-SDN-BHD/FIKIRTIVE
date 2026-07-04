# prod 坏了,你怎么知道 —— 事故可见性一页纸(2026-07-04)

> 背景:2026-07-04 盲区扫描确认,此前 prod 出故障**没有任何东西会通知你**
> (审计原话:一个坏掉的 prod 视频流程 "live and undetected")。本页是修复后的
> 完整地图:出事时信号从哪来、你去哪看、按什么顺序查。

## 三层信号(从"自动叫你"到"你主动看")

### 1. /api/health —— 外部监控的探测点(自动叫你,需一次性接线)
- `GET https://<prod域名>/api/health`(免登录、零敏感数据)返回:
  - HTTP **200** + `{ ok:true, db:"up", worker:"up|stale|unknown" }`
  - HTTP **503** = 数据库不可达(web 本身还活着才答得出 503;web 全挂 = 超时/无响应)
  - `worker:"stale"` = 后台 worker ≥5 分钟没心跳(生成/发布/回收全停摆)
- **接线(你做一次,五分钟)**:注册 [UptimeRobot](https://uptimerobot.com) 免费档 →
  加 HTTP(s) 监控指向上面的 URL → 告警条件选 **Keyword**,关键词填 `"worker":"up"`
  (missing 时报警)→ 通知渠道填你的邮箱/Telegram。这样 web 挂、库挂、worker 挂
  三种情况都会**主动叫你**。
- Railway 侧(可选加固):service Settings → Health Check Path 填 `/api/health`,
  部署起不来会自动回滚到上一个版本。

### 2. Sentry —— 报错聚合(自动记录,配了 DSN 才生效)
- web + worker 都已接 `@sentry/node`,但**只在 Railway 设了 `SENTRY_DSN` 时生效**,
  仓库里查不到 prod 是否已设 —— **去 Railway 两个 service 各确认一次**。
- 设好后在 Sentry 里配 Alert rule(new issue → email),否则只记录不叫人。
- Stripe 争议/退款(charge.dispute.created / charge.refunded)现在会打 Sentry
  warning + 写 ActionEvent(type: credits.dispute / credits.refund)—— 有人拒付
  时你会被叫到;**扣不扣回该用户的 credits 是你的决定**,系统不自动动账。
  - ⚠️ **代码就绪 ≠ 事件会来**:Stripe 只推送你在 endpoint **订阅**了的事件。
    去 Stripe Dashboard → Developers → Webhooks → 选中 prod 的 webhook endpoint →
    "Select events" 里勾上 `charge.dispute.created`、`charge.dispute.closed`、
    `charge.refunded`(现有的 `checkout.session.completed` /
    `checkout.session.async_payment_succeeded` 保留)。不勾 = 代码永远收不到、
    告警永不触发。这一步只有你能做,和 UptimeRobot 接线同级。

### 3. Admin 面板 —— 你主动看(已有)
- `/admin/system`:队列积压(QUEUED/GENERATING/FAILED)+ System Health
  (含 BytePlus 资源包余量告警,需在 Railway 设 `BYTEPLUS_RESOURCE_PACK_USD`)。
- `/admin/cost`:30 天真实成本聚合。
- `/admin/audit`:ActionEvent 流水(充值/争议/Meta 数据删除等都有痕)。

## 出事了按这个顺序查
1. **用户报错/监控报警** → 开 `/api/health`:503 = 库;`worker:stale` = worker;
   200 全 up = 应用层问题,看下一步。
2. **Railway** → 两个 service 的 Deployments(最近一次部署是不是刚好在出事前?)
   + Logs(搜 `[worker]`、`error`)。坏部署 → Rollback 按钮回上一版。
3. **Sentry**(配了 DSN 的话)→ 最新 issue 的堆栈直接贴给 agent 修。
4. **数据库** → Neon 控制台看连接数/存储;(开了 PITR 的话)可回滚到时间点。
5. 找 agent:把上面看到的贴进会话,说"诊断这个"。

## 已知边界(诚实清单)
- UptimeRobot/Sentry 告警规则是**外部服务配置**,仓库管不到 —— 本页第 1/2 节的
  接线动作只有你能做,做完这页才真正闭环。
- worker 心跳写库失败只降级为 `stale` 信号,不会让 worker 崩(设计如此)。
- 日志仍是 Railway stdout(无长期留存);要留存需接 Logtail/Axiom 类服务,暂缓。
