// One-shot R2 bucket configuration for T4b direct upload (codex round #4/#8).
// Sets the two things presigned browser uploads need beyond credentials:
//   CORS  — allow PUT from the app origin AND expose ETag (Uppy reads part
//           ETags during multipart completion; without this it stalls)
//   Lifecycle — abort incomplete multipart uploads after 7 days, so an
//           abandoned/crashed upload can't leak storage forever
//
// Idempotent: re-running overwrites both configs with the same values.
// Usage (against prod R2, creds from the secrets file):
//   set -a && source ~/.gstack/projects/artlio/secrets/cloud.env && set +a
//   APP_ORIGIN=https://web-production-b13a4.up.railway.app node scripts/r2-configure.mjs
// Or against local MinIO:
//   STORAGE_DRIVER=r2 R2_ENDPOINT=http://localhost:9000 R2_ACCESS_KEY_ID=minioadmin \
//   R2_SECRET_ACCESS_KEY=minioadmin R2_BUCKET=artlio APP_ORIGIN=http://localhost:3100 \
//   node scripts/r2-configure.mjs
import { createRequire } from "node:module";
const require = createRequire(new URL("../packages/storage/package.json", import.meta.url));
const { S3Client, PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, GetBucketCorsCommand } = await import(
  require.resolve("@aws-sdk/client-s3")
);

const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
const APP_ORIGIN = process.env.APP_ORIGIN;
if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  throw new Error("need R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET in env");
}
if (!APP_ORIGIN) throw new Error("need APP_ORIGIN (the web origin browsers upload from)");

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE !== "false",
});

// MinIO (local stand-in) manages CORS/lifecycle outside the S3 API and
// returns NotImplemented for both PutBucket* below — it ships a permissive
// default CORS that already exposes ETag, so the local tracer works without
// this. These operations are the real, required prod-R2 configuration.
// MinIO rejects these S3 config calls with NotImplemented or InvalidArgument
// depending on the call; R2 accepts both. Either signal means "local backend
// won't take this — fine, it's R2-only configuration."
const isLocalUnsupported = (err) => ["NotImplemented", "InvalidArgument"].includes(err?.name ?? "");
let corsApplied = false;

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: R2_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [APP_ORIGIN],
            AllowedMethods: ["PUT", "GET"],
            AllowedHeaders: ["content-type", "if-none-match"],
            ExposeHeaders: ["ETag"], // Uppy multipart reads part ETags
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  corsApplied = true;
  console.log(`✓ CORS set: PUT/GET from ${APP_ORIGIN}, ETag exposed`);
} catch (err) {
  if (!isLocalUnsupported(err)) throw err;
  console.warn("⚠ CORS skipped — backend manages CORS natively (MinIO; R2 needs the S3 API call)");
}

try {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: R2_BUCKET,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "abort-incomplete-multipart",
            Status: "Enabled",
            Filter: { Prefix: "" },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
        ],
      },
    }),
  );
  console.log("✓ lifecycle set: incomplete multipart uploads abort after 7 days");
} catch (err) {
  if (!isLocalUnsupported(err)) throw err;
  console.warn("⚠ lifecycle skipped — backend doesn't implement AbortIncompleteMultipartUpload (MinIO; R2 does)");
}

if (corsApplied) {
  const cors = await client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
  const exposed = cors.CORSRules?.[0]?.ExposeHeaders ?? [];
  if (!exposed.map((h) => h.toLowerCase()).includes("etag")) {
    throw new Error("readback: ETag is NOT exposed — multipart uploads will stall");
  }
  console.log("✓ readback confirms ETag exposed — R2 ready for direct upload");
} else {
  console.log("• nothing applied via S3 API (MinIO) — verify your prod R2 run shows both ✓ lines above");
}
