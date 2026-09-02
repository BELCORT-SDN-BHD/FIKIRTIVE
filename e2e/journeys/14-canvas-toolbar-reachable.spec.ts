/**
 * Journey 14 — every control the canvas puts on the board is reachable by a real hand (FRONT-A14).
 *
 * THE DEFECT THIS CLOSES, found in the Founder's 2026-09-03 six-surface walkthrough (trunk
 * d24079b5, production build, 1440×900). The canvas had TWO things fighting for one corner: the
 * board's own tool row (`.cv-bottom-stack`, z-index 5, `bottom: 20px`) and the Otto overlay
 * (`absolute inset-0`, z-index 30) whose composer sits at `bottom-4`. The composer's block-end
 * addon — the strip carrying Attach / "Enter to send" / Send — is itself clickable, so it took
 * every pointer aimed at the tools underneath it: `elementFromPoint()` at the centre of all eight
 * controls returned that addon, at 1280×800, 1440×900, 1440×1024 and 1920×1080 alike. And the
 * overlay's root carried the `gb` token class, which paints `background-color: var(--background)`
 * — so an `inset-0` copy of it was an opaque sheet over the whole board, hiding the dot grid, the
 * tools and every card. Nothing was broken in the handlers; the merchant could neither see nor
 * reach them.
 *
 * WHERE THE CONTROLS LIVE NOW — the approved canvas pattern's own three places, not ours (Founder
 * 2026-09-03: 生产界面严格按 UIUX 设计走). `design-system/patterns/canvas/CanvasReference.tsx`
 * puts the interaction mode on a rail at `right-4 top-1/2`, zoom in the `bottom-4 right-4` corner,
 * and the creation band at `bottom-4 left-[300px] right-[160px]` — that 160px is what leaves the
 * zoom cluster its corner. The three direct creation tools (image / video / text) have no home in
 * that design, so they stay in the band with the prompt they open, above the Otto composer.
 *
 * WHY A REAL `click()` AND NOT `dispatchEvent`. The bug lives entirely in hit-testing: a
 * dispatched event is delivered straight to the target and goes green over a button buried under
 * a hundred pixels of another component. Playwright's `click()` does what a hand does — it aims
 * at a point and lets the browser decide who receives it — so it is the only form of the
 * assertion that can see this class of defect at all. The two sweeps beside it ask the same
 * question of EVERY control rather than only the two the journey then presses, and they ask it
 * twice: who receives the click, and what is painted on top. The second is not the first — a
 * `pointer-events: none` sheet is invisible to hit-testing and perfectly visible to the merchant,
 * which is exactly what the `gb` overlay was.
 *
 * BOTH SIDES ARE ASSERTED, deliberately. Moving the tools out from under the composer is trivial
 * to get wrong in the other direction — a layout that clears the composer by covering it just
 * moves the unreachable control. So the journey ends by typing into the Otto composer and reading
 * the value back: the tools are pressable AND Otto still takes a keystroke, or this is red.
 *
 * TWO VIEWPORTS, because the overlap is a layout fact and layout facts are width-dependent.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";
import { waitUntilInteractive } from "../support/ui.js";

/**
 * Every control the canvas puts on the board, in the three groups the approved pattern gives
 * them — the creation row in the band above the Otto composer, the interaction-mode rail on the
 * right edge, and the zoom cluster in the bottom-right corner. Named by the accessible name a
 * merchant's screen reader reads, and grouped so a failure says which cluster moved.
 */
const TOOL_GROUPS = [
  { group: "Canvas tools", role: "toolbar", names: ["Generate image", "Video", "Add text"] },
  // The mode rail is a ToggleGroup, which the primitive renders as role="group" — asked for by the
  // role it really has rather than the one it looks like.
  { group: "Canvas interaction mode", role: "group", names: ["Hand tool", "Select tool"] },
  { group: "Canvas zoom", role: "toolbar", names: ["Zoom out", "Fit to screen", "Zoom in"] },
] as const;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

/**
 * Who really receives a click aimed at the middle of this control — `null` when it is the control
 * itself (or something inside it), and a short description of the covering element otherwise.
 *
 * Runs inside the page against the live box, so it asks the browser the same question the browser
 * answers when a merchant presses the mouse.
 */
async function whatCovers(control: Locator): Promise<string | null> {
  return control.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!top) return "(nothing — the point is outside the viewport)";
    if (top === el || el.contains(top)) return null;
    const classes = typeof top.className === "string" ? top.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
    return `${top.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`;
  });
}

/**
 * What is PAINTED over the middle of this control, which is a different question from who receives
 * the click and has to be asked separately.
 *
 * A `pointer-events: none` layer is invisible to hit-testing and perfectly visible to the merchant.
 * The walkthrough's canvas had exactly one: the Otto overlay's own root carried the `gb` token
 * class, and `.gb` paints `background-color: var(--background)` — so an `inset-0` copy of it was an
 * opaque sheet over the whole board at z-index 30, hiding the dot grid, the tool row and every card
 * on it, while `elementFromPoint` reported the tools as reachable. A journey that only asked the
 * hit-test question would have gone green over a toolbar nobody can see.
 *
 * Approximate on purpose, and deliberately narrow: any element with an opaque background whose box
 * contains the point, that is neither an ancestor nor a descendant of the control, and that is
 * positioned above the tool column's own z-index. That is the shape of the defect; it does not try
 * to reimplement CSS paint order.
 */
