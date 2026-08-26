// @vitest-environment jsdom
/**
 * r22-project-start.test.ts —— 「建一个项目」这一层的行为契约(Founder 2026-08-26 亲验换血)。
 *
 * 病灶:按下 Create project 弹出来的是一张七格表单(标题 / 目标 / 品牌语气 / 受众 / 语言 /
 * 默认比例 / 上下文)。Founder 原话:「就只是 create 而已」。换过来的形状照 Stitch 的开局 ——
 * Otto 问一句,商家说一句人话,项目就建好了,而且刚才那段对话跟着进画布。
 *
 * 六条钉的都是商家屏幕上真的发生的事(DOM、aria、sessionStorage),只有「旧表单零残留」
 * 那一条量的是源码 —— 它量的正是「那七个格子还在不在」。
 *   ① 一句话够清楚 → 不多问一句,直接建,进的是**那个新项目**的画布;
 *   ② 那段对话真的落进那块板的会话存档(进画布就读得到);
 *   ③ 一句含糊话 → 出**一张** Ask 卡,而且可以跳过(跳过照样建);
 *   ④ Ask 卡是一组**真**单选:方向键在组内移动并跟着选中(shadcn RadioGroup 原生行为);
 *   ⑤ Esc 关掉零残留:浏览器里不留任何草稿,重开是空的;
 *   ⑥ 这一层里一个价钱都不出现(建项目 0 cr,把 cr 摆在这里等于说开项目要钱);
 *   ⑦ 旧七格表单零残留。
 *
 * 变异自查(2026-08-26 逐条**实做**,做完以 commit 为锚还原,红 → 绿):
 *   · `send()` 里跳过 `projectStartQuestion` 直接 `create("")` ⇒ ③④ 三条红;
 *   · `create()` 里删掉 `startCanvasFixtureConversation(...)` ⇒ ② 与「答案进会话」两条红;
 *   · `create()` 里把 `router.push` 的 project 换回 `fixture-raya` ⇒ ① 与「跳过照样建」两条红;
 *   · 关闭时那个清空 effect 里不再清 `sentence` ⇒ ⑤ 红;
 *   · 问题卡从 `RadioGroup` 换回一排 `Button` 加 `role="radio"` ⇒ ④ 与「出一张 Ask 卡」
 *     两条红,外加 `r22-shadcn-composition` 那条围栏一起红。
 *
 * 零后端、零生成:`createProject` 与 `useRouter` 都有替身,fixture 那一支根本不碰它们。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/create",
}));
const actions = vi.hoisted(() => ({ createProject: vi.fn() }));
vi.mock("@/lib/actions", () => actions);

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const { R22ProjectsView } = await import("@/components/projects/R22ProjectsView");
const { projectNameFromSentence, projectStartQuestion } = await import("@/components/projects/project-start");
const {
  NEW_PROJECT_FIXTURE_ID,
  canvasFixtureSessionKey,
  CANVAS_FIXTURE_SESSION_VERSION,
} = await import("@/components/canvas/r22-canvas-fixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB_ROOT = path.resolve(__dirname, "../..");
/** `DEFAULT_R22_WORKSPACE_DIRECTORY.activeId` —— 没有 seed directory 时的默认 workspace。 */
const WORKSPACE_ID = "batik-house";
/** fixture 那一支建项目的假等待(`window.setTimeout(…, 360)`)。 */
const CREATE_MS = 400;

const FIXTURE_ROWS = [{
  id: "fixture-raya",
  name: "Raya launch",
  ownerLabel: "You",
  modifiedLabel: "Just now",
  visibility: "Private",
  briefLabel: "Create a Raya launch set.",
}];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
  navigation.push.mockClear();
  actions.createProject.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  window.sessionStorage.clear();
});

function need<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`找不到 ${selector} —— 下面的断言在核对空气`);
  return node as T;
}

function all<T extends Element = HTMLElement>(selector: string): T[] {
  return [...document.querySelectorAll(selector)] as T[];
}

async function click(node: Element) {
  await act(async () => { (node as HTMLElement).click(); });
}

async function openStartDialog() {
  await act(async () => { root!.render(createElement(R22ProjectsView, { projects: FIXTURE_ROWS, fixture: true })); });
  await click(need("[data-r22-project-create]"));
}

