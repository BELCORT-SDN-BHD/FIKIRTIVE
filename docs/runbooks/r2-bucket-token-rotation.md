# R2 桶级令牌铸造与对象搬运(`scripts/tools/mint-r2-token.mjs`)

> **性质:**操作程序 + 工具说明,不是 Cloudflare/Railway 的状态台账。桶、令牌、变量现值
> 都属于外部状态,每次动手前现场查(第 1 步 `--check` 就是查)。本文件不含任何秘密值。

## 目的

一句话:**把「一把能读写整个账号所有 R2 桶的宽权限钥匙」换成「每个环境一把只管自己那个桶的窄钥匙」,
并且在换之前把对象先搬过去。**

- 老形态:`staging` 与 `production` 共用一个桶 `artlio`,共用一把账号级 R2 钥匙。
  钥匙一旦泄漏,staging 的一次误操作就能删掉生产对象(债 D-085 / MASTERPLAN P0-6)。
- 新形态:两个桶 `fikirtive-staging` / `fikirtive-production`,两把**桶级**令牌
  (Cloudflare 权限组 `Workers R2 Storage Bucket Item Read/Write`,作用范围 = 单个桶),
  各写进 Railway 对应环境的 `web` + `worker`。

脚本做四件事,一个子命令一件:体检 / 搬对象 / 铸 staging 钥匙 / 铸 production 钥匙。

**这个脚本由 agent 在本机跑,不是 Founder 手工跑。** Founder 只做一个动作:
在 production 切换那一步说一声「切」(见第 4 步)。

## 前提

1. **钥匙串条目 `cloudflare-api-token-belcort`** —— 一把整账号权限的 Cloudflare API token。
   脚本用 `security find-generic-password` 从 macOS 钥匙串读它,**只在进程内存里用**:
   从不打印、从不写文件、从不进命令行参数。条目不存在就在发出任何网络请求之前干净退出。
   换条目名用 `--keychain-service <name>`。
2. **一个已经 `railway link` 过本项目的目录** —— `railway` CLI 按目录记项目绑定。
   脚本默认在**当前工作目录**跑 `railway`;指到别处用环境变量:

   ```
   RAILWAY_LINKED_DIR=/path/to/linked/checkout node scripts/tools/mint-r2-token.mjs --check
   ```

   开场那两行会把本次用的账号 id 与 railway 目录打出来,跑之前先核对。
3. **依赖**:`@aws-sdk/client-s3`(脚本从 `packages/storage` 的 package.json 起解析,
   所以仓库 `pnpm install` 过就行)、`node >= 22`、`railway` CLI 已登录。
4. **账号**:默认 `ac42cba1bda978bd00f6c45d0e25dc24`(账号 id 不是秘密,它出现在每个 R2 endpoint 里)。
   别的账号用 `--account-id <32 位十六进制>`。

三把令牌,各管各的:

| 令牌名 | 权限 | 去处 | 谁来铸 |
| --- | --- | --- | --- |
| `fikirtive-staging-web` | `fikirtive-staging` 桶级读写 | Railway staging 的 `web` + `worker` | `--mint staging` |
| `fikirtive-production-web` | `fikirtive-production` 桶级读写 | Railway production 的 `web` + `worker` | `I_UNDERSTAND_THIS_TOUCHES_PROD=yes … --mint production --yes-production`,**等 Founder 说「切」** |
| `fikirtive-migration-temp` | 源桶只读 ＋ 目标桶可写 | **哪儿都不去** —— 只在 `--copy` 进程内存里活着,跑完在 `finally` 里删掉 | `--copy` 自己铸自己删 |

## 四步(顺序不能颠倒)