async function whatPaintsOver(control: Locator): Promise<string | null> {
  return control.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const stack = el.closest(".cv-bottom-stack");
    const floor = Number(stack ? getComputedStyle(stack).zIndex : 0) || 0;
    for (const candidate of Array.from(document.querySelectorAll("*"))) {
      if (candidate === el || candidate.contains(el) || el.contains(candidate)) continue;
      const box = candidate.getBoundingClientRect();
      if (box.left > x || box.right < x || box.top > y || box.bottom < y) continue;
      const style = getComputedStyle(candidate);
      if (style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)") continue;
      const layer = Number(style.zIndex);
      if (!Number.isFinite(layer) || layer <= floor) continue;
      const classes = typeof candidate.className === "string"
        ? candidate.className.trim().split(/\s+/).slice(0, 4).join(".")
        : "";
      return `${candidate.tagName.toLowerCase()}${classes ? `.${classes}` : ""} (background ${style.backgroundColor}, z-index ${style.zIndex})`;
    }
    return null;
  });
}

/** One of the canvas's control groups — scoped, because "Video" also names things on the cards. */
function canvasGroup(page: Page, name: string, role: "toolbar" | "group" = "toolbar"): Locator {
  return page.getByRole(role, { name });
}

test("FRONT-A14 — a merchant can press every canvas tool while Otto's composer is on screen", async ({ page }) => {
  const ws = await seedWorkspace({
    slug: "toolbar",
    workspaceName: "Kaia Cafe",
    personName: "Kaia",
    openingGrant: 75,
  });

  await page.setViewportSize({ width: VIEWPORTS[0].width, height: VIEWPORTS[0].height });
  await signIn(page, ws, "/");

  // The one production entry into a canvas, walked rather than deep-linked (journey 12 documents
  // the two steps): Home → Create → describe → Start.
  await page.getByRole("link", { name: "Create something new" }).click();
  await expect(page).toHaveURL(/\/create$/);
  const brief = page.getByRole("textbox", { name: "Describe what you want to create" });
  await waitUntilInteractive(brief);
  await brief.fill("A poster for our weekend kopi set");
  const start = page.getByRole("button", { name: "Start a Canvas with Otto" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/create\/canvas\?project=/);

  // The canvas is in its REAL state for this defect: a thread exists, so the Otto overlay is the
  // chat stream with its bottom composer — the same surface the walkthrough was on.
  const tools = canvasGroup(page, "Canvas tools");
  await expect(tools).toBeVisible();
  const ottoComposer = page.getByRole("textbox", { name: "Reply to Otto" });
  await expect(ottoComposer).toBeVisible();

  for (const viewport of VIEWPORTS) {
    const where = `${viewport.width}×${viewport.height}`;
    await page.setViewportSize(viewport);
    await expect(tools).toBeVisible();

    // ① Nothing is on top of any control — neither for the pointer nor for the eye. Named one by
    //    one so a failure says WHICH control, in WHICH group, and WHAT is over it.
    //
    //    POLLED, NOT READ ONCE. The height the creation column gives way to the Otto composer is
    //    measured by a ResizeObserver, so a viewport change settles a frame after the resize
    //    returns. A single instantaneous read here would be a race — and this suite runs with
    //    `retries: 0` on purpose, so the one flake it grew would be this one. Polling costs nothing
    //    when the layout is already right and keeps the failure message.
    for (const { group, role, names } of TOOL_GROUPS) {
      const cluster = canvasGroup(page, group, role);
      await expect(cluster, `the "${group}" group is missing at ${where}`).toBeVisible();
      for (const name of names) {
        const control = cluster.getByRole("button", { name, exact: true }).first();
        await expect(control, `${name} is missing from "${group}" at ${where}`).toBeVisible();
        await expect
          .poll(() => whatCovers(control), { message: `at ${where}, a click on "${name}" lands somewhere else` })
          .toBeNull();
        await expect
          .poll(() => whatPaintsOver(control), { message: `at ${where}, "${name}" is painted over` })
          .toBeNull();
      }
    }

    // ② The two tools a merchant loses the most by not reaching, pressed for real.
    const generate = tools.getByRole("button", { name: "Generate image", exact: true });
    await generate.click();
    // The prompt bar itself, not a role: its input is a TipTap contenteditable whose placeholder
    // is drawn in CSS, so it carries no accessible name to ask for.
    const imagePrompt = page.locator("form.cv-composer-pop");
    await expect(imagePrompt, `pressing Generate image at ${where} did not open the image prompt`).toBeVisible();
    await expect(imagePrompt.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close image prompt" }).click();
    await expect(imagePrompt).toBeHidden();

    const video = tools.getByRole("button", { name: "Video", exact: true });
    await video.click();
    const videoDialog = page.getByRole("dialog").filter({ hasText: "Make a video from a prompt" });
    await expect(videoDialog, `pressing Video at ${where} did not open the video dialog`).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(videoDialog).toBeHidden();

    // ③ …and moving the tools out from under Otto did not bury Otto instead.
    await ottoComposer.click();
    await ottoComposer.fill("");
    await ottoComposer.press("k");
    await expect(ottoComposer, `the Otto composer stopped taking keystrokes at ${where}`).toHaveValue("k");
    await ottoComposer.fill("");
  }
});
