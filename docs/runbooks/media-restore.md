# 媒体对象恢复(MEDIA-durability,`docs/specs/media-durability.md` 已冻结 · v2)

> **性质:**操作程序 + 工具说明,不是桶、令牌、对象数的状态台账。真实值现场查——第 1 步
> 就是查。本文件不含任何秘密值。

## 一句话

**新写入**的媒体对象同步复制一份;直传上传的素材在收尾(尺寸复核通过)时由服务端补一刀
复制(`packages/storage` 的 `R2Storage.put()` / `R2Storage.copyToBackup()`,见
`docs/specs/media-durability.md` §1.2/§4)。误删或误操作导致内容桶丢了某个对象时,这份手册
教你把它从备份桶原样放回来。

**只按单键恢复,禁止整桶回滚。** 整桶回滚会把别的租户、别的时间点的对象一起改回旧状态——
这份手册与它背后的脚本(`scripts/tools/media-restore-object.mjs`)只做「一个 key 进,一个
key 出」这一件事,没有整桶操作的入口。

### 什么可能漏备、怎么发现

复制不是 100% 保证。唯一的漏备成因,加上发现它的手段:

**成因:首写/收尾复制两次都失败后,该 key 永不自动重试。** `replicateWithRetry` 的语义是
「重试一次,仍失败就放行主写并记录」——放行之后不会有第三次自动尝试,后续对同一 key 的
dedup 命中(无论是写路径的 `put()` 还是直传收尾的 `copyToBackup()`)也不会补这一刀(见
`packages/storage/src/index.ts` 里 dedup-skip 的注释)。唯一能补上这个缺口的是按周期跑的
回填脚本(见下方「什么可能漏备、怎么发现」之后的差集/回填说明)。

**怎么发现:每次复制失败都会落一条可检索的结构化日志**,`event` 字段固定是
`media_backup_replication_failed`(写路径与直传收尾各带不同的 `path` 字段区分,直传收尾
是 `finalize-copy`)。grep 这个字段串就能拿到所有漏掉复制的 key,不需要等差集命令跑到
才发现。

## 前提

