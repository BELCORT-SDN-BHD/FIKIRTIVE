/**
 * #994 (W2-7) — Otto 面板的几何围栏。
 *
 * 规格:`docs/specs/wave2-shell.md` §3.1–§3.2、§7.1「Otto 面板」块。
 *
 * 这些断言之所以打在纯函数上而不是打在拖动上:面板的难点是「拖到哪、夹到哪、吸到哪」,
 * 而那三件事没有一件需要浏览器。把它们钉在这里,React 那层就只剩「读指针 → 调这里 → 写 state」,
 * 而「窗体飞出屏幕」「面板窄到审批卡塞不下」这类回归会在这个文件里当场红。
 */
import { describe, expect, it } from "vitest";
import {
  DOCK_SNAP_PX,
  PANEL_MIN_WIDTH,
  clampFloatingRect,
  clampLauncherAnchor,
  clampPanelWidth,
  defaultPanelWidth,
  expandedPanelWidth,
  floatingRectFromDocked,
  launcherPosition,
  maxPanelWidth,
  resizeFloatingRect,
  shouldDockOnRelease,
  shouldShowDockHint,
  snapLauncher,
  widthFromResizePointer,
} from "@/components/otto/panel/panel-geometry";

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 1024, height: 700 };

describe("clampPanelWidth (§3.1 320px – min(720px, 50vw))", () => {
  // 验收清单逐字那两条。
  it("pulls a too-narrow width up to 320", () => {
    expect(clampPanelWidth(280)).toBe(320);
  });

  it("pulls a too-wide width down to min(720, 50vw)", () => {
    expect(clampPanelWidth(9999)).toBe(Math.min(720, WIDE.width * 0.5));
    expect(clampPanelWidth(9999, WIDE.width)).toBe(720);
    expect(clampPanelWidth(9999, 1200)).toBe(600);
    expect(clampPanelWidth(9999, NARROW.width)).toBe(512);
  });

  it("leaves a width that is already legal alone", () => {
    expect(clampPanelWidth(420, WIDE.width)).toBe(420);
  });

  it("keeps the 320 floor even when 50vw is narrower than it", () => {
    // 320 以下审批卡的金额与按钮就塞不下,那是钱路读不懂的问题 —— 下限优先于 50vw。
    expect(maxPanelWidth(500)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(400, 500)).toBe(PANEL_MIN_WIDTH);
  });

  it("treats a corrupt width as no width at all", () => {
    expect(clampPanelWidth(Number.NaN, WIDE.width)).toBe(defaultPanelWidth(WIDE.width));
  });
});

describe("defaultPanelWidth (§3.1 clamp(360px, 25vw, 560px))", () => {
  it("uses 25vw between the two ends", () => {
    expect(defaultPanelWidth(1800)).toBe(450);
  });

  it("never goes below 360 on a small desktop", () => {
    expect(defaultPanelWidth(1200)).toBe(360);
  });

  it("never goes above 560 on a very wide screen", () => {
    expect(defaultPanelWidth(3000)).toBe(560);
  });
});

describe("expandedPanelWidth (§3.1 min(960px, 60vw))", () => {
  it("is 60vw until 960 caps it", () => {
    expect(expandedPanelWidth(1440)).toBe(864);
    expect(expandedPanelWidth(2000)).toBe(960);
  });

  it("is always wider than the ordinary docked maximum on a real desktop", () => {
    expect(expandedPanelWidth(WIDE.width)).toBeGreaterThan(maxPanelWidth(WIDE.width));
  });
});

describe("widthFromResizePointer (拖左缘)", () => {
  it("turns the pointer's x into the width of the strip to its right", () => {
    expect(widthFromResizePointer(1000, WIDE.width)).toBe(440);
  });

  it("clamps at both ends instead of following the pointer off the edge", () => {
    expect(widthFromResizePointer(-500, WIDE.width)).toBe(maxPanelWidth(WIDE.width));
    expect(widthFromResizePointer(WIDE.width + 200, WIDE.width)).toBe(PANEL_MIN_WIDTH);
  });
});

