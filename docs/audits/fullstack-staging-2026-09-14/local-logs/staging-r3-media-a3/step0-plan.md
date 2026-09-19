# Step 0 — 盲走计划（写于任何演练命令之前）

来源：只读 docs/runbooks/media-restore.md @ f5fe84486da8fe1b293f08ba16a49e7ee211cf1e（PR #1484 head，未合并）
读法：从头读到尾一遍，然后只按手册写的做；手册没写而我必须自己知道的，记 ambiguity。

## 手册给出的骨架
- 「前提」1/2/3 → 变量只看名字、railway run 注值、pnpm install + core build + 预检、碰生产确认锁
- 「演练(仅 staging)」 → 造出「丢了」：四道保险丝 + /tmp/drill-delete.mjs 脚手架
- 五步：第1步定位键 → 第2步(2-a 差集 / 2-b 单键 HEAD / 2-c 恢复脚本 dry-run) → 第3步 --apply → 第4步哈希比对与删后核对 → 第5步回填 RTO
- 四态、错误处置三条、只按单键恢复、演练记录表

## 我要执行的顺序（每步记 UTC 时间 / 命令形状 / 退出码 / 墙钟秒 / 输出摘录）
P1 前提1：railway variables list ... -s worker | jq -r 'keys[]'（只列名字，核 7 个必需变量 + 可选 endpoint 缺席）
P2 前提2：pnpm install → pnpm --filter @fikirtive/core build → deps OK 预检
P3 前提3：确认 I_UNDERSTAND_THIS_TOUCHES_PROD 只做 per-command 前缀，绝不 export
S1 第1步：DB 拼键（Asset.ownerId/contentHash/ext），限 org_cmts923pm00002mptbuoube0j；按手册「挑测试商家的最小对象」取 sizeBytes 最小；若与首轮 ee0273a5…png 同键，按任务书改取次小者并记为 deviation
S1b 快照（任务书要求，非手册）：A6 CreditLedger/CreditAccount、Asset 行 md5、A4 GenJob 计数 —— 删前
S2a 第2步 2-a：media-backup-backfill.mjs dry-run，必须差集为 0 才准删
S2b 第2步 2-b：/tmp/drill-delete.mjs 不带 DRILL_DELETE（四道保险丝 + 两侧 size/ETag 留证）
D  删除：同一条命令加 DRILL_DELETE=yes（整场唯一不可逆步骤，仅 staging，单键）
S2c 第2步 2-c：media-restore-object.mjs dry-run（正确 --expect-owner）
A9 故意错 --expect-owner 一次，逐字记录拒绝语
S3 第3步：--apply 恢复，量脚本段 RTO
S4 第4步：删后核对 = 手法1（2-c 再跑一遍，期待 already exists）+ 手法2（脚手架 guard-only 两侧 size/ETag）
S5 第5步：回填 RTO 行（脚本段与人工段分开报，不相加）
POST 删后快照：A6/A4/Asset md5/差集再跑一次（期待仍 0）/备份桶 lastModified 未变（零写入）
X1 EXTRA A1：#1388 两租户付费跑的产物键，两桶 HEAD 比对 size+ETag
X2 EXTRA A2：备份桶 GetBucketLifecycleConfiguration + grep 手册「全量保留/月度」

## 硬边界（任务书 + 全局家规 §6）
staging only；对象必须属 org_cmts923pm00002mptbuoube0j；只删一个 key；备份桶零写入；
production 零触碰（不传 -e production、不读生产变量、不命名生产桶）；不改手册、不提交；
不起任何生成 job、不动额度；凭据值不落盘不回显。
