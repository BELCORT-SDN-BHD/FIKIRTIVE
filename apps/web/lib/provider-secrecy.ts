const URL_RE = /https?:\/\/[^\s'"`]+/gi;
const PROVIDER_NAME_RE =
  /(?:(?:seedance|seedream|byteplus|bytedance|jimeng|anthropic|claude)[a-z0-9]*(?:[./:_-][a-z0-9][a-z0-9./:_-]*)*(?:[ \t]+\d+(?:\.\d+)*(?:[ \t]+fast)?)?|\bfal(?:provider|client|error|[./:_-][a-z0-9][a-z0-9./:_-]*)?\b|即梦)/giu;

/** Browser-bound errors may describe the service, but never identify the underlying provider. */
export function redactProviderNames(value: string): string {
  return value
    .replace(PROVIDER_NAME_RE, "generation provider")
    .replace(/\bgeneration provider(?:\s+generation provider)+\b/gi, "generation provider");
}

/** Defense for old persisted rows as well as newly returned server-action errors. */
export function sanitizeUserError(value: unknown, max = 300): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return redactProviderNames(raw.replace(URL_RE, "<redacted-url>")).slice(0, max);
}