describe("clampFloatingRect (§3.2 永不飞出屏幕)", () => {
  it("pulls a window that hangs off the right/bottom back into view", () => {
    const rect = clampFloatingRect({ x: 1300, y: 800, w: 420, h: 640 }, WIDE);

    expect(rect.x + rect.w).toBeLessThanOrEqual(WIDE.width);
    expect(rect.y + rect.h).toBeLessThanOrEqual(WIDE.height);
  });

  it("pulls a window back after the viewport shrinks under it", () => {
    const before = clampFloatingRect({ x: 980, y: 120, w: 420, h: 640 }, WIDE);
    const after = clampFloatingRect(before, { width: 900, height: 600 });

    expect(after.x).toBeGreaterThanOrEqual(0);
    expect(after.x + after.w).toBeLessThanOrEqual(900);
    expect(after.y + after.h).toBeLessThanOrEqual(600);
  });

  it("enforces the 320 x 360 floor and the 720 x 90vh ceiling", () => {
    const tiny = clampFloatingRect({ x: 10, y: 10, w: 10, h: 10 }, WIDE);
    expect(tiny.w).toBe(320);
    expect(tiny.h).toBe(360);

    const huge = clampFloatingRect({ x: 0, y: 0, w: 5000, h: 5000 }, WIDE);
    expect(huge.w).toBe(720);
    expect(huge.h).toBe(810);
  });

  it("survives a corrupt rect instead of producing NaN geometry", () => {
    const rect = clampFloatingRect({ x: Number.NaN, y: undefined, w: "wide" as unknown as number, h: null as unknown as number }, WIDE);

    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
    expect(rect.w).toBe(320);
    expect(rect.h).toBe(360);
  });
});

describe("shouldDockOnRelease (§3.2 右缘 48px)", () => {
  // 这一组故意用字面量而不是 `DOCK_SNAP_PX` 来造输入:用常数造输入、再用常数验结果,
  // 那么把常数改成任何值测试都还是绿的 —— 阈值就等于没被钉住(变异自查①的教训)。
  it("pins the band at the spec's 48px", () => {
    expect(DOCK_SNAP_PX).toBe(48);
  });

  it("docks when the window's right edge lands inside the 48px band", () => {
    const rect = { x: WIDE.width - 420 - 40, y: 40, w: 420, h: 600 };
    expect(shouldDockOnRelease(rect, WIDE)).toBe(true);
  });

  it("stays floating just outside the band", () => {
    const rect = { x: WIDE.width - 420 - 60, y: 40, w: 420, h: 600 };
    expect(shouldDockOnRelease(rect, WIDE)).toBe(false);
  });

  it("is exact at the boundary: 48 in, 49 out", () => {
    expect(shouldDockOnRelease({ x: WIDE.width - 420 - 48, y: 0, w: 420, h: 600 }, WIDE)).toBe(true);
    expect(shouldDockOnRelease({ x: WIDE.width - 420 - 49, y: 0, w: 420, h: 600 }, WIDE)).toBe(false);
  });

  it("draws the drop hint on exactly the same test it docks on", () => {
    const rect = { x: WIDE.width - 420 - 10, y: 40, w: 420, h: 600 };
    expect(shouldShowDockHint(rect, WIDE)).toBe(shouldDockOnRelease(rect, WIDE));
  });
});

describe("floatingRectFromDocked (拖头部脱离)", () => {
  it("keeps the width the merchant had dragged", () => {
    expect(floatingRectFromDocked(480, WIDE).w).toBe(480);
  });

  it("clears the snap band so a deliberate detach does not spring straight back", () => {
    const rect = floatingRectFromDocked(480, WIDE);
    expect(shouldDockOnRelease(rect, WIDE)).toBe(false);
  });

  it("stays inside the viewport", () => {
    const rect = floatingRectFromDocked(720, { width: 800, height: 600 });
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(800);
    expect(rect.y + rect.h).toBeLessThanOrEqual(600);
  });
});

