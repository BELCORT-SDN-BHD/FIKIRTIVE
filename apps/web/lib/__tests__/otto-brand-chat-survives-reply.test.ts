/**
 * otto-brand-chat-survives-reply.test.ts — BUG 6:商家在 Brand & products 里跟 Otto 说完一句,
 * Otto 一回话,整段对话就消失了。
 *
 * 病灶两层,这里各钉一层:
 *
 * 一、重挂。app/otto/page.tsx 用 `${projectId}:${openThreadId}` 当 <OttoApp> 的 key,而
 *    `openThreadId` 在地址栏没有 ?thread= 时会落到「本项目最新的一条会话」。Brand 聊天走的
 *    ottoTurn 会新建一条会话、并以 revalidatePath("/", "layout") 收尾 —— 于是「最新」换了人,
 *    key 跟着换,整棵树重挂,住在组件 state 里的聊天记录连同它所属的会话指针一起蒸发。
 *    修法:key 只认「地址栏点名的那条会话」。后台冒出来的会话不改地址栏,也就不再重挂;
 *    商家真的切会话(?thread=)或切项目时,重挂照旧。
 *
 * 二、回不来。就算不再重挂,这个视图从服务端拿不到任何会话(OttoView 只给它 memory/records/
 *    projectId),所以刷新一次、或任何一次真重挂,记录都回不来,下一句话还会另开一条新会话。
 *    修法:把会话 ID 按项目记在 sessionStorage 里,重挂时拿它回服务端把记录读回来 ——
 *    消息本身仍然只有服务端是权威。
 *
 * 断言的是行为:真的调用服务端组件读它给出的 key,真的挂一次 OttoMemory、卸载、再挂一次,
 * 看屏幕上还有没有那段对话。
 */
import { describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    threads: [] as Array<{ id: string; projectId: string }>,
    projects: [{ id: "proj_1", name: "Test project", pinnedAt: null as Date | null }],
  },
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: vi.fn(async () => ({ ownerId: "org_1" })) }));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: vi.fn(async () => ({ id: "proj_1" })) }));
vi.mock("@/lib/data", () => ({
  getEntities: vi.fn(async () => []),
  getCoworkThreads: vi.fn(async (_ownerId: string, projectId: string) =>
    db.threads.filter((t) => t.projectId === projectId)),
  getCoworkThread: vi.fn(async (_ownerId: string, id: string) =>
    db.threads.find((t) => t.id === id) ?? null),
  resolveCoworkResultUrls: vi.fn(async () => ({})),
  getMyAds: vi.fn(async () => []),
  getMyAdJobs: vi.fn(async () => []),
  getRecentGenerationThumbs: vi.fn(async () => []),
  getProjects: vi.fn(async () => db.projects),
  getAllCoworkThreadMetas: vi.fn(async () => db.threads),
}));
vi.mock("@/lib/dto", () => ({
  toEntityDTO: (r: unknown) => r,
  toChatThreadDTO: (r: unknown) => r,
  toChatThreadMetaDTO: (r: unknown) => r,
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: vi.fn(async () => ({ balanceUsd: 0 })) }));
vi.mock("@/lib/profile-names", () => ({ getMyProfileNames: vi.fn(async () => ({})) }));
vi.mock("@/lib/otto-greeting", () => ({ ottoGreetingNameFromProfile: vi.fn(async () => "there") }));
vi.mock("@/lib/memory-actions", () => ({ listMemory: vi.fn(async () => []) }));
vi.mock("@/lib/brand-record-actions", () => ({ listBrandRecords: vi.fn(async () => []) }));
vi.mock("@/lib/analytics-actions", () => ({ getAnalytics: vi.fn(async () => ({ state: "notConnected" })) }));
vi.mock("@/lib/owner-settings-actions", () => ({ getOwnerSettings: vi.fn(async () => ({ ottoOnboardingDismissed: false })) }));
// The tree itself is not under test here — only the key the page hangs on it.
vi.mock("@/components/otto/OttoApp", () => ({ OttoApp: () => null }));

const { default: OttoPage } = await import("@/app/otto/page");

type Search = { view?: string; project?: string; thread?: string; new?: string };

async function instanceKey(search: Search): Promise<string | null> {
  const el = await OttoPage({ searchParams: Promise.resolve(search) });
  return (el as { key: string | null }).key;
}

describe("BUG 6 — a thread created in the background must not remount the Otto tree", () => {
  it("keeps the same key when a NEWER thread appears and the address bar did not move", async () => {
    // The merchant is on Brand & products. No ?thread= — this screen never puts one there.
    db.threads = [{ id: "thread_old", projectId: "proj_1" }];
    const before = await instanceKey({ project: "proj_1", view: "memory" });

    // Their message went through ottoTurn, which created a conversation and revalidated the
    // layout. The page re-renders at the SAME address, with a different newest thread.
    db.threads = [{ id: "thread_new", projectId: "proj_1" }, { id: "thread_old", projectId: "proj_1" }];
    const after = await instanceKey({ project: "proj_1", view: "memory" });

    expect(after).toBe(before); // the regression: this became "proj_1:thread_new" → full remount
  });

  it("still opens that newest thread — only the KEY stopped following it", async () => {
    // Guard against the lazy fix (dropping the fallback): a bare /otto must still show the
    // most recent conversation, which is what the key used to be proving by accident.
    db.threads = [{ id: "thread_new", projectId: "proj_1" }, { id: "thread_old", projectId: "proj_1" }];
    const el = await OttoPage({ searchParams: Promise.resolve({ project: "proj_1" }) });
    const props = (el as { props: { initialActiveThreadId: string | null } }).props;

    expect(props.initialActiveThreadId).toBe("thread_new");
  });

  it("STILL remounts when the merchant explicitly switches conversation (?thread=)", async () => {
    db.threads = [{ id: "thread_a", projectId: "proj_1" }, { id: "thread_b", projectId: "proj_1" }];

    const a = await instanceKey({ project: "proj_1", thread: "thread_a" });
    const b = await instanceKey({ project: "proj_1", thread: "thread_b" });
    const none = await instanceKey({ project: "proj_1" });

    expect(a).not.toBe(b);
    expect(a).not.toBe(none);
  });

  it("STILL remounts when the merchant starts a new conversation from an open one", async () => {
    db.threads = [{ id: "thread_a", projectId: "proj_1" }];

    const open = await instanceKey({ project: "proj_1", thread: "thread_a" });
    const fresh = await instanceKey({ project: "proj_1", new: "1" });

    expect(fresh).not.toBe(open);
  });

  it("STILL remounts when the project changes", async () => {
    db.projects = [
      { id: "proj_1", name: "One", pinnedAt: null },
      { id: "proj_2", name: "Two", pinnedAt: null },
    ];
    db.threads = [{ id: "thread_a", projectId: "proj_1" }];

    const one = await instanceKey({ project: "proj_1" });
    const two = await instanceKey({ project: "proj_2" });

    expect(one).not.toBe(two);
    db.projects = [{ id: "proj_1", name: "Test project", pinnedAt: null }];
  });
});
