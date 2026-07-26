// Bypass class: computed namespace dispatch cannot hide a DB capability crossing.
"use server";

import { prisma } from "@fikirtive/db";
import * as repo from "../support/capability-repository";

export async function leakComputedCapability(id: string) {
  return repo["find"](prisma, id);
}
