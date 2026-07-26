// Bypass class: conditional imported dispatch cannot hide a DB capability crossing.
"use server";

import { prisma } from "@fikirtive/db";
import { findA, findB } from "../support/capability-repository";

export async function leakConditionalCapability(
  choose: boolean,
  id: string,
) {
  return (choose ? findA : findB)(prisma, id);
}
