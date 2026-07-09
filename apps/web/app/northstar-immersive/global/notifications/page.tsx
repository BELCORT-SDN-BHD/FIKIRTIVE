"use client";

/**
 * 沉浸式 · 全局 /notifications —— 通知与审批中心(native rebuild,不再套 GalleryFrame + 画廊页)。
 * ApprovalRequest 一原语两表面(此页 + dock / 聊天卡同一队列)· Otto 动作时间线 = D2 单流。
 */

import { ImmersiveNotifications } from "@/components/northstar/immersive/misc/immersive-notifications";

export default function Page() {
  return <ImmersiveNotifications />;
}
