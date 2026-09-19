// READ-ONLY. HeadObject on both buckets for keys given in HEAD_KEYS (whitespace/comma separated).
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/packages/storage/package.json");
const { S3Client, HeadObjectCommand } = await import(require.resolve("@aws-sdk/client-s3"));

const CONTENT = process.env.R2_BUCKET;
const BACKUP = process.env.R2_MEDIA_BACKUP_BUCKET;
if (CONTENT !== "fikirtive-staging") throw new Error("refusing: content bucket is " + CONTENT);
if (BACKUP !== "fikirtive-staging-backup") throw new Error("refusing: backup bucket is " + BACKUP);

const s3 = (id, secret) =>
  new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: id, secretAccessKey: secret },
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
  });
const content = s3(process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY);
const backup = s3(process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID, process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY);

const keys = (process.env.HEAD_KEYS || "").split(/[\s,]+/).filter(Boolean);

const head = async (client, Bucket, Key) => {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket, Key }));
    return {
      exists: true,
      size: r.ContentLength,
      etag: r.ETag,
      lastModified: r.LastModified ? r.LastModified.toISOString() : null,
      contentType: r.ContentType,
    };
  } catch (e) {
    return { exists: false, error: e.name || String(e) };
  }
};

const results = [];
for (const k of keys) {
  const c = await head(content, CONTENT, k);
  const b = await head(backup, BACKUP, k);
  const sizeEtagMatch = Boolean(c.exists && b.exists && c.size === b.size && c.etag === b.etag);
  results.push({ key: k, content: c, backup: b, sizeEtagMatch });
}
console.log(JSON.stringify({ contentBucket: CONTENT, backupBucket: BACKUP, results }, null, 2));
