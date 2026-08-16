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
 *
 * ── #810: one filter, not two (the streaming/whole-text split) ────────────────────────────
 * The first cut of the streaming filter was a SECOND judgement of the same rule, and the two
 * disagreed in both directions:
 *   · it leaked — the pattern had unbounded quantifiers, so the 64-character tail it held back
 *     was shorter than the distance the pattern could actually reach, and a name could be
 *     released before the text that condemned it arrived;
 *   · it over-scrubbed — it sliced its buffer at an arbitrary offset and handed the regex a
 *     fresh string, so the cut itself manufactured a `\b` and turned a merchant's own compound
 *     word ("AAmyseedance") into "AAmygeneration provider".
 * Both are fixed by making one judgement, not two: every quantifier below is BOUNDED, so
 * MAX_MATCH_SPAN is a provable ceiling rather than a guess, and the streaming filter always
 * shows the regex the real preceding character instead of a fabricated string start.
 *
 * INVARIANT (asserted by property tests over arbitrary cut points):
 *   for ANY chunking of `text`, the streamed output is byte-identical to
 *   redactProviderNames(text).
 */

/** Names that must never reach a merchant, in the shapes they actually appear in
 *  (bare, versioned, suffixed with provider/client/error, or preceded by "model"/"api").
 *
 *  Every quantifier is bounded ON PURPOSE (#810 P1-3). `[a-z0-9./:_-]*` and `[ \t]+` used to
 *  be open-ended, which made the pattern's reach unknowable and the streaming hold-back a
 *  guess. The bounds are generous enough for every real shape ("seedance.pro/v2 3.1 fast",
 *  "model claude sonnet") and they buy a ceiling the streaming filter can be built on. The
 *  narrowing is deliberate and visible: a name separated from its technical context by a
 *  20+ character token, or by five spaces, is no longer read as a technical context — and
 *  now BOTH the whole-text and the streaming path read it the same way. */