1. **两把桶级凭据**:内容桶的(`R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
   `R2_BUCKET`,与部署环境一致)与媒体备份桶的(`R2_MEDIA_BACKUP_ACCESS_KEY_ID` /
   `R2_MEDIA_BACKUP_SECRET_ACCESS_KEY` / `R2_MEDIA_BACKUP_BUCKET`,`R2_MEDIA_BACKUP_ENDPOINT`
   可选、默认沿用 `R2_ENDPOINT`)。凭据分工见 `docs/runbooks/r2-bucket-token-rotation.md` 的
   口径:**Founder 建桶与铸令牌,agent 与演练脚本只用最小权限的只读/演练桶令牌,永不读也
   不回显生产写令牌**。**`R2_MEDIA_BACKUP_*` 令牌须同时具备备份桶写＋内容桶读权限**(服务端
   `CopyObject` 的 copy-source 用它去读内容桶——`R2Storage.copyToBackup()` 走的就是这把
   令牌,不是内容桶自己的凭据)。按旧口径(只给备份桶写权限)铸的令牌,会让直传上传收尾的
   那次复制静默 403——`put()` 的写路径复制不受影响(那条路径本来就不需要读内容桶),但
   直传收尾这条路径会一直失败、一直落 `media_backup_replication_failed` 日志,永远补不上,
   铸令牌时务必核对这一条。staging 与 production 目前共用同一个令牌 id 的拆分步骤,见
   `docs/runbooks/r2-bucket-token-rotation.md`「staging 备份令牌拆分(Founder 2026-09-15 裁决)」。

   **这些变量的现值在哪(2026-09-19 盲走补)**:不在任何文件里,就在部署环境自己的变量上——
   Railway 项目 `b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d`、environment `staging`、service `web`
   或 `worker`(两个 service 都带齐了上面 7 个必需变量;可选的 `R2_MEDIA_BACKUP_ENDPOINT` 两边
   都没设,按可选项回落 `R2_ENDPOINT`——2026-09-19 只读核过)。只看名字、不看值:

   ```bash
   railway variables list --json \
     -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker | jq -r 'keys[]'
   ```

   **别把值抄进自己的 shell。** 用 `railway run` 把变量直接注进子进程,值全程不经过操作者的
   终端、不落任何文件——本手册下面每一条 `node scripts/tools/…` 都按这个形状跑:

   ```bash
   I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
     railway run -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker \
       -- node scripts/tools/media-restore-object.mjs \
            --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId>
   ```

   (Railway 自己的 flag 一律写在 `--` 之前;`I_UNDERSTAND_THIS_TOUCHES_PROD=yes` 写在
   `railway run` 之前会被子进程继承——2026-09-19 实测确认。production 同法换 `-e production`。
   **永远不要跑 `railway run env` / `railway run printenv`**,那会把值打出来。命令要在仓库
   根目录跑,脚本靠相对路径找 `packages/storage`。)

   **演练用哪把凭据(2026-09-19 修正,照实说)**:上面那句「agent 与演练脚本只用最小权限的
   只读/演练桶令牌」是**复制路径**的口径(备份桶写＋内容桶读)。**恢复演练今天没有对应的那把
   令牌**——恢复要的是「备份桶读＋内容桶写」,仓库里既没有这样一把令牌,也没有铸它的程序。
   所以现状是:演练用 `railway run` 借 staging 部署自己的凭据跑,权限大于演练所需,这是已知
   且当下接受的缺口,不要以为文档里还藏着一把更小的钥匙。补一把限 staging 的最小权限恢复演练
   令牌是后续项,已记在 `docs/specs/media-durability.md` §5 变更登记等 Founder 裁;在它落地
   之前,生产环境不做删除演练(规格 §3 非目标 + MEDIA-A7)。
2. **依赖**:`@aws-sdk/client-s3` 与 `@fikirtive/core`(脚本从 `packages/storage` 的
   package.json 起解析)、`node >= 22`。**`pnpm install` 不够**:`@fikirtive/core` 的
   `exports` 指向 `./dist`(见 `packages/core/package.json`),新检出没 build 过,脚本会抛一条
   不解释原因的 `MODULE_NOT_FOUND`,路径指向 `packages/storage/node_modules/@fikirtive/core/dist/index.js`
   ——2026-09-19 盲走就撞死在这里。在仓库根目录先做完这三条再往下走:

   ```bash
   pnpm install
   pnpm --filter @fikirtive/core build
   # 预检:两个依赖都解析得到就打印 deps OK,否则当场 MODULE_NOT_FOUND,不必跑到一半才发现
   node -e 'const r=require("node:module").createRequire(process.cwd()+"/packages/storage/package.json");r.resolve("@aws-sdk/client-s3");r.resolve("@fikirtive/core");console.log("deps OK")'
   ```
3. **碰生产确认锁**:两个脚本都用 `scripts/tools/_interlock.mjs`,跑之前要
   `I_UNDERSTAND_THIS_TOUCHES_PROD=yes`——不管连的是 staging 还是 production,传的是哪个
   环境的凭据就碰哪个环境的 R2。

## 演练(仅 staging):怎么亲手造出这个「丢了」

真事故里对象已经没了,直接从第 1 步开始。**但 MEDIA-A3/A4 这类演练要自己先删一个对象**——
这是整场里唯一不可逆的一步,手册以前对它一个字没写(2026-09-19 盲走据此判 PARTIAL)。规矩:

- **只在 staging。** 生产桶零删除(规格 §3 非目标 + MEDIA-A7)。
- **挑测试商家 `org_cmts923pm00002mptbuoube0j`(E2E Cafe,staging 的 E2E 固定租户)的最小
  对象**(挑法见第 1 步那条「演练选对象」SQL);Founder(ownerId `founder`)与任何其他 org 的
  对象一律不碰。不确定某个 ownerId 是不是测试商家时**停手问 Founder**——下一步就不可逆了。
  (2026-09-13 那行演练记录删的是 `u/founder/…`,那是本条规矩写下之前的做法,不作先例。)
- **删之前四道必须全过**:① 差集为 0(第 2 步的 `media-backup-backfill.mjs` dry-run);
  ② 备份桶 `HeadObject` 命中同一个 key;③ 两侧大小相等;④ 先把 size / ETag 记下来,
  演练记录里要用。
- **一次只删一个 key。** 没有「按前缀删」,没有批量。

脚本侧今天**没有** `--drill-delete` 这类开关(2026-09-19 核过 `scripts/tools/media-restore-object.mjs`
的参数只有 `--key` / `--expect-owner` / `--apply`),所以删除用下面这段一次性脚手架——它不进
仓库、不进 `scripts/tools/`,跑完就删。把它存到仓库外、**文件名带一段随机后缀**(例如
`/tmp/drill-delete-$(date +%s).mjs`),跑完就删——同机并行演练时固定文件名会互相覆盖,
别人留下的旧文件也会被你当成自己的照跑:

```javascript
// 演练脚手架(仅 staging)。保险丝在前,删除在后;任何一道不过就抛错、什么都不删。
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/packages/storage/package.json");
const { S3Client, HeadObjectCommand, DeleteObjectCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);

const KEY = process.env.DRILL_KEY;
const CONTENT = process.env.R2_BUCKET;
const BACKUP = process.env.R2_MEDIA_BACKUP_BUCKET;

// 保险丝 1:内容桶必须就是 staging 内容桶,字面量比对,不接受任何别的值
if (CONTENT !== "fikirtive-staging") throw new Error(`refusing: content bucket is "${CONTENT}"`);
// 保险丝 2:桶名里不许出现 backup / production(防呆:哪怕保险丝 1 将来被改宽)
if (/backup|production/i.test(CONTENT)) throw new Error(`refusing: "${CONTENT}" looks like a backup/production bucket`);
// 保险丝 3:一次一个 key,且必须是合法的 media key(照抄 parseStorageKey 的形状,不接受前缀/通配)
if (!/^u\/[0-9A-Za-z_-]+\/[0-9a-f]{64}\.[0-9a-z]{1,8}$/.test(KEY ?? ""))
  throw new Error("refusing: DRILL_KEY must be exactly one u/<ownerId>/<sha256>.<ext>");

const s3 = (id, secret) =>
  new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: id, secretAccessKey: secret },
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
  });