```
node scripts/tools/mint-r2-token.mjs --check
node scripts/tools/mint-r2-token.mjs --copy staging --dry-run --exclude-prefix backups/
node scripts/tools/mint-r2-token.mjs --copy staging --exclude-prefix backups/
node scripts/tools/mint-r2-token.mjs --mint staging
node scripts/tools/mint-r2-token.mjs --copy production --dry-run
node scripts/tools/mint-r2-token.mjs --copy production
#  ↑ 这四步写的是新桶;2026-09-09 切换前不影响线上,
#    切换后重跑时 --copy production 与 --mint production 都要带碰生产锁。
#    下面这条等 Founder 明说「切」,并且要带碰生产确认锁:
I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
  node scripts/tools/mint-r2-token.mjs --mint production --yes-production --expect-objects <上一步的源对象数>
```

### 第 1 步 · `--check` 体检(只读)

四项:验令牌 / 列 R2 权限组 / 确认三个桶都在 / 读 staging 与 production 四个服务的
`R2_*` 指纹并校验 endpoint 归属。全程不发 S3 请求。

每行前面是 `OK` / `FAIL` / `WARN`。**全是 OK 才做第 2 步。**

它**不**验的:不发 S3 请求,所以不会告诉你现有的 R2 钥匙还能不能用。四项全过只代表「可以铸新钥匙」。

### 第 2 步 · staging:先搬对象,再换钥匙

**staging 一直带 `--exclude-prefix backups/`**:源桶里那一坨是**生产库备份**,
staging 不该拿到它 —— 又占地方,又等于把生产数据复制进一个防护更松的环境。
`--exclude-prefix` 可重复给;被剔掉的对象数与字节数会落屏,**校验时也一并排除**
(它们本来就不该出现在目标桶里,不排除的话 key 集合差集必然报缺)。

`--mint staging` 做的事:重跑体检 → 铸 `fikirtive-staging-web` → 用推导出的 S3 凭据实测
(目标桶可列 ＋ 另一个桶被 401/403 拒)→ 写 Railway staging 的 `web` 和 `worker` → 读回比对指纹。
中间任何一环不对,它自己把刚建的钥匙删掉,Railway 一个字都不改。

写完之后 **在 Railway 上重新部署 staging 的 `web` 和 `worker`**(脚本用了 `--skip-deploys`,
不重启不生效),确认能上传、能读图。

### 第 3 步 · production:先搬对象(这一步不动线上)

**production 不带 `--exclude-prefix`** —— 它要的是源桶的完整一份,包括 `backups/`。

这一步只是把对象灌进 `fikirtive-production`,**不改 Railway、不影响线上**:production 的服务
这时还指着老桶。所以它不必等 Founder 发话,早搬早好 —— 搬完再切,切换那一刻就没有等待窗口。

**把汇总行里的源对象数记下来**(形如 `源 260 个对象`),第 4 步填进 `--expect-objects`。
带过 `--exclude-prefix` 的那次汇总行不能拿来填(数会变小)。

### 第 4 步 · production 切换 · **等 Founder 明说「切」**

两道人闸,缺一不可:

- **碰生产确认锁** `I_UNDERSTAND_THIS_TOUCHES_PROD=yes` —— 全仓碰生产脚本统一那把
  (`scripts/tools/_interlock.mjs`)。没设就在**读钥匙串之前**退出:一个秘密都不会被读出来,
  也不会发出任何网络请求。屏幕上会直接告诉你要设哪个变量。
- **`--yes-production` 旗标** —— **就是「Founder 说过切了」的唯一凭据,agent 不得自己加。**

前者证明「跑的人知道自己在碰生产」,后者证明「Founder 说过切」。
碰生产锁的范围:`--mint production` 与 `--copy production`(含 `--dry-run`)都受锁 ——
2026-09-09 切换完成后 `fikirtive-production` 就是线上正在读的桶,往里写对象等于碰生产。
`--check` / `--copy staging` / `--mint staging` 不受这把锁影响。

它比 staging 多一道闸:铸完令牌之后、写 Railway 之前,用新令牌数一遍目标桶的对象数。

- 数出来是 **0** → `FAIL`,回收刚建的令牌,Railway 一个字不改,提示先跑 `--copy production`。
  空桶切过去等于线上瞬间全是坏图。
