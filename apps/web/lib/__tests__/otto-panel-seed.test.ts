/**
 * otto-panel-seed.test.ts — 面板种子的深链选择契约(W2-11 判官修复轮 P1)。
 *
 * `/otto?project=P&thread=T` 这条旧地址重定向到 `/?otto=1&project=P&thread=T` 之后,
 * 参数不能只是「留着没人读」——`loadOttoPanelSeed({projectId, threadId})` 就是接住它们的
 * 那一层。这里钉的是从被删的 `otto-new-conversation-routing.test.ts`(旧 OttoApp 架构,
 * 客户端 popstate 那一版)搬过来、在新架构里仍然成立的两条契约,换成服务端选择逻辑的口径:
 *
 *   · 旧文件 277-287「Forward back onto a ?thread= entry restores that thread」
 *     → 这里「project 与 thread 都给且 thread 落在那个 project 上,选中它」。
 *   · 旧文件 304-321「Back/Forward onto a bare project URL...opens the most recent
 *     thread」→ 这里「只给 project(没给 thread 或 thread 校验不过),选中该 project
 *     最近那一条」。
 *
 * 另加「owner 校验沿既有模式」这一条判官原话要求的护栏:商家传来的 id 不直接查库,
 * 只在已经按 ownerId 查出来的 projectRows/threadRows 里核对——伪造或者别人的 id 核不过,
 * 落回默认,不抛错。
 *
 * 全程 mock 掉 `./data` / `./dto` / `./actions` / `./account-actions` / `./auth-guard` /
 * `./otto-greeting` / `./profile-names` 与 `@fikirtive/db/principal`:这里要钉的是
 * `loadOttoPanelSeed` 自己的选择分支,不是这些底层查询/映射函数(它们各有自己的测试)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";

const {
  mockRequireOwner,
  mockGetOrCreateDefaultProject,
  mockGetMyAccount,
  mockGetEntities,
  mockGetProjects,
  mockGetAllCoworkThreadMetas,
  mockGetCoworkThread,
  mockResolveCoworkResultUrls,
} = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockGetMyAccount: vi.fn(),
  mockGetEntities: vi.fn(),
  mockGetProjects: vi.fn(),
  mockGetAllCoworkThreadMetas: vi.fn(),
  mockGetCoworkThread: vi.fn(),
  mockResolveCoworkResultUrls: vi.fn(),
}));

vi.mock("../auth-guard", () => ({
  requireOwner: mockRequireOwner,
  resolveUserPrincipal: async (gate: { email: string; ownerId: string }) => ({
    kind: "user" as const,
    subjectUserId: null,
    subjectEmail: gate.email,
    ownerId: gate.ownerId,
    orgRole: null,
    membershipId: null,
    impersonating: false,
    impersonatedByBaUserId: null,
  }),
}));
vi.mock("@fikirtive/db/principal", () => ({ runAsUser: <T,>(_p: unknown, fn: () => T) => fn() }));
vi.mock("../actions", () => ({ getOrCreateDefaultProject: mockGetOrCreateDefaultProject }));
vi.mock("../account-actions", () => ({ getMyAccount: mockGetMyAccount }));
vi.mock("../data", () => ({
  getEntities: mockGetEntities,
  getProjects: mockGetProjects,
  getAllCoworkThreadMetas: mockGetAllCoworkThreadMetas,
  getCoworkThread: mockGetCoworkThread,
  resolveCoworkResultUrls: mockResolveCoworkResultUrls,
}));
vi.mock("../dto", () => ({
  toEntityDTO: (e: unknown) => e,
  // 传进来的就是 mock 好的 meta 行,原样当 ChatThreadDTO 用(messages 留空,和真实现同义:
  // 列表里的行本来就是 meta,不带消息)。
  toChatThreadMetaDTO: (t: { id: string; projectId: string; title: string; updatedAt: string; pinnedAt?: string | null }) =>
    ({ id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt, pinnedAt: t.pinnedAt ?? null, messages: [] }) satisfies ChatThreadDTO,
  toChatThreadDTO: (t: { id: string; projectId: string; title: string; updatedAt: string; messages: unknown[] }) =>
    ({ id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt, pinnedAt: null, messages: t.messages }) as unknown as ChatThreadDTO,
}));
vi.mock("../otto-greeting", () => ({ ottoGreetingNameFromProfile: vi.fn().mockResolvedValue("Tester") }));
vi.mock("../profile-names", () => ({ getMyProfileNames: vi.fn() }));

const { loadOttoPanelSeed } = await import("../otto-panel-seed");

const OWNER = "org_a";
const DEFAULT_PROJECT = "proj_default";
const OTHER_PROJECT = "proj_other";
const FOREIGN_PROJECT = "proj_someone_elses";

/** 两个 project,每个 project 底下的会话已经按「最近在前」排好(与 getAllCoworkThreadMetas
 *  真实的 orderBy pinnedAt desc, updatedAt desc 同一个约定 —— 选择逻辑不自己再排一次序)。 */
