// Bypass class: a tracked DB client passed across the depth boundary must fail closed.
import { prisma } from "@fikirtive/db";
import { depthClientOne } from "../support/depth-client-one";

export function leak() {
  return depthClientOne(prisma);
}
