// Positive class: a statically imported pure DTO callback preserves principal state.
"use server";

import { requireOwner } from "../support/auth-guard";
import { toOwnedRowDto } from "../support/imported-callbacks";
import { loadOwnedRow, loadOwnedRows } from "../support/imported-owned-query";

export async function listOwnedRowsThroughImportedDto() {
  const gate = await requireOwner();
  if ("error" in gate) return gate;
  const rows = await loadOwnedRows(gate.ownerId);
  const dtos = rows.map(toOwnedRowDto);
  return loadOwnedRow(gate.ownerId, dtos[0]?.id);
}
