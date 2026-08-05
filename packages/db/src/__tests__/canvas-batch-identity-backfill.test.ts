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
import { CANVAS_JOB_KEY_PREFIX } from "@fikirtive/core";
import { prisma } from "../index.js";
import { settleCanvasCardsForGenJob } from "../canvas-settlement.js";
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

/** A key of the shape startCanvasGen mints server-side for a Canvas press. */
function canvasKey(): string {
  return `${CANVAS_JOB_KEY_PREFIX}${randomUUID().replace(/-/g, "").repeat(2)}`;
}

async function seedJob(input: {
  generationIds: string[];
  sourceGenerationId?: string | null;
  /** Set it to let the real settlement writer recognise this as a job bought from a board. */
  idempotencyKey?: string | null;
}): Promise<string> {
  const jobId = `gjb_${randomUUID()}`;
  await prisma.genJob.create({
    data: {
      id: jobId, ownerId: orgId, projectId, prompt: "a cup steaming",
      kind: "IMAGE", model: "seedream", count: Math.max(1, input.generationIds.length),
      status: "DONE", generationIds: input.generationIds,
      sourceGenerationId: input.sourceGenerationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
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

/**
 * Put a row back into the ONE-COLUMN shape the pre-T4 writers left behind.
 *
 * Used on rows the REAL settlement has just written, so everything about them — ids, ordering,
 * which card is the anchor, where each sits — is the writer's own output rather than a hand-drawn
 * guess at it. Only the legacy column is stamped, exactly as the writer of the day stamped it.
 */
async function stampLegacySource(id: string, sourceNodeId: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "CanvasNode" SET "sourceNodeId" = $2 WHERE "id" = $1 AND "ownerId" = $3`,
    id, sourceNodeId, orgId,
  );
}

type Identity = {
  batchIndex: number | null;
  batchSize: number | null;
  layoutAnchorNodeId: string | null;
  madeFromNodeId: string | null;
};

async function cardsOfJob(genJobId: string) {
  return prisma.canvasNode.findMany({
    where: { ownerId: orgId, projectId, genJobId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, generationId: true, batchIndex: true },
  });
}

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

/**
 * 判官轮 r1 · P1 —— 同一列的两种意思,不能用「这个作业有没有输入图」来分(#603 T4)。
 *
 * 反例是**可达的历史输出**,不是想象:T2a+b 的结算写者(main `a43438d7`)在「衍生批次多图、
 * 板上还没有锚点」这一路上,先建锚点行(它的 `sourceNodeId` = 真来源卡),再把**刚建好的锚点
 * 自己的 id** 写进兄弟行的 `sourceNodeId` —— 而整批的作业 `sourceGenerationId` 非空。按作业分类
 * 的回填会把兄弟行那个「同批布局锚点」读成派生血缘:画布上凭空多一条「兄弟从锚点来」的线,
 * 而它真正的布局锚点被丢掉。
 *
 * 所以判别式是**被引用的那张卡是什么**,不是作业是什么:同一个作业的卡 ⇒ 布局锚点;作业记录的
 * 来源产出的卡 ⇒ 真派生;两样都验不上 ⇒ 两列都留空。
 *
 * 这两个用例的行由**真结算写者**产出(真 id、真顺序、真锚点),只把那一个旧列按当年写者的样子
 * 盖回去,所以形状不是手画的。
 */
describe("one column, two meanings — decided by the card it points AT", () => {
  it("keeps a derived batch's sibling as LAYOUT, and still gives it the batch's real parent", async () => {
    const sourceGenerationId = await seedGeneration();
    const sourceCard = await seedLegacyCard({
      genJobId: null, generationId: sourceGenerationId, sourceNodeId: null,
    });
    const outputs = [await seedGeneration(), await seedGeneration()];
    const jobId = await seedJob({ generationIds: outputs, sourceGenerationId, idempotencyKey: canvasKey() });

    // The real writer places the whole batch: it creates the anchor first, then the sibling.
    const settled = await settleCanvasCardsForGenJob(jobId, orgId);
    expect(settled.created).toBe(2);
    const [anchor, sibling] = await cardsOfJob(jobId);
    expect(anchor!.generationId).toBe(outputs[0]);
    expect(sibling!.generationId).toBe(outputs[1]);

    // …and the writer OF THE DAY recorded both meanings in the one column: the anchor pointed at
    // the picture the job was built on, the sibling pointed at the anchor it was laid out around.
    await stampLegacySource(anchor!.id, sourceCard);
    await stampLegacySource(sibling!.id, anchor!.id);

    await runBackfill();

    expect(await identityOf(anchor!.id)).toEqual({
      batchIndex: 0, batchSize: 2, layoutAnchorNodeId: null, madeFromNodeId: sourceCard,
    });
    // The sibling stood NEXT TO the anchor; it did not come out of it. And the picture the whole
    // paid job was built on is the sibling's parent too — that is a fact of the job.
    expect(await identityOf(sibling!.id)).toEqual({
      batchIndex: 1, batchSize: 2, layoutAnchorNodeId: anchor!.id, madeFromNodeId: sourceCard,
    });
  });

  it("leaves both columns empty when the old value verifies as neither", async () => {
    // Two ordinary presses, and a stale pointer from one press's card to the other's. It is not a
    // same-batch anchor (different job) and it cannot be a parent (this job was built on nothing).
    const otherJob = await seedJob({ generationIds: [await seedGeneration()] });
    const elsewhere = await seedLegacyCard({
      genJobId: otherJob, generationId: null, sourceNodeId: null,
    });
    const jobId = await seedJob({ generationIds: [await seedGeneration()] });
    const stray = await seedLegacyCard({
      genJobId: jobId, generationId: null, sourceNodeId: elsewhere,
    });

    await runBackfill();

    expect(await identityOf(stray)).toEqual({
      batchIndex: null, batchSize: 1, layoutAnchorNodeId: null, madeFromNodeId: null,
    });
  });
});
