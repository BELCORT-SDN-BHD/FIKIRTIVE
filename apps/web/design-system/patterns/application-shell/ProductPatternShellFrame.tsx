"use client"

import type { ReactNode } from "react"

import { MerchantShellFrame } from "@/components/global-navigation"
import type { RailAccount } from "@/components/navigation/rail/NavigationRail"
import navigationContract from "@/design-system/information-architecture/navigation-contract.json"
import { BRAND_REVIEW_HREF } from "@/design-system/patterns/brand/review-links"
import {
  CREATE_WORKSPACE_REVIEW_HREF,
} from "@/design-system/patterns/canvas/review-links"
import { FOUNDER_HOME_REVIEW_HREF } from "@/design-system/patterns/founder-home/review-links"
import { LIBRARY_REVIEW_HREF } from "@/design-system/patterns/library/review-links"
import {
  SETTINGS_REVIEW_HREF,
  settingsSectionReviewHref,
} from "@/design-system/patterns/settings/review-links"

import { REVIEW_ACCOUNT } from "./review-account"

const REVIEW_NAVIGATION_HREFS = {
  home: FOUNDER_HOME_REVIEW_HREF,
  create: CREATE_WORKSPACE_REVIEW_HREF,
  library: LIBRARY_REVIEW_HREF,
  brand: BRAND_REVIEW_HREF,
  settings: SETTINGS_REVIEW_HREF,
} as const

export function ProductPatternShellFrame({
  children,
  pathname,
  topBarLabel,
  account = REVIEW_ACCOUNT,
}: {
  children: ReactNode
  pathname: string
  topBarLabel?: string
  account?: RailAccount
}) {
  return (
    <MerchantShellFrame
      pathname={pathname}
      account={account}
      visibleTopLevelNavigationKeys={navigationContract.activeMainNavigationKeys}
      flattenedNavigationGroupKeys={["settings"]}
      navigationHrefOverrides={REVIEW_NAVIGATION_HREFS}
      profileHref={settingsSectionReviewHref("profile")}
      creditsHref={settingsSectionReviewHref("billing")}
      showSignOutAction={false}
      topBarLabel={topBarLabel}
      signOutAction={async () => {}}
    >
      {children}
    </MerchantShellFrame>
  )
}
