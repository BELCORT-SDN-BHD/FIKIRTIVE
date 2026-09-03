/**
 * scripts/tools/purge-deleted-entity-assets.ts —— 存量清理脚本的真库集成测试(2026-09-03
 * staging 走查 S4)。种的是**这次修复之前**的坏形状:一个已经 `deletedAt` 的 Entity,底下
 * 还挂着一张活的 ReferenceImage(pre-fix 的 `softDeleteEntity` 从不级联,漏下的正是这个)。
 *
 * 脚本作为真正的子进程跑(跟人/CI 实际会敲的命令一字不差),断言:
 *   · 默认 DRY RUN 不改一行、不删任何存储对象,但计数是**真算出来的**(脚本内部真跑一遍
 *     事务再回滚,不是估算);
 *   · --apply 之后 ReferenceImage/Asset 都被标记 deletedAt,存储对象真的从磁盘消失;
 *   · 重跑 --apply 是空操作(幂等)——第二次找不到任何东西可处理。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/tools/purge-deleted-entity-assets.ts");
const TSX_LOADER = path.join(REPO_ROOT, "apps/worker/node_modules/tsx/dist/loader.mjs");

const { prisma } = await import("@fikirtive/db");
const { storage } = await import("../storage");
const { storageKey } = await import("@fikirtive/core");

const OWNER = `org-purgescript-${randomUUID().slice(0, 8)}`;

type Run = { status: number | null; stdout: string; stderr: string };

/** Runs the ACTUAL script as a child process — the same invocation a human or CI would type
 *  (`node --conditions=react-server --import <tsx loader> scripts/tools/….ts [args]`), against
 *  this test file's own real Postgres connection (STORAGE_DRIVER stays unset → local disk,
 *  same as every other real-DB test in this suite). */
function runScript(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--conditions=react-server", "--import", TSX_LOADER, SCRIPT, ...args],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function seedLeftover(): Promise<{ entityId: string; assetId: string; key: string }> {
  const bytes = new TextEncoder().encode(`purgescript-${randomUUID()}`);
  const { contentHash, key } = await storage.put(OWNER, bytes, "png");
  const assetId = `ast-${randomUUID()}`;
  await prisma.asset.create({
    data: {
      id: assetId, ownerId: OWNER, contentHash, ext: "png", mime: "image/png",
      sizeBytes: BigInt(bytes.byteLength), originalFilename: "x.png", source: "UPLOAD",
    },
  });
  const entityId = `ent-${randomUUID()}`;
  // The pre-fix bug, reproduced on purpose: entity tombstoned WITHOUT cascading its
  // reference image — exactly what happened for real before softDeleteEntity was fixed.
  await prisma.entity.create({ data: { id: entityId, ownerId: OWNER, type: "CHARACTER", name: "Leftover Cast", deletedAt: new Date() } });
  await prisma.referenceImage.create({ data: { id: `ri-${randomUUID()}`, ownerId: OWNER, entityId, assetId, position: 0 } });
  return { entityId, assetId, key };
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: OWNER, name: "Purge script fixture shop" } });
});

afterAll(async () => {
  await prisma.referenceImage.deleteMany({ where: { ownerId: OWNER } });
  const assets = await prisma.asset.findMany({ where: { ownerId: OWNER }, select: { ownerId: true, contentHash: true, ext: true } });
  await prisma.entity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.organization.deleteMany({ where: { id: OWNER } });
  for (const a of assets) await storage.deleteObject(storageKey(a.ownerId, a.contentHash, a.ext)).catch(() => {});
}, 20_000);

describe("scripts/tools/purge-deleted-entity-assets.ts", () => {
  it("dry run: reports the exact would-be counts and changes NOTHING", async () => {
    const { entityId, assetId, key } = await seedLeftover();

    const result = await runScript(["--owner", OWNER]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("DRY RUN");
    expect(result.stdout).toMatch(/entities with leftover live refs\s*: 1/);
    expect(result.stdout).toMatch(/reference images that would be soft-deleted\s*: 1/);
    expect(result.stdout).toMatch(/assets that would be purged.*: 1/);

    const [ref, asset] = await Promise.all([
      prisma.referenceImage.findFirst({ where: { entityId, ownerId: OWNER } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER } }),
    ]);
    expect(ref?.deletedAt).toBeNull();
    expect(asset?.deletedAt).toBeNull();
    expect(await storage.exists(key)).toBe(true);
  }, 30_000);

  it("--apply: cascades the reference image and purges the now-exclusive asset for real", async () => {
    const { entityId, assetId, key } = await seedLeftover();

    const result = await runScript(["--apply", "--owner", OWNER]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("APPLY");
    expect(result.stdout).toMatch(/reference images soft-deleted\s*: \d+/);
    expect(result.stdout).toMatch(/storage objects deleted\s*: \d+/);

    const [ref, asset] = await Promise.all([
      prisma.referenceImage.findFirst({ where: { entityId, ownerId: OWNER } }),
      prisma.asset.findFirst({ where: { id: assetId, ownerId: OWNER } }),
    ]);
    expect(ref?.deletedAt).not.toBeNull();
    expect(asset?.deletedAt).not.toBeNull();
    expect(await storage.exists(key)).toBe(false);

    // idempotent: nothing left to find on a second pass
    const again = await runScript(["--apply", "--owner", OWNER]);
    expect(again.status, again.stdout + again.stderr).toBe(0);
    expect(again.stdout).toMatch(/entities with leftover live refs\s*: 0/);
    expect(again.stdout).toMatch(/storage objects deleted\s*: 0/);
  }, 30_000);
});
