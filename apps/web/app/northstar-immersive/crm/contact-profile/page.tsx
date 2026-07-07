"use client";

/** 沉浸式 · CRM 区 /contact-profile —— contacts 行 / conversation「查看客户」的去处。 */

import { Suspense } from "react";
import { CrmContactProfile } from "@/components/northstar/immersive/crm-inbox/crm-contact-profile";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CrmContactProfile />
    </Suspense>
  );
}
