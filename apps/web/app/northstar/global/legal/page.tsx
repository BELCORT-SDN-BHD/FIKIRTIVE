/* @nsPage district="全局横切" page="legal" status="draft"
   sources="现有路由(apps/web/app/privacy 等)" approvedAt="" pr="" */

/**
 * 法务页 — #615 Founder 裁决(2026-08-02):壳内假法务副本退场,一行跳转真法务页。
 * 真文本住在 /privacy(页内可达 /terms 与 /legal/data-deletion);壳不再自带会过期的分叉副本。
 */

import { redirect } from "next/navigation";

export default function Page() {
  redirect("/privacy");
}
