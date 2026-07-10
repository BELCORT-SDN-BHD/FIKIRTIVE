// AES-256-GCM Meta-token encryption now lives in the shared @fikirtive/token-crypto package
// so the publish worker (L1) can decrypt page tokens without reverse-importing apps/web/lib.
// Re-exported here to keep every existing web importer (`./token-encryption`) unchanged.
export { encryptToken, decryptToken } from "@fikirtive/token-crypto";
