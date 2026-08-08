/**
 * provider-secrecy — the ONE place that turns a trade-secret provider/model name into
 * "generation provider".
 *
 * Founder standing order: Seedance / Seedream and the model behind Otto are exclusive and
 * confidential — a merchant must never be told which engine made their image, their video,
 * or this sentence. Until #791 that rule was enforced on exactly one path (a persisted job
 * error, apps/worker/src/redact.ts) and on no other: Otto itself, which talks to merchants
 * all day and knows the names (its own prompt skills are called seedreamPrompt /
 * seedancePrompt), had nothing between its mouth and the merchant but an instruction.
 *
 * This module is that something. It lives in core because both the worker (error strings)
 * and the web app (Otto's reply text, streamed and persisted) must scrub identically —
 * two regexes would mean two definitions of "secret".
 */

/** Names that must never reach a merchant, in the shapes they actually appear in
 *  (bare, versioned, suffixed with provider/client/error, or preceded by "model"/"api"). */
const PROVIDER_NAME_RE =
  /\b(?:seedance|seedream|byteplus|bytedance|jimeng)(?:(?:provider|client|error)\b|(?:[./:_-][a-z0-9][a-z0-9./:_-]*)?\b(?:[ \t]+\d+(?:\.\d+)*(?:[ \t]+fast)?)?)|\bfal(?:provider|client|error|[./:_-][a-z0-9][a-z0-9./:_-]*)?\b|即梦|\b(?:claude|anthropic)(?:(?:as|via)?(?:api|sdk|model|provider|error|version)\b|(?:[-_./0-9][a-z0-9./:_-]*)\b)|\b(?:claude|anthropic)\b(?=(?:[ \t]+[a-z0-9'-]+)?[ \t]+(?:api|sdk|model|provider|error|version)\b)|(\b(?:api|sdk|model|provider|error|version)\b(?:[ \t]+[a-z0-9'-]+)?[ \t]+)(?:claude|anthropic)\b/giu;

/** Longest text the pattern above can span. The streaming filter holds back at least this
 *  much, so a name split across two deltas can never slip out one half at a time. */
const MAX_MATCH_SPAN = 64;

/** Replace trade-secret provider/model names while keeping the surrounding text useful. */
export function redactProviderNames(s: string): string {
  return s
    .replace(
      new RegExp(PROVIDER_NAME_RE.source, PROVIDER_NAME_RE.flags),
      (_match, leadingContext: string | undefined) => `${leadingContext ?? ""}generation provider`,
    )
    .replace(/\bgeneration provider(?:\s+generation provider)+\b/gi, "generation provider");
}

/**
 * Streaming variant: feed it the text deltas as they arrive, emit what is safe to show.
 *
 * A name arriving as "seed" + "ance" would defeat a per-delta `redactProviderNames`, and a
 * filter that only cleans the PERSISTED copy would let the merchant watch the secret stream
 * in and then vanish on reload — worse than not filtering. So this holds back the tail:
 * everything up to the last position no in-flight match can reach is scrubbed and emitted,
 * the rest waits for the next delta. `flush()` scrubs and releases whatever is left.
 *
 * Output is byte-identical to `redactProviderNames(wholeText)` re-assembled.
 */
export function createProviderNameFilter(): { push(delta: string): string; flush(): string } {
  let buffer = "";
  return {
    push(delta: string): string {
      buffer += delta;
      if (buffer.length <= MAX_MATCH_SPAN) return "";
      let safeEnd = buffer.length - MAX_MATCH_SPAN;
      // Never cut through a match in progress: if one straddles the boundary, hold from
      // its start instead, so the whole name is scrubbed together on a later push/flush.
      const re = new RegExp(PROVIDER_NAME_RE.source, PROVIDER_NAME_RE.flags);
      for (let m = re.exec(buffer); m !== null; m = re.exec(buffer)) {
        if (m.index < safeEnd && m.index + m[0].length > safeEnd) safeEnd = m.index;
        if (m.index >= safeEnd) break;
      }
      if (safeEnd <= 0) return "";
      const out = redactProviderNames(buffer.slice(0, safeEnd));
      buffer = buffer.slice(safeEnd);
      return out;
    },
    flush(): string {
      const out = redactProviderNames(buffer);
      buffer = "";
      return out;
    },
  };
}
