/**
 * 前端基线合并(FRONT-A12 同批):设计系统的 pattern 夹具直接 `import x from "./assets/x.png"`,
 * 而这些模块的类型只住在 Next 自己生成的 `next-env.d.ts` 里 —— 那份文件在 `.gitignore` 里,
 * 只有跑过 `next build` / `next dev` 的工作树才有它。
 *
 * 于是 CI 的 typecheck 腿(它不先 build)在这些 PNG import 上报 17 条 TS2307,而同一份代码
 * 在开发者本机(build 过)是绿的 —— 一条只在 CI 上出现的红,最容易被当成噪音忽略掉。
 * 这一行把 Next 的静态资源类型显式挂进 tsconfig 的 include 面,build 与否结果都一样。
 */
/// <reference types="next/image-types/global" />
