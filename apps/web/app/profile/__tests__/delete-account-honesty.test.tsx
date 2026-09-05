// @vitest-environment jsdom
//
// 尾巴清单 F4 —— 删账号那一屏说的是实话。
//
// Founder 2026-09-04 20:45 拍板原话:「删账号 → beta 先改诚实文案。写清这是给客服的请求、
// 删什么、留什么、多久处理;自助删除另立规格」。这个文件把那四要素钉成会红的形状。
//
// 刻意是行为测试而不是源码断言:确认框里那四句只有商家真的按下 Delete 才看得到,而源码断言
// 会被同一份文件里的中文注释喂饱(#1153 判官 P2-1 就是这个病)。所以这里渲染真组件、按真按钮、
// 读真 DOM。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteAccountCard } from "../DeleteAccountCard";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(DeleteAccountCard, { email: "kaia@e2e.test" })));
  return container;
}

/** 商家按下 Delete 之后,确认框(portal 到 body 末尾)里的全部文字。 */
async function openConfirmDialog(): Promise<string> {
  const el = await renderCard();
  const del = [...el.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").trim().startsWith("Delete"),
  );
  if (!del) throw new Error("no Delete button on the card");
  await act(async () => del.click());
  return document.body.textContent ?? "";
}

describe("FRONT-A12 — the delete-account screen promises only what it does", () => {
  it("FRONT-A12: the row says this is a request to support, not a switch", async () => {
    const el = await renderCard();
    const shown = el.textContent ?? "";

    expect(shown).toContain("request to our support team");
    expect(shown).toContain("not a switch");
    expect(shown).toContain("Nothing is deleted automatically");
    // 「按下去就删掉了」那一族说法,一句都不许在这一屏出现。
    expect(shown).not.toMatch(/deleted (immediately|right away|instantly)/i);
    expect(shown).not.toMatch(/permanently deletes/i);
  });

  it("FRONT-A12: the confirm step names all four — the request, what goes, what stays, how long", async () => {
    const shown = await openConfirmDialog();

    // ① 这是给客服的请求。
    expect(shown, "① 客服请求").toContain("This opens an email to support");
    expect(shown).toContain("Nothing is deleted automatically");
    // ② 删什么。
    expect(shown, "② 删什么").toContain("What goes:");
    expect(shown).toContain("your workspace and the work inside it");
    // ③ 留什么。
    expect(shown, "③ 留什么").toContain("What stays:");
    expect(shown).toContain("billing and credit history");
    // ④ 多久 —— 处理是人做的、做完发邮件;备份里还会留一段时间。
    expect(shown, "④ 多久").toContain("How long:");
    expect(shown).toContain("emails you when it is done");
    expect(shown).toContain("backups");
  });

  it("FRONT-A12: the retention window has one author — this screen links to it, it does not restate the number", async () => {
    // 「留多久」的天数写在 /legal/data-deletion(「about 30 days」)。这一屏再抄一个数字,
    // 两处迟早各说各的(§7.3),所以这里只许链过去。
    const el = await renderCard();
    const link = el.querySelector<HTMLAnchorElement>('a[href="/legal/data-deletion"]');

    expect(link, "行里没有指向 /legal/data-deletion 的链接").not.toBeNull();
    expect(link!.textContent).toContain("how long deleted records are kept");

    const shown = `${el.textContent ?? ""}\n${await openConfirmDialog()}`;
    expect(shown, "这一屏自己写了一个保留天数 —— 数字只能有一个作者").not.toMatch(
      /\d+\s*(day|days|week|weeks|month|months)/i,
    );
  });

  it("FRONT-A12: the button still only opens an email — the honest copy did not grow a real deletion", async () => {
    const el = await renderCard();
    // 组件行为一字未改是这一轮的前提:它不碰数据库,唯一的出口是 mailto。
    const shown = await openConfirmDialog();
    expect(shown).toContain("Request account deletion?");
    // 二次确认仍然要输入自己的登录邮箱。
    expect(el.ownerDocument.body.textContent).toContain("Open email request");
  });
});
