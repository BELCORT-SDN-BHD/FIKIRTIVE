"use client";

/**
 * 沉浸式 · 全局 /search —— 一块干净的命令面板占满内容 pane(不是画廊的双演示 + DemoFrame)。
 * 复用 global 的 NS_SEARCH_ITEMS 语料;选中即在沉浸式路由间跳转(见 ImmersiveSearch 注释)。
 */

import { ImmersiveSearch } from "@/components/northstar/immersive/misc/immersive-search";

export default function Page() {
  return <ImmersiveSearch />;
}
