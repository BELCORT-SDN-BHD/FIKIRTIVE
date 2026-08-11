# Worker 拆两个服务(#796 / #760)—— 运维怎么落地

> 本页描述**仓库里已经存在的能力**和落地时要做的动作,不报告任何 live 环境的现状。
> Railway 上现在有几个服务、各自的变量是什么,必须现场查;查不到写 `Unknown`。
> 把生产配置搬进仓库是 #797 的活,本页只讲这一次拆分要按什么形状做。

## 一句话

同一个 worker 镜像,靠 `WORKER_ROLE` 分成两种服务:**算力型**扛 ffmpeg,**等待型**扛供应商等待。
不设 `WORKER_ROLE` 就是今天的单服务(`all`),所以这次改动可以先合、后拆,两步之间没有断档。

## 两个服务

| | 算力型 `WORKER_ROLE=compute` | 等待型 `WORKER_ROLE=wait` |
|---|---|---|
| 队列 | `ingest` `render` `caption` | `gen` `refgen` `research` `publish` |
| 在忙什么 | ffmpeg / ffprobe / whisper —— 吃 CPU 和内存 | 等 BytePlus / LLM / Meta 回话 —— CPU 基本闲着 |
| 怎么扩容 | **加副本 + 调大容器**(进程内并发恒为 1) | **调进程内并发**(`GEN_CONCURRENCY` 等) |
| 清道夫 / 发布调度 / 夜间备份 | 不跑 | 跑 |
| 心跳 | 跑 | 跑 |

镜像仍然只有 `apps/worker/Dockerfile` 一个,两个服务用同一个镜像、同一条启动命令,只差环境变量。

## 落地步骤

1. 现有 worker 服务:**不动**。它没有 `WORKER_ROLE`,继续按 `all` 跑,行为跟今天完全一样。
2. 新建一个服务,同 repo、同 Dockerfile,设 `WORKER_ROLE=wait`,其余变量与现有 worker 一致。
3. 确认它的启动日志里有 `role=wait — consuming gen×4, refgen×2, …`,再把**原**服务改成
   `WORKER_ROLE=compute`。顺序是这样的原因:先补上等待型,再把原服务收窄,中间任何一刻
   每条队列都至少有一个消费者。
4. 观察一轮之后,按需要给算力型加副本 / 调容器规格,给等待型调并发。

回退:把 `WORKER_ROLE` 从原服务上删掉(回到 `all`),再把新服务停掉。不需要回滚代码。

## 并发怎么定,以及为什么不能拍脑袋

- 供应商额度是**按账户**算的:2026-08-08 用 `arkcli models get` 实测,三个视频模型都是
  `concurrent_requests: 10` / `create_task_rpm: 600`。
- `gen` 和 `refgen` 打的是同一个账户,所以要按**它们的和**算,还要再乘副本数:

  ```
  replicas × (GEN_CONCURRENCY + REFGEN_CONCURRENCY) ≤ 8      # 10 减 2 的余量
  ```

- worker 每次启动都把这行算术打进日志(`provider concurrency: gen 4 + refgen 2 = 6 per replica …`),
  但它**不知道副本数** —— 那一步的乘法只有你能做。超了额度的后果是 429,商家看到的是生成失败。
- 单个进程自己就超出可用额度时,启动日志会有一条 WARNING。

## 数据库连接池

`DB_POOL_MAX` 不设时,worker 按自己的并发算默认值(每条并发 2 条连接 + 4 条给定时器)。
等待型默认并发合计 10 ⇒ 池上限 24。**建议就让它不设**;如果你按副本数手算过一个更小的值,
worker 会保留你的值并在启动时警告 —— 它不覆盖你的决定,因为只有你知道副本数。

## web 启动时的迁移(同票处置)

`apps/web/Dockerfile` 的启动命令从 `migrate:deploy && next start` 换成了
`node apps/web/scripts/boot.mjs`:

- 迁移最多重试 3 次(退避 2s / 4s),盖住 pooler 抖动这类瞬时故障;
- 三次都失败:**照样把网站起起来**(旧 schema 上的站点强过没有站点),同时
  日志打醒目横幅、Sentry 记一条、`/api/health` 的 body 里变成 `"migrations":"failed"`。

代价必须记住:一次滚动发布里,迁移失败但容器健康,Railway 会用新代码顶掉旧版本 ——
于是新代码跑在旧 schema 上。所以 `"migrations":"applied"` 这个关键词必须进外部监控
(接线属于 #793)。在那之前,每次部署后人工看一眼 `/api/health` 的这个字段。

## 现场排查

- 「我的任务没人干」——先看目标服务启动日志的 `role=… — consuming …` 那行:队列不在里面,
  就是角色配错了,不是队列坏了。
- 拆完之后 `/api/health` 的 `worker` 字段只代表**至少有一个** worker 在写心跳,不区分角色。
  按角色分别告警属于 #793(仪表盘点亮)。
