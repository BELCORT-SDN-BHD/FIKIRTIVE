"use client";

/** 沉浸式 · 收件箱 /conversation —— 一条线程全文,连回客户档案。 */

import { Suspense } from "react";
import { InboxConversation } from "@/components/northstar/immersive/crm-inbox/inbox-conversation";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InboxConversation />
    </Suspense>
  );
}
