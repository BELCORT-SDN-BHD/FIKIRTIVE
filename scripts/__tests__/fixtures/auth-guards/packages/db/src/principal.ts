// Fixture stand-in for the real packages/db/src/principal.ts: the transparent frame
// runners the fence models as `fn()`. Pure carrier — no DB, storage or queue access.
import { AsyncLocalStorage } from "node:async_hooks";

type Principal = { kind: "user"; ownerId: string };

const store = new AsyncLocalStorage<Principal>();

export function runAsUser<T>(principal: Principal, fn: () => T): T {
  return store.run(Object.freeze({ ...principal }), fn);
}

export function runAsTenant<T>(ownerId: string, fn: () => T): T {
  return store.run(Object.freeze({ kind: "user" as const, ownerId }), fn);
}
