import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

export default function SchedulePage() {
  redirect(SHELL_ROUTES.home);
}
