// READ-ONLY probe: can ANY staging R2 credential read a lifecycle configuration?
// Staging buckets only; never names a production bucket.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/packages/storage/package.json");
const { S3Client, GetBucketLifecycleConfigurationCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);

const CONTENT = process.env.R2_BUCKET;
const BACKUP = process.env.R2_MEDIA_BACKUP_BUCKET;
if (CONTENT !== "fikirtive-staging") throw new Error("refusing: content bucket is " + CONTENT);
if (BACKUP !== "fikirtive-staging-backup") throw new Error("refusing: backup bucket is " + BACKUP);

const mk = (id, secret) =>
  new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: id, secretAccessKey: secret },
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
  });

const contentCreds = mk(process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY);
const backupCreds = mk(
  process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID,
  process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY,
);

const probe = async (label, client, Bucket) => {
  try {
    const r = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket }));
    return { probe: label, bucket: Bucket, ok: true, rules: r.Rules || [] };
  } catch (e) {
    return {
      probe: label,
      bucket: Bucket,
      ok: false,
      errorName: e.name || null,
      message: String(e.message || e),
      httpStatus: e.$metadata ? e.$metadata.httpStatusCode : null,
    };
  }
};

const out = [];
out.push(await probe("backup-creds -> backup bucket", backupCreds, BACKUP));
out.push(await probe("content-creds -> content bucket", contentCreds, CONTENT));
out.push(await probe("content-creds -> backup bucket", contentCreds, BACKUP));
console.log(JSON.stringify(out, null, 2));
