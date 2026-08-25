# 本地跑测试(不走 `pnpm quality` 的那条路)

> 适用场景:只想跑**某几个测试文件**——改完一处代码要立刻知道红没红,或者判官/worker 手上
> 只领了几个文件。要跑**全部闸**(typecheck / tests / build / lint / checks),用
> `pnpm quality`,配方在 `docs/runbooks/local-ci.md`,那份不受本文影响。
>
> 本文记的是 2026-08-25 在本机逐条跑通的配方,每一步下面都附了当天的实测输出。
> 版本、路径、默认值会漂,引用之前照着跑一遍再信。

## 为什么需要一份单独的配方

`pnpm quality` 会**自己**建一个临时测试库、跑迁移、导出环境变量、跑完再删库。直接
`npx vitest run <file>` 绕过了那一整套,于是三件事得手动补上,少一件就会得到一个
**与代码无关**的红:

| 少了什么 | 症状 |
| --- | --- |
| packages 没 build | `Cannot find module '@fikirtive/core/...'`——`apps/web` 引的是 `packages/*/dist`,不是 `src` |
| 没有 `*_test` 库 / 迁移没跑 | 碰库的测试报表不存在;或者被 `setup-db-guard.ts` 当场拦下 |
| `DB_POOL_MAX` 用默认的 10 | 多个 worktree 同时跑时本机 Postgres 连接饱和,不相干的测试随机红(2026-08-08 实测过 5 次以上) |

## 配方

### 0. 前置:本机 Postgres 16

```text
postgresql://fikirtive:fikirtive@127.0.0.1:5432/<库名>
```

用 `127.0.0.1` 而不是 `localhost`:本机可能同时存在原生实例与 docker 映射,两者都占
5432,写主机名时连上的是哪一个说不准。

### 1. build 依赖包

```bash
corepack pnpm --filter "./packages/*" build
```

2026-08-25 实测 14.2s,末尾输出:

```text
packages/db build: ✔ Generated Prisma Client (7.8.0) to ./generated/prisma in 404ms
packages/otto build: Done
```

改过 `packages/**` 之后必须重跑,否则 `apps/web` 读到的还是上一份 `dist`。

### 2. 建一个 `*_test` 库

库名**必须**以 `_test` 结尾——`apps/web/lib/__tests__/setup-db-guard.ts` 拿这个后缀
挡住「拿生产 DATABASE_URL 跑集成测试」。库名里带上票号或场次,别和别人的撞车:

```bash
PGPASSWORD=fikirtive psql -h 127.0.0.1 -U fikirtive -d postgres \
  -c 'CREATE DATABASE "fikirtive_<票号>_test"'
```

```text
CREATE DATABASE
```

### 3. 跑迁移

```bash
DATABASE_URL="postgresql://fikirtive:fikirtive@127.0.0.1:5432/fikirtive_<票号>_test" \
  corepack pnpm --filter @fikirtive/db exec prisma migrate deploy
```

```text
All migrations have been successfully applied.
```

用 `migrate deploy` 而不是 `migrate dev`:后者会按 schema 漂移**改写迁移文件**,那不是
跑测试要的东西。

### 4. 跑测试

```bash
cd apps/web
DATABASE_URL="postgresql://fikirtive:fikirtive@127.0.0.1:5432/fikirtive_<票号>_test" \
FIKIRTIVE_TEST_DB="fikirtive_<票号>_test" \
DB_POOL_MAX=4 \
NODE_OPTIONS=--max-old-space-size=6144 \
  npx vitest run lib/__tests__/<file>.test.ts
```

2026-08-25 实测(`lib/__tests__/isolation.test.ts`,真的连库):

```text
 ✓ lib/__tests__/isolation.test.ts (12 tests) 314ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
```

四个变量各自在管什么:

- **`DATABASE_URL`** —— 集成测试真的连它。指向 `*_test` 库,否则 guard 抛错。
- **`FIKIRTIVE_TEST_DB`** —— 库名本身。`quality.sh` 用它建库/删库;手动跑时带上,是为了
  跟那条路径同名同姿势,别在两套写法之间漂。
- **`DB_POOL_MAX=4`** —— 每进程 pg 连接上限。`packages/db` 默认 10(那是给生产 replica 的),
  本机多 worktree 并跑会把 Postgres 顶满。**4 不是随手写的**:并发锁的证明需要同时握住三条
  连接(A 持锁、B 阻塞、第三条问 `pg_blocking_pids` B 是不是真的被挡住),`DB_POOL_MAX=2` 时
  第三条在等池子,锁的证明就蒸发了。2026-08-08 实测:2 → 3 红 / 172s;**4 → 全绿 / 74s**;
  6 → 120s;10 → 144s。理由全文在 `scripts/ci/quality.sh` 那段注释里。
- **`NODE_OPTIONS=--max-old-space-size=6144`** —— 顶到 2GB 默认堆上限会**随机假红**
  (2026-08-08 抽查:近 8 次失败里 4 次带 OOM 特征、分布在 4 个分支,与改动无关)。
  这一行不关闭任何检查。

不碰库的测试(纯源码扫描、纯函数、`renderToStaticMarkup`)可以整组省掉 `DATABASE_URL` /
`FIKIRTIVE_TEST_DB`,只留后两个——guard 对**没设** `DATABASE_URL` 是放行的,它挡的是设成
非 `_test` 库。2026-08-25 实测:六个前端测试文件(100 条)不带任何 DB 变量,全绿。

### 5. typecheck

```bash
cd apps/web && NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

只跑 `apps/web` 这一包,**不要**在仓库根上跑全仓 `tsc`。

## 判红判绿:只认 `Tests` 那一行

vitest 跑起来会往 stderr 打各种东西——依赖库的启动日志、告警、弃用通知(例如 Better Auth
在某些组合下打的那一行)。**它们不是失败判据**:一次运行的判决是结尾那两行
`Test Files` / `Tests`,以及进程退出码。看到 stderr 有字就说「测试挂了」,是这个仓库反复
出现的误报来源。

反过来也要说清:**这不是「忽略 stderr」的许可证**。一条陌生的告警值得看一眼它在说什么;
它只是不能单独把一次绿判成红。

> 证据边界:本节这条规则本身是 2026-08-25 落的,但当天七次定向运行(含 better-auth 两个
> 测试文件、账户与 admin 角色测试)**一次都没复现**那行 Better Auth 告警——`better-auth`
> 1.6.20 的 `create-context.mjs` 里那段密钥检查开头就是 `if (isTest()) return;`,测试环境
> 下本来就不说话。所以「哪一条告警」这件事没被验到,被验到的是判据本身。

## 收尾

手动建的测试库**不会**被自动删掉(`pnpm quality` 才有那套 create/drop)。跑完自己记一笔,
或者复用同一个库——库名带票号就是为了这个。**别顺手删别人的库**:本机同时住着好几个
worktree 的测试库(`psql -l` 能看到十几个),名字看不出归属就先问。
