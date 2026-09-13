// MEDIA-durability(docs/specs/media-durability.md 已冻结·v2)—— 存量回填 + 差集比对。
//
// 一件事两种跑法(同一份逻辑,别写两份可能走散的):
//   默认(dry-run):只列出内容桶里「备份桶还没有」的 key,不写任何东西。
//                  这就是手册要的「主桶与备份桶差集」比对命令(MEDIA-A2)。
//   --apply      :真的把差集里的对象从内容桶复制进备份桶(存量回填,MEDIA §1.4 的
//                  「施工时把两个内容桶现有对象一次性复制进各自备份桶」)。
//
// 幂等:备份桶已有同一个 key 且 ContentLength 与内容桶一致 → 跳过(counted "skipped")。
//   media 的 key 本身是内容寻址的(`u/<ownerId>/<sha256>.<ext>`,packages/storage 的
//   storageKey),同一个 key 在系统里只可能对应一份字节——写路径永远是「先按字节算哈希,
//   再拿哈希拼 key」,不存在「同 key 不同内容」的合法状态。所以「同 key + 同大小」已经是
//   「同内容」的充分证据,不需要为了验证而把每个对象整个下载下来重算一次 sha256(280 个
//   对象、约 419 MB 的量级下,那会是纯粹多余的网络成本)。
//   同 key 但大小不同 → 判 "conflict",绝不覆盖(fail closed,同 mint-r2-token.mjs 的三态
//   约定),脚本退出非零、点名冲突的 key,人来看。
//
// 用法(对 staging):
//   R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=fikirtive-staging \
//   R2_MEDIA_BACKUP_ACCESS_KEY_ID=... R2_MEDIA_BACKUP_SECRET_ACCESS_KEY=... \
//   R2_MEDIA_BACKUP_BUCKET=fikirtive-staging-backup \
//     node scripts/tools/media-backup-backfill.mjs                # dry-run:只报差集
//   I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
//     node scripts/tools/media-backup-backfill.mjs --apply        # 真的回填
//
// R2_MEDIA_BACKUP_ENDPOINT 可选,不设默认沿用 R2_ENDPOINT(两个桶通常是同账号同 endpoint)。
//
// 本次施工(#1385)按任务书要求**不真跑**——staging/production 桶凭据不经 agent;
// 这份脚本只交付,由 Founder/操作者在有凭据的机器上跑。
import { interlock } from "./_interlock.mjs";
interlock({
  prod: "把内容桶的对象读出来写进备份桶——传入的是哪个环境的凭据就碰哪个环境的 R2(staging 或 production)",
});
import { createRequire } from "node:module";
const require = createRequire(new URL("../../packages/storage/package.json", import.meta.url));
const { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);

const APPLY = process.argv.includes("--apply");
// 只回填媒体对象——`backups/` 前缀是数据库夜间备份,不归这份脚本管(见 packages/storage 的
// OPS_PREFIX 与 docs/runbooks/db-backup.md);media 内容一律落在 `u/` 前缀下。
const MEDIA_PREFIX = "u/";
const CONCURRENCY = 4; // 与 mint-r2-token.mjs 的搬运并发同一个数量级,不是巧合

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`missing required env: ${missing.join(", ")}`);
  }
}

requireEnv(["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]);
requireEnv(["R2_MEDIA_BACKUP_ACCESS_KEY_ID", "R2_MEDIA_BACKUP_SECRET_ACCESS_KEY", "R2_MEDIA_BACKUP_BUCKET"]);

const contentClient = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
});
const CONTENT_BUCKET = process.env.R2_BUCKET;

const backupClient = new S3Client({
  region: "auto",
  endpoint: process.env.R2_MEDIA_BACKUP_ENDPOINT || process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
});
const BACKUP_BUCKET = process.env.R2_MEDIA_BACKUP_BUCKET;

async function listAllKeys(client, bucket, prefix) {
  const out = new Map(); // key -> size
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) out.set(obj.Key, obj.Size ?? 0);
    }
    if (res.IsTruncated && !res.NextContinuationToken) {
      throw new Error("ListObjectsV2 said isTruncated but returned no continuation token — refusing to guess");
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function headSize(client, bucket, key) {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? null;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    const name = err?.name ?? "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return null;
    throw err;
  }
}

async function copyOne(key) {
  const got = await contentClient.send(new GetObjectCommand({ Bucket: CONTENT_BUCKET, Key: key }));
  if (!got.Body) throw new Error(`empty object body: ${key}`);
  await backupClient.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: key,
      Body: got.Body,
      ContentLength: got.ContentLength,
      ContentType: got.ContentType,
    }),
  );
}

/** 简单并发池——不引新依赖,四步流程用不上一个完整的任务队列库。 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`content bucket: ${CONTENT_BUCKET} (${process.env.R2_ENDPOINT})`);
  console.log(`backup  bucket: ${BACKUP_BUCKET} (${process.env.R2_MEDIA_BACKUP_ENDPOINT || process.env.R2_ENDPOINT})`);
  console.log(`mode: ${APPLY ? "APPLY (will copy)" : "dry-run (report only — pass --apply to copy)"}`);

  const contentKeys = await listAllKeys(contentClient, CONTENT_BUCKET, MEDIA_PREFIX);
  console.log(`content bucket has ${contentKeys.size} object(s) under "${MEDIA_PREFIX}"`);

  const missing = []; // keys with no backup copy at all
  const conflict = []; // keys present in both but with different sizes — never auto-resolved
  const already = []; // keys present in both with matching size — nothing to do

  for (const [key, size] of contentKeys) {
    const backupSize = await headSize(backupClient, BACKUP_BUCKET, key);
    if (backupSize === null) missing.push(key);
    else if (backupSize !== size) conflict.push({ key, contentSize: size, backupSize });
    else already.push(key);
  }

  console.log(`already backed up (same key, same size): ${already.length}`);
  console.log(`missing from backup (the diff): ${missing.length}`);
  if (conflict.length > 0) {
    console.log(`CONFLICT — same key, different size (never auto-overwritten): ${conflict.length}`);
    for (const c of conflict) console.log(`  ${c.key}  content=${c.contentSize}B backup=${c.backupSize}B`);
  }

  if (missing.length > 0) {
    console.log(APPLY ? "copying missing objects…" : "(dry-run — nothing copied; rerun with --apply)");
    if (APPLY) {
      let copied = 0;
      let failed = 0;
      await mapWithConcurrency(missing, CONCURRENCY, async (key) => {
        try {
          await copyOne(key);
          copied++;
        } catch (err) {
          failed++;
          console.error(`FAILED copying ${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      console.log(`copied ${copied}/${missing.length}, failed ${failed}`);
      if (failed > 0) {
        console.error("some objects failed to copy — rerun this script (idempotent) after investigating");
        process.exitCode = 1;
      }
    }
  }

  if (conflict.length > 0) {
    console.error("refusing to call this run clean while conflicting keys exist — investigate by hand");
    process.exitCode = 1;
  } else if (!APPLY && missing.length > 0) {
    // dry-run 报了非空差集:退出码点名「还没回填干净」,方便接进手册的差集命令按退出码判断。
    process.exitCode = 1;
  }
}

await main();
