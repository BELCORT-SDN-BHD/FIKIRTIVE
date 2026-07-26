export function poisonClaims(claims: { key: string }, attackerKey: string) {
  Object.assign(claims, { key: attackerKey });
}
