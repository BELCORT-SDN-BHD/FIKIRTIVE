import { redirect } from "next/navigation";

/** Otto is the product and the single front door. The root launches straight into
 *  it; Otto resolves its own default project, so no ?p threading is needed.
 *  (Legacy /studio was deleted — /otto is the only surface.) */
export default async function Page() {
  redirect("/otto");
}
