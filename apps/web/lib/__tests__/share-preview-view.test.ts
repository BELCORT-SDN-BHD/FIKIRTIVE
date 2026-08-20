/**
 * B0-28 — the READ side of the seat-less share link: what an anonymous holder of a link may see,
 * and what every other caller sees instead.
 *
 * The link existed and the page did not, so this is the first test in the repository that can ask
 * "what does the person the merchant sent this to actually get back". Three properties carry it:
 *
 *   ① a live link resolves to EXACTLY one post's display fields — not a list, not an id, not the
 *      owner, not a second post;
 *   ② every refusal is ONE object. Expired, revoked, deleted, never-existed and belongs-to-
 *      somebody-else are indistinguishable to the caller, so sweeping links cannot be used to
 *      learn which posts are real;
 *   ③ the ids the read is scoped by come from the HMAC's own claims, never from the URL — a token
 *      minted for (owner A, post A) can never be steered at post B.
 *
 * Prisma is faked here rather than mocked call-by-call: the fake answers `findFirst` by actually
 * matching the `where` clause against a small table, so the tenant scope and the row-liveness
 * check are exercised as the behavior they are, not asserted as the arguments they pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

type PostRow = {
  id: string;
  ownerId: string;
  channel: string;
  caption: string;
  firstComment: string | null;
  scheduledAt: Date;
  scheduledTz: string;
  deletedAt: Date | null;
  media: { generationId: string; position: number }[];
};
type TokenRow = {
  id: string;
  ownerId: string;
  scheduledPostId: string;
  tokenDigest: string;
  expiresAt: Date;
  revokedAt: Date | null;
};
type GenRow = {
  id: string;
  ownerId: string;
  deletedAt: Date | null;
  asset: { ownerId: string; contentHash: string; ext: string; width: number | null; height: number | null };
};

const db = vi.hoisted(() => ({
  posts: [] as PostRow[],
  tokens: [] as TokenRow[],
  gens: [] as GenRow[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@fikirtive/db", () => ({
  prisma: {
    sharePreviewToken: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = db.tokens.find(
          (r) =>
            r.tokenDigest === where.tokenDigest &&
            r.ownerId === where.ownerId &&
            r.scheduledPostId === where.scheduledPostId &&
            r.revokedAt === null &&
            r.expiresAt > (where.expiresAt as { gt: Date }).gt,
        );
        return found ? { id: found.id } : null;
      },
    },
    scheduledPost: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = db.posts.find(
          (r) => r.id === where.id && r.ownerId === where.ownerId && r.deletedAt === null,
        );
        return found ?? null;
      },
    },
    generation: {
      findMany: async ({ where }: { where: { id: { in: string[] }; ownerId: string } }) =>
        db.gens.filter((g) => where.id.in.includes(g.id) && g.ownerId === where.ownerId && g.deletedAt === null),
    },
  },
}));

const gate = vi.hoisted(() => ({ consumeSharePreviewDoor: vi.fn() }));
vi.mock("../rate-limit-gates", () => gate);

import { signSharePreviewToken } from "@fikirtive/token-crypto";
import { loadSharePreview } from "../share-preview-view";

const SHARE_SECRET = "share-secret-for-the-read-side";
const MEDIA_SECRET = "media-secret-for-the-read-side";
const NOW = Date.now();
const IN_AN_HOUR = NOW + 3_600_000;

const OWNER_A = "org_a";
const OWNER_B = "org_b";

function post(overrides: Partial<PostRow> = {}): PostRow {
  return {
    id: "post_a",
    ownerId: OWNER_A,
    channel: "instagram",
    caption: "Two-for-one on iced coffee this Saturday.",
    firstComment: "Open from 9am.",
    scheduledAt: new Date("2026-09-05T02:00:00.000Z"),
    scheduledTz: "Asia/Kuala_Lumpur",
    deletedAt: null,
    media: [],
    ...overrides,
  };
}

/** Mint a real token AND its authority row — the two halves a working link is made of. */
function mintLink(ownerId: string, postId: string, expMs = IN_AN_HOUR): string {
  const token = signSharePreviewToken(ownerId, postId, expMs, SHARE_SECRET);
  db.tokens.push({
    id: `row_${db.tokens.length}`,
    ownerId,
    scheduledPostId: postId,
    tokenDigest: createHash("sha256").update(token, "utf8").digest("hex"),
    expiresAt: new Date(expMs),
    revokedAt: null,
  });
  return token;
}

