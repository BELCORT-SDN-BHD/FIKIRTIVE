// @vitest-environment jsdom
/**
 * #715 review follow-up — "Load more" and a new search share one read lane.
 *
 * If a merchant clicks Load more and then immediately searches for something else, the two
 * reads race. Without a fence the slow page lands last and appends rows from the OLD filter
 * into the NEW list, overwriting the new total and cursor: the list is mixed and the number
 * above it is wrong — the exact dishonesty #715 was filed about, re-entering through the door.
 *
 * The reads are driven through the real client event path (jsdom + react-dom/client), with
 * `listContacts` handed out as controlled promises so the responses can be resolved backwards.
 */
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm-view-data", () => ({ listContacts: vi.fn() }));
vi.mock("@/lib/crm-actions", () => ({ createContact: vi.fn(), importContacts: vi.fn() }));

import ContactsPage from "@/components/crm/contacts-page";
import { listContacts } from "@/lib/crm-view-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-08-01T00:00:00.000Z");

function contact(name: string) {
  return {
    id: `contact-${name}`,
    name,
    lifecycleStage: "Active",
    source: "manual",
    firstTouchCampaignId: null,
    firstTouchAt: NOW,
    lastSeenAt: NOW,
    consentState: { state: "unknown", stateSourceKind: null, evidenceStatus: null, lastReceivedAt: null },
    doNotDisturb: false,
    totalOrdersMyr: null,
    createdAt: NOW,
    identities: [],
  };
}

function page(names: string[], totalCount: number, nextCursor: string | null) {
  return {
    ok: true as const,
    contacts: names.map(contact),
    totalCount,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

/** A promise plus the switch that settles it, so responses can land out of order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

function buttonLabelled(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match as HTMLButtonElement;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
}

describe("#715 contacts read lane keeps one truth on screen", () => {
  it("drops a slow page that lands after a newer search instead of mixing it in", async () => {
    const host = await render(createElement(ContactsPage, {
      initialState: page(["Alpha 1", "Alpha 2"], 4, "cursor-alpha"),
    } as ComponentProps<typeof ContactsPage>));

    const slowPage = deferred<ReturnType<typeof page>>();
    const newSearch = deferred<ReturnType<typeof page>>();
    vi.mocked(listContacts)
      .mockReturnValueOnce(slowPage.promise as never)
      .mockReturnValueOnce(newSearch.promise as never);

    // 1) Merchant asks for the next page of the unfiltered list.
    await act(async () => {
      buttonLabelled(host, "Load more contacts").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    // 2) Before it lands, they search for something else.
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search contacts"]')!;
    await act(async () => {
      setNativeValue(search, "Beta");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // 3) Responses land backwards: the new search first, the stale page after.
    await act(async () => { newSearch.resolve(page(["Beta 1"], 1, null)); });
    await act(async () => { slowPage.resolve(page(["Alpha 3", "Alpha 4"], 4, null)); });

    const text = host.textContent ?? "";
    expect(text).toContain("Beta 1");
    // The stale page must not be appended into the list it does not belong to...
    expect(text).not.toContain("Alpha 3");
    expect(text).not.toContain("Alpha 4");
    expect(text).not.toContain("Alpha 1");
    // ...and must not overwrite the new list's declared total.
    expect(text).toContain("Showing all 1 contact");
    expect(text).not.toContain("of 4 contacts");
  });

  it("continues the visible list, not a half-typed search box", async () => {
    const host = await render(createElement(ContactsPage, {
      initialState: page(["Alpha 1", "Alpha 2"], 4, "cursor-alpha"),
    } as ComponentProps<typeof ContactsPage>));

    vi.mocked(listContacts).mockResolvedValue(page(["Alpha 3", "Alpha 4"], 4, null) as never);

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search contacts"]')!;
    await act(async () => {
      setNativeValue(search, "Beta");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonLabelled(host, "Load more contacts").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(vi.mocked(listContacts).mock.calls[0][0]).toEqual({
      query: "",
      cursor: "cursor-alpha",
    });
    expect(host.textContent).toContain("Showing all 4 contacts");
  });
});
