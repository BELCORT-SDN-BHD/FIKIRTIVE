import { redirect } from "next/navigation";

/** The redesigned Studio is the product. The root launches straight into it
 *  (the old Workbench still lives at /library for fallback). */
export default function Page() {
  redirect("/studio");
}
