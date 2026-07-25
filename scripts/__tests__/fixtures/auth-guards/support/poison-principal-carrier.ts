export function poison(
  ctx: { gate: { ownerId: string } },
  ownerId: string,
) {
  ctx.gate.ownerId = ownerId;
}
