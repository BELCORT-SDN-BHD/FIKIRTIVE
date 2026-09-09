// 纯函数单元测试：node --test mint-r2-token.plan.test.mjs
// 只测不发网络、不碰钥匙串、不动 Railway 的那几个函数。
// import 这个脚本不会触发 main()（脚本里有 invokedDirectly 守卫）。

import test from "node:test";
import assert from "node:assert/strict";

import {
  planFor,
  bucketResourceKey,
  buildPolicy,
  buildMigrationPolicies,
  copyDecision,
  firstSegment,
  prefixSummary,
  partitionByPrefixes,
  migrationExpiry,
} from "./mint-r2-token.mjs";

const ACC = "ac42cba1bda978bd00f6c45d0e25dc24";
const PG_R = { id: "read-id", name: "Workers R2 Storage Bucket Item Read" };
const PG_W = { id: "write-id", name: "Workers R2 Storage Bucket Item Write" };

test("planFor(staging) 给出 staging 的桶／令牌名／Railway 环境", () => {
  assert.deepEqual(planFor("staging"), {
    env: "staging",
    bucket: "fikirtive-staging",
    tokenName: "fikirtive-staging-web",
    railwayEnv: "staging",
    otherBuckets: ["artlio", "fikirtive-production"],
  });
});

test("planFor(production) 的反证桶是另外两个桶，不含自己", () => {
  const p = planFor("production");
  assert.equal(p.bucket, "fikirtive-production");
  assert.equal(p.tokenName, "fikirtive-production-web");
  assert.deepEqual(p.otherBuckets, ["artlio", "fikirtive-staging"]);
  assert.ok(!p.otherBuckets.includes(p.bucket));
});

test("planFor 拒绝不认识的环境名（含空、大小写错、别名）", () => {
  for (const bad of ["", "prod", "Production", "dev", undefined]) {
    assert.throws(() => planFor(bad), /不认识的环境/);
  }
});

test("bucketResourceKey 是文档规定的形状", () => {
  assert.equal(
    bucketResourceKey(ACC, "default", "fikirtive-staging"),
    `com.cloudflare.edge.r2.bucket.${ACC}_default_fikirtive-staging`,
  );
});

test("buildPolicy 把每个桶写成一个 resources 键，权限组只留 id/name", () => {
  const p = buildPolicy(ACC, "default", ["a", "b"], [{ id: "x", name: "X", extra: 1 }]);
  assert.equal(p.effect, "allow");
  assert.deepEqual(Object.keys(p.resources), [
    bucketResourceKey(ACC, "default", "a"),
    bucketResourceKey(ACC, "default", "b"),
  ]);
  assert.deepEqual(Object.values(p.resources), ["*", "*"]);
  assert.deepEqual(p.permission_groups, [{ id: "x", name: "X" }]);
});

test("buildMigrationPolicies 是两条：源桶只读、目标桶可写，互不越界", () => {
  const [readPolicy, writePolicy] = buildMigrationPolicies({
    accountId: ACC,
    jurisdiction: "default",
    sourceBucket: "artlio",
    targetBucket: "fikirtive-production",
    pgRead: PG_R,
    pgWrite: PG_W,
  });
  assert.deepEqual(Object.keys(readPolicy.resources), [
    bucketResourceKey(ACC, "default", "artlio"),
  ]);
  assert.deepEqual(readPolicy.permission_groups, [PG_R]);
  assert.deepEqual(Object.keys(writePolicy.resources), [
    bucketResourceKey(ACC, "default", "fikirtive-production"),
  ]);
  assert.deepEqual(writePolicy.permission_groups, [PG_W]);
  // 源桶绝不能拿到写权限
  assert.ok(!Object.keys(writePolicy.resources).some((k) => k.endsWith("_artlio")));
});

// ───────────────────── migrationExpiry ─────────────────────

test("migrationExpiry 是秒级 RFC3339，不带毫秒（Cloudflare 逐字拒收带毫秒的值）", () => {
  const s = migrationExpiry();
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(!s.includes("."), `expires_on 不能带毫秒，实际是 ${s}`);
});

test("migrationExpiry 落在未来约一小时，且能被 Date 解析回同一时刻", () => {
  const s = migrationExpiry();
  const t = Date.parse(s);
  assert.ok(Number.isFinite(t), `解析不了：${s}`);
  const delta = t - Date.now();
  assert.ok(delta > 3500e3 && delta <= 3600e3, `期望约 1 小时后，实际差 ${delta} ms`);
});

// ───────────────────── copyDecision（三态） ─────────────────────

test("copyDecision：目标已有同名同大小 → skip", () => {
  assert.equal(copyDecision({ ContentLength: 100 }, 100, false), "skip");
  assert.equal(copyDecision({ ContentLength: 0 }, 0, false), "skip");
  // 同大小时 --allow-overwrite-live 也不该重传
  assert.equal(copyDecision({ ContentLength: 100 }, 100, true), "skip");
});

