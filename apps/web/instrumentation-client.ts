/**
 * 浏览器端 instrumentation(#793 — 上线债#1「仪表盘点亮」).
 *
 * Next.js 在应用 hydrate 之前执行这个文件。它是浏览器崩溃唯一的入口:在这之前,server
 * 侧 instrumentation.ts 只看得见服务端抛出来的错,商家那边白屏、点击没反应、组件在渲染
 * 里炸掉 —— 一条都传不回来。
 *
 * 没配 NEXT_PUBLIC_SENTRY_DSN 就完全不 init(本地与 CI 因此零副作用),与服务端
 * instrumentation.ts 的既有约定一致。判据在 lib/sentry-browser.ts,那边可以被单测穷举。
 *
 * 注意:这里 **不改 next.config**(不接 withSentryConfig)。那条路要在构建期把 source map
 * 传给外部服务,需要一枚构建期凭据 —— 属于生产侧动作,写进 docs/ops/dashboards.md 的残留
 * 清单交 Founder 窗口决定。没有它照样收得到事件,只是堆栈是压缩后的。
 */
import * as Sentry from "@sentry/nextjs";
import { browserSentryOptions } from "@/lib/sentry-browser";

// process.env.NEXT_PUBLIC_* 必须在这里字面出现,Next 才会在构建时把值内联进浏览器包。
const options = browserSentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NODE_ENV);
if (options) Sentry.init(options);

/** Next.js 在每次客户端路由切换开始时调用它。没 init 时是 no-op。 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