const NO_HEADERS = new Headers();

beforeEach(() => {
  db.posts = [];
  db.tokens = [];
  db.gens = [];
  vi.clearAllMocks();
  gate.consumeSharePreviewDoor.mockResolvedValue(true);
  process.env.SHARE_PREVIEW_SECRET = SHARE_SECRET;
  delete process.env.MEDIA_PROXY_SECRET;
});

describe("a live link", () => {
  it("resolves to the ONE post it was minted for, and to nothing else about the workspace", async () => {
    db.posts.push(post());
    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);

    expect(view).toEqual({
      state: "post",
      channelLabel: "Instagram",
      caption: "Two-for-one on iced coffee this Saturday.",
      firstComment: "Open from 9am.",
      scheduledAtMs: new Date("2026-09-05T02:00:00.000Z").getTime(),
      scheduledTz: "Asia/Kuala_Lumpur",
      linkExpiresAtMs: IN_AN_HOUR,
      media: [],
      mediaWithheld: false,
    });
  });

  it("returns NOTHING that identifies the tenant — no ownerId, no post id, no row id", async () => {
    db.posts.push(post());
    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(OWNER_A);
    expect(serialized).not.toContain("post_a");
    expect(serialized).not.toContain("row_0");
  });

  it("a second post in the same workspace is never reachable through the first one's link", async () => {
    db.posts.push(post(), post({ id: "post_b", caption: "The other post nobody shared." }));
    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);

    expect(JSON.stringify(view)).not.toContain("The other post nobody shared.");
  });
});

/**
 * ONE SHAPE. Each case below is a DIFFERENT reason the link does not work, and the caller is
 * handed the identical object every time. If any branch ever gains its own wording or its own
 * status, this block goes red — which is the whole point of writing them as one list.
 */