async function say(sentence: string) {
  const composer = need<HTMLTextAreaElement>('[data-r22-project-start] textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(composer, sentence);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send() {
  await act(async () => {
    need('[data-r22-project-start] form').dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function storedSession(projectId: string): { version?: number; messages?: Array<{ from: string; text: string }> } | null {
  const raw = window.sessionStorage.getItem(`${canvasFixtureSessionKey(projectId, null)}:${WORKSPACE_ID}`);
  return raw ? JSON.parse(raw) : null;
}

/** 商家读得到的字(把这一层整段文字折成一行)。 */
function dialogText(): string {
  return need("[data-r22-project-start]").textContent?.replace(/\s+/g, " ") ?? "";
}

describe("① 一句话就建好一个项目", () => {
  it("说清楚了就不多问一句 —— 直接开那个新项目的画布", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openStartDialog();

    await say("Raya gift set launch for Instagram");
    await send();

    // 问题卡一张都不该出来:他已经说清楚了,再问一句就是拦路。
    expect(document.querySelector("[data-r22-project-ask]"), "说清楚了还被问一句").toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(CREATE_MS); });
    vi.useRealTimers();

    const to = navigation.push.mock.calls.at(-1)?.[0] as string | undefined;
    expect(to, "建完没有进画布").toBeTruthy();
    expect(to, "进的是别人那块板 —— 顶栏写着别人的名字,而且没有一处会报错").toContain(`project=${NEW_PROJECT_FIXTURE_ID}`);
  });

  it("② 刚才那段对话真的落进那块板的会话 —— 进画布不用再说一遍", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openStartDialog();
    await say("Raya gift set launch for Instagram");
    await send();
    await act(async () => { await vi.advanceTimersByTimeAsync(CREATE_MS); });
    vi.useRealTimers();

    const session = storedSession(NEW_PROJECT_FIXTURE_ID);
    expect(session?.version, "会话存档的版本号对不上 —— 画布读到会当场丢掉,进去是一块空板").toBe(CANVAS_FIXTURE_SESSION_VERSION);
    const said = session?.messages?.filter((line) => line.from === "me").map((line) => line.text) ?? [];
    expect(said, "商家那句话没跟着进画布").toContain("Raya gift set launch for Instagram");
  });

  it("项目名从那句话派生,不另问一格", () => {
    expect(projectNameFromSentence("Create a Raya gift set launch for Instagram")).toBe("Raya gift set launch for");
    expect(projectNameFromSentence("   ")).toBe("New project");
  });
});

