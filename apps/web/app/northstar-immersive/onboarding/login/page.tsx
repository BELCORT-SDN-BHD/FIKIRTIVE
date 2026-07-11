"use client";

/**
 * 沉浸式 · Onboarding /login —— 设计降级入口卡(email 魔链演示,无 Otto、无 coral)。
 * gallery 里此页为 stub,内容照 account-ops 先例现建(见 OnboardingLogin 注释)。
 * CTA 进产品流:注册 → onboarding/checklist,登录 → create/home;法务尾注 → global/legal。
 */

import { OnboardingLogin } from "@/components/northstar/immersive/misc/onboarding-login";

export default function Page() {
  return <OnboardingLogin />;
}
