// Bypass class: a DB capability cannot disappear inside a nested carrier at the depth bound.

import { prisma } from "@fikirtive/db";
import { depthNestedClientOne } from "../support/depth-client-one";

export function leakNestedClient() {
  return depthNestedClientOne({ nested: { client: prisma } });
}
