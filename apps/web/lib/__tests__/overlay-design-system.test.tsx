// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { ReferencePickerMenu } from "@/components/reference-picker/ReferencePickerMenu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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

const WEB_ROOT = path.resolve(__dirname, "../..");

function source(file: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, file), "utf8");
}

describe("FIKIRTIVE overlay visual contract", () => {
  it("keeps every modal on one ink-scrim, radius, shadow, and timing family", () => {
    for (const file of ["dialog.tsx", "alert-dialog.tsx", "sheet.tsx"]) {
      const contents = source(`components/ui/${file}`);
      expect(contents, file).toContain("bg-foreground/40");
      expect(contents, file).toContain("backdrop-blur-[2px]");
      expect(contents, file).toContain("data-open:duration-[var(--dur-3)]");
      expect(contents, file).toContain("data-closed:duration-[var(--dur-2)]");
      expect(contents, file).toContain("ease-[var(--ease-out)]");
      expect(contents, file).not.toMatch(/bg-brand|text-brand|border-brand|shadow-brand/);
    }

    for (const file of ["dialog.tsx", "alert-dialog.tsx"]) {
      const contents = source(`components/ui/${file}`);
      expect(contents, file).toContain("rounded-[var(--radius-modal)]");
      expect(contents, file).toContain("shadow-[var(--shadow-xl)]");
      expect(contents, file).toContain("max-h-[calc(100dvh-2rem)]");
    }
  });

  it("keeps anchored surfaces on the trigger-origin, 12px, fast timing family", () => {
    for (const file of ["dropdown-menu.tsx", "popover.tsx", "select.tsx"]) {
      const contents = source(`components/ui/${file}`);
      expect(contents, file).toContain("origin-(--transform-origin)");
      expect(contents, file).toContain("rounded-[var(--radius-card)]");
      expect(contents, file).toContain("shadow-[var(--shadow-lg)]");
      expect(contents, file).toContain("data-open:duration-[var(--dur-2)]");
      expect(contents, file).toContain("data-closed:duration-[var(--dur-1)]");
      expect(contents, file).toContain("slide-in-from-top-1");
      expect(contents, file).not.toMatch(/bg-brand|text-brand|border-brand|shadow-brand/);
    }
  });

  it("defers overlay examples until the component-library phase", () => {
    const reference = source("app/design-system/DesignSystemReference.tsx");
    expect(reference).toContain('data-scope="foundations-only"');
    expect(reference).not.toContain("<DialogClose");
    expect(reference).not.toContain("<SheetClose");
    expect(reference).not.toContain("<DropdownMenu");
  });

  it("routes both Otto composers AND the Tiptap editor through ONE mention surface", () => {
    // Spec §7.3③: the two `@` implementations collapse into one component. This guard is the
    // ratchet — a third menu (or a composer quietly rebuilding its own) fails here.
    for (const file of ["otto/OttoFrontDoor.tsx", "otto/OttoChatStream.tsx", "MentionInput.tsx"]) {
      const contents = source(`components/${file}`);
      expect(contents, file).toContain("<ReferencePickerMenu");
      expect(contents, file).not.toContain("<PopoverContent");
    }
    for (const file of ["otto/OttoFrontDoor.tsx", "otto/OttoChatStream.tsx"]) {
      const contents = source(`components/${file}`);
      expect(contents, file).toContain("picker.ariaProps");
      expect(contents, file).not.toContain("absolute bottom-full");
    }

    const mentionSurface = source("components/reference-picker/ReferencePickerMenu.tsx");
    expect(mentionSurface).toContain("<PopoverAnchor asChild>");
    expect(mentionSurface).toContain("<PopoverAnchor virtualRef={virtualRef} />");
    expect(mentionSurface).toContain("<PopoverContent");
    expect(mentionSurface).toContain('role="listbox"');
    expect(mentionSurface).toContain('role="option"');
    expect(mentionSurface).toContain('motion="instant"');
    expect(mentionSurface).toContain("onOpenChange=");
    expect(mentionSurface).not.toMatch(/z-\d|z-\[/);
  });

  it("keeps the anchored-popover primitives the mention surface depends on", () => {
    const mentionInput = source("components/MentionInput.tsx");
    const globals = source("app/globals.css");
    const popover = source("components/ui/popover.tsx");
    const button = source("components/ui/button.tsx");

    expect(mentionInput).toContain("virtualRef={virtualRef}");
    expect(mentionInput).not.toMatch(/popup\.style|style\.zIndex|style\.position|window\.innerHeight|pop-menu|pop-item/);
    expect(globals).not.toMatch(/\.pop-menu|\.pop-item/);

    expect(popover).toContain('motion?: "standard" | "instant"');
    expect(popover).toContain('motion === "standard"');
    expect(button).toContain('instant: "transition-none"');
    expect(button).toContain('data-press-feedback={motion === "instant" ? undefined : "true"}');
    expect(button).toContain("aria-selected:bg-accent");
  });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function render(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}

async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

async function press(key: string, target: EventTarget = document): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The `@` menu both Otto composers and the Tiptap canvas editor now render (spec §7.3③). */
function MentionHarness({ onSelect }: { onSelect?: (name: string) => void }) {
  const [open, setOpen] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rows = [
    { key: "product:product-1", kind: "reference" as const, name: "Morning mug", source: "Product · Otto IQ", type: "product" as const },
    { key: "product:product-2", kind: "reference" as const, name: "Canvas tote", source: "Product · Otto IQ", type: "product" as const },
  ];

  return (
    <ReferencePickerMenu
      open={open}
      listId="mention-suggestions"
      rows={rows}
      highlightedIndex={highlightedIndex}
      title="References"
      onDismiss={() => setOpen(false)}
      onHighlightChange={setHighlightedIndex}
      onSelect={(index) => {
        onSelect?.(rows[index]!.name);
        setOpen(false);
      }}
    >
      <textarea aria-label="Composer" />
    </ReferencePickerMenu>
  );
}

describe("FIKIRTIVE overlay interaction contract", () => {
  it("Dialog exposes its title, closes with Escape, and returns focus", async () => {
    const dom = await render(
      <Dialog>
        <DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename campaign</DialogTitle>
            <DialogDescription>Change the team-facing name.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    const trigger = dom.querySelector<HTMLButtonElement>("button")!;
    trigger.focus();
    await click(trigger);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Rename campaign");
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    await press("Escape");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Sheet keeps dialog semantics and closes from the keyboard", async () => {
    const dom = await render(
      <Sheet>
        <SheetTrigger asChild><Button>Open details</Button></SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Asset details</SheetTitle>
            <SheetDescription>Review this asset.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );
    await click(dom.querySelector("button")!);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Asset details");
    await press("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("AlertDialog uses alertdialog semantics and an explicit cancel path", async () => {
    const dom = await render(
      <AlertDialog>
        <AlertDialogTrigger asChild><Button>Delete asset</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    await click(dom.querySelector("button")!);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Delete this asset?");
    await click(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Cancel")!);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("DropdownMenu opens from the keyboard and closes with Escape", async () => {
    const dom = await render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button>Actions</Button></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup><DropdownMenuItem>Rename</DropdownMenuItem></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await press("ArrowDown", dom.querySelector("button")!);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Rename");
    await press("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("Popover stays contextual and closes with Escape", async () => {
    const dom = await render(
      <Popover>
        <PopoverTrigger asChild><Button>Filters</Button></PopoverTrigger>
        <PopoverContent>Filter activity</PopoverContent>
      </Popover>,
    );
    await click(dom.querySelector("button")!);
    expect(document.querySelector('[data-slot="popover-content"]')?.textContent).toContain("Filter activity");
    await press("Escape");
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it("Popover supports an instant virtual-caret suggestion surface", async () => {
    const virtualRef = {
      current: { getBoundingClientRect: () => new DOMRect(120, 80, 1, 18) },
    };
    await render(
      <Popover open>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          motion="instant"
          role="listbox"
          aria-label="Entity suggestions"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Button motion="instant" variant="ghost" role="option" aria-selected>
            Morning mug
          </Button>
        </PopoverContent>
      </Popover>,
    );

    const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    expect(listbox.textContent).toContain("Morning mug");
    expect(listbox.className).not.toContain("animate-in");
    expect(option.className).toContain("transition-none");
    expect(option.className).toContain("aria-selected:bg-accent");
  });

  it("Otto mention suggestions keep composer focus and close with Escape", async () => {
    const dom = await render(<MentionHarness />);
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Composer"]')!;
    await act(async () => composer.focus());
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain("Morning mug");
    expect(document.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(composer);

    await press("Escape", composer);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("Otto mention suggestions select without moving focus into the popup", async () => {
    const picked: string[] = [];
    const dom = await render(<MentionHarness onSelect={(name) => picked.push(name)} />);
    const composer = dom.querySelector<HTMLTextAreaElement>('textarea[aria-label="Composer"]')!;
    await act(async () => composer.focus());
    const option = document.querySelector('[role="option"]')!;

    await act(async () => {
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    });

    expect(picked).toEqual(["Morning mug"]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(composer);
  });
});