const MAX_TOKEN = 20; // longest path/version-ish tail glued to a name: "seedance.pro/v2…"
const MAX_WORD = 20; // longest word allowed between "claude" and "api" ("claude sonnet api")
const MAX_GAP = 4; // longest run of spaces/tabs inside one match
const PROVIDER_NAME_RE = new RegExp(
  [
    // #905 — `modelark` (BytePlus's model-catalogue brand) and `dreamina` (the engine's own
    // consumer-facing name) join this group for the same reason `volcengine`/`prometheus` did
    // in #779: neither is a word in any language a merchant writes to us in, so both match bare
    // and both take the same optional version tail ("Dreamina 2.0", "modelark-v2").
    `\\b(?:seedance|seedream|byteplus|bytedance|jimeng|volcengine|volc|vmp|prometheus|modelark|dreamina)(?:(?:provider|client|error)\\b|(?:[./:_-][a-z0-9][a-z0-9./:_-]{0,${MAX_TOKEN}})?\\b(?:[ \\t]{1,${MAX_GAP}}\\d{1,4}(?:\\.\\d{1,4}){0,3}(?:[ \\t]{1,${MAX_GAP}}fast)?)?)`,
    `\\bfal(?:provider|client|error|[./:_-][a-z0-9./:_-]{0,${MAX_TOKEN}})?\\b`,
    `即梦`,
    // #779 judge r1, P2-1 — the OBSERVABILITY side of the same supplier. Its metrics workspace,
    // its console and its metrics dialect all name it, and none of those names were here: an
    // upstream string reading "Volcengine quota exceeded" passed through untouched.
    //
    // Split by the file's existing rule, not by convenience. `volcengine`, `volc`, `vmp` and
    // `prometheus` are not words in any language a merchant writes to us in, so they match bare
    // — `fal` above already settles that a three-letter bare token is acceptable here. `ark`
    // IS an ordinary English word, so it gets the `whisper` treatment: technical shapes only,
    // never bare, so a merchant selling an ark is left alone.
    //
    // This is the SECOND layer, not the defence. `apps/web/lib/queue-observability.ts` renders
    // upstream text nowhere at all — it classifies into a closed vocabulary — precisely because
    // a deny list is only as good as the last name someone remembered to add to it.
    `\\bark(?:(?:provider|client|error|api|sdk|model)\\b|[-._/:][a-z0-9][a-z0-9./:_-]{0,${MAX_TOKEN}}\\b)`,
    // #905 — the same supplier's English brand name, spelled out as two ordinary words.
    // `volcano` and `engine` are each common on their own (the near-miss test below keeps
    // "Volcano Hot Pot" legal), so only the exact adjacent phrase is matched — no bare
    // `volcano`, no bare `engine`.
    `\\bvolcano[ \\t]{1,${MAX_GAP}}engine\\b`,
    // #905 — `ark` bare is still an ordinary English word (Noah's ark, Ark Encounter), so the
    // glued shapes above (`ark-api-key`, `arkapi`) miss a merchant reading it back out loud:
    // "the Ark model", "using the Ark provider", "Ark API returned an error". Give it the exact
    // context rule `claude`/`anthropic` already use below — a nearby api/sdk/model/provider/
    // error/version word, not the bare word alone, is what earns a redaction.
    `\\bark\\b(?=(?:[ \\t]{1,${MAX_GAP}}[a-z0-9'-]{1,${MAX_WORD}})?[ \\t]{1,${MAX_GAP}}(?:api|sdk|model|provider|error|version)\\b)`,
    `(\\b(?:api|sdk|model|provider|error|version)\\b(?:[ \\t]{1,${MAX_GAP}}[a-z0-9'-]{1,${MAX_WORD}})?[ \\t]{1,${MAX_GAP}})ark\\b`,
    // #787 — the CAPTION engine and its model files. A merchant buys "Subtitles", not an
    // engine name, so these belong here with the rest.
    //
    // Deliberately NARROWER than the names above, and the narrowness is the point: "whisper"
    // is an ordinary English word a merchant may well be selling ("whisper-quiet fan"), so
    // only the shapes that are unambiguously the software are matched — never bare "whisper",
    // and no open-ended tail that would swallow "whisper-quiet". "ggml" is not a word in any
    // language, so it matches bare and with its model-file tail ("ggml-small.bin").
    `\\bwhisper(?:[-.]?cpp|-cli)\\b`,
    `\\bggml(?:[-_.][a-z0-9][a-z0-9./:_-]{0,${MAX_TOKEN}})?\\b`,
    `\\b(?:claude|anthropic)(?:(?:as|via)?(?:api|sdk|model|provider|error|version)\\b|(?:[-_./0-9][a-z0-9./:_-]{0,${MAX_TOKEN}})\\b)`,
    `\\b(?:claude|anthropic)\\b(?=(?:[ \\t]{1,${MAX_GAP}}[a-z0-9'-]{1,${MAX_WORD}})?[ \\t]{1,${MAX_GAP}}(?:api|sdk|model|provider|error|version)\\b)`,
    `(\\b(?:api|sdk|model|provider|error|version)\\b(?:[ \\t]{1,${MAX_GAP}}[a-z0-9'-]{1,${MAX_WORD}})?[ \\t]{1,${MAX_GAP}})(?:claude|anthropic)\\b`,
  ].join("|"),
  "giu",
);

/** What a redacted name reads as. Also a literal a merchant can type, which is why the
 *  streaming filter treats it as a boundary atom too (see below). */
const REDACTED = "generation provider";

/** Collapse a run of adjacent redactions back to one phrase. Bounded like everything else:
 *  a run bridged by more than MAX_GAP whitespace is not one phrase, it is two sentences. */
const REPEAT_RE = new RegExp(`\\b${REDACTED}(?:\\s{1,${MAX_GAP}}${REDACTED})+\\b`, "giu");

/** An already-redacted phrase sitting in the INPUT. Not a secret, but the collapse above can
 *  merge it with a neighbouring redaction, so the streaming filter must never split a run
 *  that contains one. */
const REDACTED_LITERAL_RE = new RegExp(`\\b${REDACTED}\\b`, "giu");

