/**
 * #810 r4 P1-a —— 真实 IG 执行器的时序,不是假 executor。
 *
 * r3 把开关复核放在 handlePublish 调用 send() 之前。判官指出那不是最后一刻:IG 的 send() 里面
 * 还有建容器 + 最多 15 次轮询(默认 ≥14×2 秒),media_publish 在这之后才发生。复核放在 send()
 * 入口,只是把窗口从「四分钟」换成「三十秒」,并没有关上。
 *
 * 这个文件不用假 executor —— handlePublish 不传 execute 参数,跑的就是产品里那个 realExecute:
 * authorize → buildMediaUrls → resolvePage → publishInstagram(建容器 → 轮询 → media_publish)。
 * 只有 prisma / storage / token-crypto / 全局 fetch 被替身,所以「谁在什么时候被调用」是真的。
 *
 * 断言的那条线:商家在**轮询期间**关掉开关 —— 容器可以已经建好(容器不是发布,商家看不见,
 * 过期即废),但 ig1/media_publish 一次都不许发生。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  const scheduledPostFindUnique = vi.fn();
  const scheduledPostUpdateMany = vi.fn();
  const scheduledPostMediaFindMany = vi.fn();
  const generationFindMany = vi.fn();
  const metaConnectionFindUnique = vi.fn();
  const organizationFindUnique = vi.fn();
  const publishAttemptCreate = vi.fn();
  const publishAttemptFindFirst = vi.fn();
  const publishAttemptFindUnique = vi.fn();
  const publishAttemptUpdate = vi.fn();
  const publishAttemptUpdateMany = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    scheduledPost: { findUnique: scheduledPostFindUnique, updateMany: scheduledPostUpdateMany },
    scheduledPostMedia: { findMany: scheduledPostMediaFindMany },
    generation: { findMany: generationFindMany },
    metaConnection: { findUnique: metaConnectionFindUnique },
    organization: { findUnique: organizationFindUnique },
    publishAttempt: {
      create: publishAttemptCreate,
      findFirst: publishAttemptFindFirst,
      findUnique: publishAttemptFindUnique,
      update: publishAttemptUpdate,
      updateMany: publishAttemptUpdateMany,
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
  };
  return {
    prisma, scheduledPostFindUnique, scheduledPostUpdateMany, scheduledPostMediaFindMany,
    generationFindMany, metaConnectionFindUnique, organizationFindUnique,
    publishAttemptCreate, publishAttemptFindFirst, publishAttemptFindUnique,
    publishAttemptUpdate, publishAttemptUpdateMany,
  };
});

vi.mock("@fikirtive/db", () => ({ prisma: m.prisma }));
vi.mock("@fikirtive/token-crypto", () => ({ decryptToken: () => "user-token", signMediaToken: () => "sig" }));
// A real JPEG's magic bytes, so the byte contract passes on the genuine classifier and pass 2 needs
// NO ffmpeg (a jpeg asset is published as-is).
vi.mock("@fikirtive/storage", () => ({ readBoundedPrefix: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]) }));
vi.mock("../storage.js", () => ({ storage: { ffmpegInput: vi.fn(), put: vi.fn(), readStream: vi.fn() } }));

import { handlePublish } from "./publish.js";

const DUE_POST = {
  id: "sp1", ownerId: "o1", channel: "instagram", metaTargetId: "pg1", caption: "hi", firstComment: null,
  status: "SCHEDULED", metaPostId: null, deletedAt: null,
};

/** A real sha256 — storageKey refuses anything that isn't one. */
const CONTENT_HASH = "2966c1a88fbf03b61a3b4a7e6efcd4f8c631e6d504adae868084b904469e7e4d";

/** Every Graph call the real IG path makes, in order, as "METHOD path". */
let calls: string[] = [];

/** Stub Graph: me/accounts → a page with an IG business account; POST ig1/media → a container;
 *  GET on the container → IN_PROGRESS until `finishOnPoll`; POST media_publish → a media id.
 *  `onPoll` is where the merchant gets to flip their switch mid-flight. */
