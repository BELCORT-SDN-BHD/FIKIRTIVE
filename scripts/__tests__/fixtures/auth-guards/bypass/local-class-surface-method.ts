// Bypass class: a local class instance method is an ordinary repository shape, not an escape hatch.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

class Service {
  run(db: typeof prisma, assetId: string) {
    return find(db, assetId);
  }
}

export async function leakViaLocalClass(id: string) {
  const service = new Service();
  return service.run(prisma, id);
}
