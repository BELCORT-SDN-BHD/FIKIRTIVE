import { redirect } from "next/navigation";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";

export default function LibraryEditorPage() {
  redirect(SHELL_ROUTES.create);
}