- 带了 `--expect-objects <n>` → 必须**正好等于** n,对不上就回收令牌 + `FAIL`。推荐一直带上。
- 没带 → 只要非 0 就放行,数量落屏,请自己与第 3 步对照。

写完之后重新部署 production 的 `web` 和 `worker`,确认正常,**再**按屏幕上的名字去
Cloudflare 后台吊销旧的宽权限令牌。顺序不能颠倒。

## 关键机制(为什么可以信它)

**指纹**:脚本从不打印秘密,打印的是 SHA-256 十六进制**前 12 位**。指纹只能**对照**
(两处一样 = 值一样),反推不出原值。Access Key ID 额外打前 6 位,方便在后台认出是哪一把。

**S3 钥匙怎么来的**:Access Key ID = 令牌响应里的 `id`;Secret Access Key = 令牌 `value` 的
**SHA-256 十六进制**。脚本在内存里算完,不落盘、不打印。

**权限组按名字查、按 id 用**:Cloudflare 官方说名字是装饰性的、可能变,所以脚本是 fail-closed ——
名字对不上就 `FAIL`、不铸造。真变了就照 `[2/4]` 打出来的清单改脚本顶部那两行常量。

**作用域反证**:铸完之后**故意**对另一个桶做同一个 `ListObjectsV2`,期望被拒。
401/403 = 已证实;200 = 越权,脚本立刻删掉刚建的钥匙、非零退出、Railway 一个字不改;
404/超时/其他 = **未证实**(不阻止本次写入,但结论行照实写,且幂等短路不成立)。
它证的是「碰不到第三个桶」,**没有**去证「对源桶的写确实被拒」(那得真写一次,会写脏源桶)。

**正向门只认 `ListObjectsV2`**:`HeadBucket` 是桶级操作,Bucket Item 权限组只承诺对象级,
所以 `HeadBucket` 降为信息行 —— 否则一把完全正确的新钥匙会被误删。

**搬运是逐对象 `GetObject` → `PutObject`**(不用 `CopyObject`:跨桶要另一套权限组合,
出错时看不清是哪一端)。并发 4,单对象失败重试 1 次,**单对象上限 256 MiB**(整块读进内存的路子,
超限按 `failed` 计并落屏,请单独处理)。逐对象三态:

| 目标桶的情况 | 决策 | 计数 |
| --- | --- | --- |
| 没有这个 key(或 `HeadObject` 读不到) | 搬 | `copied` |
| 有,**大小相同** | 跳过 | `skipped` |
| 有,**大小不同** | **不动它**,点名落屏 | `conflict` |
| 目标桶独有的 key | 永不触碰 | 不计 |

大小不同 = 目标桶那一份很可能是**线上写进去的新版本**,拿旧版盖回去就是数据丢失。
所以默认只点名不覆盖,`conflict > 0` 就 `exit 1`。确知要用源桶版本覆盖才加 `--allow-overwrite-live`。

**搬完的校验是 key 集合差集,不是对象数**:源桶(去掉排除前缀之后)的每个 key 都必须出现在目标桶,
缺一个就 `FAIL` 并 `exit 1`。只比对象数是个假闸 —— 源清单一旦被截断,拿被截断的数去比它自己必然通过。
`ListObjectsV2` 若说「还有下一页」却不给游标,脚本直接报错停手。

**秘密怎么写进 Railway**:`R2_BUCKET` / `R2_ENDPOINT` 不是秘密,直接进参数;
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 走 **stdin**(命令行参数在这台机器上任何进程都能用 `ps` 看到)。
全部调用用 `execFileSync` 传数组,不经 shell 拼接。写完再读回,四个键逐个比对。

## 幂等与半成品

**`--check`** 纯只读,跑几次都一样。

**`--copy`** 天然幂等:同名同大小跳过,重跑只补上次没搬成的;开头先清掉上一次留下的同名搬运令牌。
目标桶已经上线之后重跑也不会盖掉线上数据(见上面的三态表)。

