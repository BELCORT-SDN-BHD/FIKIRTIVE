export const MARKETING_HOME_COPY = {
  partialTitle: "Meta ads is reporting",
  partialLabel: "Partial view",
  partialDescription:
    "This view only includes facts available from Meta ads. Connect the rest of your marketing sources for full marketing health.",
  notConfiguredTitle: "Connect marketing data to see your health",
  notConfiguredDescription:
    "Home needs at least one supported marketing connection before it can show performance.",
  reconnectTitle: "Reconnect Meta ads to refresh Home",
  reconnectDescription:
    "Your existing Meta connection needs attention before Fikirtive can read current performance.",
  insufficientTitle: "Not enough evidence yet",
  insufficientDescription:
    "Meta ads is connected, but this period does not include enough data for a useful summary.",
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
