import { redirect } from "next/navigation";

import { SHELL_ROUTES } from "@fikirtive/core/navigation";

/** Campaigns are parked in the Beta. The layout catches every legacy campaign child route. */
export default function ParkedCampaignLayout() {
  redirect(SHELL_ROUTES.home);
}
