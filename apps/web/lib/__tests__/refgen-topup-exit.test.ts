// @vitest-environment jsdom
/**
 * refgen-topup-exit — #979 P3:参考图那三个「钱不够」出口同样是死路。
 *
 * 与 #707 三张卡、与计划卡是**同一个病**:服务端的句子早就指向 Billing
 * (`outOfCreditsMessage`),渲染层却只是 `role="alert"` 里一段 `{error}` 死文字。
 * 商家已经决定要花钱了,还得自己去找 Billing 在哪。
 *
 * 两条钉板:
 *   ① 真跑一次「生成参考图 → 服务端说钱不够」,弹窗里必须有一条真的指向 /billing 的路;
 *   ② 三个出口逐个枚举 —— 谁把 `<ErrorWithTopUp>` 换回裸 `{error}`,谁当场红。
 *      (第二条钉的是「以后别退回去」,所以它按源码枚举,而不是只测今天走得通的那一条。)
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEntity: vi.fn(),
  startRefGen: vi.fn(),
  notifyBalanceRefresh: vi.fn(),
}));

vi.mock("@/lib/actions", () => ({ createEntity: mocks.createEntity }));
vi.mock("@/lib/refgen-actions", () => ({ startRefGen: mocks.startRefGen }));
vi.mock("@/lib/balance-refresh", () => ({ notifyBalanceRefresh: mocks.notifyBalanceRefresh }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AddAssetDialog } = await import("@/components/otto/stuff/AddAssetDialog");
const { outOfCreditsMessage } = await import("@/lib/credit-format");

const WEB_ROOT = path.resolve(__dirname, "../..");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  mocks.createEntity.mockReset();
  mocks.startRefGen.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function clickByText(dom: HTMLElement, startsWith: string): Promise<void> {
  const button = Array.from(dom.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").trim().startsWith(startsWith),
  );
  expect(button, `no button starting with "${startsWith}"`).toBeTruthy();
  return act(async () => {
    button!.click();
  });
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("#979 参考图生成:钱不够时有一条真的能点的路", () => {
  it("弹窗里给出 /billing 链接,而不是一段点不动的字", async () => {
    mocks.createEntity.mockResolvedValue({ id: "ent_1" });
    mocks.startRefGen.mockResolvedValue({ error: outOfCreditsMessage(4) });

    const dom = await mount(
      createElement(AddAssetDialog, { open: true, onClose: vi.fn(), onDone: vi.fn() }),
    );

    // Upload → Generate 半屏
    await clickByText(dom, "Generate");
    // 选一个格式(卡片是按钮),再填主体
    const formatCard = Array.from(dom.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Head-and-shoulders"),
    );
    expect(formatCard, "找不到格式卡片").toBeTruthy();
    await act(async () => formatCard!.click());

    const subject = Array.from(dom.querySelectorAll("input")).find((i) => i.type !== "file");
    expect(subject, "找不到主体输入框").toBeTruthy();
    await typeInto(subject!, "Mira, our spokesperson");

    // 定价那一颗按钮(「Generate · N credits」),不是上面那个模式切换。
    await clickByText(dom, "Generate ·");
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.startRefGen).toHaveBeenCalled();
    const alert = dom.querySelector('[role="alert"]');
    expect(alert, "短余额提示根本没显示").toBeTruthy();
    expect(alert!.textContent).toContain("this needs 4 credits");
    const link = alert!.querySelector<HTMLAnchorElement>('a[href="/billing"]');
    expect(link, "叫商家去充值,却没给他路").toBeTruthy();
    expect(link!.textContent?.trim()).toBe("Top up in Billing");
  });
});

// ---------------------------------------------------------------------------
// 三个出口逐个枚举 —— 谁退回裸 `{error}`,谁当场红
// ---------------------------------------------------------------------------
describe("#979 参考图三个出口都不再是死路", () => {
  const SITES = [
    "components/otto/stuff/AddAssetDialog.tsx",
    "components/otto/stuff/ElementVariantsDialog.tsx",
  ];

  it.each(SITES)("%s 的错误提示走 ErrorWithTopUp", (relative) => {
    const source = readFileSync(path.join(WEB_ROOT, relative), "utf8");
    expect(source, `${relative} 没有接上出口组件`).toContain("<ErrorWithTopUp text={error} />");
    // 裸 `{error}` 单独占一行的那种渲染 —— 就是死路的形状。
    expect(
      source.split("\n").some((l) => l.trim() === "{error}"),
      `${relative} 还留着一处点不动的 {error} —— 钱不够又变回死路`,
    ).toBe(false);
  });

  it("AddAssetDialog 的两个出口都接上了(不是只修了一个)", () => {
    const source = readFileSync(path.join(WEB_ROOT, SITES[0]!), "utf8");
    const hits = source.match(/<ErrorWithTopUp text=\{error\} \/>/g) ?? [];
    expect(hits.length, "上传半屏与生成半屏各有一个出口,少接一个就还剩一条死路").toBe(2);
  });
});