const content = s3(process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY);
const backup = s3(process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID, process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY);

// 保险丝 4:副本必须先在(HeadObject 404 就在这里抛),且两侧大小相等
const c = await content.send(new HeadObjectCommand({ Bucket: CONTENT, Key: KEY }));
const b = await backup.send(new HeadObjectCommand({ Bucket: BACKUP, Key: KEY }));
if (c.ContentLength !== b.ContentLength)
  throw new Error(`refusing: content ${c.ContentLength}B vs backup ${b.ContentLength}B — not the same object`);

// 先留证再动手:这两行抄进演练记录
console.log(`content ${CONTENT}: size=${c.ContentLength} etag=${c.ETag} type=${c.ContentType}`);
console.log(`backup  ${BACKUP}: size=${b.ContentLength} etag=${b.ETag} type=${b.ContentType}`);

if (process.env.DRILL_DELETE !== "yes") {
  console.log("guard-only run — 四道保险丝全过;真要删再加 DRILL_DELETE=yes");
  process.exit(0);
}
await content.send(new DeleteObjectCommand({ Bucket: CONTENT, Key: KEY }));
console.log(`deleted: ${KEY} is now GONE from ${CONTENT}`);
```

跑法(在仓库根目录;第一趟不带 `DRILL_DELETE`,只看保险丝与留证):

```bash
I_UNDERSTAND_THIS_TOUCHES_PROD=yes DRILL_KEY=u/<ownerId>/<sha256>.<ext> \
  railway run -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker \
    -- node /tmp/drill-delete-<随机后缀>.mjs