**`--mint`** 动手前先判「是不是已经做完了」:两个服务都指向目标桶 + 指纹一致 + 现存钥匙能通过同样的
S3 实测 + 反证是被 401/403 明确拒绝证实的。全满足才打印「已完成,无需重复铸造」并正常退出,
**不会**多建一把令牌。最后那条刻意从严:反证没证实就宁可多铸一把窄钥匙,也不把一把可能是宽权限的
旧钥匙判成「已完成」。`--mint production` 走短路时,**切换前闸照跑**(对象数为 0 / 与
`--expect-objects` 对不上 → `FAIL`),否则重跑会打出一条假绿。

**半成品状态,三种:**

1. **铸造失败**:屏幕上**没有** `WARN 可能已在 Cloudflare 建好令牌` 才安全。出现了就说明
   Cloudflare 那边很可能已经建好一把、只是脚本没拿到 id/value。照 WARN 行给的**名字**
   到后台核对并删除,再重跑。
2. **`--mint` 写入 Railway 之后出问题**(写到一半 / 读回指纹对不上 / 读回本身失败):
   那把新令牌是活的。屏幕会打一段「半成品状态」(新令牌名字＋前缀、创建路径、每个服务哪几个键
   已写/未写)。**先照它把上一把令牌删掉再重跑** —— 特别是「读回失败」那条:四个键其实已经写好了,
   重跑会判定「已完成」直接短路,多出来的那把令牌不删就一直挂着。
3. **`--copy` 的搬运令牌残留**(回收被拒/断网,或进程被 Ctrl-C、被 OOM 杀掉 —— 那时 Node 根本不执行
   `finally`,屏幕上什么提示都没有)。两条兜底:下一次 `--copy` 开头的清残留会捡走它;
   令牌自带**一小时 `expires_on`** 会自动到期。但别指望兜底 —— 看到提示就手工删,
   自己按过 Ctrl-C 也顺手到后台按名字 `fikirtive-migration-temp` 删一把。

## 回滚

**对象搬运基本没有回滚需求**:源桶全程**只读**。目标桶还空着时更简单 —— 清空再跑一次即可。

唯一能造成损失的动作是「用源桶旧版盖掉线上写进去的新版本」。默认路径做不到这件事
(判 `conflict`、原样留着、`exit 1`)。真正**不可回滚**的是加了 `--allow-overwrite-live` 的那一次 ——
R2 没开版本控制,盖掉就没了。那个旗标只在「已经看过 conflict 名单」之后才加。

**钥匙有三件事要分清:**

1. **吊销新钥匙**:Cloudflare 后台 → Manage Account → Account API Tokens
   (或 My Profile → API Tokens,取决于脚本走的哪条路径,屏幕上会说),按名字删。
   也可以 `DELETE /accounts/{account_id}/tokens/{token_id}`。
2. **把 Railway 四个变量改回旧值 —— 只有事先备份过才做得到。**
   **凭据没有「值级回滚」**:脚本打的「回滚参照」里只有*指纹*,指纹是单向的;
   Cloudflare 的令牌 secret 也只在创建那一刻显示一次。想保留「原封不动改回去」的可能,
   就在 `--mint` 之前自己抄一份现值:

   ```
   railway variable list --environment <env> --service <svc> --kv | grep -E '^R2_'
   ```

   `railway variable list` 会**明文打印所有变量**(数据库连接串、Stripe 密钥这些全在里面),
   所以上面那个 `grep` 不要去掉,输出不要贴进聊天窗,抄完用终端的 **Clear Scrollback** 清掉
   (`clear` 不够,历史还在回滚缓冲里)。
3. **`R2_ENDPOINT`** 也会被写(不是秘密,「回滚参照」里有每个服务的旧值原文),
   要回滚用 `railway variable set` 改回去。

`--skip-deploys` 意味着变量改了但服务没重启:要生效得在 Railway 上重新部署对应环境的
`web` 和 `worker`(这一步脚本不做)。

## 2026-09-09 实跑记录(桶改名 `artlio` → `fikirtive-*`)

按上面四步跑完,**两个环境四个服务(staging/production × web/worker)已全部换成桶级令牌**。
过程中确认的事实:

