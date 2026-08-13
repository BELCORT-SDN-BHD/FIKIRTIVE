# 生产形状(#797,工程评估债 #6 / #8)

> **性质:**这份文档描述仓库里现在声明了什么、还有什么没声明,以及部署窗口里人要做哪几步。
> 它**不是** Railway 状态台账:任何一个环境此刻是什么样,只有查那个环境本身才知道。
> 引用本文任何一条之前,先确认它说的是「仓库声明」还是「实际状态」。

## 一、这张票之前的病

四件事全都活在部署平台的控制台里,仓库看不见、review 不到、回滚不了:

1. **启动与重启策略**——用哪个 Dockerfile、失败怎么重启、跑几个副本。
2. **健康检查**——平台按什么判断一次部署算成功。
3. **环境变量**——49 个变量,漏配一个进程照样起来,然后在某条业务路径上变成怪病。
4. **两个服务是不是同一个部署**——web 与 worker 各自构建、各自重启,半成功的部署没人看得见。

再加上第五件:**CI 只在 PR 上跑**。两个 PR 各自绿、各自合,合并后的 main 可以是红的,而在
下一个人开 PR 之前没有任何东西会发现。

## 二、现在仓库里声明了什么

| 位置 | 声明了什么 |
| --- | --- |
| `apps/web/railway.json` | web 服务:Dockerfile 构建、健康检查 `/api/health`(300s 超时)、失败重启上限 10、副本 1 |
| `apps/worker/railway.json` | worker 服务:Dockerfile 构建、失败重启上限 10、副本 1。**无健康检查**——worker 不提供 HTTP |
| `packages/core/src/env-contract.ts` | 全部 env 变量:谁读、什么时候必需、什么形状、哪些必须 web/worker 同值 |
| `.env.example` | 同一份清单的人话版。与上面那份漂移即测试红 |
| `scripts/ops/smoke.sh` | 部署后烟测:`/api/health` 200 + 数据库可达 + 匿名页 `/login` 200 |
| `.github/workflows/post-merge.yml` | main 每次前进,重跑一遍与 PR 逐字相同的门 |

三处机器校验,每个 PR 都跑(`pnpm -r test`,即 `quality` 的 tests 门):

- `packages/core/src/env-contract.test.ts` —— 源码读的 env、契约、`.env.example` 三方对账。
- `apps/web/lib/__tests__/railway-config.test.ts` —— railway.json 指的 Dockerfile 存在、健康检查路径确有其路由且免鉴权。
- `apps/web/lib/__tests__/ci-workflows.test.ts` —— 必需检查 `quality` 只存在一处,没被新 workflow 抢名。
- `apps/web/lib/__tests__/smoke-script.test.ts` —— 烟测脚本喂坏形状必须红(否则它只是个永远返回 0 的摆设)。

## 三、仍然只活在控制台的部分(诚实清单)

这些**没有**进仓库,而且这张票也没有去改动它们——改动生产配置需要 Founder 对该次动作的明确授权:

- **每个服务的 root directory 与「配置文件路径」指向**。`railway.json` 要生效,服务设置里
  必须把 config-as-code 文件指到 `apps/web/railway.json` / `apps/worker/railway.json`,并把
  root directory 保持为 `/`(两个 Dockerfile 都从仓库根 COPY,pnpm workspace 需要完整上下文)。
  **这一步是部署窗口里人手做的**,做完之前仓库里这两个文件不生效。
- **环境变量的值**。契约声明的是名字与形状,值永远不进仓库。
- **卷、区域、域名、副本伸缩、cron 定时项**。仓库无从得知当前设置,不猜、不写。
- **哪个环境是生产**。烟测脚本刻意没有默认 URL,就是不让任何一次运行「顺手」打到生产。

## 四、部署窗口的动作顺序

1. 合并进 main → `post-merge.yml` 自动重跑一遍门。绿了再往下走。
2. (首次)在平台上把两个服务的 config-as-code 路径指到上表那两个文件,root directory 保持 `/`。
3. 部署。
4. 跑烟测,URL 由人填:

   ```
   scripts/ops/smoke.sh https://<环境域名> --require-worker
   ```

   或在 GitHub Actions 里手动触发 `post-merge` workflow,填 `base_url`。
   脚本只发 GET、不带凭据,对任何环境都不会改变它的状态。
