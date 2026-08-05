/**
 * 北极星真路由转正上生产(#606 · D7 · T7 第二刀)
 *
 * 预览开关删除、假页清零之后,`/northstar-immersive` 底下只剩两条**真**路由:Home 与
 * Canvas。它们从此就是正式产品页,把人挡在外面的东西只有一件 —— 登录。
 *
 * 这里钉三条商家可见的结果:
 *   ① 未登录进不去 —— 常驻壳、Home、Canvas 三个受控入口一律 redirect("/login"),一个
 *      字节的内容都不交出去。改前壳会以 **null 身份**继续把导航画出来(那条路是为已删的
 *      `/onboarding/login` 假登录页留的),所以第一条在改前是红的。
 *   ② 登录了照常 —— 认证商家拿到的是**自己的**东西:壳写自己的名字,Home 只读自己
 *      ownerId 下的项目。
 *   ③ 生产环境不再需要任何开关 —— NODE_ENV=production 且不设任何预览变量时,认证商家
 *      照样看到内容。改前这三处都会 notFound(),所以这一组在改前也是红的。
 *
 * 全程零后端、零生成:会话、项目读取与画布壳全是假件,一个积分都花不出去。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";
const NOT_FOUND = "NEXT_NOT_FOUND";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireOwner: vi.fn(),
  getMyProfileNames: vi.fn(),
  getProjects: vi.fn(),
  getCoworkThreads: vi.fn(),
  getEntities: vi.fn(),
  getMyAccount: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/auth-guard", () => ({ requireOwner: mocks.requireOwner }));
vi.mock("@/lib/profile-names", () => ({ getMyProfileNames: mocks.getMyProfileNames }));
vi.mock("@/lib/data", () => ({
  getProjects: mocks.getProjects,
  getCoworkThreads: mocks.getCoworkThreads,
  getEntities: mocks.getEntities,
}));
vi.mock("@/lib/actions", () => ({ getOrCreateDefaultProject: mocks.getOrCreateDefaultProject }));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: mocks.getMyAccount }));
vi.mock("@/lib/dto", () => ({ toEntityDTO: (entity: { id: string }) => entity }));
vi.mock("@/components/northstar/immersive/immersive-shell", () => ({ ImmersiveShell: vi.fn() }));
vi.mock("@/components/canvas/NorthstarHome", () => ({ NorthstarHome: vi.fn() }));
vi.mock("@/components/canvas/NorthstarCanvasWorkspace", () => ({ NorthstarCanvasWorkspace: vi.fn() }));

const { NorthstarShellEntry } = await import("@/components/canvas/NorthstarShellEntry");
const { NorthstarHomeEntry } = await import("@/components/canvas/NorthstarHomeEntry");
const { ImmersiveCanvasEntry } = await import("@/components/canvas/ImmersiveCanvasEntry");

const SIGNED_IN = { email: "nurul@warungnurul.my", ownerId: "org_nurul" };

function signedIn(): void {
  mocks.requireOwner.mockResolvedValue(SIGNED_IN);
  mocks.getMyProfileNames.mockResolvedValue({
    displayName: "Nurul Huda",
    workspaceName: "Warung Nurul",
    email: SIGNED_IN.email,
  });
  mocks.getProjects.mockResolvedValue([
    { id: "p-1", name: "Raya campaign", updatedAt: new Date("2026-08-01T00:00:00.000Z") },
  ]);
  mocks.getOrCreateDefaultProject.mockResolvedValue({ id: "p-1" });
  mocks.getCoworkThreads.mockResolvedValue([]);
  mocks.getEntities.mockResolvedValue([]);
  mocks.getMyAccount.mockResolvedValue({ balance: 42 });
}

function signedOut(): void {
  mocks.requireOwner.mockResolvedValue({ error: "Not authorized." });
  mocks.getMyProfileNames.mockResolvedValue({ error: "Not authorized." });
}

/** 三条入口的统一调用形状(Canvas 多一个 searchParams)。 */
const ENTRIES = [
  { name: "shell", call: () => NorthstarShellEntry({ children: "content" }) },
  { name: "home", call: () => NorthstarHomeEntry() },
  {
    name: "canvas",
    call: () => ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) }),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ── ① 未登录进不去 ───────────────────────────────────────────────────────── */

describe("未登录访问北极星路由", () => {
  for (const entry of ENTRIES) {
    it(`${entry.name}:送去 /login,不交出任何内容`, async () => {
      signedOut();
      await expect(entry.call()).rejects.toThrow(REDIRECTED);
      expect(mocks.redirect).toHaveBeenCalledWith("/login");
    });
  }

  it("壳不再以 null 身份把导航画出来", async () => {
    signedOut();
    // 改前:这一句会 resolve 成 <ImmersiveShell identity={null}> —— 未登录的人拿到一整个
    // 产品外壳。现在它抛 redirect,永远没有一个 element 可以被渲染。
    await expect(NorthstarShellEntry({ children: "content" })).rejects.toThrow(REDIRECTED);
  });

  it("Home 在身份没解析出来之前不读任何项目", async () => {
    signedOut();
    await expect(NorthstarHomeEntry()).rejects.toThrow(REDIRECTED);
    expect(mocks.getProjects).not.toHaveBeenCalled();
  });
});

/* ── ② 登录了照常 ─────────────────────────────────────────────────────────── */

describe("已登录商家照常进出", () => {
  it("壳写的是登录进来的这个人的名字与邮箱", async () => {
    signedIn();
    const element = await NorthstarShellEntry({ children: "content" });
    expect(element.props.identity).toEqual({ name: "Nurul Huda", email: SIGNED_IN.email });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("Home 只读认证身份自己的项目", async () => {
    signedIn();
    const element = await NorthstarHomeEntry();
    expect(mocks.getProjects).toHaveBeenCalledWith(SIGNED_IN.ownerId);
    expect(element.props.projects).toEqual([
      { id: "p-1", name: "Raya campaign", updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);
  });

  it("Canvas 按认证身份装好画布上下文", async () => {
    signedIn();
    const element = await ImmersiveCanvasEntry({ searchParams: Promise.resolve({}) });
    expect(mocks.getProjects).toHaveBeenCalledWith(SIGNED_IN.ownerId);
    expect(element.props.runtimeContext.activeProjectId).toBe("p-1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

/* ── ③ 生产上不再需要开关 ─────────────────────────────────────────────────── */

describe("生产环境:没有任何预览开关,真路由照样上", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    // 明确不设任何预览变量 —— 这正是「开关已经不存在」的意思。
    signedIn();
  });

  for (const entry of ENTRIES) {
    it(`${entry.name}:认证商家拿到内容,没有 404`, async () => {
      const element = await entry.call();
      expect(element).toBeTruthy();
      expect(mocks.notFound).not.toHaveBeenCalled();
    });
  }
});
