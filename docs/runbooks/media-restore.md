# 媒体对象恢复(MEDIA-durability,`docs/specs/media-durability.md` 已冻结 · v2)

> **性质:**操作程序 + 工具说明,不是桶、令牌、对象数的状态台账。真实值现场查——第 1 步
> 就是查。本文件不含任何秘密值。

## 一句话

内容桶的每个媒体对象,写入时都同步复制了一份到隔离的备份桶(`packages/storage` 的
`R2Storage.put()`,见 `docs/specs/media-durability.md` §1.2/§4)。误删或误操作导致内容桶
丢了某个对象时,这份手册教你把它从备份桶原样放回来。

**只按单键恢复,禁止整桶回滚。** 整桶回滚会把别的租户、别的时间点的对象一起改回旧状态——
这份手册与它背后的脚本(`scripts/tools/media-restore-object.mjs`)只做「一个 key 进,一个
key 出」这一件事,没有整桶操作的入口。

## 前提

1. **两把桶级凭据**:内容桶的(`R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
   `R2_BUCKET`,与部署环境一致)与媒体备份桶的(`R2_MEDIA_BACKUP_ACCESS_KEY_ID` /
   `R2_MEDIA_BACKUP_SECRET_ACCESS_KEY` / `R2_MEDIA_BACKUP_BUCKET`,`R2_MEDIA_BACKUP_ENDPOINT`
   可选、默认沿用 `R2_ENDPOINT`)。凭据分工见 `docs/runbooks/r2-bucket-token-rotation.md` 的
   口径:**Founder 建桶与铸令牌,agent 与演练脚本只用最小权限的只读/演练桶令牌,永不读也
   不回显生产写令牌**。
2. **依赖**:`@aws-sdk/client-s3` 与 `@fikirtive/core`(脚本从 `packages/storage` 的
   package.json 起解析,仓库 `pnpm install` 过就行)、`node >= 22`。
3. **碰生产确认锁**:两个脚本都用 `scripts/tools/_interlock.mjs`,跑之前要
   `I_UNDERSTAND_THIS_TOUCHES_PROD=yes`——不管连的是 staging 还是 production,传的是哪个
   环境的凭据就碰哪个环境的 R2。

## 五步(定位 → 找副本 → 恢复 → 哈希比对 → 回填 RTO)

### 第 1 步 · 定位对象键

对象键的形状是 `u/<ownerId>/<sha256>.<ext>`(`packages/core` 的 `storageKey`)。从下面任一
来源都能拿到:

- 数据库:`Asset` / `AssetVariant` 一类表里该产物记录的 `key` 字段(具体表名以
  `packages/db/prisma/schema.prisma` 当前 schema 为准——本手册不复述会漂移的表名)。
- 商家报错时给的产物页面 URL:`/files/<key>` 里 `<key>` 之后的部分就是它。
- 误删事故本身的日志(若删除路径记录了被删的 key——见 commit `71fbe75e` 之后 asset 删除
  真删字节这条变化)。

`<ownerId>` 段就是这个对象所属的租户/org。**记下这个 ownerId,第 2 步核对要用。**

### 第 2 步 · 在备份桶找副本 + 核对租户前缀(MEDIA-A9)

先跑差集/核验命令(dry-run,只读,不改任何东西):

```bash
R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=fikirtive-staging \
R2_MEDIA_BACKUP_ACCESS_KEY_ID=... R2_MEDIA_BACKUP_SECRET_ACCESS_KEY=... \
R2_MEDIA_BACKUP_BUCKET=fikirtive-staging-backup \
  node scripts/tools/media-restore-object.mjs \
    --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId>
```

不带 `--apply` 时这条命令只做核验:

- **租户前缀核对**——`--expect-owner` 必须等于你在第 1 步记下的 ownerId。脚本用
  `@fikirtive/core` 的 `keyOwnerMatches`(产品代码里判断「一个 key 属于哪个租户」的唯一
  权威)逐字比对 key 里的 ownerId 段,对不上**立即拒绝并停手**——**绝不要为了让它跑通而
  改传另一个 `--expect-owner`**,那等于把核对本身作废。
- 内容桶里这个 key 是否已经不在了(下一节「错误处置」第 2 条)。
- 备份桶里是否真的有这份副本(下一节「错误处置」第 1 条,手册的「空」态)。

三道核验都过,脚本打印副本大小并停在 dry-run,提示「rerun with --apply」。

想看**主桶与备份桶的整体差集**(不是单个 key,而是「还有哪些 key 备份侧没有」),用另一个
脚本的默认模式(同样是 dry-run,不写):

```bash
R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=fikirtive-staging \
R2_MEDIA_BACKUP_ACCESS_KEY_ID=... R2_MEDIA_BACKUP_SECRET_ACCESS_KEY=... \
R2_MEDIA_BACKUP_BUCKET=fikirtive-staging-backup \
  node scripts/tools/media-backup-backfill.mjs
```

输出「missing from backup」「CONFLICT」两类;非空即非零退出,方便接进监控。

### 第 3 步 · 恢复命令

三道闸都过之后,加 `--apply` 真正执行(需要碰生产确认锁):

```bash
I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=fikirtive-staging \
R2_MEDIA_BACKUP_ACCESS_KEY_ID=... R2_MEDIA_BACKUP_SECRET_ACCESS_KEY=... \
R2_MEDIA_BACKUP_BUCKET=fikirtive-staging-backup \
  node scripts/tools/media-restore-object.mjs \
    --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId> --apply
```

脚本内部顺序:下载备份侧字节 → 本地重新算一次 sha256(见第 4 步)→ 哈希对上才
`PutObject` 写回内容桶原 key(带 `IfNoneMatch: "*"`,即便两次检查之间发生竞态写入也绝不
覆盖)。整个过程不触发任何生成 job、不产生任何计费事件——恢复是纯粹的字节搬运。

### 第 4 步 · 哈希比对

脚本自动做:key 文件名里的 `<sha256>` 段本身就是这个对象在写入那一刻的内容哈希(内容
寻址的定义);脚本对下载下来的字节重新算一遍 `sha256`,两者不等就**拒绝写回**并非零
退出,报「HASH MISMATCH」。成功时脚本打印:

```
RESTORED u/<ownerId>/<sha256>.<ext> — hash verified (<sha256>), RTO <N>s
```

拿这一行去访问 `/files/<key>`(产物页面的同一条路径)确认页面能重新打开,再进第 5 步。

### 第 5 步 · 回填 RTO(演练记录)

把上一步打出的 RTO 秒数,连同日期/执行者/对象键/命令输出片段,填进本文件末尾的
「演练记录」表——格式与 `docs/runbooks/db-backup.md` 的恢复演练同规格。**RTO 只统计
脚本自身的下载/校验/写回耗时,不含「先找到应该恢复哪个 key」那段人工排查时间**——两段
分开报,免得被悄悄相加。

## 四态(MEDIA §1.3)

| 态 | 长什么样 |
|---|---|
| 空 | 备份桶里没有这个 key 的副本 → 脚本报 `EMPTY`,**当场停手,升级给 Founder**,不得自造替代对象 |
| 加载 | 恢复命令执行中 → 把命令与输出原样贴进第 5 步的演练记录 |
| 错误 | 见下面「错误处置」三条,一律 fail closed |
| 成功 | 对象回到原 key,字节哈希与原件一致(脚本自动校验),产物页面能重新打开 |

## 错误处置(三条,一律 fail closed:宁可不恢复,不许覆盖现存对象)

| 情况 | 处置 |
|---|---|
| **副本列不出来**(备份桶 `HeadObject` 返回 404/NotFound/NoSuchKey) | 脚本报 `EMPTY`,退出非零。不得从别处拼一份替代字节;当场升级给 Founder,先确认是不是漏备窗口内发生的误删(见 `docs/specs/media-durability.md` §4 的「漏备窗口」说明)。 |
| **权限不足**(凭据没有目标桶的读/写权限,S3 返回 403/AccessDenied 一类) | 脚本照实抛出原始错误,不吞、不重试成别的操作。核对拿到的是不是对的令牌(演练/只读令牌 vs 生产写令牌,见「前提」第 1 条),绝不为了跑通而升级令牌权限。 |
| **键写错**(格式不对,或指向一个其实还活着的对象) | 格式不对 → `parseStorageKey` 直接拒绝,报「not a fikirtive storage key」。指向活对象 → 内容桶 `HeadObject` 命中,脚本报「already exists」并拒绝——内容寻址下已存在必然已经是对的字节,恢复到一个已经有内容的 key 上没有意义,也不会被允许覆盖。 |

## 只按单键恢复,禁止整桶回滚

`scripts/tools/media-restore-object.mjs` 没有整桶操作的入口——它一次只吃一个 `--key`,
写回时也只 `PutObject` 这一个 key。**任何「批量恢复」「按前缀恢复」的临时脚本都不在这份
手册的授权范围内**;真出现需要恢复一批对象的场景,对每一个 key 分别跑一次这个脚本、
分别核对一次租户前缀,再分别记一行演练记录——多花的时间就是这条规矩的成本,换来的是
「一次操作最多影响一个对象」的上限。

## 演练记录

| 日期 | 执行者 | 对象键 | 实测 RTO | 命令输出片段 |
|---|---|---|---|---|
| | | | | |

<!--
  每次演练(含首次上线前的验证跑,MEDIA-A3/A4/A5)在上表加一行:
  - 日期:YYYY-MM-DD
  - 执行者:GitHub 用户名或姓名
  - 对象键:完整 u/<ownerId>/<sha256>.<ext>
  - 实测 RTO:脚本打印的那一行数字(秒)
  - 命令输出片段:粘贴 media-restore-object.mjs --apply 的关键几行(RESTORED ... hash verified ...)
  演练前先跑 media-backup-backfill.mjs(dry-run)确认差集为零,再动手删对象——
  MEDIA-A2 要求的就是这个「回填已完成」的状态。
-->

## 相关

- `docs/specs/media-durability.md` —— 本手册对应的规格(已冻结 · v2:备份桶复制口径,
  v1 的「R2 对象版本历史」口径已判死,证据见该规格 §1.4/§6)。
- `docs/runbooks/db-backup.md` —— 数据库夜间备份与恢复演练,本手册的对照物(同样的
  「隔离备份桶 + 手册 + 一次真跑 + 回填 RTO」形状)。
- `docs/runbooks/r2-bucket-token-rotation.md` —— 令牌铸造与凭据分工的口径出处。
- `scripts/tools/media-backup-backfill.mjs` —— 存量回填 + 差集比对(同一份脚本,
  `--apply` 才写)。
- `scripts/tools/media-restore-object.mjs` —— 本手册第 3 步的恢复命令。
- `packages/storage/src/index.ts` —— 写路径同步复制的实现(`R2Storage.put()` →
  `replicateToBackup` → `replicateWithRetry`)。