/**
 * The longest stretch of text any alternative above can DECIDE ON — its own match plus the
 * lookahead it consults plus the one character a trailing `\b` inspects. Bounded quantifiers
 * make this arithmetic, not a guess:
 *
 *   names        "volcengine"(10) + "[./:_-]x" + tail(20) = 23 + version/fast(4+4+15+4+4 = 31) → 63
 *   fal          "fal"(3) + "[./:_-]" + tail(20) = 24, + `\b`                                → 25
 *   ark (glued)  "ark"(3) + "[-._/:]x" + tail(20) = 25, + `\b`                               → 26
 *   volcano      "volcano"(7) + gap(4) + "engine"(6), + `\b`                                 → 17
 *   ark ahead    "ark"(3) + `\b` + gap(4) + word(20) + gap(4) + "provider"(8), + `\b`         → 39
 *   ark after    "provider"(8) + gap(4) + word(20) + gap(4) + "ark"(3), + `\b`                → 39
 *   whisper.cpp  "whisper"(7) + "-cpp"(4) = 11, + `\b`                                       → 12
 *   ggml         "ggml"(4) + "[-_.]x" + tail(20) = 26, + `\b`                                → 27
 *   claude-glued "anthropic"(9) + "[-_./0-9]" + tail(20) = 30, + `\b`                        → 31
 *   claude ahead "anthropic"(9) + gap(4) + word(20) + gap(4) + "provider"(8), + `\b`         → 46
 *   claude after "provider"(8) + gap(4) + word(20) + gap(4) + "anthropic"(9), + `\b`         → 46
 *
 * 63 < 64 — the ceiling moved from 62 when #779 added "volcengine"/"prometheus" (10 chars,
 * one longer than "bytedance") to the names group. #905 added "modelark"/"dreamina" (≤10
 * chars, no change) to the same group and the "volcano engine" / "ark" context rows above
 * (all ≤ 46) — none of it moves the ceiling past 63. The streaming filter holds back this much,
 * so a match is never judged on text it
 * has not seen yet — the property tests in provider-secrecy.test.ts assert the consequence
 * (streamed output === whole-text output) rather than trusting the arithmetic alone.
 */
const MAX_MATCH_SPAN = 64;

/**
 * "Is this a word character?" — asked with the SAME flags the pattern above is compiled with
 * (#810 r2 P2). Under `iu`, case folding makes U+212A (KELVIN SIGN) equal to "k" and U+017F
 * (LATIN SMALL LETTER LONG S) equal to "s", so `\b` treats both as word characters. A plain
 * `/\w/` disagrees — and the streaming filter used one to pick its stand-in, so "Kseedance"
 * (which the whole text leaves alone, there being no boundary) was scrubbed the moment a chunk
 * boundary landed after the K. Two readings of "word character" is the same class of bug as two
 * readings of "secret": whatever `\b` believes, this must believe.
 */
const WORD_CHAR_RE = /\w/iu;
const WHITESPACE_RE = /\s/u;

/** Replace trade-secret provider/model names while keeping the surrounding text useful. */
export function redactProviderNames(s: string): string {
  return s
    .replace(
      new RegExp(PROVIDER_NAME_RE.source, PROVIDER_NAME_RE.flags),
      (_match, leadingContext: string | undefined) => `${leadingContext ?? ""}${REDACTED}`,
    )
    .replace(REPEAT_RE, REDACTED);
}

/**
 * Half-open [start, end) source spans a release must never cut inside.
 *
 * Two kinds, merged into RUNS: a name the first pass rewrites, and an already-redacted phrase
 * a merchant typed themselves. Both end up reading "generation provider", so the repeat-collapse
 * can merge either with either — which means a run of them is ONE decision, and splitting it
 * would leave the two halves saying something the whole text never says.
 */