5. 打开 admin → System health,看 **Deploy identity** 一行:

   - `in sync` —— web 与 worker 同一个 commit、同一份共享配置。
   - `code mismatch` —— 一个服务没部署完。重新部署落后的那个。
   - `config mismatch` —— **最贵的一种**。两个进程都活着,代码同版,但共享变量不是同一份;
     依赖两边同值的能力(发布、媒体代理)会静默失败。对照 `.env.example` 里标了
     「web + worker 必须同值」的那几项逐个核对。
   - `no worker heartbeat` —— worker 从没写过心跳。先看 worker 的部署日志。

## 五、开机 env 契约的行为

| 场景 | 行为 |
| --- | --- |
| 值的形状不对(64 位密钥写成 63 位、URL 少协议) | **任何环境**都报;生产退出,其它环境警告 |
| 生产缺必需项(`DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `STORAGE_DRIVER`) | 退出,由平台重启 → 表现为持续重启,而不是一个假装健康的进程 |
| 生产的 `STORAGE_DRIVER` 是 `local`(或未设) | 退出。**部署前必读**:见下面那一段 |
| 生产半配(`GENERATION_PROVIDER=byteplus` 却没 key;`STORAGE_DRIVER=r2` 却少一个 R2_*) | 退出 |
| 全组未配(如整条发布链) | 静默通过——上线前刻意 inert 是正常状态 |
| `next build` 期间 | 一律只警告(构建机器没有生产密钥是正常的) |
| 设了 `FIKIRTIVE_ENV_CONTRACT=warn` | 生产也只警告。逃生门:检查本身错了的时候,上线门不能把生产锁死 |

报错信息永远只含变量名与规则,**从不回显值**。

### `STORAGE_DRIVER` —— 部署前必须确认的一项

这是本次改动里唯一一个**可能挡住生产开机**的新要求,所以单独说清楚。

不设或设成 `local`,对象存储工厂会落 `LocalDiskStorage`:商家的每一张图、每一段视频写进容器
自己的盘。换一次部署容器就换了,文件跟着没;而且 web 与 worker 各写各的盘,一边存的另一边
根本看不见。这个形状不会抛任何错——正是「跑起来了、也没报错、但生产形状是错的」。

所以生产要求 `STORAGE_DRIVER=r2` 并配齐四个 `R2_*`。**部署窗口第一件事:先确认生产环境已经
设了它。** 如果没设,这次部署会开不起来(持续重启),那正是设计意图——但要在预期之内发生,
不要在半夜发现。真的需要先上线再补,`FIKIRTIVE_ENV_CONTRACT=warn` 可以放行一次,并把它记进
延后台账。

## 六、已知代价与残留

- **跑手**:`post-merge.yml` 与 `ci.yml` 同用 GitHub 托管的 `ubuntu-latest` + `postgres:16`
  服务容器(2026-08-11 Founder 修复账单后,#864 把 `ci.yml` 切了过去)。每次运行独占一台
  临时 VM,与 PR 的 `quality` 并行、互不排队。
  **这一条曾经写反过,留个记录**:本文档第一版主张留在自托管跑手,理由是 #577 的账单失败
  曾冻结全仓合并两天。账单已修,而自托管跑手的监听进程 2026-08-11 晚已停(注册保留,纯人工
  备援)——照第一版写法合进去,这个 workflow 会永远排不到跑手,也就是本文档自己最看重的
  那种失败:不是红,是不跑。`ci-workflows.test.ts` 现在把「post-merge 不许指向 self-hosted」
  钉住了。
- **真实部署验证不属于本次改动**:railway.json 是否被平台真正读到、烟测打真环境是否全绿、
  指纹在两个真实服务之间是否对得上——这三件都需要一次真实部署,属于部署窗口。
- **契约的扫描有边界**:测试识别 `process.env.X` 与 `const { X } = process.env` 两种形式。
  经第三方 SDK 间接读取的变量(如 `ANTHROPIC_API_KEY`)在契约里显式标了 `readBy: "library"`,
  平台注入的标 `"platform"`,今天没有任何代码读的标 `"none"`——最后这一类的存在就是为了让
  过期的文档条目有地方被诚实登记,而不是伪装成生效中的配置。
