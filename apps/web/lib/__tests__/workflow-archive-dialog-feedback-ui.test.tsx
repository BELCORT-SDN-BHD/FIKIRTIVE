// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  archiveWorkflowDefinition: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  killRoutine: vi.fn(),
  listRoutines: vi.fn(),
}));

vi.mock("@/lib/customer-workflow-ui-actions", () => actions);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: ArchiveWorkflowDialog } = await import(
  "@/components/crm/workflows/archive-workflow-dialog"
);

const DEFINITION = {
  id: "workflow-1",
  slug: "welcome-back",
  name: "Welcome back",
  definitionKind: "rule",
  status: "published",
  currentRevision: 3,
  rowRevision: 7,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let onArchived: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  actions.listRoutines.mockResolvedValue({
    ok: true,
    resource: { items: [], nextCursor: null },
  });
  onArchived = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(ArchiveWorkflowDialog, {
        definition: DEFINITION as never,
        onArchived,
      }),
    );
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function button(label: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`No button labelled "${label}"`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function openDialog() {
  await click(button("Archive"));
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
}

describe("workflow archive confirmation", () => {
  it("uses AlertDialog and states that archive never stops a Routine", async () => {
    await openDialog();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Archive this workflow?");
    expect(dialog?.textContent).toContain("Archive is not off");
    expect(dialog?.textContent).toContain("Archiving never kills or pauses a Routine.");
    expect(dialog?.textContent).toContain("No active Routines");
    expect(actions.archiveWorkflowDefinition).not.toHaveBeenCalled();
  });

  it("cancels without archiving", async () => {
    await openDialog();
    await click(button("Cancel"));

    expect(actions.archiveWorkflowDefinition).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("blocks same-tick double submits, keeps refusal inline, and retries", async () => {
    let release!: (result: { ok: false; error: string }) => void;
    actions.archiveWorkflowDefinition.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await openDialog();

    const confirm = button("Archive workflow");
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(actions.archiveWorkflowDefinition).toHaveBeenCalledTimes(1);
    expect(actions.archiveWorkflowDefinition).toHaveBeenCalledWith({
      workflowDefinitionId: "workflow-1",
      expectedRowRevision: 7,
    });
    expect(button("Archiving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => {
      release({ ok: false, error: "CAS_CONFLICT" });
    });

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.querySelector('[data-error-code="CAS_CONFLICT"]')?.textContent).toContain(
      "The workflow was not archived",
    );
    expect(button("Archive workflow").disabled).toBe(false);

    const archived = { ...DEFINITION, status: "archived", rowRevision: 8 };
    actions.archiveWorkflowDefinition.mockResolvedValueOnce({ ok: true, resource: archived });
    await click(button("Archive workflow"));

    expect(actions.archiveWorkflowDefinition).toHaveBeenCalledTimes(2);
    expect(onArchived).toHaveBeenCalledWith(archived);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
