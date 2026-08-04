/**
 * #603 T4 — 回填到底把哪些行填对了,哪些行诚实地留空(spec #599 D5)。
 *
 * 迁移的回填只跑一次,而它决定的是**商家会看到什么谱系**:填错一条,画布上就多一条不存在的
 * 「从这张来」——错的溯源比没有溯源更危险,因为它会被当成证据。所以这里不是复述那段 SQL,
 * 而是**把迁移文件里那一句原样读出来执行**,用真库、老形状的行,逐类核对结果:
 *
 *   可回填 —— 批内序号、批大小(付费作业自己的产出列表)、以及旧「来源」列到底是哪一种意思
 *             (作业有没有输入图,是无歧义的判据)。
 *   不可回填 —— 没有作业的卡、作业行已被物删的卡、还没绑上产出的在途卡、绑了非本作业产出的
 *             历史错绑行。这四类一律留 NULL,读作「不知道」,不画线、不显示 A/B、不画组框。
 *
 * 这段测试与迁移文件绑定:改了那句 SQL 而没有改这里,这里就红。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../index.js";
import { seedOrg } from "../../test/setup.js";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260805120000_t4_canvas_batch_identity/migration.sql",
);

/**
 * The migration's own backfill statement, taken from the file rather than spelled again here.
 *
 * Comments are stripped line by line before the statement's end is looked for: the file's prose is
 * Chinese and full of punctuation that would otherwise be read as SQL.
 */
function backfillStatement(): string {
  const lines = readFileSync(MIGRATION, "utf8").split("\n");
  const start = lines.findIndex((line) => line.startsWith('UPDATE "CanvasNode" n'));
  if (start < 0) throw new Error("the T4 migration no longer contains its backfill UPDATE");
  const statement: string[] = [];
  for (const line of lines.slice(start)) {
    const code = line.replace(/--.*$/u, "");
    statement.push(code);
    if (code.includes(";")) return statement.join("\n");
  }
  throw new Error("the T4 migration's backfill UPDATE is not terminated");
}

let orgId: string;
let projectId: string;

beforeEach(async () => {
  orgId = `org_${randomUUID()}`;
  await seedOrg(orgId, 100_000);
  projectId = `prj_${randomUUID()}`;
  await prisma.project.create({ data: { id: projectId, ownerId: orgId, name: "Legacy board" } });
});

afterEach(async () => {
  if (!orgId) return;
  await prisma.canvasNode.deleteMany({ where: { ownerId: orgId } });
});

async function seedGeneration(): Promise<string> {
  const contentHash = randomUUID().replace(/-/g, "").repeat(2);
  const asset = await prisma.asset.create({
    data: {
      id: `ast_${randomUUID()}`, ownerId: orgId, contentHash, ext: "png",
      mime: "image/png", sizeBytes: BigInt(64), source: "GENERATED",
    },
  });
  const generation = await prisma.generation.create({
    data: {
      id: `gen_${randomUUID()}`, ownerId: orgId, projectId, assetId: asset.id,
      source: "GENERATED", entitySnapshot: {},
    },
  });
  return generation.id;
}

async function seedJob(input: {
  generationIds: string[];
  sourceGenerationId?: string | null;
}): Promise<string> {
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a cup steaming",
      kind: "IMAGE", model: "seedream", count: Math.max(1, input.generationIds.length),
      status: "DONE", generationIds: input.generationIds,
      sourceGenerationId: input.sourceGenerationId ?? null,
      spent: true, spentUsd: 0.12, startedAt: new Date(), finishedAt: new Date(),
    },
  });
  return jobId;
}

/** A row exactly as the pre-T4 writers left it: one "source" column, no batch identity. */
async function seedLegacyCard(input: {
  genJobId: string | null;
  generationId: string | null;
  sourceNodeId: string | null;
}): Promise<string> {
  const id = `cnd_${randomUUID()}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CanvasNode" (
       "id","ownerId","projectId","type","x","y","w","h","prompt",
       "generationId","genJobId","status","sourceNodeId","createdAt","updatedAt"
     ) VALUES ($1,$2,$3,'image',0,0,320,320,'a cup steaming',$4,$5,'done',$6,NOW(),NOW())`,
    id, orgId, projectId, input.generationId, input.genJobId, input.sourceNodeId,
  );
  return id;
}

type Identity = {
  batchIndex: number | null;
  batchSize: number | null;
  layoutAnchorNodeId: string | null;
  madeFromNodeId: string | null;
};

async function identityOf(id: string): Promise<Identity> {
  const row = await prisma.canvasNode.findFirstOrThrow({
    where: { id, ownerId: orgId },
    select: { batchIndex: true, batchSize: true, layoutAnchorNodeId: true, madeFromNodeId: true },
  });
  return row;
}

