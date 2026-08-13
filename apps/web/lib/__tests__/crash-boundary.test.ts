// @vitest-environment jsdom
/**
 * #793 r2(判官 r1 P1)—— 崩溃页不许把供应商的话转述给商家,也不许一声不吭。
 *
 * 两个洞是同一个根:`app/error.tsx` 把 `error.message` 原样印在页面上,又不上报。
 *   ① 白标:Next 对 Client Component 抛出的错误保留原始 message,于是供应商的报错
 *     ——名字、模型 ID、限流措辞——可以一路显示到商家屏幕上。
 *   ② 可见性:被 React 捕获的错误不算 unhandled error,Sentry 不会自动收;不显式
 *     `captureException`,这一路崩溃就是零信号 —— 而零信号正是这一票要消灭的东西。
 *
 * 所以这里既渲染真组件(不 mock 被测物),也把整族 error boundary 扫一遍。
 */
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: RouteError } = await import("@/app/error");

/** 一条真实形态的供应商报错:名字、模型 ID、限流措辞、内部 request id 全在里面。 */
const VENDOR_MESSAGE =
  "BytePlus Ark seedance-1-0-pro-250528 rate limit exceeded (req_9f3c, account 2100xxxx)";

let container: HTMLDivElement;
let root: Root;

function render(error: Error & { digest?: string }): string {
  act(() => {
    root.render(createElement(RouteError, { error, reset: () => {} }));
  });
  return container.innerHTML;
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("app/error.tsx — what the merchant is allowed to see", () => {
  it("never repeats the thrown message, so a vendor error cannot reach the merchant", () => {
    const html = render(Object.assign(new Error(VENDOR_MESSAGE), { digest: "3141592653" }));
    expect(html).not.toContain(VENDOR_MESSAGE);
    for (const leak of ["BytePlus", "Ark", "seedance", "rate limit", "req_9f3c", "2100xxxx"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("says something true and useful instead — plus an inline way out", () => {
    const html = render(new Error(VENDOR_MESSAGE));
    expect(html).toContain("Something broke");
    expect(html).toMatch(/could not be loaded/);
    expect(html).toContain("Reload workbench");
  });

  // digest 是把商家截图里的那一串和服务端日志里的那一条对上的唯一钥匙 —— 它必须留着。
  it("still shows the Next.js digest, which is not a vendor detail", () => {
    expect(render(Object.assign(new Error(VENDOR_MESSAGE), { digest: "3141592653" }))).toContain(
      "3141592653",
    );
  });

  it("sends the real error to Sentry, tagged as the route boundary", () => {
    const error = Object.assign(new Error(VENDOR_MESSAGE), { digest: "3141592653" });
    render(error);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { surface: "route-error", digest: "3141592653" },
    });
    // 细节没有消失,只是换了收件人:商家看通用文案,我们看原文。
    expect((captureException.mock.calls[0]![0] as Error).message).toBe(VENDOR_MESSAGE);
  });

  it("reports a boundary hit even when Next.js gave no digest", () => {
    render(new Error("boom"));
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      tags: { surface: "route-error", digest: "none" },
    });
  });
});

/**
 * 类级围栏:同族的每一个 error boundary 都不许把 message 印出来。
 *
 * 唯一豁免是 `app/admin/error.tsx` —— City Hall 是我们自己的运维面(商家到不了 /admin),
 * 那一页的 "Visible error" 字段是**故意**给运维看原文的诊断字段,不是白标破口。
 */
describe("every merchant-facing error boundary", () => {
  const APP_ROOT = path.resolve(__dirname, "../../app");
  const DIAGNOSTIC_BY_DESIGN = new Set(["admin/error.tsx"]);

  function boundaries(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : boundaries(full);
      return /^(global-)?error\.tsx$/.test(entry.name) ? [full] : [];
    });
  }

  it("finds the boundaries at all (an empty sweep would pass vacuously)", () => {
    const found = boundaries(APP_ROOT).map((f) => path.relative(APP_ROOT, f));
    expect(found).toContain("error.tsx");
    expect(found).toContain("global-error.tsx");
    expect(found.length).toBeGreaterThan(5);
  });

  it("renders no raw error message", () => {
    const offenders = boundaries(APP_ROOT)
      .map((file) => ({ rel: path.relative(APP_ROOT, file), src: fs.readFileSync(file, "utf8") }))
      .filter(({ rel }) => !DIAGNOSTIC_BY_DESIGN.has(rel))
      // JSX 里印出来的形态:{error.message …}。注释与本条围栏自身的说明不算。
      .filter(({ src }) => /\{\s*error\.message/.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
