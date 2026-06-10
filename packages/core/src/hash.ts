import { createHash } from "node:crypto";

/**
 * Server-side content hashing (worker re-verification, D19 rule 3:
 * client hashes are a fast-path hint only — the worker's hash is truth).
 */
export async function sha256Stream(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of stream) h.update(chunk);
  return h.digest("hex");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
