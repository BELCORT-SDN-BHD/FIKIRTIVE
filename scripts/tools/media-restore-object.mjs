// MEDIA-durability(docs/specs/media-durability.md 已冻结·v2)—— 单键恢复。
//
// docs/runbooks/media-restore.md 第 3 步「恢复命令」就是这个脚本。手册写死「只按单键
// 恢复,禁止整桶回滚」(规格 §6 / MEDIA-A9)——这条硬规矩由脚本本身强制,不是写在文档里
// 指望人自觉遵守。三道闸,一一对应手册的三条错误处置:
//
//   1. --expect-owner 与 key 里的 ownerId 段不匹配 → 拒绝(MEDIA-A9 的租户前缀核对;
//      直接复用 packages/core 的 parseStorageKey / keyOwnerMatches —— 这就是产品代码里
//      判断「一个 key 属于哪个租户」的唯一权威,恢复脚本不重新发明第二份判断逻辑)。
//   2. 内容桶里这个 key 已经存在 → 拒绝(内容寻址下「已存在」必然已经是对的字节;这一条
//      同时也拦住了「键写错、其实指向一个还活着的对象」那一种误操作)。
//   3. 备份桶里找不到这个 key → 拒绝,要求当场停手并升级给 Founder(手册的「空」态)。
//   （第四种失败——权限不足——不特殊处理,S3 调用照实抛出原始错误,不吞。）
//
// 恢复成功后自动做第 4 步的哈希比对:对下载下来的字节重新算一次 sha256,与 key 文件名里
// 那一段(内容寻址的定义本身)比对,对不上直接拒绝写回,不存在「恢复了但没人核对过字节」
// 的状态。同时打出可以直接贴进手册演练记录的 RTO 行。
//
// 用法(默认 dry-run:只做三道闸的核验,不写;--apply 才真的把字节放回内容桶):
//   R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=fikirtive-staging \
//   R2_MEDIA_BACKUP_ACCESS_KEY_ID=... R2_MEDIA_BACKUP_SECRET_ACCESS_KEY=... \
//   R2_MEDIA_BACKUP_BUCKET=fikirtive-staging-backup \
//   I_UNDERSTAND_THIS_TOUCHES_PROD=yes \
//     node scripts/tools/media-restore-object.mjs \
//       --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId> --apply
//
// 本次施工(#1385)按任务书要求**不真跑**——staging/production 桶凭据不经 agent;
// 这份脚本只交付,由 Founder/操作者在有凭据的机器上跑演练。
import { interlock } from "./_interlock.mjs";
interlock({ prod: "把备份桶里的一个对象写回内容桶——传入的是哪个环境的凭据就碰哪个环境的 R2" });
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../../packages/storage/package.json", import.meta.url));
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);
const { parseStorageKey, keyOwnerMatches } = await import(require.resolve("@fikirtive/core"));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const KEY = arg("key");
const EXPECT_OWNER = arg("expect-owner");
const APPLY = process.argv.includes("--apply");

if (!KEY) {
  throw new Error("usage: --key u/<ownerId>/<sha256>.<ext> --expect-owner <ownerId> [--apply]");
}
if (!EXPECT_OWNER) {
  throw new Error("refusing: --expect-owner is required (MEDIA-A9 tenant-prefix check has no silent default)");
}

// 闸 1 —— 键写错 / 租户前缀核对(手册「错误」态第 3 条 + MEDIA-A9)
let parsed;
try {
  parsed = parseStorageKey(KEY);
} catch (err) {
  throw new Error(`refusing: "${KEY}" is not a well-formed storage key (${err instanceof Error ? err.message : err})`);
}
if (!keyOwnerMatches(KEY, EXPECT_OWNER)) {
  throw new Error(
    `refusing: key owner segment is "${parsed.ownerId}", but --expect-owner was "${EXPECT_OWNER}" — stopping ` +
      `here per docs/runbooks/media-restore.md's tenant-prefix check (MEDIA-A9). Never pass a different ` +
      `--expect-owner just to make this pass — confirm which tenant actually owns this object first.`,
  );
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new Error(`missing required env: ${missing.join(", ")}`);
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

async function exists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    const name = err?.name ?? "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
    throw err; // 权限不足 / 网络错误照实抛出 —— 手册「错误」态第 2 条,不吞
  }
}

async function main() {
  const startedAt = Date.now();

  // 闸 2 —— 内容桶已经有这个 key:内容寻址下「已存在」必然已经是对的字节
  if (await exists(contentClient, CONTENT_BUCKET, KEY)) {
    throw new Error(
      `refusing: ${KEY} already exists in the content bucket — content-addressed keys mean it already holds ` +
        `the correct bytes. Restoring only makes sense when the object is actually gone.`,
    );
  }

  // 闸 3 —— 备份桶里没有副本:手册的「空」态,当场停手升级给 Founder
  let backupHead;
  try {
    backupHead = await backupClient.send(new HeadObjectCommand({ Bucket: BACKUP_BUCKET, Key: KEY }));
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    const name = err?.name ?? "";
    if (status === 404 || name === "NotFound" || name === "NoSuchKey") {
      throw new Error(
        `EMPTY — no backup copy of ${KEY} in ${BACKUP_BUCKET}. Per docs/runbooks/media-restore.md: stop here, ` +
          `do not fabricate a replacement object, escalate to the Founder.`,
      );
    }
    throw err;
  }

  console.log(`found backup copy: ${KEY} (${backupHead.ContentLength} bytes) in ${BACKUP_BUCKET}`);
  if (!APPLY) {
    console.log("dry-run — all three gates passed; rerun with --apply to actually restore");
    return;
  }

  const got = await backupClient.send(new GetObjectCommand({ Bucket: BACKUP_BUCKET, Key: KEY }));
  const bytes = await got.Body.transformToByteArray();

  // 第 4 步 —— 哈希比对:字节的 sha256 必须等于 key 文件名里那一段(内容寻址的定义本身)
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== parsed.contentHash) {
    throw new Error(
      `HASH MISMATCH — downloaded ${bytes.length} bytes from the backup hash to ${actualHash}, but the key ` +
        `claims ${parsed.contentHash}. Refusing to write corrupted bytes back — escalate to the Founder.`,
    );
  }

  await contentClient.send(
    new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: KEY,
      Body: bytes,
      ContentType: got.ContentType,
      IfNoneMatch: "*", // 双保险:哪怕两次 exists() 检查之间发生了竞态写入,这里也绝不覆盖
    }),
  );

  const rtoSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`RESTORED ${KEY} — hash verified (${actualHash}), RTO ${rtoSeconds}s`);
  console.log(`Paste into docs/runbooks/media-restore.md's drill log: RTO=${rtoSeconds}s key=${KEY}`);
}

await main();