function stubGraph(opts: { finishOnPoll: number; onPoll?: (n: number) => void }) {
  let polls = 0;
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v\d+\.\d+\//, "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

    if (path === "me/accounts") {
      return json({ data: [{ id: "pg1", name: "Shop", access_token: "page-token", instagram_business_account: { id: "ig1" } }] });
    }
    if (method === "POST" && path === "ig1/media") return json({ id: "container-1" });
    if (method === "POST" && path === "ig1/media_publish") return json({ id: "media-1" });
    if (method === "GET" && path === "container-1") {
      polls += 1;
      opts.onPoll?.(polls);
      return json({ status_code: polls >= opts.finishOnPoll ? "FINISHED" : "IN_PROGRESS" });
    }
    return json({});
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  process.env.PUBLIC_BASE_URL = "https://app.test";
  process.env.MEDIA_PROXY_SECRET = "secret";
  m.scheduledPostFindUnique.mockResolvedValue(DUE_POST);
  m.scheduledPostUpdateMany.mockResolvedValue({ count: 1 });
  m.scheduledPostMediaFindMany.mockResolvedValue([{ generationId: "g1" }]);
  m.generationFindMany.mockResolvedValue([
    { id: "g1", asset: { ownerId: "o1", contentHash: CONTENT_HASH, ext: "jpg", mime: "image/jpeg" } },
  ]);
  m.metaConnectionFindUnique.mockResolvedValue({
    accessTokenEnc: "enc", canPublish: true, organicPublishPaused: false, status: "active", tokenExpiresAt: null,
  });
  m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: true } });
  m.publishAttemptCreate.mockResolvedValue({ id: "pa1" });
  m.publishAttemptFindFirst.mockResolvedValue(null);
  m.publishAttemptFindUnique.mockResolvedValue({ id: "pa1", scheduledPostId: "sp1", creationId: "container-1" });
  m.publishAttemptUpdate.mockResolvedValue({});
  m.publishAttemptUpdateMany.mockResolvedValue({ count: 1 });
});

describe("#810 r4 P1-a 真实 IG 执行器:轮询期间关掉开关", () => {
  it("容器可以已经建好,但 media_publish 一次都不发", async () => {
    // 判官的时序:容器建好了,第 1 次轮询回 IN_PROGRESS —— 商家正是这一刻关掉开关 ——
    // 第 2 次轮询才 FINISHED。r3 的复核在这整段之前就问完了,所以它放行。
    let switchedOff = false;
    vi.stubGlobal(
      "fetch",
      stubGraph({
        finishOnPoll: 2,
        onPoll: (n) => {
          if (n === 1) {
            switchedOff = true;
            m.organizationFindUnique.mockResolvedValue({ id: "o1", settings: { autoPublish: false } });
          }
        },
      }),
    );

    await handlePublish({ scheduledPostId: "sp1" }, 0);

    expect(switchedOff).toBe(true);
    // 备料发生过:页面解析 + 建容器 + 两次轮询。
    expect(calls).toContain("POST ig1/media");
    expect(calls.filter((c) => c === "GET container-1")).toHaveLength(2);
    // 不可逆的那一下没有发生 —— 这是这条测试的全部意义。
    expect(calls).not.toContain("POST ig1/media_publish");

    // 撤回不是失败:不留 PUBLISHED / NEEDS_ATTENTION,行交还 SCHEDULED 等着。
    const statuses = m.scheduledPostUpdateMany.mock.calls.map((c) => c[0].data?.status);
    expect(statuses).not.toContain("PUBLISHED");
    expect(statuses).not.toContain("NEEDS_ATTENTION");
    expect(statuses).toContain("SCHEDULED");
  }, 20_000);

  it("开关全程开着 —— 轮询完照常 media_publish(这道闸不误伤正常发布)", async () => {
    vi.stubGlobal("fetch", stubGraph({ finishOnPoll: 1 }));

    await handlePublish({ scheduledPostId: "sp1" }, 0);

    expect(calls).toContain("POST ig1/media_publish");
    const published = m.scheduledPostUpdateMany.mock.calls.find((c) => c[0].data?.status === "PUBLISHED");
    expect(published?.[0].data).toMatchObject({ status: "PUBLISHED", metaPostId: "media-1" });
  }, 20_000);

  it("开关是在容器建好**之后**才被问的 —— 问得太早,窗口就还开着", async () => {
    // 复核读组织行;记录每次读发生时已经走到哪一步,证明最后一次读排在轮询之后、发送之前。
    const readAfter: string[] = [];
    m.organizationFindUnique.mockImplementation(async () => {
      readAfter.push(calls[calls.length - 1] ?? "(nothing yet)");
      return { id: "o1", settings: { autoPublish: true } };
    });
    vi.stubGlobal("fetch", stubGraph({ finishOnPoll: 2 }));

    await handlePublish({ scheduledPostId: "sp1" }, 0);

    // 第一次是认领前的省钱短路(还没有任何 Graph 调用);最后一次紧跟着最后一次轮询。
    expect(readAfter[0]).toBe("(nothing yet)");
    expect(readAfter[readAfter.length - 1]).toBe("GET container-1");
    expect(calls[calls.length - 1]).toBe("POST ig1/media_publish");
  }, 20_000);
});