# 四道都过、size/ETag 已抄下,再加 DRILL_DELETE=yes 重跑同一条命令真删
```

这段脚手架同时是第 4 步「删后核对」的工具:恢复完不带 `DRILL_DELETE` 再跑一次,两侧 size
相等就说明字节回位了。把 `--drill-delete` 做进 `media-restore-object.mjs` 是后续项,**本 PR
没有实现**。

## 五步(定位 → 找副本 → 恢复 → 哈希比对 → 回填 RTO)

### 第 1 步 · 定位对象键

对象键的形状是 `u/<ownerId>/<sha256>.<ext>`(`packages/core` 的 `storageKey`)。从下面任一
来源都能拿到:

- 数据库:**`Asset` 表没有 `key` 列,键是拼出来的**——`u/<ownerId>/<contentHash>.<ext>`,三段
  分别取 `Asset.ownerId` / `Asset.contentHash` / `Asset.ext`(拼法的唯一权威是
  `packages/core/src/storage-key.ts` 的 `storageKey()`)。也**没有 `AssetVariant` 这张表**
  ——2026-09-19 按 `packages/db/prisma/schema.prisma` 核过,手册旧写法会把人送去找不存在的
  列。

  **SQL 在哪跑(只读;2026-09-19 二次盲走补)**:连接串同样不在文件里,在 Railway 的 Postgres
  service 变量上。取值只进 shell 变量、不回显:

  ```bash
  URL=$(railway variables list --json \
    -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s Postgres \
    | jq -r '.DATABASE_PUBLIC_URL')
  psql "$URL" -v ON_ERROR_STOP=1
  ```

  查询一律包在 `BEGIN READ ONLY; … ROLLBACK;` 里。production 同法换 `-e production`,且只读。

  SQL 直接把键拼出来:

  ```sql
  -- 已知产物 id
  SELECT 'u/' || "ownerId" || '/' || "contentHash" || '.' || "ext" AS key,
         "mime", "sizeBytes", "deletedAt"
  FROM "Asset" WHERE "id" = '<assetId>';

  -- 或按租户列最近的几件,自己认出要恢复的那一个
  SELECT 'u/' || "ownerId" || '/' || "contentHash" || '.' || "ext" AS key,
         "originalFilename", "createdAt", "deletedAt"
  FROM "Asset" WHERE "ownerId" = '<ownerId>' ORDER BY "createdAt" DESC LIMIT 20;

  -- 演练选对象:该租户最小的几件(演练规矩要的就是最小那一个,上一条按时间排,选不出来)
  SELECT 'u/' || "ownerId" || '/' || "contentHash" || '.' || "ext" AS key,
         "sizeBytes", "mime", "deletedAt"
  FROM "Asset" WHERE "ownerId" = '<测试商家 orgId>' AND "deletedAt" IS NULL
  ORDER BY "sizeBytes" ASC LIMIT 10;
  ```
- 商家报错时给的产物页面 URL:`/files/<key>` 里 `<key>` 之后的部分就是它。
- 误删事故本身的日志(若删除路径记录了被删的 key——见 commit `71fbe75e` 之后 asset 删除
  真删字节这条变化)。

`<ownerId>` 段就是这个对象所属的租户/org。**记下这个 ownerId,第 2 步核对要用。**

**只按 `contentHash` 找键会一次找出好几个租户的键**(内容寻址:同一份素材被几个租户用过就有
几行 `Asset`,`contentHash` 完全相同——2026-09-19 二次盲走那件就被 7 个 org 共用),选中哪一个
靠的是键首段的 `ownerId`,查的时候务必连 `ownerId` 一起限定(这正是 MEDIA-A9 前缀核对在防的事)。

### 第 2 步 · 在备份桶找副本 + 核对租户前缀(MEDIA-A9)

**顺序很重要,而且和直觉相反。** 恢复脚本的三道闸是按顺序烧的:闸 1 键格式/租户前缀 → 闸 2
内容桶里这个 key 还在不在 → 闸 3 备份桶里有没有副本。**对象还活着的时候,闸 2 会先抛
`already exists in the content bucket` 直接短路**(见 `scripts/tools/media-restore-object.mjs`
的 `main()`),命令永远走不到「备份桶里有没有副本」那一问。所以**「删之前先用它确认副本在」
这条路是走不通的**——删前的核对要用下面的 2-a 和 2-b(2026-09-19 盲走据此修正)。

**2-a · 差集(删之前的正经核对,也是日常巡检)。** 主桶与备份桶的整体差集,dry-run 只读不写:

```bash
I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
  railway run -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker \
    -- node scripts/tools/media-backup-backfill.mjs
