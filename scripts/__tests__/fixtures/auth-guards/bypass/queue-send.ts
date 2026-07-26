// Bypass class: queue send occurs without an authenticated principal.
import { getBoss } from "../support/queue";

export async function leak() {
  const boss = await getBoss();
  return boss.send("job", {});
}