describe("③④ 一句含糊话先问一样,而且可以跳过", () => {
  it("含糊就出一张 Ask 卡,跳过照样建", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openStartDialog();

    await say("make something nice");
    await send();

    expect(document.querySelector("[data-r22-project-ask]"), "一句含糊话直接建了项目").toBeTruthy();
    // 只问**一样**:建项目一分钱都不花,问第二句纯粹是拖时间。
    expect(all("[data-r22-project-ask] [data-slot=radio-group]").length, "问了不止一样").toBe(1);
    expect(navigation.push, "问的时候就把项目建了 —— 那句话还没答完").not.toHaveBeenCalled();

    await click(need("[data-r22-project-ask-skip]"));
    await act(async () => { await vi.advanceTimersByTimeAsync(CREATE_MS); });
    vi.useRealTimers();

    expect(navigation.push.mock.calls.at(-1)?.[0], "跳过之后建不出项目 —— 那这一问就是一道闸").toContain(`project=${NEW_PROJECT_FIXTURE_ID}`);
  });

  it("④ Ask 卡是一组真单选:方向键在组内移动并跟着选中", async () => {
    await openStartDialog();
    await say("make something nice");
    await send();

    const options = all<HTMLButtonElement>("[data-r22-project-ask-option]");
    expect(options.length, "问题卡上没有选项").toBe(3);
    expect(options.every((node) => node.getAttribute("role") === "radio"), "这几个不是单选").toBe(true);
    // 一组单选在 Tab 序里只占一站:还没选时那一站在组本身上(shadcn RadioGroup 的
    // roving focus 原生行为),三个选项谁都不抢 Tab。
    expect(need("[data-r22-project-ask] [data-slot=radio-group]").getAttribute("tabindex")).toBe("0");
    expect(options.map((node) => node.tabIndex), "三个选项各占一站 Tab —— 那不是一组单选").toEqual([-1, -1, -1]);

    await act(async () => { options[0]!.focus(); });
    // shadcn RadioGroup 的 roving focus 把搬焦点排到下一个 macrotask 里(Radix
    // `setTimeout(() => focusFirst(...))`),所以这里必须等那一拍 —— 不等就是在按下键的
    // 同一帧上核对结果,永远核不到。
    await act(async () => {
      options[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const after = all<HTMLButtonElement>("[data-r22-project-ask-option]");
    expect(after.map((node) => node.getAttribute("aria-checked")), "方向键什么都没发生 —— 键盘上这组单选是死的").toEqual(["false", "true", "false"]);
    expect(document.activeElement, "选中跟着走了,焦点没跟上").toBe(after[1]);
    // 选中之后 Tab 序那一站搬到选中的那一个上。
    expect(after.map((node) => node.tabIndex)).toEqual([-1, 0, -1]);
    expect(need<HTMLButtonElement>("[data-r22-project-ask-go]").disabled, "选好了「Open the project」还是死的").toBe(false);
  });

  it("答出来的那一样也跟着进画布的会话", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openStartDialog();
    await say("make something nice");
    await send();

    await click(need('[data-r22-project-ask-option="A launch"]'));
    await click(need("[data-r22-project-ask-go]"));
    await act(async () => { await vi.advanceTimersByTimeAsync(CREATE_MS); });
    vi.useRealTimers();

    const said = storedSession(NEW_PROJECT_FIXTURE_ID)?.messages?.map((line) => line.text) ?? [];
    expect(said, "答案没进会话 —— 商家进画布得把刚答过的话再答一遍").toContain("A launch");
    expect(said, "Otto 问过的那句话没留在会话里 —— 那条答案就成了一句没头没脑的话").toContain(projectStartQuestion("make something nice")!.question);
  });
});

describe("⑤⑥ 关掉零残留,而且一个价钱都不出现", () => {
  it("Esc 关掉之后浏览器里不留草稿,重开是空的", async () => {
    await openStartDialog();
    await say("Raya gift set launch for Instagram");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-r22-project-start]"), "Esc 关不掉这一层").toBeNull();

    // 旧表单往 sessionStorage 存草稿(`r22:projects:create:draft:v1`)—— 那对一张表单是
    // 体贴,对一句话是纠缠。这里量的是「浏览器里真的一个字都没留」。
    const leftovers = Object.keys(window.sessionStorage).filter((key) => key.includes("projects"));
    expect(leftovers, "关掉之后还在浏览器里留着东西").toEqual([]);

    await click(need("[data-r22-project-create]"));
    expect(need<HTMLTextAreaElement>("[data-r22-project-start] textarea").value, "重开还留着上一次那句话").toBe("");
  });

  it("这一层里一个价钱都不出现 —— 开项目本身不花钱", async () => {
    await openStartDialog();
    expect(dialogText(), "建项目这一层摆了价钱 —— 那等于说开个项目要收费").not.toMatch(/\bcr\b|\bcredits?\b/i);

    await say("make something nice");
    await send();
    expect(dialogText(), "问一句的时候摆了价钱").not.toMatch(/\bcr\b|\bcredits?\b/i);
  });
});

describe("⑦ 旧七格表单零残留", () => {
  it("那七个格子在源码里一个都不剩", () => {
    const view = readFileSync(path.join(WEB_ROOT, "components/projects/R22ProjectsView.tsx"), "utf8");
    const dialog = readFileSync(path.join(WEB_ROOT, "components/projects/ProjectStartDialog.tsx"), "utf8");
    for (const field of ["Project title", "Brand voice", "Default format", "Audience", "r22-projects-form", "projects:create:draft"]) {
      expect(view, `列表页还留着「${field}」`).not.toContain(field);
      expect(dialog, `新对话框里又长出了「${field}」`).not.toContain(field);
    }
  });
});