```

输出「missing from backup」「CONFLICT」两类;非空即非零退出,方便接进监控。脚本第一行就把
内容桶与备份桶的名字打出来——**动手前把这两行读回去**,这是环境搞混时唯一会拦住你的东西。
**这条差集命令不是只在演练前跑一次的东西——按固定周期(例如每日)跑它,非空才需要人看、
确认后再 `--apply` 回填,这是「什么可能漏备、怎么发现」那条成因说的那个漏备窗口唯一的闭合
手段。** 演练场景里它还兼一个身份:差集为 0 才准删(MEDIA-A2 要的就是这个「回填已完成」
的状态)。

**2-b · 单个 key 的副本 HEAD。** 差集是全桶口径,删之前还要对**这一个 key** 亲眼确认副本在、
大小一致——用「演练(仅 staging)」小节那段脚手架不带 `DRILL_DELETE` 跑一趟,它打印两侧的
size / ETag。真事故(对象已经没了)不需要这一步,直接看 2-c。

**2-c · 对象确实已经不在之后,再跑恢复脚本的 dry-run** 做租户核对 + 副本核对:

```bash
I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
  railway run -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker \
    -- node scripts/tools/media-restore-object.mjs \
         --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId>
```

（`_interlock.mjs` 在脚本顶部无条件检查这把锁——即便是不带 `--apply` 的只读 dry-run 也要
先给这个环境变量,不给就直接 `REFUSING` 退出,不管连的是哪个环境的凭据,见「前提」第 3 条。
两个脚本都一样。）

不带 `--apply` 时这条命令只做核验:

- **租户前缀核对**——`--expect-owner` 必须等于你在第 1 步记下的 ownerId。脚本用
  `@fikirtive/core` 的 `keyOwnerMatches`(产品代码里判断「一个 key 属于哪个租户」的唯一
  权威)逐字比对 key 里的 ownerId 段,对不上**立即拒绝并停手**——**绝不要为了让它跑通而
  改传另一个 `--expect-owner`**,那等于把核对本身作废。
- 内容桶里这个 key 是否已经不在了(下一节「错误处置」第 2 条)。**还在就到此为止**,这正是
  上面说的短路。
- 备份桶里是否真的有这份副本(下一节「错误处置」第 1 条,手册的「空」态)。

三道核验都过,脚本打印副本大小并停在 dry-run,提示「rerun with --apply」。

### 第 3 步 · 恢复命令

三道闸都过之后,加 `--apply` 真正执行(需要碰生产确认锁):

```bash
I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
  railway run -p b5d13d78-5d9b-4791-a6ae-7a7bc85f5d3d -e staging -s worker \
    -- node scripts/tools/media-restore-object.mjs \
         --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId> --apply