- **staging**:`--copy staging --exclude-prefix backups/` 搬了 **229 个对象、约 380 MB**
  (`backups/` 是生产库备份,按规矩排除)。
- **production**:`--copy production` 搬了 **260 个对象、约 446.8 MB**(不排除任何前缀)。
- **`expires_on` 不能带毫秒** —— Cloudflare 逐字拒收:
  `expires_on must be a valid date/time in the format "2005-12-30T01:02:03Z"`,
  而 `toISOString()` 一定带三位毫秒。脚本的 `migrationExpiry()` 把毫秒削掉,
  `scripts/tools/mint-r2-token.plan.test.mjs` 有一条测试钉住这个格式。
- **账号级 `POST /accounts/{account_id}/tokens` 可用**(没有退到 `/user/tokens` 的用户级令牌路径)。
  账号级令牌不跟着人走,人被移出账号也不会失效 —— 这是想要的形态。

**注意:** 这次实跑时**还没有**第 4 步那把 `I_UNDERSTAND_THIS_TOUCHES_PROD` 碰生产锁
(它是 2026-09-09 收尾时补上的);当时只有 `--yes-production` 与 `--expect-objects` 两道闸。
按本文档现在的写法重跑,production 那一步必须多带这个环境变量。

**遗留:** 老桶 `artlio` 的退役(观察期后删桶)与旧宽权限令牌的最终吊销另行处理,不在本脚本范围内。

## 单元测试

```
node --check scripts/tools/mint-r2-token.mjs
node --test scripts/tools/mint-r2-token.plan.test.mjs
```

`node --test` 这条**已经进了 CI 的 gate 列表**(`scripts/ci/quality.sh` 的 `checks` 腿,
gate 名 `mint-r2-token plan tests`;腿→gate 对照表在 `scripts/__tests__/quality-legs.test.sh`)。
`node --check` 仍是手动的。

覆盖纯函数:环境计划表、桶资源键、policy 构造、复制三态决策、前缀汇总与前缀排除、`expires_on` 格式。
测试只 `import` 脚本,不触发主流程(脚本里有 `invokedDirectly` 守卫),不发网络、不碰钥匙串、不动 Railway。

## 引用的 Cloudflare 文档

- **S3 凭据推导规则、桶资源键格式、权限组作用范围、endpoint 形状** —— <https://developers.cloudflare.com/r2/api/tokens/>
  原文:「Access Key ID: The `id` of the API token.」「Secret Access Key: The SHA-256 hash of the API token `value`.」
  「A specific bucket is represented as: `"com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET_NAME>": "*"`」
  「For buckets not created in a specific jurisdiction this value will be `default`.」
- **一把令牌可以带多条 policy;policy 字段与求值顺序;权限组 `name` 是装饰性的** ——
  <https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/>
  原文:「Each token can contain multiple policies.」「the permission `name` is cosmetic and subject to change.」
- **账号级令牌的端点与前置权限** —— <https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/>
  原文:「Creating or updating an account owned token requires Super Administrator permission on the account」
- **对象级令牌只能走 S3 API** —— <https://developers.cloudflare.com/r2/platform/troubleshooting/>
  原文:「Object-level tokens are only supported by the S3-compatible API…」
  配合 <https://developers.cloudflare.com/r2/api/s3/api/> 的兼容表(`HeadBucket` = bucket-level,
  `ListObjectsV2` = object-level)—— 这就是正向门只认 `ListObjectsV2` 的依据。
- **R2 桶的 REST 路径** —— <https://developers.cloudflare.com/r2/api/>

## 相关

- `docs/runbooks/db-backup.md` —— 夜间数据库备份写的就是 `backups/` 前缀(staging 搬运排除它的原因)。
- `scripts/tools/r2-configure.mjs` —— 新桶的 CORS 与 multipart lifecycle 配置(换桶时要各跑一次)。
- `docs/DEFERRED.md` D-085 —— staging/production 共用桶的原始债务条目。
