// Positive class: an anonymous direct default callback has no provider binding to reassign.
"use server";

import toOwnedRowDto from "../support/aliased-imported-callbacks";
import { requireOwner } from "../support/auth-guard";
import { loadOwnedRow, loadOwnedRows } from "../support/imported-owned-query";

export async function listOwnedRowsThroughAnonymousImportedDto() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await loadOwnedRows(gate.ownerId);
  const dtos = rows.map(toOwnedRowDto);
  return loadOwnedRow(gate.ownerId, dtos[0]?.id);
}
