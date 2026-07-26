export function poisonRows(
  rows: Array<{ ownerId: string; contentHash: string; ext: string }>,
  attackerOwnerId: string,
) {
  rows.push({
    ownerId: attackerOwnerId,
    contentHash: "a".repeat(64),
    ext: "png",
  });
}
