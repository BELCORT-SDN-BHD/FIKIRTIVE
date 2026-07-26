// Bypass class: an array mutator cannot hide a DB capability in an indexed carrier.
"use server";

import { prisma } from "@fikirtive/db";
import { runLocalDbCarrier } from "../support/local-db-carrier-runner";

export async function leakThroughArrayPush(id: string) {
  const carriers: any[] = [];
  carriers.push(prisma);
  return runLocalDbCarrier(carriers[0], id);
}
