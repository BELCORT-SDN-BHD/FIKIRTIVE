// Positive class: queue send after a consumed authenticated principal.
import { requireOwner } from "../support/auth-guard";
import { getBoss } from "../support/queue";

export async function ok() {
  const principal = await requireOwner();
  if ("error" in principal) return principal;
  const boss = await getBoss();
  return boss.send("job", { ownerId: principal.ownerId });
}