function boundaryRuns(text: string): { start: number; end: number; lastStart: number }[] {
  const atoms: { start: number; end: number }[] = [];
  for (const re of [PROVIDER_NAME_RE, REDACTED_LITERAL_RE]) {
    const scan = new RegExp(re.source, re.flags);
    for (let m = scan.exec(text); m !== null; m = scan.exec(text)) {
      if (m[0].length === 0) {
        scan.lastIndex++;
        continue;
      }
      atoms.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  atoms.sort((a, b) => a.start - b.start || a.end - b.end);
  const runs: { start: number; end: number; lastStart: number }[] = [];
  for (const a of atoms) {
    const last = runs[runs.length - 1];
    const joins =
      !!last && a.start <= last.end + MAX_GAP && /^\s*$/.test(text.slice(last.end, a.start));
    if (joins && last) {
      last.end = Math.max(last.end, a.end);
      last.lastStart = Math.max(last.lastStart, a.start);
    } else {
      runs.push({ start: a.start, end: a.end, lastStart: a.start });
    }
  }
  return runs;
}

/**
 * Streaming variant: feed it the text deltas as they arrive, emit what is safe to show.
 *
 * A name arriving as "seed" + "ance" would defeat a per-delta `redactProviderNames`, and a
 * filter that only cleans the PERSISTED copy would let the merchant watch the secret stream
 * in and then vanish on reload — worse than not filtering. So this holds back the tail.
 *
 * Two rules make the held tail's judgement identical to the whole text's (#810):
 *
 *   1. It never emits past `length - MAX_MATCH_SPAN`, and never through the middle of a match
 *      (or through a run of matches the repeat-collapse would merge). Every match it acts on
 *      is therefore already final — the text that would change it has arrived.
 *   2. It prepends a one-character STAND-IN for the last emitted character before scrubbing.
 *      `\b` only asks whether the neighbouring character is a word character, so a stand-in of
 *      the right class ("_" for a word character, " " for anything else) makes the held tail's
 *      first boundary read exactly as it reads in the whole text. Without it, the cut point
 *      invented a word boundary and scrubbed a merchant's own compound word. The stand-in —
 *      rather than the real character — is what keeps the trick honest: no alternative can
 *      begin with "_" or " ", so the prepended character always survives untouched and can be
 *      sliced back off, whereas a real "s" would let a match start inside the stand-in itself.
 *
 * `flush()` scrubs and releases whatever is left.
 *
 * Text and reasoning are two independent byte streams and each needs its OWN instance —
 * sharing one would interleave two texts inside a single hold-back buffer.
 */
export function createProviderNameFilter(): { push(delta: string): string; flush(): string } {
  /** Stand-in for the last emitted character ("" before anything has been emitted), kept only
   *  so the held tail's first word boundary is judged against the real text. */
  let prev = "";
  /** Source text not yet released. */
  let buffer = "";

  /** Same word/non-word class as `c`, but a character no alternative can start with. */
  const standIn = (c: string): string => (WORD_CHAR_RE.test(c) ? "_" : " ");

  /** How far into `buffer` it is safe to emit, or 0 for "nothing yet". */
  const safeEnd = (): number => {
    let end = buffer.length - MAX_MATCH_SPAN;
    if (end <= 0) return 0;
    // Never cut through the middle of a word. The released head is scrubbed as its own string,
    // and end-of-string is a word boundary — so a cut inside "false" would hand the pattern a
    // "fal" the real text never contains.
    while (end > 0 && WORD_CHAR_RE.test(buffer[end - 1]!) && WORD_CHAR_RE.test(buffer[end]!)) end--;
    if (end <= 0) return 0;
    // Scan with the left neighbour's stand-in in front, then translate back to buffer coordinates.
    const probe = prev + buffer;
    for (const run of boundaryRuns(probe)) {
      const start = run.start - prev.length;
      if (start >= end) break;
      const runEnd = run.end - prev.length;
      // A run protects two things past its own text: the LOOKAHEAD its last name is judged on
      // (bounded by MAX_MATCH_SPAN — "claude" is only a secret because of an "api" further
      // along, and the released head must carry that "api" or it would judge differently), and
      // the whitespace through which the repeat-collapse could still recruit a name that has
      // not arrived yet.
      let reach = run.lastStart - prev.length + MAX_MATCH_SPAN;
      for (let at = runEnd, i = 0; i < MAX_GAP && at < buffer.length && WHITESPACE_RE.test(buffer[at]!); i++, at++) {
        reach = Math.max(reach, at + 1);
      }
      if (reach >= end) return Math.max(start, 0);
    }
    return end;
  };

  const release = (upTo: number): string => {
    if (upTo <= 0) return "";
    const head = buffer.slice(0, upTo);
    // The stand-in cannot start any match, so it passes through and is sliced back off.
    const out = redactProviderNames(prev + head).slice(prev.length);
    prev = standIn(head.slice(-1));
    buffer = buffer.slice(upTo);
    return out;
  };

  return {
    push(delta: string): string {
      buffer += delta;
      return release(safeEnd());
    },
    flush(): string {
      return release(buffer.length);
    },
  };
}
