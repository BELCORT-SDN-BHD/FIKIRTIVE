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
  toChatThreadMetaDTO: (t: { id: string; projectId: string; title: string; updatedAt: string; pinnedAt?: string | null; surface?: string | null }) =>
    ({ id: t.id, projectId: t.projectId, title: t.title, updatedAt: t.updatedAt, pinnedAt: t.pinnedAt ?? null, surface: t.surface ?? null, messages: [] }) satisfies ChatThreadDTO,
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
 *  真实的 orderBy pinnedAt desc, updatedAt desc 同一个约定 —— 选择逻辑不自己再排一次序)。
 *
 *  FRONT-A14 起每一行都带 `surface`:`"panel"` 是面板自己开的,`"canvas"` 是画布那一侧开的,
 *  `null` 是这一票之前的老行(一律按画布读)。默认 project 里**最近的一条是画布的** ——
 *  P1-010 的现场就长这样(商家在 /billing 展开面板,读到一条画布对话)。 */
const THREAD_ROWS = [
  { id: "thr_default_canvas_newest", projectId: DEFAULT_PROJECT, title: "Professional Male Model Image", updatedAt: "2026-08-21T09:00:00.000Z", pinnedAt: null, surface: "canvas" },
  { id: "thr_default_recent", projectId: DEFAULT_PROJECT, title: "Default recent", updatedAt: "2026-08-20T12:00:00.000Z", pinnedAt: null, surface: "panel" },
  { id: "thr_default_older", projectId: DEFAULT_PROJECT, title: "Default older", updatedAt: "2026-08-01T00:00:00.000Z", pinnedAt: null, surface: null },
  { id: "thr_other_recent", projectId: OTHER_PROJECT, title: "Other recent", updatedAt: "2026-08-19T00:00:00.000Z", pinnedAt: null, surface: "panel" },
  { id: "thr_other_older", projectId: OTHER_PROJECT, title: "Other older", updatedAt: "2026-08-02T00:00:00.000Z", pinnedAt: null, surface: null },
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

describe("不带 select:停在默认 project,续面板自己那一批里最近的一条", () => {
  it("停在 getOrCreateDefaultProject 给的那个 project,选它最近那一条面板对话", async () => {
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });
});

/**
 * FRONT-A14(Codex 全 beta 审计 P1-010)—— 面板只自动续**它自己开的**对话。
 *
 * 现场:商家从 /billing 展开侧栏 Otto,面板摊开的是一条画布对话
 * 「Professional Male Model Image」。根因不在面板,在这一层的选择判据:它只按 project 取
 * 最近一条,而 project 来自 `getOrCreateDefaultProject()`,与商家在看哪一页毫无关系。
 */
describe("FRONT-A14 面板只续自己开的对话(Codex 全 beta 审计 P1-010)", () => {
  it("FRONT-A14 — the panel resumes its own conversation, never the newer canvas one in the same project", async () => {
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    // 最近的一条(`thr_default_canvas_newest`)是画布的 —— 旧规则会选它,这就是 P1-010。
    expect(seed.activeThreadId).not.toBe("thr_default_canvas_newest");
    expect(seed.activeThreadId).toBe("thr_default_recent");
  });

  it("FRONT-A14 — with no panel conversation in the project the panel opens a new one instead of a canvas thread", async () => {
    mockGetAllCoworkThreadMetas.mockResolvedValue([
      { id: "thr_canvas_only", projectId: DEFAULT_PROJECT, title: "Professional Male Model Image", updatedAt: "2026-08-21T09:00:00.000Z", pinnedAt: null, surface: "canvas" },
    ]);
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    // 不预选 —— 面板画新对话态,而不是替商家打开一段他没有在这里开过的上下文。
    expect(seed.activeThreadId).toBeNull();
    // 画布那一条仍然在列表里,商家点得到 —— 只是不再自动摊开。
    expect(seed.threads.map((t) => t.id)).toContain("thr_canvas_only");
  });

  it("FRONT-A14 — a thread with no recorded surface counts as a canvas conversation", async () => {
    mockGetAllCoworkThreadMetas.mockResolvedValue([
      { id: "thr_legacy", projectId: DEFAULT_PROJECT, title: "Legacy", updatedAt: "2026-08-21T09:00:00.000Z", pinnedAt: null, surface: null },
    ]);
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    // 老行没有办法回溯它当初从哪个门开的。诚实登记:按画布读,面板不自动续它。
    expect(seed.activeThreadId).toBeNull();
  });

  it("FRONT-A14 — a deep-linked canvas thread still opens, because the merchant named it", async () => {
    // 深链是商家自己点名的到达,与「面板自动续哪一条」是两件事。
    const seed = await loadOttoPanelSeed({ projectId: DEFAULT_PROJECT, threadId: "thr_default_canvas_newest" });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBe("thr_default_canvas_newest");
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

/**
 * FRONT-A14(#1200 判官 P2-2)—— 落座口径与展开信号必须是同一句话。
 *
 * 展开信号(`hasPendingPanelThread`)按 ownerId 查、**不带 project**;落座从前只在当前
 * project 里选。两者口径不一致时的现场:一条在别的 project 里跑着的面板对话把面板顶开,
 * 面板打开后却画的是新对话空态 —— 商家看到的是凭空弹出来的一块空面板。
 */
describe("FRONT-A14 落座与展开信号同一口径:全店(#1200 判官 P2-2)", () => {
  const CANVAS_ROW = { id: "thr_default_canvas", projectId: DEFAULT_PROJECT, title: "Professional Male Model Image", updatedAt: "2026-08-21T09:00:00.000Z", pinnedAt: null, surface: "canvas" };
  const OTHER_PANEL_ROW = { id: "thr_other_panel", projectId: OTHER_PROJECT, title: "Top up my credits", updatedAt: "2026-08-19T00:00:00.000Z", pinnedAt: null, surface: "panel" };

  it("FRONT-A14 — 当前 project 没有面板对话时,续全店最近那一条,并跟着它停在那个 project", async () => {
    mockGetAllCoworkThreadMetas.mockResolvedValue([CANVAS_ROW, OTHER_PANEL_ROW]);

    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBe("thr_other_panel");
    // 项目与会话是同一件事:续了别的 project 那一条,就停在那个 project。
    expect(seed.projectId).toBe(OTHER_PROJECT);
  });

  it("FRONT-A14 — 当前 project 自己有面板对话时照旧先选它,不跨项目", async () => {
    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBe("thr_default_recent");
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
  });

  it("FRONT-A14 — 深链点名的 project 里没有面板对话时也回落全店,不再弹一块空面板(#1215 判官 P2-2)", async () => {
    // 现场:`/?otto=1&project=P` 进来,P 里一条面板对话都没有。信号那一边不认识 project,
    // 照样答「有」把面板顶开 —— 从前这里的深链例外让面板选不到任何一条,商家看到的仍然是
    // 凭空弹出来的一块空面板,只是换了个入口。
    mockGetAllCoworkThreadMetas.mockResolvedValue([CANVAS_ROW, OTHER_PANEL_ROW]);

    const seed = await loadOttoPanelSeed({ projectId: DEFAULT_PROJECT });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBe("thr_other_panel");
    // 项目与会话是同一件事:续了别的 project 那一条,就停在那个 project。
    expect(seed.projectId).toBe(OTHER_PROJECT);
  });

  it("FRONT-A14 — 深链点名的 project 自己有面板对话时仍然先用它,地址栏说的优先", async () => {
    const seed = await loadOttoPanelSeed({ projectId: OTHER_PROJECT });
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBe("thr_other_recent");
    expect(seed.projectId).toBe(OTHER_PROJECT);
  });

  it("FRONT-A14 — 全店一条面板对话都没有时仍然不预选(不会退去续画布或老行)", async () => {
    mockGetAllCoworkThreadMetas.mockResolvedValue([
      CANVAS_ROW,
      { id: "thr_other_legacy", projectId: OTHER_PROJECT, title: "Legacy", updatedAt: "2026-08-19T00:00:00.000Z", pinnedAt: null, surface: null },
    ]);

    const seed = await loadOttoPanelSeed();
    if ("error" in seed) throw new Error("unexpected error: " + seed.error);
    expect(seed.activeThreadId).toBeNull();
    expect(seed.projectId).toBe(DEFAULT_PROJECT);
  });
});
