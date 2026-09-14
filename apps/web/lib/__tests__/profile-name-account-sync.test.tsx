// @vitest-environment jsdom
/**
 * R3-F04 —— 商家在 /profile 存了新姓名,右上角账号菜单与头像要**当场**跟上,不用刷新。
 *
 * 走查(round-3,build 14bcd038)看到的是:按下 Save changes、读到 "Saved" 之后立刻打开
 * 账号菜单,里面还写着旧名字、头像还是旧首字母;只有整页重载才追上。而 /profile 那句话
 * 明写着 "This is how your name appears across Fikirtive" —— 商家在同一屏上同时读到两个
 * 名字,这是产品在自打嘴巴。
 *
 * 病根不在动作里。`updateDisplayName` 写完 `User.name` 就 `revalidatePath("/", "layout")`
 * (lib/profile-actions.ts),而账号那份数据活在 `MerchantShellContent` 的**客户端 state**
 * 里(components/global-navigation.tsx),只在挂载、余额广播、`visibilitychange` 这三下
 * 重读 —— 根布局的 revalidate 够不着它。
 *
 * 所以这个文件把两边**挂在同一棵树上**(真的商家壳 + 真的 /profile 表单),按真的 Save,
 * 然后去看右上角那颗账号按钮。`getMyAccount` 的替身读的是一个可变的 `storedDisplayName`,
 * 当它是那一行数据库记录:动作先写它,壳只有**真的重读**才看得见新值。这样「跟上」就
 * 不能靠把动作的返回值直接塞进另一份 state 蒙混过去 —— 那会造出账号数据的第二个源头,
 * 而那正是这条修法要避免的东西。
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/profile"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })),
}));

/** 这一行当数据库用:动作写它,`getMyAccount` 读它。 */
let storedDisplayName = "Kaia Tan";

const getMyAccount = vi.fn(async () => ({
  email: "kaia@fikirtive.test",
  displayName: storedDisplayName,
  organizationName: "Kaia Cafe",
  isFounder: false,
  balance: 55,
  reserved: 0,
  balanceUsd: 5.5,
  recent: [],
  buildSha: "test",
}));
vi.mock("@/lib/account-actions", () => ({ getMyAccount: () => getMyAccount() }));

/** 真动作要 Postgres,这里只替换那一次写。成功那一路**真的改掉** `storedDisplayName`,
 *  所以下一次 `getMyAccount` 才读得到新名字 —— 见文件头。 */
const updateDisplayName = vi.fn(async (name: string) => {
  storedDisplayName = name.trim();
  return { ok: true as const, name: storedDisplayName };
});
const updateWorkspaceName = vi.fn(async (name: string) => ({ ok: true as const, name: name.trim() }));
vi.mock("@/lib/profile-actions", () => ({
  updateDisplayName: (name: string) => updateDisplayName(name),
  updateWorkspaceName: (name: string) => updateWorkspaceName(name),
}));

/** 面板体与项目/会话那一侧的服务端动作 —— 这个文件一次都不会走到它们,挡住只是为了不把
 *  Prisma 拖进来(与 otto-panel-mount.test.ts 同一份理由、同一份名单)。 */
vi.mock("@/lib/otto-panel-seed", () => ({ loadOttoPanelSeed: vi.fn(async () => ({ error: "seed not wired in this test" })) }));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoTurn: vi.fn(),
  createEmptyCoworkThread: vi.fn(),
  deleteCoworkThread: vi.fn(),
  renameCoworkThread: vi.fn(),
  setCoworkThreadPinned: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/actions", () => ({
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  setProjectPinned: vi.fn(),
}));
vi.mock("@/lib/otto-panel-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/otto-panel-activity")>()),
  fetchPanelThreadPending: vi.fn(async () => false),
}));

// 下拉菜单与导轨在 jsdom 里要这三样才活得起来(与 nav-rail.test.ts / otto-panel-mount.test.ts
// 同一份 polyfill)。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MerchantShellContent } = await import("@/components/global-navigation");
// 面板体是懒加载的,先把模块取进 registry,省得 `React.lazy` 的 promise 等的是模块解析本身。
await import("@/components/otto/panel/OttoPanelConversation");
const { ProfileNames } = await import("@/app/profile/ProfileNames");
// 信号本身用**真模块**:这条修法买的正是「名字改了走的是壳已经在听的那条路」,mock 掉
// 它就把要证明的东西换成了一句断言自己。
const { subscribeBalanceRefresh } = await import("@/lib/balance-refresh");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  storedDisplayName = "Kaia Tan";
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await settle();
  return container;
}

