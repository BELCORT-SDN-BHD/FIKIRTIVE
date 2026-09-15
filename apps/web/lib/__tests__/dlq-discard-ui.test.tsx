// @vitest-environment jsdom
/**
 * `/admin/queue` 的「Dead letters」一节（Founder 2026-09-15 裁决；验收表登记在
 * docs/specs/fail-closed-reliability.md §5，DLQ-A1／A2／A3）。
 *
 * 这里只测这一节自己负责的三件事：把一条死信说清楚、按下去要先问一次、丢完之后那一行消失且
 * 屏幕上留下一句指得到审计行的话。谁能丢、丢了写什么，全在服务端，由 `dlq-discard-live.test.ts`
 * 拿真库证。动作层在这里是假的 —— 它带着 `"use server"` 和 Prisma，不该被拖进 jsdom。
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadLetterItem } from "@/lib/dead-letters-admin";

const discardDeadLetter = vi.fn();
vi.mock("@/lib/dlq-actions", () => ({ discardDeadLetter: (...args: unknown[]) => discardDeadLetter(...args) }));

const { DeadLetterPanel } = await import("@/components/admin/DeadLetterPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "6a0d2f7c-1f2b-4c9d-9c1a-2b7d3e4f5a60";
const GEN_JOB_ID = "01M288VJS12BBT536TZF5T0S01";

const ITEM: DeadLetterItem = {
  queue: "gen.dlq",
  jobId: JOB_ID,
  createdAt: "2026-09-11T04:05:06.000Z",
  identifiers: [{ key: "genJobId", value: GEN_JOB_ID }],
  withheldKeys: [],
  ledger: { net: 0, rows: 4 },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  discardDeadLetter.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

function button(label: string, scope: ParentNode = document.body): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button")].find((node) => node.textContent?.trim() === label);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`No button labelled "${label}"`);
  return match;
}

function dialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("No confirm dialog is open");
  return button(label, dialog);
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("DLQ-A1 the dead-letter section", () => {
  it("DLQ-A1 names the queue, the job, the payload identifier and the job's ledger net", async () => {
    await render(<DeadLetterPanel listing={{ readable: true, items: [ITEM], truncated: false }} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("gen.dlq");
    expect(text).toContain(JOB_ID);
    expect(text).toContain(GEN_JOB_ID);
    expect(text).toContain("2026-09-11 04:05");
    expect(text).toContain("Ledger for this job: closed at zero across 4 entries.");
  });

  /** 「读不到」和「读到了，是空的」是两句话（packages/core/src/dead-letters.ts 立的规矩）。 */
  it("DLQ-A1 says it cannot read rather than drawing an empty list", async () => {
    await render(<DeadLetterPanel listing={{ readable: false }} />);

    expect(document.body.textContent).toContain("Dead letters cannot be read right now");
    expect(document.body.querySelectorAll("button")).toHaveLength(0);
  });

  it("DLQ-A1 says the queues are empty when the read succeeded and found nothing", async () => {
    await render(<DeadLetterPanel listing={{ readable: true, items: [], truncated: false }} />);

    expect(document.body.textContent).toContain("No dead letters.");
  });
});

describe("DLQ-A2 discarding one dead letter", () => {
  it("DLQ-A2 asks once before discarding, and does nothing while the question is open", async () => {
    await render(<DeadLetterPanel listing={{ readable: true, items: [ITEM], truncated: false }} />);

    await click(button("Discard"));

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Discard this dead letter?");
    expect(discardDeadLetter).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(JOB_ID);
  });

  it("DLQ-A2 removes the row and names the audit row it wrote", async () => {
    discardDeadLetter.mockResolvedValue({ ok: true, outcome: "discarded", auditEventId: "01M2AUDITROW0000000000000" });
    await render(<DeadLetterPanel listing={{ readable: true, items: [ITEM], truncated: false }} />);

    await click(button("Discard"));
    await click(dialogButton("Discard job"));

    expect(discardDeadLetter).toHaveBeenCalledWith({ queue: "gen.dlq", jobId: JOB_ID });
    const status = document.querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain("Audit row 01M2AUDITROW0000000000000");
    expect(document.body.textContent).toContain("No dead letters.");
  });

  it("DLQ-A2 keeps the row and shows the refusal when the server says no", async () => {
    discardDeadLetter.mockResolvedValue({ error: "You don't have access to this." });
    await render(<DeadLetterPanel listing={{ readable: true, items: [ITEM], truncated: false }} />);

    await click(button("Discard"));
    await click(dialogButton("Discard job"));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("You don't have access to this.");
    expect(document.body.textContent).toContain(JOB_ID);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("DLQ-A3 says nothing was recorded when the job was already gone", async () => {
    discardDeadLetter.mockResolvedValue({ ok: true, outcome: "already-gone" });
    await render(<DeadLetterPanel listing={{ readable: true, items: [ITEM], truncated: false }} />);

    await click(button("Discard"));
    await click(dialogButton("Discard job"));

    const status = document.querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain("already gone");
    expect(status).toContain("nothing was recorded");
    expect(document.body.textContent).toContain("No dead letters.");
  });
});
