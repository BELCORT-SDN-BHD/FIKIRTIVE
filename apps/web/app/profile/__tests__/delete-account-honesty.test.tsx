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
//
// 落修轮新增两条(判官 #1237 P2-5 与 P2-4):这一屏不许许一封仓库寄不出的通知信;确认框里点名
// 的那一页,商家在框里就得点得到。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DeleteAccountCard } from "../DeleteAccountCard";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 每次渲染都记下来,afterEach 全部卸掉。一个测试里渲染两次却只记住后一次,前一次那颗 portal
// 到 body 的对话框就会留在文档里 —— vitest 在同一个 worker 里连着跑 jsdom 文件,它会漏进**别的
// 测试文件**(CI 实证:`segment-delete-feedback-ui.test.tsx` 读到了本文件的确认框)。
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

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
  for (const entry of mounted.splice(0)) {
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
});

async function renderCard(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(createElement(DeleteAccountCard, { email: "kaia@e2e.test" })));
  return container;
}

/** 商家按下 Delete 之后,确认框(portal 到 body 末尾)里的全部文字。 */
async function openConfirmDialog(el: HTMLDivElement): Promise<string> {
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
    const shown = await openConfirmDialog(await renderCard());

    // ① 这是给客服的请求。
    expect(shown, "① 客服请求").toContain("This opens an email to support");
    expect(shown).toContain("Nothing is deleted automatically");
    // ② 删什么。
    expect(shown, "② 删什么").toContain("What goes:");
    expect(shown).toContain("your workspace and the work inside it");
    // ③ 留什么。
    expect(shown, "③ 留什么").toContain("What stays:");
    expect(shown).toContain("billing and credit history");
    // ④ 多久 —— 没有自动删除、由人按手处理;备份里还会留一段时间。
    expect(shown, "④ 多久").toContain("How long:");
    expect(shown).toContain("a person handles the request by hand");
    expect(shown).toContain("backups");
  });

  it("FRONT-A12: this screen promises no notification the product cannot send", async () => {
    // 判官 #1237 P2-5:这一屏此前写着「处理完发邮件通知你」,而仓库里没有任何一条在删号处理
    // 完之后发信的路径 —— 产品唯一做的事是打开一封商家自己发给 support 的邮件。许一封寄不出
    // 的信,和「按下去就删掉了」是同一类假话,只是慢一点才被发现。
    const el = await renderCard();
    const shown = `${el.textContent ?? ""}\n${await openConfirmDialog(el)}`;

    expect(shown, "许了一封仓库寄不出的通知信").not.toMatch(
      /emails? you|e-?mails? you|notify you|notifies you|let you know|you will be notified/i,
    );
    // 反面:商家自己去信 support 那条路仍然写着(否则上面那条正则靠删光文案也能变绿)。
    expect(shown).toContain("This opens an email to support");
  });

  it("FRONT-A12: the retention window has one author — this screen links to it, it does not restate the number", async () => {
    // 「留多久」的天数写在 /legal/data-deletion(「about 30 days」)。这一屏再抄一个数字,
    // 两处迟早各说各的(§7.3),所以这里只许链过去。
    const el = await renderCard();
    const link = el.querySelector<HTMLAnchorElement>('a[href="/legal/data-deletion"]');

    expect(link, "行里没有指向 /legal/data-deletion 的链接").not.toBeNull();
    expect(link!.textContent).toContain("how long deleted records are kept");

    const shown = `${el.textContent ?? ""}\n${await openConfirmDialog(el)}`;
    expect(shown, "这一屏自己写了一个保留天数 —— 数字只能有一个作者").not.toMatch(
      /\d+\s*(day|days|week|weeks|month|months)/i,
    );
  });

  it("FRONT-A12: the confirm step's own link reaches the retention page — not one behind the dialog", async () => {
    // 判官 #1237 P2-4:确认框一开就盖住整页,卡片行那条链子在框里点不到 —— 框里点名一处
    // 权威页,却要商家先关掉框才够得着,等于点了个到不了的名。
    const el = await renderCard();
    await openConfirmDialog(el);

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog, "确认框没渲染出来").not.toBeNull();
    const link = dialog!.querySelector<HTMLAnchorElement>('a[href="/legal/data-deletion"]');
    expect(link, "确认框里没有指向 /legal/data-deletion 的链接").not.toBeNull();
    expect(link!.textContent).toContain("how long deleted records are kept");
  });

  it("FRONT-A12: the button still only opens an email — the honest copy did not grow a real deletion", async () => {
    const el = await renderCard();
    // 组件行为一字未改是这一轮的前提:它不碰数据库,唯一的出口是 mailto。
    const shown = await openConfirmDialog(el);
    expect(shown).toContain("Request account deletion?");
    // 二次确认仍然要输入自己的登录邮箱。
    expect(el.ownerDocument.body.textContent).toContain("Open email request");
  });
});
