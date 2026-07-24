// Bypass class: raw SQL receiver is not named prisma.
export function leak(tx: unknown) {
  return tx.$queryRaw`SELECT 1`;
}
