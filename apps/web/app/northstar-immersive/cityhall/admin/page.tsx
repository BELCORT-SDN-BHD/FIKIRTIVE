"use client";

/**
 * 沉浸式 · 市政厅 /admin —— 内部运维台(设计降级,无 Otto、无 coral)。
 * gallery 里此页为 stub,内容照 account-ops 先例现建(见 CityhallAdmin 注释)。
 * 环境标识固定 `fikirtive-prod`(旧品牌前缀一律不出现)。
 */

import { CityhallAdmin } from "@/components/northstar/immersive/misc/cityhall-admin";

export default function Page() {
  return <CityhallAdmin />;
}