```

**`media-restore-object.mjs` 只打备份桶名、不打内容桶名**(2026-09-19 二次盲走核过),所以它
自己拦不住「环境搞混」这件事——真写之前,用 2-a 那条差集命令的头两行确认内容桶与备份桶都是
你以为的那两个,再发 `--apply`。

脚本内部顺序:下载备份侧字节 → 本地重新算一次 sha256(见第 4 步)→ 哈希对上才
`PutObject` 写回内容桶原 key(带 `IfNoneMatch: "*"`,即便两次检查之间发生竞态写入也绝不
覆盖)。整个过程不触发任何生成 job、不产生任何计费事件——恢复是纯粹的字节搬运。

**写回用的是备份对象自己的 `ContentType`,不是数据库 `Asset.mime`。** 存量数据里两者有不
一致的(2026-09-19 盲走那件就是 R2 的 `image/png` vs `Asset.mime` 的 `image/jpeg`),恢复保留的是
备份桶那一份——这是原样回滚,不是损坏,别当事故报。

**内存下限:** 脚本用 `transformToByteArray()` 把整个对象一次性读进内存再校验、再写回——
不是流式的。恢复一个几百 MB 的大视频,跑这个脚本的机器就要能腾出至少那么大的一块内存;
量级远超本手册管的媒体对象就先掂量一下跑脚本的机器够不够,不够就先扩内存或者换一台机器,
而不是当场去改脚本抢流式。

### 第 4 步 · 哈希比对

脚本自动做:key 文件名里的 `<sha256>` 段本身就是这个对象在写入那一刻的内容哈希(内容
寻址的定义);脚本对下载下来的字节重新算一遍 `sha256`,两者不等就**拒绝写回**并非零
退出,报「HASH MISMATCH」。成功时脚本打印:

```
RESTORED u/<ownerId>/<sha256>.<ext> — hash verified (<sha256>), RTO <N>s
```

拿这一行去做**删后核对**。三样任选,前两样不需要任何浏览器会话(2026-09-19 盲走修正:
原来只写「访问 `/files/<key>`」,那条路未登录根本走不通):

1. **工具自证(最省事)**:把第 2 步 2-c 的 dry-run 原样再跑一遍。对象回来了,闸 2 就会拒绝
   并报 `already exists in the content bucket`——**这条拒绝就是恢复成功的证据**(闸 2 打的是
   内容桶 `HeadObject`,见 `scripts/tools/media-restore-object.mjs`)。
   **注意它是抛异常的形状**:终端会打出一段 Node 栈回溯(`Error: refusing: … already exists in
   the content bucket` 加文件路径,再加一行 `Node.js v22.x`),退出码 1。**这不是脚本坏了**——
   同一个脚本的 MEDIA-A9 拒绝(第 2 步)是干干净净的一行,两种拒绝长得完全不一样,别被吓到;
   认那行 `refusing:` 就够了。
2. **直接 HEAD 内容桶**:用「演练(仅 staging)」小节那段脚手架、不带 `DRILL_DELETE` 再跑
   一趟,它打印内容桶与备份桶两侧的 size / ETag / ContentType;两侧 size 相等即字节回位。
   (手边有别的 S3 客户端也行,把 `R2_*` 映射成它自己的变量名即可;工具不限,HEAD 的是同一个
   内容桶同一个 key。)
3. **(可选)看页面**:`/files/<key>` 这条路**要登录**——未登录会被重定向到 `/login`
   (`apps/web/app/files/[...key]/route.ts`:先 `auth()` + 允许名单,再 `requireOwner()`,
   还要 `keyOwnerMatches` 与当前 org 对上,对不上直接 404)。所以要看页面,必须先用**这个
   对象所属商家**的账号登录 staging(`https://web-staging-7901.up.railway.app`),再访问
   `https://web-staging-7901.up.railway.app/files/<key>`;换别的账号看只会得到 404。

任一条过了,进第 5 步。

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
| 成功 | 对象回到原 key,字节哈希与原件一致(脚本自动校验),产物页面(用该商家账号登录后)能重新打开——核对手法见第 4 步 |

## 错误处置(三条,一律 fail closed:宁可不恢复,不许覆盖现存对象)

| 情况 | 处置 |
|---|---|
| **副本列不出来**(备份桶 `HeadObject` 返回 404/NotFound/NoSuchKey) | 脚本报 `EMPTY`,退出非零。不得从别处拼一份替代字节;当场升级给 Founder,先确认是不是本文件「什么可能漏备、怎么发现」那条成因说的那种漏备窗口内发生的误删(先跑一次 `media-backup-backfill.mjs` 差集命令看这个 key 是不是就是被落下的那一个,再 grep `media_backup_replication_failed` 确认当时是否真的复制失败过)。 |
| **权限不足**(凭据没有目标桶的读/写权限,S3 返回 403/AccessDenied 一类) | 脚本照实抛出原始错误,不吞、不重试成别的操作。核对拿到的是不是对的环境的凭据(见「前提」第 1 条的凭据口径——恢复演练今天借的就是该环境部署自己的凭据,没有单独的演练令牌),绝不为了跑通而升级令牌权限。 |
| **键写错**(格式不对,或指向一个其实还活着的对象) | 格式不对 → `parseStorageKey` 直接拒绝,报「not a fikirtive storage key」。指向活对象 → 内容桶 `HeadObject` 命中,脚本报「already exists」并拒绝——内容寻址下已存在必然已经是对的字节,恢复到一个已经有内容的 key 上没有意义,也不会被允许覆盖。 |