/** React 记着它上次写进受控元素的值,会吞掉「没变」的事件 —— 走原型 setter 写。 */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** 右上角那颗账号按钮。头像首字母就是它的文字内容,名字在 `title` 上
 *  (MerchantAccountMenu:`title={label}` + `label.slice(0, 1).toUpperCase()`)。 */
function identity(dom: HTMLElement): HTMLElement {
  return dom.querySelector<HTMLElement>("[data-shell-identity]")!;
}

function displayNameInput(dom: HTMLElement): HTMLInputElement {
  return dom.querySelector<HTMLInputElement>("#profile-display-name")!;
}

/** 真的壳 + 真的 /profile 表单,挂在同一棵树上 —— 商家看到的就是这一棵。 */
function profileScreen(): ReactElement {
  return createElement(
    MerchantShellContent,
    { pathname: "/profile", signOutAction: vi.fn(async () => undefined) },
    createElement(ProfileNames, { displayName: storedDisplayName, workspaceName: "Kaia Cafe" }),
  );
}

describe("R3-F04 改名之后账号菜单与头像当场跟上(不用刷新)", () => {
  it("R3-F04 存下新姓名之后,账号按钮的名字与头像首字母立刻是新的", async () => {
    const dom = await mount(profileScreen());

    // 起点:壳已经读过一次账号,写着旧名字。
    expect(identity(dom).getAttribute("title")).toBe("Kaia Tan");
    expect(identity(dom).textContent?.trim()).toBe("K");

    const input = displayNameInput(dom);
    await typeInto(input, "Alya Tan");
    await save(input);

    // 保存这一步本身是成功的(否则下面那条断言测的就不是同步,而是保存)。
    expect(updateDisplayName).toHaveBeenCalledWith("Alya Tan");
    expect(input.closest("form")!.textContent).toContain("Saved");
    expect(input.value).toBe("Alya Tan");

    // 走查里坏掉的就是这两行:没有刷新,菜单与头像还停在旧名字上。
    expect(identity(dom).getAttribute("title")).toBe("Alya Tan");
    expect(identity(dom).textContent?.trim()).toBe("A");
  });

  it("R3-F04 名字是**重读服务端**拿回来的,不是把返回值塞进第二份 state", async () => {
    const dom = await mount(profileScreen());
    expect(getMyAccount).toHaveBeenCalledTimes(1);

    await typeInto(displayNameInput(dom), "Alya Tan");
    await save(displayNameInput(dom));

    // 壳只认 `getMyAccount()` 这一个源头:改完名字它必须再读一次。少了这一次重读,
    // 屏幕上的名字就只能来自另一份就地拼出来的状态 —— 那是账号数据的第二个源头。
    expect(getMyAccount).toHaveBeenCalledTimes(2);
  });

  it("R3-F04 走的是壳已经在听的那条信号,不是另建一条", async () => {
    // 订阅端用的就是 `global-navigation.tsx` 调的那一个(`subscribeBalanceRefresh`):
    // 保存喊的那一声必须落到同一个监听集里,否则就是第二套刷新机制。
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(listener);
    try {
      const dom = await mount(profileScreen());
      listener.mockClear();

      await typeInto(displayNameInput(dom), "Alya Tan");
      await save(displayNameInput(dom));

      expect(listener).toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("R3-F04 保存失败不喊,屏幕上的名字不为一次没落地的改动动一下", async () => {
    updateDisplayName.mockResolvedValueOnce({ error: "Could not save your name. Try again." } as never);
    const listener = vi.fn();
    const unsubscribe = subscribeBalanceRefresh(listener);
    try {
      const dom = await mount(profileScreen());
      listener.mockClear();

      await typeInto(displayNameInput(dom), "Alya Tan");
      await save(displayNameInput(dom));

      expect(listener).not.toHaveBeenCalled();
      expect(identity(dom).getAttribute("title")).toBe("Kaia Tan");
      expect(identity(dom).textContent?.trim()).toBe("K");
    } finally {
      unsubscribe();
    }
  });
});
