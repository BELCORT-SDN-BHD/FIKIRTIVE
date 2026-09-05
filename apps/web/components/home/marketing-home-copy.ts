export const MARKETING_HOME_COPY = {
  partialTitle: "Meta ads is reporting",
  partialLabel: "Partial view",
  partialDescription:
    "This view only includes facts available from Meta ads. Connect the rest of your marketing sources for full marketing health.",
  notConfiguredTitle: "Connect marketing data to see your health",
  // Codex 全 beta 审计 P1-011 说的正是这一句:旧文案写「至少一个受支持的营销连接」,而
  // Connections 页把 Instagram / Facebook 摆成社交发布渠道 —— 商家读完不知道该点哪一行。
  // 这两行走的就是 Home 读的那条 Meta 连接(`lib/meta-insights.ts` 的 `MetaConnection`),
  // 所以这里直接点名它们。
  notConfiguredDescription:
    "Home reads performance from your Meta ad accounts. Connect Instagram or Facebook in Connections to see your own numbers here.",
  // 连上了,可这个 Meta 登录名下一个广告账号都没有(判官 2026-09-05 P1-1)。只为发帖连了
  // Instagram／Facebook 的商家就是这一种;对他们说「数据不够、换 90 天」是把人引向一个
  // 换到底也救不了的动作。这里说的是真话:Home 看的是广告表现,而这个登录名下没有广告。
  noAdAccountsTitle: "This Meta login has no ad accounts yet",
  noAdAccountsDescription:
    "Home shows ad performance, so connect a Meta account that runs ads.",
  reconnectTitle: "Reconnect Meta ads to refresh Home",
  reconnectDescription:
    "Your existing Meta connection needs attention before Fikirtive can read current performance.",
  insufficientTitle: "Not enough evidence yet",
  // 「零」有三种,商家要分得出来:读不到(unavailable)、压根没有广告账号(上面那一条)、
  // 有账号但这段期间没跑(这一条)。走到这里时「有广告账号」已经成立,所以「换个更宽的
  // 期间」是一个真的可能帮上忙的动作,而不是一句敷衍。
  insufficientDescription:
    "Meta ads is connected, but your ad accounts reported no delivery in this period. Nothing has run yet, or it happened outside these dates.",
  unavailableTitle: "Marketing data is temporarily unavailable",
  unavailableDescription:
    "Your existing data is safe. Try the read again without changing your Home filters.",
  recentsTitle: "Continue creating",
  recentsDescription: "Pick up a recent canvas, or start from a fresh outcome.",
  recentsUnreadable: "Recent canvases could not be read just now.",
  analysis: {
    reconnectTitle: "Reconnect Meta ads to continue",
    connectTitle: "Connect a marketing source first",
    setupDescription:
      "This analysis needs live source data. It will not substitute sample metrics or an inferred conclusion.",
    insufficientTitle: "Not enough evidence yet",
    insufficientDescription:
      "This period does not include enough Meta data for a reliable explanation.",
    unavailableTitle: "We couldn't refresh this analysis",
    unavailableDescription:
      "Your saved data is safe. Retry the current read, or return Home without changing its filters.",
    partialDataHealthTitle: "Meta ads is the only reporting source",
    partialPerformanceTitle: "Meta ads changed during this period",
    limitedCoverageTitle: "Limited source coverage",
    limitedCoverageDescription: (period: string, freshness: string) =>
      `This explanation uses Meta ads only for the selected ${period}. It does not claim revenue impact or cross-channel attribution. ${freshness}.`,
    partialMeaningFallback: "Meta ads supplied observable activity for this period.",
    partialMeaningBoundary:
      "Add another supported source before using this as a complete marketing-health conclusion.",
  },
} as const;
