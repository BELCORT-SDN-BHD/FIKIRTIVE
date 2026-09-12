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

/**
 * 这一页的商家可见文案,单源(global 法 §7.3):组件与测试读同一份。
 *
 * 拆成 `project` / `thread` 两组(判官 P1-1,PR #1414)——被拒的地址有两种范围:整张画布
 * (`?project=`)与一条对话(`?thread=`)。两组共用 project 那句话会说假话:商家自己的画布 P
 * 配一条伪造/别家的 thread id,拒绝页却说「This canvas isn't in your workspace」——指控的是
 * 他自己那张、确实在他 workspace 里的画布,而他真正点的那条对话才是打不开的那个。
 * `thread` 组换成说一条对话被拒,`project` 组原文不动(向后兼容)。
 *
 * 两组仍然是同一张页面、同一套「或」的措辞、同样不区分「属于别人 / 已经删除」——那道模糊
 * 防的是同一条扫链攻击面(逐一探测 id 换回不同错误就能反推哪些存在),见组件上方与文件头
 * 的原因说明,两组不例外。
 */
export const CANVAS_DEEP_LINK_REFUSAL_COPY = {
  project: {
    heading: "This canvas isn't in your workspace",
    body:
      "This link belongs to a different workspace, or the canvas was deleted. " +
      "Nothing was opened and nothing was created for you.",
    primaryAction: "Go to your canvas",
    secondaryAction: "Back to Create",
  },
  thread: {
    heading: "We can't open this conversation in your workspace",
    body:
      "This conversation belongs to a different workspace, or it's been deleted. " +
      "Nothing was opened and nothing was created for you.",
    primaryAction: "Go to your canvas",
    secondaryAction: "Back to Create",
  },
} as const;

export type CanvasDeepLinkRefusalVariant = keyof typeof CANVAS_DEEP_LINK_REFUSAL_COPY;

export function CanvasDeepLinkRefused({
  variant = "project",
}: {
  variant?: CanvasDeepLinkRefusalVariant;
}) {
  const copy = CANVAS_DEEP_LINK_REFUSAL_COPY[variant];
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
          {copy.heading}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {copy.body}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={CANVAS_HREF}>{copy.primaryAction}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href={CREATE_NAV_HREF}>{copy.secondaryAction}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
