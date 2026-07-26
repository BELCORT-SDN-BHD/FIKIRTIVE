export function toOwnedRowDto(row: { id: string }) {
  return { id: row.id };
}

export function mutatePrincipal(principal: { ownerId: string }) {
  principal.ownerId = "attacker-controlled";
}

export function makeMutatingCallback(row: { id: string }) {
  return (id: string) => {
    row.id = id;
  };
}
