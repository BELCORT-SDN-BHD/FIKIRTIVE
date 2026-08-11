/**
 * transcript-generation.test.ts — #787 r2: how getTranscript CHOOSES a cached transcript.
 *
 * r1 chose "the newest row for these bytes". That reads fine and is wrong: rolling deploys run
 * old and new workers side by side for minutes, and the OLD one can finish a job LAST. The
 * newest row is then the retired engine's — an English transcript of Malay audio — and the new
 * worker's cache hit means nothing ever corrects it. Silent, permanent, and merchant-facing.
 *
 * The selection is now an exact match on TRANSCRIPT_GENERATION: no comparison, no ordering, so
 * there is no race to lose. These tests drive the real action against a mocked Prisma and assert
 * the query it builds and the answer it gives in both mixed-deploy states — the query SHAPE, not
 * a string search for a forbidden literal (a `findFirst where model: 'small'` would have slipped
 * through that).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth-guard", async () => ({
  requireOwner: vi.fn(),
  resolveUserPrincipal: (await import("@/lib/__tests__/__stubs__/resolve-user-principal")).stubResolveUserPrincipal,
}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    transcript: { findUnique: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getTranscript } from "@/lib/actions";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
import { TRANSCRIPT_GENERATION } from "@fikirtive/core";

const OWNER = "org_a";
const HASH = "a".repeat(64);
const SRC = `/files/u/${OWNER}/${HASH}.mp4`;
const PROJECT = "prj_1";

/** The tag rows written before #787 carry. */
const RETIRED_GENERATION = "base.en";

const MALAY_CUES = [{ startMs: 0, lengthMs: 480, text: "Selamat" }];
const STALE_ENGLISH_CUES = [{ startMs: 0, lengthMs: 480, text: "Salamat" }];

/** Stand in for the Transcript table: rows addressed by their generation tag. */
function seedRows(rows: Record<string, unknown[]>) {
  (prisma.transcript.findUnique as Mock).mockImplementation(
    async ({ where }: { where: { contentHash_model: { contentHash: string; model: string } } }) => {
      const cues = rows[where.contentHash_model.model];
      return cues && where.contentHash_model.contentHash === HASH ? { cuesJson: cues } : null;
    },
  );
}

/** The `where` the action actually handed Prisma. */
function query(): { contentHash_model: { contentHash: string; model: string } } {
  return (prisma.transcript.findUnique as Mock).mock.calls[0]![0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireOwner as Mock).mockResolvedValue({ ownerId: OWNER, email: "a@b.c" });
  (prisma.project.findFirst as Mock).mockResolvedValue({ id: PROJECT, ownerId: OWNER });
  (prisma.asset.findFirst as Mock).mockResolvedValue({ id: "ast_1", contentHash: HASH });
});

describe("getTranscript — selection is structural, not chronological", () => {
  it("asks for the current generation by exact key, never by ordering", async () => {
    seedRows({ [TRANSCRIPT_GENERATION]: MALAY_CUES });

    expect(await getTranscript(PROJECT, SRC)).toEqual(MALAY_CUES);
    // the query names the shared generation tag …
    expect(query().contentHash_model).toEqual({ contentHash: HASH, model: TRANSCRIPT_GENERATION });
    // … and nothing about it is a comparison the deploy order could decide.
    expect((prisma.transcript.findUnique as Mock).mock.calls[0]![0]).not.toHaveProperty("orderBy");
  });

  it("[rolling deploy] a LATE row from the old worker cannot win", async () => {
    // Both rows exist and the retired one was written last. Under "newest wins" the merchant
    // would be shown STALE_ENGLISH_CUES for their Malay clip, forever.
    seedRows({ [TRANSCRIPT_GENERATION]: MALAY_CUES, [RETIRED_GENERATION]: STALE_ENGLISH_CUES });

    expect(await getTranscript(PROJECT, SRC)).toEqual(MALAY_CUES);
  });

  it("[rolling deploy] new web + old worker returns an honest empty, not a wrong language", async () => {
    // Mid-deploy the only row for these bytes can be the old worker's. The merchant sees "no
    // captions yet" and can re-run — never English words captioning Malay audio.
    seedRows({ [RETIRED_GENERATION]: STALE_ENGLISH_CUES });

    expect(await getTranscript(PROJECT, SRC)).toEqual([]);
  });

  it("[rolling deploy] old web + new worker: the two builds address disjoint rows", async () => {
    // The mirror state. A still-running old web build asks for the retired tag; the new worker
    // only ever writes the current one (asserted in apps/worker caption.test.ts). What makes
    // that a MISS rather than a mis-read is that this action addresses exactly one key and
    // never widens: no `OR`, no `in`, no partial match that could catch the other build's row.
    seedRows({ [TRANSCRIPT_GENERATION]: MALAY_CUES });
    await getTranscript(PROJECT, SRC);

    const where = query();
    expect(Object.keys(where)).toEqual(["contentHash_model"]);
    expect(Object.keys(where.contentHash_model).sort()).toEqual(["contentHash", "model"]);
    expect(where.contentHash_model.model).toBe(TRANSCRIPT_GENERATION);
    expect(where.contentHash_model.model).not.toBe(RETIRED_GENERATION);
  });
});

describe("getTranscript — the reader still knows nothing about the engine", () => {
  it("the tag it queries with is the shared constant, not a model name it made up", async () => {
    seedRows({ [TRANSCRIPT_GENERATION]: MALAY_CUES });
    await getTranscript(PROJECT, SRC);

    // Structural: whatever TRANSCRIPT_GENERATION becomes, the query must equal it — this action
    // cannot supply a value of its own. And a generation tag is not a model file name.
    expect(query().contentHash_model.model).toBe(TRANSCRIPT_GENERATION);
    expect(query().contentHash_model.model).not.toMatch(/\.en$|^(tiny|base|small|medium|large)/);
  });

  it("the owner gate still comes first — a clip the caller does not hold reads as empty", async () => {
    seedRows({ [TRANSCRIPT_GENERATION]: MALAY_CUES });
    (prisma.asset.findFirst as Mock).mockResolvedValue(null);

    expect(await getTranscript(PROJECT, SRC)).toEqual([]);
    expect(prisma.transcript.findUnique as Mock).not.toHaveBeenCalled();
  });
});
