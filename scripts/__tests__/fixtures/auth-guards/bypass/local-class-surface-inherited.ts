// Bypass class: an inherited class member lives in another declaration and stays unprovable.
"use server";

import { prisma } from "@fikirtive/db";
import { find } from "../support/capability-repository";

declare class Base {}

class Service extends Base {
  run(db: typeof prisma, assetId: string) {
    return find(db, assetId);
  }
}

export async function leakViaInheritedSurface(id: string) {
  return new Service().run(prisma, id);
}
