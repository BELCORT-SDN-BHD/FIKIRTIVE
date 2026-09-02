import { notFound } from "next/navigation";

/**
 * FRONT-A12 —— 评审夹具路由的生产构建守卫。
 *
 * `/product-patterns/*` 与 `/design-system/*` 是设计走查的样张页:它们渲染写死的夹具数据,
 * 不经 `requireOwner()`、也不属于任何租户。规格 §1 九问 2 把它们排除在商家入口之外,
 * A12 的判定是「用生产构建访问不可达」—— 生产里可达,等于商家面上出现夹具数据。
 *
 * 每个夹具页把它作为组件的第一句调用;dev 与评审构建照常渲染。
 */
export function assertReviewFixtureRoute(): void {
  if (process.env.NODE_ENV === "production") notFound();
}