const THREAD_ROWS = [
  { id: "thr_default_recent", projectId: DEFAULT_PROJECT, title: "Default recent", updatedAt: "2026-08-20T12:00:00.000Z", pinnedAt: null },
  { id: "thr_default_older", projectId: DEFAULT_PROJECT, title: "Default older", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null },
  { id: "thr_other_recent", projectId: OTHER_PROJECT, title: "Other recent", updatedAt: "2026-08-19T00:00:00.000Z", pinnedAt: null },
  { id: "thr_other_older", projectId: OTHER_PROJECT, title: "Other older", updatedAt: "2026-08-02T00:00:00.000Z", pinnedAt: null },
];

beforeEach(() => {
  mockRequireOwner.mockReset().mockResolvedValue({ email: "a@test", ownerId: OWNER });
  mockGetOrCreateDefaultProject.mockReset().mockResolvedValue({ id: DEFAULT_PROJECT });
  mockGetMyAccount.mockReset().mockResolvedValue({ balanceUsd: 5 });
  mockGetEntities.mockReset().mockResolvedValue([]);
  mockGetProjects.mockReset().mockResolvedValue([
    { id: DEFAULT_PROJECT, name: "Default project", pinnedAt: null },
    { id: OTHER_PROJECT, name: "Other project", pinnedAt: null },
  ]);
  mockGetAllCoworkThreadMetas.mockReset().mockResolvedValue(THREAD_ROWS);
  mockGetCoworkThread.mockReset().mockImplementation(async (_ownerId: string, threadId: string) => {
    const row = THREAD_ROWS.find((t) => t.id === threadId);
    if (!row) return null;
    return { ...row, messages: [{ role: "user", content: `full content for ${row.id}` }] };
  });
  mockResolveCoworkResultUrls.mockReset().mockResolvedValue(new Map());
});

describe("不带 select:与深链之前逐字同义(回归钉)", () => {
  it("停在 getOrCreateDefaultProject 给的那个 project,选它最近那一条", async () => {
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });
});

describe("深链契约①(旧 otto-new-conversation-routing.test.ts:304-321 迁移)——bare project 选最近会话", () => {
  it("只给 project,没给 thread:选中该 project 最近那一条,不是默认 project 的", async () => {
    const seed = await loadOttoPanelSeed({ projectId: OTHER_PROJECT });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(OTHER_PROJECT);
    expect(seed.activeThreadId).toBe("thr_other_recent");
  });

  it("给了 thread,但它核不过(见下面「owner 校验」)也等价于 bare project:落回该 project 最近那一条", async () => {
    const seed = await loadOttoPanelSeed({ projectId: OTHER_PROJECT, threadId: "thr_does_not_exist" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(OTHER_PROJECT);
    expect(seed.activeThreadId).toBe("thr_other_recent");
  });
});

describe("深链契约②(旧 otto-new-conversation-routing.test.ts:277-287 迁移)——?thread= 恢复对应会话", () => {
  it("project 与 thread 都给,thread 落在那个 project 上:选中它,不是最近那一条", async () => {
    const seed = await loadOttoPanelSeed({ projectId: DEFAULT_PROJECT, threadId: "thr_default_older" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_older");
    // 选中的那一条要带真消息(不是只切了个 id),门面组件靠这个才画得出对话本身。
    const full = seed.threads.find((t) => t.id === "thr_default_older");
    expect(full?.messages.length).toBeGreaterThan(0);
  });

  it("只给 thread,不给 project:落在默认 project 上,thread 必须属于那个 project 才算数", async () => {
    // thr_other_recent 属于 OTHER_PROJECT,但没给 project= 时 activeProjectId 落回默认
    // project——地址栏没说清项目,不该跨项目瞎选一条会话。
    const seed = await loadOttoPanelSeed({ threadId: "thr_other_recent" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });
});

describe("owner 校验沿既有模式——无效 id 回落默认,不炸", () => {
  it("project 不是这个商家自己的(伪造或者别人的 id):落回 getOrCreateDefaultProject 给的那个", async () => {
    const seed = await loadOttoPanelSeed({ projectId: FOREIGN_PROJECT, threadId: "thr_default_recent" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });

  it("thread 是真会话,但属于另一个 project(跨项目伪造):不认,落回选中 project 自己最近那一条", async () => {
    // thr_other_recent 真的存在,但深链点名的是 DEFAULT_PROJECT——地址栏说的项目与会话
    // 必须是同一件事,不能商家点开的其实是另一个 project 底下的会话。
    const seed = await loadOttoPanelSeed({ projectId: DEFAULT_PROJECT, threadId: "thr_other_recent" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });

  it("project 与 thread 都是伪造的:整份种子仍然正常返回,不是 { error }", async () => {
    const seed = await loadOttoPanelSeed({ projectId: FOREIGN_PROJECT, threadId: "thr_does_not_exist" });
    expect("error" in seed).toBe(false);
  });
});
