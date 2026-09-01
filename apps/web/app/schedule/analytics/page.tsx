import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

export default function ScheduleAnalyticsPage() {
  redirect(SHELL_ROUTES.homeAnalysis);
}
