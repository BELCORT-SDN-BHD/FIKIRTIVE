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
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { default: RouteError } = await import("@/app/error");
const { default: GlobalError } = await import("@/app/global-error");

/** 同族崩溃卡的外框 —— 路由段 boundary 与共用 `CrashPage` 逐字相同的那一串。
 *  不再数个数(尾巴轮四组一,#1244 判官 P2-1):写下「九个」的那天磁盘上是十个,今天是十一个,
 *  而这个数每加一面就过期一次 —— 承重的是「同族逐字相同」,从来不是数量。 */
const CRASH_CARD_CLASSES =
  "mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8";

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

/**
 * 2026-09-05 走查 P2 —— 「崩溃页两套不一致」(验收 FRONT-A14)。
 *
 * `/brand` 这类没有自己 boundary 的面崩起来落在 `app/error.tsx`,而它和 `app/global-error.tsx`
 * 从前是独立手写的第二套:居中裸文字、没有卡、错误编号那一行叫 `Reference:`,而路由段那一族的
 * boundary 叫 `Error reference:`。两处现在渲染**同一个** `CrashPage`,所以这里钉的是
 * 「同一个组件」这件事本身:把其中一处改回手写的形状,或者把编号那一行的措辞改成第三种说法,
 * 当场红。
 */
describe("FRONT-A14:两个兜底崩溃页渲染同一个 CrashPage", () => {
  const DIGEST = "2718281828";

  function markupOf(boundary: unknown): string {
    return renderToStaticMarkup(
      createElement(boundary as never, {
        error: Object.assign(new Error(VENDOR_MESSAGE), { digest: DIGEST }),
        reset: () => {},
      } as never),
    );
  }

  it("FRONT-A14: both fallback boundaries render the one shared crash card", () => {
    for (const boundary of [RouteError, GlobalError]) {
      const markup = markupOf(boundary);
      expect(markup).toContain("data-crash-page");
      expect(markup).toContain(CRASH_CARD_CLASSES);
    }
  });

  it("FRONT-A14: both call the error number by the same name the rest of the family uses", () => {
    for (const boundary of [RouteError, GlobalError]) {
      const markup = markupOf(boundary);
      expect(markup).toContain(`Error reference: ${DIGEST}`);
      // 旧的第二种说法不许回来 —— 商家报的那一串在两处只有一个名字。
      expect(markup).not.toMatch(/>Reference:/);
    }
  });

  it("FRONT-A14: the shared card is what the route-segment boundaries already look like", () => {
    // 形状的参照物是同族里现成的那一个,不是这条测试自己编的一份描述。
    const family = fs.readFileSync(path.resolve(__dirname, "../../app/create/error.tsx"), "utf8");
    expect(family).toContain(CRASH_CARD_CLASSES);
    expect(family).toContain("Error reference:");
  });
});