describe("every refusal is the same response", () => {
  const UNAVAILABLE = { state: "unavailable" };

  it("a token that was never signed by us", async () => {
    db.posts.push(post());
    expect(await loadSharePreview("not-a-token", NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a tampered token", async () => {
    db.posts.push(post());
    const token = mintLink(OWNER_A, "post_a");
    expect(await loadSharePreview(token.slice(0, -2) + "zz", NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a token signed with a different secret", async () => {
    db.posts.push(post());
    const foreign = signSharePreviewToken(OWNER_A, "post_a", IN_AN_HOUR, "some-other-secret");
    expect(await loadSharePreview(foreign, NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("an expired token", async () => {
    db.posts.push(post());
    const token = mintLink(OWNER_A, "post_a", NOW - 1000);
    expect(await loadSharePreview(token, NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a revoked link — the HMAC still verifies, the mint row does not", async () => {
    db.posts.push(post());
    const token = mintLink(OWNER_A, "post_a");
    db.tokens[0]!.revokedAt = new Date(NOW - 1);
    expect(await loadSharePreview(token, NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a valid HMAC with NO mint row at all (a token minted by a leaked secret, never recorded)", async () => {
    db.posts.push(post());
    const rowless = signSharePreviewToken(OWNER_A, "post_a", IN_AN_HOUR, SHARE_SECRET);
    expect(await loadSharePreview(rowless, NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a post that has since been deleted", async () => {
    db.posts.push(post({ deletedAt: new Date(NOW - 1) }));
    expect(await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("a post that never existed — indistinguishable from one that does but isn't yours", async () => {
    expect(await loadSharePreview(mintLink(OWNER_A, "ghost_post"), NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("no SHARE_PREVIEW_SECRET on this server", async () => {
    db.posts.push(post());
    const token = mintLink(OWNER_A, "post_a");
    delete process.env.SHARE_PREVIEW_SECRET;
    expect(await loadSharePreview(token, NO_HEADERS)).toEqual(UNAVAILABLE);
  });

  it("an empty token", async () => {
    expect(await loadSharePreview("", NO_HEADERS)).toEqual(UNAVAILABLE);
  });
});

/**
 * 越权形状 — the token carries WHOSE post and WHICH post; the URL carries neither. There is no
 * parameter on this page a caller could point at another row.
 */
describe("a token can only ever reach its own post", () => {
  it("owner B's token cannot reach owner A's post, even with the same post id", async () => {
    db.posts.push(post({ id: "post_shared_id", ownerId: OWNER_A, caption: "A's private draft." }));
    const bToken = mintLink(OWNER_B, "post_shared_id");

    expect(await loadSharePreview(bToken, NO_HEADERS)).toEqual({ state: "unavailable" });
  });

  it("owner A's token for post A cannot be re-pointed at post B by re-signing the payload", async () => {
    db.posts.push(post({ id: "post_b", caption: "The post that was NOT shared." }));
    // Everything an attacker holding a real link has: a valid token for a DIFFERENT post.
    mintLink(OWNER_A, "post_a");
    const forgedForB = signSharePreviewToken(OWNER_A, "post_b", IN_AN_HOUR, "guessed-secret");

    expect(await loadSharePreview(forgedForB, NO_HEADERS)).toEqual({ state: "unavailable" });
  });

  it("the post read is scoped by the token's OWN attested owner, so a cross-tenant row never matches", async () => {
    db.posts.push(post({ id: "post_a", ownerId: OWNER_B, caption: "B's post wearing A's post id." }));
    const aToken = mintLink(OWNER_A, "post_a");

    expect(await loadSharePreview(aToken, NO_HEADERS)).toEqual({ state: "unavailable" });
  });
});

describe("the public door", () => {
  it("refuses with its OWN honest state, not the unavailable one — the link is fine, the pace is not", async () => {
    db.posts.push(post());
    gate.consumeSharePreviewDoor.mockResolvedValue(false);
    expect(await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS)).toEqual({ state: "busy" });
  });

  it("is never reached by a forged token — a nonsense token costs zero counter writes", async () => {
    await loadSharePreview("not-a-token", NO_HEADERS);
    expect(gate.consumeSharePreviewDoor).not.toHaveBeenCalled();
  });
});

describe("media", () => {
  const asset = {
    ownerId: OWNER_A,
    contentHash: "a".repeat(64),
    ext: "png",
    width: 1080,
    height: 1080,
  };

  it("hands over signed proxy URLs for THIS post's media, in carousel order", async () => {
    process.env.MEDIA_PROXY_SECRET = MEDIA_SECRET;
    db.posts.push(post({ media: [{ generationId: "gen_1", position: 0 }, { generationId: "gen_2", position: 1 }] }));
    db.gens.push(
      { id: "gen_1", ownerId: OWNER_A, deletedAt: null, asset },
      { id: "gen_2", ownerId: OWNER_A, deletedAt: null, asset: { ...asset, contentHash: "b".repeat(64), ext: "mp4" } },
    );

    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);
    expect(view.state).toBe("post");
    if (view.state !== "post") return;
    expect(view.media).toHaveLength(2);
    expect(view.media[0]!.kind).toBe("image");
    expect(view.media[1]!.kind).toBe("video");
    for (const item of view.media) {
      expect(item.src.startsWith("/api/media/pub/")).toBe(true);
      // No storage host, bucket, key or content hash ever reaches the page.
      expect(item.src).not.toContain(asset.contentHash);
      expect(item.src).not.toContain(OWNER_A);
    }
    expect(view.mediaWithheld).toBe(false);
  });

  it("skips a generation that is not the attested owner's, and says the images were withheld", async () => {
    process.env.MEDIA_PROXY_SECRET = MEDIA_SECRET;
    db.posts.push(post({ media: [{ generationId: "gen_other", position: 0 }] }));
    db.gens.push({ id: "gen_other", ownerId: OWNER_B, deletedAt: null, asset: { ...asset, ownerId: OWNER_B } });

    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);
    if (view.state !== "post") throw new Error("expected the post");
    expect(view.media).toEqual([]);
    expect(view.mediaWithheld).toBe(true);
  });

  it("with no MEDIA_PROXY_SECRET the post still renders, and the page is told the images are missing", async () => {
    db.posts.push(post({ media: [{ generationId: "gen_1", position: 0 }] }));
    db.gens.push({ id: "gen_1", ownerId: OWNER_A, deletedAt: null, asset });

    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);
    if (view.state !== "post") throw new Error("expected the post");
    expect(view.media).toEqual([]);
    expect(view.mediaWithheld).toBe(true);
  });

  it("a post with no media is not 'withheld' — there was nothing to withhold", async () => {
    process.env.MEDIA_PROXY_SECRET = MEDIA_SECRET;
    db.posts.push(post());
    const view = await loadSharePreview(mintLink(OWNER_A, "post_a"), NO_HEADERS);
    if (view.state !== "post") throw new Error("expected the post");
    expect(view.mediaWithheld).toBe(false);
  });
});
