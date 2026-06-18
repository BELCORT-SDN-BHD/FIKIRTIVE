import { redirect } from "next/navigation";

// /admin has no content of its own — send it to the first live section. The
// admin layout's allowlist gate wraps this page too, so the redirect is gated.
export default function AdminIndexPage() {
  redirect("/admin/settings");
}
