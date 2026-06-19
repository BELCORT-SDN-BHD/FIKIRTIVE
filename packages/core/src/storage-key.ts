/**
 * Object storage addressing (design doc D14 + D19):
 *   key = u/<owner_id>/<sha256-hex>.<ext>
 * Owner namespace prevents cross-user hash probing; the DB never stores
 * bucket paths, only content hashes — keys are always derived.
 */
// DO NOT CHANGE: the founder org is seeded with id === this literal, and it is baked
// into every R2 key (u/founder/<hash>). Changing it orphans every stored blob. A test
// in storage-key.test.ts fails if this value ever drifts.
export const FOUNDER_OWNER_ID = "founder";

const HEX_64 = /^[0-9a-f]{64}$/;
const SAFE_EXT = /^[0-9a-z]{1,8}$/;

export function storageKey(ownerId: string, contentHash: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  const cleanHash = contentHash.toLowerCase(); // some client hash libs emit uppercase hex
  if (!HEX_64.test(cleanHash)) throw new Error(`invalid content hash: ${contentHash.slice(0, 16)}…`);
  if (!SAFE_EXT.test(cleanExt)) throw new Error(`invalid extension: ${ext}`);
  if (!ownerId || /[^0-9A-Za-z_-]/.test(ownerId)) throw new Error(`invalid owner id: ${ownerId}`);
  return `u/${ownerId}/${cleanHash}.${cleanExt}`;
}

export function parseStorageKey(key: string): { ownerId: string; contentHash: string; ext: string } {
  const m = key.match(/^u\/([0-9A-Za-z_-]+)\/([0-9a-f]{64})\.([0-9a-z]{1,8})$/);
  if (!m) throw new Error(`not an artlio storage key: ${key}`);
  return { ownerId: m[1]!, contentHash: m[2]!, ext: m[3]! };
}

/** True iff `key` is a well-formed storage key whose owner namespace === `ownerId`.
 *  The single cross-tenant guard for serving/resolving content-addressed blobs:
 *  a forged or guessed key for another owner returns false. Never throws. */
export function keyOwnerMatches(key: string, ownerId: string): boolean {
  try {
    return parseStorageKey(key).ownerId === ownerId;
  } catch {
    return false;
  }
}
