// READ-ONLY. GetBucketLifecycleConfiguration on the STAGING backup bucket only.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/packages/storage/package.json");
const { S3Client, GetBucketLifecycleConfigurationCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);

const BACKUP = process.env.R2_MEDIA_BACKUP_BUCKET;
if (BACKUP !== "fikirtive-staging-backup") throw new Error("refusing: backup bucket is " + BACKUP);

const backup = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_MEDIA_BACKUP_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_MEDIA_BACKUP_SECRET_ACCESS_KEY,
  },
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
});

try {
  const r = await backup.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BACKUP }));
  console.log(JSON.stringify({ bucket: BACKUP, ok: true, rules: r.Rules || [] }, null, 2));
} catch (e) {
  console.log(
    JSON.stringify(
      {
        bucket: BACKUP,
        ok: false,
        errorName: e.name || null,
        errorCode: e.Code || (e.$response && e.$response.body) || null,
        message: String(e.message || e),
        httpStatus: e.$metadata ? e.$metadata.httpStatusCode : null,
      },
      null,
      2,
    ),
  );
}
