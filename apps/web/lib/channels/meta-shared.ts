import type { ConnectionStatus } from "./types";
import { getMetaConnection } from "../meta-actions";

export async function metaStatus(): Promise<ConnectionStatus> {
  const c = await getMetaConnection();
  if ("error" in c || !c.connected) return "not_connected";
  return c.needsReconnect || c.status === "expired" ? "needs_reconnect" : "connected";
}

export const notImpl = () => { throw new Error("not implemented (filled by the Schedule/Analytics plan)"); };
