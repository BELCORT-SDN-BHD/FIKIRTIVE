/**
 * `globalThis.AsyncLocalStorage` —— 每个测试文件都重新钉一次(R22 分诊)。
 *
 * 为什么需要:Next 只在 `next/dist/server/node-environment-baseline.js` 里给
 * `globalThis` 装过一次 `AsyncLocalStorage`,而 `next/dist/server/app-render/
 * async-local-storage.js` 在**模块求值那一刻**把它抄进模块级常量
 * (`const maybeGlobalAsyncLocalStorage = ... && globalThis.AsyncLocalStorage`);
 * 抄到 falsy,这个模块此后一辈子发的都是 `FakeAsyncLocalStorage`,`run()` 直接抛
 * 「AsyncLocalStorage accessed in runtime where it is not available」。
 *
 * 本 app 的 vitest 是 `pool: "threads"` + `singleThread`(见 vitest.config.ts 的长注释:
 * 分线程实测更慢),所以 274 个文件共用同一个 worker 的 globalThis;其中 64 个带
 * `@vitest-environment jsdom` 的文件在跑完后由 jsdom 环境 teardown 把「这段窗口里新增的
 * 全局键」删掉 —— baseline 那次赋值如果正好落在某个 jsdom 窗口内,它就被一起删了,而
 * 模块已缓存、不会再跑第二次。于是后面第一个求值 async-local-storage.js 的 node 环境文件
 * 抄到 undefined,钱路那几支(otto-actions / stripe-webhook / schedule-approve-toctou /
 * balance-refresh / resend-adapter / schedule-actions)就随文件顺序随机变红。
 *
 * 修法不是去猜谁先跑:setupFiles 对**每一个**测试文件、**两种**环境都会执行一次,在这里
 * 无条件把真的 `AsyncLocalStorage` 补回全局,顺序问题就不存在了。`??=` 保证不覆盖 Next
 * 自己(或任何一个更早的 setup)已经装好的那一份。
 */
import { AsyncLocalStorage } from "node:async_hooks";

(globalThis as typeof globalThis & { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
  AsyncLocalStorage;