/** Put every card back the way the migration found it, then run the migration's own statement. */
async function runBackfill(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "CanvasNode" SET "batchIndex" = NULL, "batchSize" = NULL,
       "layoutAnchorNodeId" = NULL, "madeFromNodeId" = NULL WHERE "ownerId" = $1`,
    orgId,
  );
  await prisma.$executeRawUnsafe(backfillStatement());
}

describe("what the T4 backfill can prove", () => {
  it("gives a plain batch its positions, its bought size, and its layout anchors", async () => {
    const outputs = [await seedGeneration(), await seedGeneration(), await seedGeneration(), await seedGeneration()];
    const jobId = await seedJob({ generationIds: outputs });
    const anchor = await seedLegacyCard({ genJobId: jobId, generationId: outputs[0]!, sourceNodeId: null });
    const siblings = [];
    for (const generationId of outputs.slice(1)) {
      siblings.push(await seedLegacyCard({ genJobId: jobId, generationId, sourceNodeId: anchor }));
    }

    await runBackfill();

    expect(await identityOf(anchor)).toEqual({
      batchIndex: 0, batchSize: 4, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
    for (const [offset, id] of siblings.entries()) {
      // The old column held the batch's anchor: layout, and nothing else. It moves to the layout
      // column, and the parentage column stays empty — nobody made these.
      expect(await identityOf(id)).toEqual({
        batchIndex: offset + 1, batchSize: 4, layoutAnchorNodeId: anchor, madeFromNodeId: null,
      });
    }
  });

  it("reads the old column as REAL parentage when the job was built on an earlier picture", async () => {
    const sourceGenerationId = await seedGeneration();
    const sourceCard = await seedLegacyCard({ genJobId: null, generationId: sourceGenerationId, sourceNodeId: null });
    const outputs = [await seedGeneration(), await seedGeneration()];
    const jobId = await seedJob({ generationIds: outputs, sourceGenerationId });
    const anchor = await seedLegacyCard({ genJobId: jobId, generationId: outputs[0]!, sourceNodeId: sourceCard });
    const sibling = await seedLegacyCard({ genJobId: jobId, generationId: outputs[1]!, sourceNodeId: sourceCard });

    await runBackfill();

    expect(await identityOf(anchor)).toEqual({
      batchIndex: 0, batchSize: 2, layoutAnchorNodeId: null, madeFromNodeId: sourceCard,
    });
    expect(await identityOf(sibling)).toEqual({
      batchIndex: 1, batchSize: 2, layoutAnchorNodeId: null, madeFromNodeId: sourceCard,
    });
  });

  it("gives an in-flight card its batch size but no position — it carries no output yet", async () => {
    const outputs = [await seedGeneration(), await seedGeneration()];
    const jobId = await seedJob({ generationIds: outputs });
    const unbound = await seedLegacyCard({ genJobId: jobId, generationId: null, sourceNodeId: null });

    await runBackfill();

    expect(await identityOf(unbound)).toEqual({
      batchIndex: null, batchSize: 2, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
  });
});

describe("what the T4 backfill refuses to guess", () => {
  it("leaves an uploaded card — no paid press, no batch — completely blank", async () => {
    const card = await seedLegacyCard({
      genJobId: null, generationId: await seedGeneration(), sourceNodeId: null,
    });

    await runBackfill();

    expect(await identityOf(card)).toEqual({
      batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
  });

  it("leaves a card whose paid job no longer exists blank in EVERY column", async () => {
    // Deleting a project physically removes its job rows while the cards claim to live for ever,
    // so the truth source dies before the fact it recorded. Nothing can say which of the two
    // meanings that card's old "source" column carried, so neither column is filled: the card
    // reads as 早期作品,来历不详 rather than as a parentage nobody can vouch for.
    const orphan = await seedLegacyCard({
      genJobId: `gjb_${randomUUID()}`, generationId: await seedGeneration(), sourceNodeId: "some-older-card",
    });

    await runBackfill();

    expect(await identityOf(orphan)).toEqual({
      batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
  });

  it("gives no position to a card carrying an output that is not in its job's list", async () => {
    const jobId = await seedJob({ generationIds: [await seedGeneration()] });
    const misbound = await seedLegacyCard({
      genJobId: jobId, generationId: await seedGeneration(), sourceNodeId: null,
    });

    await runBackfill();

    expect(await identityOf(misbound)).toEqual({
      batchIndex: null, batchSize: 1, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
  });

  it("never lets another workspace's job answer for this one's card", async () => {
    // CanvasNode.genJobId carries no foreign key, so a row can name a job that belongs elsewhere.
    // The backfill joins on owner AND project as well as the id, so such a row stays blank.
    const otherOrg = `org_${randomUUID()}`;
    await seedOrg(otherOrg, 1_000);
    const otherProject = `prj_${randomUUID()}`;
    await prisma.project.create({ data: { id: otherProject, ownerId: otherOrg, name: "Someone else" } });
    const foreignJob = `gjb_${randomUUID()}`;
    await prisma.genJob.create({
      data: {
        id: foreignJob, ownerId: otherOrg, projectId: otherProject, prompt: "not ours",
        kind: "IMAGE", model: "seedream", count: 2, status: "DONE",
        generationIds: ["gen-theirs-1", "gen-theirs-2"], spent: true,
        startedAt: new Date(), finishedAt: new Date(),
      },
    });
    const card = await seedLegacyCard({
      genJobId: foreignJob, generationId: await seedGeneration(), sourceNodeId: null,
    });

    await runBackfill();

    expect(await identityOf(card)).toEqual({
      batchIndex: null, batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
    await prisma.canvasNode.deleteMany({ where: { ownerId: otherOrg } });
  });
});
