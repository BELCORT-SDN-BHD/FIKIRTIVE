import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { CANVAS_HREF, CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import { Button } from "@/components/ui/button";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/**
 * 画布深链解析不了时商家看到的那一页(FSE-207,规格 `docs/specs/creation-engine.md` §5,
 * Founder 2026-09-12 #1358 裁:「跨租户深链零写入」是**硬口径**)。
 *
 * 从前这条路不存在:`?project=` 指向别的租户(或已删、或伪造)时,画布先
 * `getOrCreateDefaultProject()` 兜底建一张新画布、再把地址**静默改写**成那张新画布 ——
 * 走查里第二个租户打开租户 A 的画布地址,拿到的是一张空白新画布、零提示,而库里多了一行
 * `Project` 和一行 `ActionEvent project.create`(`docs/audits/fullstack-staging-2026-09-11/`
 * 的 `run-ledger.md` §R2-19 与 `backend-evidence.md` §5.2 逐格坐实)。没有越权读,但有一次
 * 没人要的写入,而且屏幕上没有一个字告诉商家他打开的不是他点的那张画布。
 *
 * 这一页把那条兜底路换成一句话:不改写地址、不建任何东西、说明白发生了什么、给两条出路。
 *
 * **措辞为什么是「或」**:服务器分不清这三种情形 —— 别的租户的画布、自己已删的画布、
 * 打错的地址。分得清就要跨租户读一次,而那恰恰是隔离不许做的事。所以句子说得出的只有
 * 「这条链接在你的 workspace 里打不开」加一句诚实的可能性,不冒充精确。
 *
 * 纯 markup、零 client hook、零 DB —— server component 直接 return 它即可。
 */

/** 这一页的商家可见文案,单源(global 法 §7.3):组件与测试读同一份。 */
export const CANVAS_DEEP_LINK_REFUSAL_COPY = {
  heading: "This canvas isn't in your workspace",
  body:
    "This link belongs to a different workspace, or the canvas was deleted. " +
    "Nothing was opened and nothing was created for you.",
  primaryAction: "Go to your canvas",
  secondaryAction: "Back to Create",
} as const;

export function CanvasDeepLinkRefused() {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <section
        data-testid="canvas-deep-link-refused"
        className="mx-auto max-w-xl rounded-[var(--radius-card)] border border-border bg-card p-6 shadow-[var(--shadow-sm)] sm:p-8"
      >
        <span className="grid size-11 place-items-center rounded-xl bg-error-soft text-destructive">
          <ShieldAlert className="size-5" />
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {PRODUCT_VOCABULARY.canvas}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {CANVAS_DEEP_LINK_REFUSAL_COPY.heading}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {CANVAS_DEEP_LINK_REFUSAL_COPY.body}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={CANVAS_HREF}>{CANVAS_DEEP_LINK_REFUSAL_COPY.primaryAction}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={CREATE_NAV_HREF}>{CANVAS_DEEP_LINK_REFUSAL_COPY.secondaryAction}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
