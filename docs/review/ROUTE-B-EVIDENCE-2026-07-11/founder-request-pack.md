# 给 founder 的证据请求包(D7 审计 · 不急但越早越好)

> 这五件事只有你能拿到,都是只读、零花费。拿到多少算多少;不给的项我会在审计里
> 标「Unknown」并如实写进最终报告。**任何时候都不要贴整份环境变量或密钥。**

## 1. 三位真实用户的差评原话(最重要)

把他们的原话(聊天记录截图/转述都行)发我。这是全案唯一的「真实用户证据」,
直接决定「用户旅程哪里断了」那份地图的可信度。

## 2. 生产数据库:你选一个

产品到底被用到什么程度,只有生产数据库知道。三个选项:
- **A. 你自己跑**:下面的 SQL 全是只读统计(只有数字,没有内容、没有密钥),
  你在 Neon 控制台粘贴运行,把结果发我;
- **B. 给我只读副本/只读连接**,我跑完即弃;
- **C. 不给**:相关结论标 Unknown,「没有行为数据管道」本身会作为审计发现入报告。

```sql
-- 有多少真实租户/用户
SELECT count(*) AS orgs FROM "Organization" WHERE "deletedAt" IS NULL;
SELECT count(*) AS users FROM "ba_user";
-- 生成用量与花费状态
SELECT "status", count(*) FROM "GenJob" GROUP BY 1;
SELECT count(*) AS paid_jobs FROM "GenJob" WHERE "spent" = true;
-- 每周生成量走势
SELECT date_trunc('week', "createdAt") AS wk, count(*) FROM "Generation" GROUP BY 1 ORDER BY 1;
-- 钱:账本分类汇总 + 有没有真实购买
SELECT "kind", "source", count(*), sum("balanceDelta") AS bal_delta FROM "CreditLedger" GROUP BY 1,2 ORDER BY 1,2;
-- Otto 对话量,近 30 天按日
SELECT date_trunc('day', "createdAt") AS d, count(*) FROM "ChatMessage" WHERE "createdAt" > now() - interval '30 days' GROUP BY 1 ORDER BY 1;
-- 排期/发布用没用过(表不存在就跳过)
SELECT "status", count(*) FROM "ScheduledPost" GROUP BY 1;
```

## 3. 生产环境的两个事实(Railway 网页版看,别贴 env 全文)

- **worker 服务** production 最近一次部署对应的 commit(短 SHA 即可)——
  web 我们已知是 `7ed7ac22`,worker 不知道;
- 这几个**开关名**在 production 的值(只要这几个名字,别的不用):
  `GENERATION_PROVIDER`、`STORAGE_DRIVER`、`AUTH_ENABLED`、`SENTRY_DSN`(有没有设,不用值)、
  以及任何以 `PUBLISH`/`META` 开头的开关名和值。

## 4. Stripe 现状(dashboard 看一眼)

- Payments 里有没有**真实成交**?几笔、大约金额?
- 现挂的充值包(Prices)是哪几档?

## 5. 报错监控

- Sentry(或任何报错监控)在生产上收不收得到错误?能看到最近的报错列表吗?
  如果根本没接,这本身是一条审计发现,不用补救,告诉我「没有」就行。