test("copyDecision：head 缺失或形状不对 → copy（宁可重传也不能漏传）", () => {
  for (const head of [null, undefined, {}, { ContentLength: "100" }]) {
    assert.equal(copyDecision(head, 100, false), "copy");
    assert.equal(copyDecision(head, 100, true), "copy");
  }
  assert.equal(copyDecision({ ContentLength: 100 }, undefined, false), "copy");
});

test("copyDecision：两边都有但大小不同 → 默认 conflict，不覆盖", () => {
  assert.equal(copyDecision({ ContentLength: 99 }, 100, false), "conflict");
  assert.equal(copyDecision({ ContentLength: 100 }, 99, false), "conflict");
  assert.equal(copyDecision({ ContentLength: 0 }, 100, false), "conflict");
});

test("copyDecision：大小不同 + --allow-overwrite-live → copy（明示才覆盖）", () => {
  assert.equal(copyDecision({ ContentLength: 99 }, 100, true), "copy");
  assert.equal(copyDecision({ ContentLength: 100 }, 99, true), "copy");
});

test("copyDecision 只返回这三个词", () => {
  const cases = [
    [null, 1, false],
    [{ ContentLength: 1 }, 1, false],
    [{ ContentLength: 2 }, 1, false],
    [{ ContentLength: 2 }, 1, true],
  ];
  for (const [h, s, a] of cases) {
    assert.ok(["skip", "copy", "conflict"].includes(copyDecision(h, s, a)));
  }
});

// ───────────────────── 前缀汇总与前缀排除 ─────────────────────

test("firstSegment 取到第一个斜杠（含斜杠）；根对象归 (根)", () => {
  assert.equal(firstSegment("backups/2026/db.sql"), "backups/");
  assert.equal(firstSegment("uploads/a.png"), "uploads/");
  assert.equal(firstSegment("favicon.ico"), "(根)");
  assert.equal(firstSegment("/leading"), "/");
  assert.equal(firstSegment(""), "(根)");
  assert.equal(firstSegment(undefined), "(根)");
});

test("prefixSummary 按第一段路径汇总 count 与 bytes，按 bytes 降序", () => {
  const objs = [
    { Key: "uploads/a", Size: 10 },
    { Key: "uploads/b", Size: 5 },
    { Key: "backups/x", Size: 900 },
    { Key: "root.txt", Size: 1 },
  ];
  assert.deepEqual(prefixSummary(objs), [
    { prefix: "backups/", count: 1, bytes: 900 },
    { prefix: "uploads/", count: 2, bytes: 15 },
    { prefix: "(根)", count: 1, bytes: 1 },
  ]);
});

test("prefixSummary：Size 缺失按 0 算，空清单给空数组", () => {
  assert.deepEqual(prefixSummary([]), []);
  assert.deepEqual(prefixSummary([{ Key: "a/b" }]), [
    { prefix: "a/", count: 1, bytes: 0 },
  ]);
});

test("partitionByPrefixes：按前缀剔除，其余原样留下", () => {
  const objs = [
    { Key: "backups/db.sql", Size: 900 },
    { Key: "uploads/a.png", Size: 10 },
    { Key: "backupsX/keep.txt", Size: 1 }, // 前缀是 backups/，这个不该被剔
  ];
  const { kept, excluded } = partitionByPrefixes(objs, ["backups/"]);
  assert.deepEqual(
    kept.map((o) => o.Key),
    ["uploads/a.png", "backupsX/keep.txt"],
  );
  assert.deepEqual(
    excluded.map((o) => o.Key),
    ["backups/db.sql"],
  );
});

test("partitionByPrefixes：可以给多个前缀，命中任意一个就剔", () => {
  const objs = [
    { Key: "backups/a", Size: 1 },
    { Key: "tmp/b", Size: 2 },
    { Key: "uploads/c", Size: 3 },
  ];
  const { kept, excluded } = partitionByPrefixes(objs, ["backups/", "tmp/"]);
  assert.deepEqual(
    kept.map((o) => o.Key),
    ["uploads/c"],
  );
  assert.equal(excluded.length, 2);
});

test("partitionByPrefixes：没给前缀就一个都不剔（production 的用法）", () => {
  const objs = [{ Key: "backups/a", Size: 1 }, { Key: "uploads/b", Size: 2 }];
  for (const prefixes of [[], undefined, null]) {
    const { kept, excluded } = partitionByPrefixes(objs, prefixes);
    assert.equal(kept.length, 2);
    assert.equal(excluded.length, 0);
  }
});

test("partitionByPrefixes 不改动传进来的数组", () => {
  const objs = [{ Key: "backups/a", Size: 1 }, { Key: "uploads/b", Size: 2 }];
  partitionByPrefixes(objs, ["backups/"]);
  assert.equal(objs.length, 2);
});