describe("resizeFloatingRect (四角四边)", () => {
  const start = { x: 400, y: 200, w: 480, h: 600 };

  it("grows to the east without moving the left edge", () => {
    const next = resizeFloatingRect(start, "e", 60, 0, WIDE);
    expect(next.x).toBe(400);
    expect(next.w).toBe(540);
  });

  it("grows to the west by moving the left edge", () => {
    const next = resizeFloatingRect(start, "w", -80, 0, WIDE);
    expect(next.x).toBe(320);
    expect(next.w).toBe(560);
  });

  it("stops the left edge once the width hits its floor", () => {
    // 尺寸顶到下限之后位置还继续爬 = 窗口自己跑掉。
    const next = resizeFloatingRect(start, "w", 10_000, 0, WIDE);
    expect(next.w).toBe(320);
    expect(next.x).toBe(start.x + start.w - 320);
  });

  it("resizes both axes from a corner", () => {
    const next = resizeFloatingRect(start, "se", 40, 50, WIDE);
    expect(next.w).toBe(520);
    expect(next.h).toBe(650);
  });

  it("never leaves the viewport", () => {
    const next = resizeFloatingRect({ x: 1000, y: 700, w: 400, h: 400 }, "se", 5000, 5000, WIDE);
    expect(next.x + next.w).toBeLessThanOrEqual(WIDE.width);
    expect(next.y + next.h).toBeLessThanOrEqual(WIDE.height);
  });
});

describe("snapLauncher (§3.2 松手吸到最近的左/右边缘)", () => {
  it("snaps to the left edge from the left half", () => {
    expect(snapLauncher({ x: 120, y: 300 }, WIDE).edge).toBe("left");
  });

  it("snaps to the right edge from the right half", () => {
    expect(snapLauncher({ x: 1200, y: 300 }, WIDE).edge).toBe("right");
  });

  it("keeps y inside [0, 1] however far the drop point is off-screen", () => {
    expect(snapLauncher({ x: 100, y: -4000 }, WIDE).y).toBe(0);
    expect(snapLauncher({ x: 100, y: 9999 }, WIDE).y).toBe(1);
    const middle = snapLauncher({ x: 100, y: 400 }, WIDE).y;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("survives a corrupt drop point", () => {
    const anchor = snapLauncher({ x: Number.NaN, y: Number.NaN }, WIDE);
    expect(anchor.edge).toBe("right");
    expect(anchor.y).toBeGreaterThanOrEqual(0);
    expect(anchor.y).toBeLessThanOrEqual(1);
  });

  it("round-trips through launcherPosition — where it snaps is where it draws", () => {
    const anchor = snapLauncher({ x: 1100, y: 512 }, WIDE);
    const drawn = launcherPosition(anchor, WIDE);

    expect(drawn.top).toBe(512);
    expect(drawn.left).toBe(1368); // 1440 − 48(图标)− 24(留白)
  });
});

describe("clampLauncherAnchor / launcherPosition (存档里的落点)", () => {
  it("falls back to the bottom-right corner when the anchor is unreadable", () => {
    expect(clampLauncherAnchor(undefined)).toEqual({ edge: "right", y: 1 });
    expect(clampLauncherAnchor({ edge: "middle" as never, y: 5 })).toEqual({ edge: "right", y: 1 });
  });

  it("keeps the launcher clear of the top and bottom edges", () => {
    const top = launcherPosition({ edge: "left", y: 0 }, WIDE);
    const bottom = launcherPosition({ edge: "left", y: 1 }, WIDE);

    expect(top.top).toBe(24);
    expect(bottom.top).toBe(828); // 900 − 48 − 24
    expect(top.left).toBe(24);
  });
});
