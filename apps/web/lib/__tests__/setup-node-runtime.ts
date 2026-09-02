/**
 * vitest setupFiles —— 把 Next 在 Node 里假定的那一个全局补回来。
 *
 * `next/dist/server/app-render/async-local-storage.js` 在**模块加载的那一刻**读一次
 * `globalThis.AsyncLocalStorage`:读得到就用真的,读不到就换成一个 `FakeAsyncLocalStorage`,
 * 而那个假件的 `run()` / `enterWith()` / `exit()` 一被调用就抛
 * `Invariant: AsyncLocalStorage accessed in runtime where it is not available`。
 *
 * 真正的 Next 服务端进程在 `next/dist/server/node-environment.js` 里把这个全局装好,所以线上
 * 永远读得到。vitest 不跑那段 bootstrap,于是同一份 Next 模块在测试里退化成会抛的假件 ——
 * 而它是**模块级一次性**求值的,同一条工作线程里谁先把它加载起来,后面所有文件就都跟着那个
 * 结果走。apps/web 的 vitest 是 `singleThread`(见 `vitest.config.ts`),459 个文件共用一条
 * 线程,所以这件事的结果**随文件顺序变**:同一棵树连跑几次,红的文件每次都不一样
 * (`stripe-webhook` / `resend-adapter` / `balance-refresh` / `otto-actions` /
 * `schedule-actions` / `schedule-approve-toctou` 这一家子,单跑全绿)。
 *
 * 这里做的事和 Next 自己的 bootstrap 一模一样:在任何测试文件加载之前,把 Node 真正的
 * `AsyncLocalStorage` 挂上去。已经有的不动(`??=`),所以不会盖掉任何真实运行时。
 */
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