## 只按单键恢复,禁止整桶回滚

`scripts/tools/media-restore-object.mjs` 没有整桶操作的入口——它一次只吃一个 `--key`,
写回时也只 `PutObject` 这一个 key。**任何「批量恢复」「按前缀恢复」的临时脚本都不在这份
手册的授权范围内**;真出现需要恢复一批对象的场景,对每一个 key 分别跑一次这个脚本、
分别核对一次租户前缀,再分别记一行演练记录——多花的时间就是这条规矩的成本,换来的是
「一次操作最多影响一个对象」的上限。

## 保留口径(备份桶留多久、谁去看)

**备份桶全量保留，月度看一眼成本。** 备份桶不设任何自动删除/过期规则(multipart 中止规则
除外);商家在产品里删掉产物,备份桶那一份也留着不动——「捞得回」就是从这里来的。容量与账单
每月看一眼,超出预期再决定要不要加规则;**要加任何规则,先改这一段,再动桶**(规格 MEDIA-A2 /
§3 非目标「删除时的备份桶联动清理」)。

**lifecycle 规则怎么看:用账号级 Cloudflare API 令牌在控制台或 API 看,不是 R2 对象令牌。**
部署里那两把 R2 令牌是对象级的,没有读桶配置的权限——2026-09-19 实测三种组合
(备份令牌→备份桶、内容令牌→内容桶、内容令牌→备份桶)对 `GetBucketLifecycleConfiguration`
全部 `AccessDenied`(HTTP 403)。**403 不等于「没有规则」**,它只说明这把钥匙看不了,别把它
写成「已核验无规则」。账号级令牌在 Founder 手上(钥匙串 `cloudflare-api-token-belcort`,见
`docs/runbooks/r2-bucket-token-rotation.md`),agent 永不读——**这一眼由 Founder 在控制台看
并回填**(staging 与 production 两个备份桶都要看;生产那次挂在部署门 #1480)。

## 演练记录

| 日期 | 执行者 | 对象键 | 脚本段 RTO | 人工排查段 | 命令输出片段 |
|---|---|---|---|---|---|
| 2026-09-13 | agent（Founder 授权「你在处理」，本对谈记录在 #1385） | u/founder/51c55aedae60a3ac26cbb52685a2bcc46278223bb3de9ad53db9d93ceeae9d49.mp4 | 1.6s | —（未分开记） | `found backup copy: … (2683441 bytes) in fikirtive-staging-backup` → `RESTORED … — hash verified (51c55aed…)`；真删证据 `deleted: … is now GONE from fikirtive-staging`；A9 反证 `refusing: key owner segment is "founder", but --expect-owner was "not-the-owner"`（exit 1）；钱守恒：founder 账本前后均 127 笔/99998514/0；存量回填 280/280 → 差集 0；生产桶本次零删除 |
| 2026-09-19 | agent（blind-walk MEDIA-A3；授权：Founder 2026-09-19 将 v0.2.0 余下决定授予编排者，编排者裁定本次 staging 演练在范围内） | u/org_cmts923pm00002mptbuoube0j/ee0273a5ca30d476c7730ccd99e3b7286044c6f463922b16457a2abc3b3f4b17.png | 1.5s | 约 7m14s（含一次 MODULE_NOT_FOUND 停顿） | 盲走：PARTIAL——手册三处 P1 缺口（本 PR 修）。`found backup copy: … (101169 bytes) in fikirtive-staging-backup` → `RESTORED … — hash verified (ee0273a5…), RTO 1.5s`；真删证据 `deleted: … is now GONE from fikirtive-staging`；A9 反证 `refusing: key owner segment is "org_cmts923pm00002mptbuoube0j", but --expect-owner was "org_someone_else"`（exit 1）；钱守恒：E2E Cafe 账本前后均 23 笔 / balanceDelta 合计 100 / reserved 0，全库 290 笔不变；差集前后均 307/307 → 0；备份桶零写入（lastModified 仍 2026-09-13T10:20:54Z）；生产桶本次零触碰 |
| 2026-09-19 | agent（blind-walk #2 MEDIA-A3，走 PR #1484 重写后的手册，与合入后的 main 逐字一致；授权：Founder 2026-09-19 将 v0.2.0 余下决定授予编排者，编排者裁定本次 staging 演练在范围内） | u/org_cmts923pm00002mptbuoube0j/bf16d2f40520f175b24354a9eb19c36f40d92e4aa2813b8ef01fe064e95efcfe.jpg | 2.7s | 约 4m25s（第 1 步定位键 10:27:35Z → 第 3 步发出 `--apply` 10:32:00Z，含删前差集 60s 与四道保险丝核对） | 盲走 #2：PARTIAL——首轮四处阻塞缺口全部闭合（凭据现值在哪、演练删除脚手架、`pnpm install` 不够要 build、删后核对不再只给要登录的 `/files/<key>`），照做即通；余下是措辞级缺口 AMB-2-01…09，本行所在这一版手册已补。`found backup copy: …(200940 bytes) in fikirtive-staging-backup` → `RESTORED … — hash verified (bf16d2f4…), RTO 2.7s`；真删证据 `deleted: … is now GONE from fikirtive-staging`；A9 反证 `refusing: key owner segment is "org_cmts923pm00002mptbuoube0j", but --expect-owner was "org_not_the_owner_a3second"`（exit 1）；钱守恒：E2E Cafe 账本前后均 23 笔／balanceDelta 合计 100／reserved 0，CreditAccount 100/0 且 updatedAt 未动，全库 290 笔不变；A4 零新 job（org 4／全库 51 前后一致）；Asset 行 md5 前后均 fa870096…；差集前后均 307/307 → 0；备份桶零写入（副本 lastModified 仍 2026-09-13T10:20:53Z）；生产桶本次零触碰。另计环境预备段 1m47s（`pnpm install` + core build + 依赖预检）——脚本段／人工排查段／环境预备段三段一律不相加。证据存档：`docs/audits/fullstack-staging-2026-09-14/local-logs/staging-r3-media-a3/`（blind-walk-2.json、step0-plan.md、raw/，首轮为 blind-walk-1.json） |
| | | | | | |

<!--
  每次演练(含首次上线前的验证跑,MEDIA-A3/A4/A5)在上表加一行:
  - 日期:YYYY-MM-DD
  - 执行者:GitHub 用户名或姓名;agent 走的写「agent + 授权出处」(现有三行都是这个形状)
  - 对象键:完整 u/<ownerId>/<sha256>.<ext>
  - 脚本段 RTO:脚本打印的那一行数字(秒),只含下载/校验/写回
  - 人工排查段:从「开始找 key」算起,到「发出 --apply」那一刻为止(第 5 步要的第二个数字)。
    这两栏永远分开写、永远不相加(2026-09-19 二次盲走前只有一栏,两个数字挤在一格里)。
    环境预备(pnpm install + core build + 预检)不算进这两段,要记就写进命令输出片段那栏。
    首行 2026-09-13 没分开计时,人工段写「—(未分开记)」,不要事后补一个猜出来的数。
  - 命令输出片段:粘贴 media-restore-object.mjs --apply 的关键几行(RESTORED ... hash verified ...)
  - 大对象耗时(MEDIA-A1/A4 适用,判官第三轮 NEW-P2-3):量一次接近 2 GiB 上限对象走
    copyToBackup 的实际耗时。若逼近 P1-2 焊死的 10s requestTimeout 上限,把这个实测数值
    回填进本文件,并评估是否要调整 finalize 路的超时——本轮只记录观察,代码超时本身不动。
  (差集的日常巡检口径、以及「演练前差集必须为零再动手删」这两条,2026-09-19 起写在正文
  第 2 步 2-a 与「演练(仅 staging)」小节里,这里不再复述。)
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
  `replicateToBackup` → `replicateWithRetry`);直传上传收尾补一刀的实现
  (`R2Storage.copyToBackup()`,同样走 `replicateWithRetry`,finalize 在
  `apps/web/lib/upload-actions.ts` 里调用)。
