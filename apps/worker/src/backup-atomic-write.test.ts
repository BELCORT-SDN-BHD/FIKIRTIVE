/**
 * #794 P1-3 (judge r1) — the backup upload is ATOMIC create-if-absent, so two triggers
 * (the worker timer and the Railway cron service) can never both write today's key.
 *
 * The contract lives in the store, not in a prior HEAD check: putFileIfAbsent sends
 * `If-None-Match: *`, and a 412 PreconditionFailed comes back as `created:false` instead
 * of throwing. This test drives a real R2OpsBucket with a fake S3 client that enforces
 * exactly those semantics, and asserts the header is sent and the second writer loses.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { R2OpsBucket } from "@fikirtive/storage";

let dir = "";
let file = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "atomic-write-test-"));
  file = path.join(dir, "dump.gz");
  await writeFile(file, Buffer.from("fake-dump-bytes"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** A minimal S3 client that honours If-None-Match: * against a set of existing keys. */
function fakeS3(existing = new Set<string>()) {
  const sent: Array<{ Key?: string; IfNoneMatch?: string }> = [];
  return {
    existing,
    sent,
    send: async (cmd: { input: { Key?: string; IfNoneMatch?: string } }) => {
      const { Key, IfNoneMatch } = cmd.input;
      sent.push({ Key, IfNoneMatch });
      if (IfNoneMatch === "*" && Key && existing.has(Key)) {
        throw Object.assign(new Error("At least one of the pre-conditions you specified did not hold"), {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        });
      }
      if (Key) existing.add(Key);
      return {};
    },
  };
}

function opsWithClient(client: unknown): R2OpsBucket {
  const ops = new R2OpsBucket(
    { endpoint: "https://acct.r2.cloudflarestorage.com", accessKeyId: "k", secretAccessKey: "s", bucket: "b" },
    "isolated",
  );
  (ops as unknown as { client: unknown }).client = client;
  return ops;
}

describe("R2OpsBucket.putFileIfAbsent — atomic create-if-absent", () => {
  const KEY = "backups/db/fikirtive-2026-08-11.dump.gz";

  it("creates the object and sends If-None-Match: * ", async () => {
    const client = fakeS3();
    const ops = opsWithClient(client);
    const res = await ops.putFileIfAbsent(KEY, file, "application/gzip");
    expect(res.created).toBe(true);
    expect(res.sizeBytes).toBe("fake-dump-bytes".length);
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]!.IfNoneMatch).toBe("*");
    expect(client.sent[0]!.Key).toBe(KEY);
  });

  it("the SECOND writer loses: created:false, no throw (the double-trigger case)", async () => {
    const client = fakeS3();
    const first = opsWithClient(client);
    const second = opsWithClient(client); // shares the same fake bucket state
    const a = await first.putFileIfAbsent(KEY, file, "application/gzip");
    const b = await second.putFileIfAbsent(KEY, file, "application/gzip");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
  });

  it("a non-412 error still throws (a real upload failure is not swallowed)", async () => {
    const client = {
      send: async () => {
        throw Object.assign(new Error("access denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      },
    };
    const ops = opsWithClient(client);
    await expect(ops.putFileIfAbsent(KEY, file, "application/gzip")).rejects.toThrow(/access denied/);
  });

  it("still refuses any key outside the backups/ prefix", async () => {
    const ops = opsWithClient(fakeS3());
    await expect(ops.putFileIfAbsent("u/founder/leak.mp4", file, "application/gzip")).rejects.toThrow(/not an ops key/);
  });
});
