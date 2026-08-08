# Decides whether a PR touches anything outside docs/.  (#809)
#
#   input      : slurped pages from GET /repos/{o}/{r}/pulls/{n}/files
#                (jq -s, so an array of the JSON array each page returned)
#   $pr        : slurped GET /repos/{o}/{r}/pulls/{n}  (--slurpfile, one object)
#   output     : exactly `true` (run every gate) or `false` (docs-only, skip)
#
# Everything is decided here, on parsed JSON, because five review rounds proved
# the alternative unworkable: each time a shell layer re-parsed projected text,
# some legal-but-unusual input punched through and produced a WRONG "false" — a
# green `quality` over unreviewed code. A real JSON parser has no such layer.
#
# The one rule that governs every branch below: any input that does not match
# the contract exactly yields `true`. Being wrong in that direction costs
# minutes of CI; being wrong the other way merges unreviewed code. Nothing here
# is "tolerant" — tolerance is how the previous five versions failed.

# The complete `status` vocabulary of the files endpoint. An unknown value means
# we are not reading what we think we are, so it is a contract violation rather
# than something to fall through to a default branch: "" , "bogus" and "RENAMED"
# all used to land on the non-rename path and skip the rename checks entirely.
def known_status:
  . == "added" or . == "removed" or . == "modified" or . == "renamed"
  or . == "copied" or . == "changed" or . == "unchanged";

# A usable path: a non-empty string whose every segment is a real name. Rejects
# "docs/" and "docs//a.md" (empty segments), "/docs/a.md" (empty leading
# segment), any "." or ".." segment, a segment that is nothing but whitespace,
# and any NUL byte. Git emits none of these, so their presence means the payload
# is not what we think it is.
#
# NUL specifically: it and "/" are the only two bytes a Git path cannot contain,
# so a NUL is proof the string did not come from Git. Other control characters
# are NOT rejected — a newline is a legal path byte, and "docs/we<LF>ird.md" is
# genuinely a docs file that must keep its short-circuit.
def path_ok:
  type == "string"
  and length > 0
  and (explode | any(. == 0) | not)
  and (split("/") | all(length > 0 and . != "." and . != ".." and test("[^[:space:]]")));

def is_docs:
  startswith("docs/");

# Every path an entry puts in play, or null when the entry breaks the contract.
# A rename is TWO paths: taking only `filename` is what let a code file rename
# itself into docs/ and skip every gate while deleting a real code path.
def entry_paths:
  . as $e
  | if ($e | type) != "object" then null
    elif ($e | has("filename") | not) or ($e.filename | path_ok | not) then null
    elif ($e | has("status") | not) or ($e.status | type) != "string" then null
    elif ($e.status | known_status | not) then null
    elif $e.status == "renamed" or $e.status == "copied" then
      # The old name is mandatory here, and must be a real path. `false`, null,
      # a number, "" or an absent key are contract violations, never "no rename".
      (if ($e | has("previous_filename")) and ($e.previous_filename | path_ok)
       then [$e.filename, $e.previous_filename]
       else null end)
    elif ($e | has("previous_filename") | not) or $e.previous_filename == null then
      [$e.filename]
    else
      # Present on a non-rename entry: only a real path is acceptable, and it
      # counts. Anything else (false, 0, {}, "") is a contract violation.
      (if ($e.previous_filename | path_ok) then [$e.filename, $e.previous_filename] else null end)
    end;

# Concatenate the pages, or null if the shape is not "array of arrays".
def entries:
  if type == "array" and (all(type == "array"))
  then (reduce .[] as $page ([]; . + $page))
  else null
  end;

# A count we can actually reason about: a non-negative integer.
#
# Checked as TEXT, because numeric checks are not enough — jq compares
# `1.0000000000000000001` unequal to 1 in one context and equal in another, so
# `floor` agreed with it and the length comparison did not catch it. jq >= 1.7
# keeps the FRACTIONAL literal the API sent, which is what makes those forms
# visible to `tostring` and rejectable here.
#
# What jq does NOT keep is the encoding of an integer: it renders 1E0 as "1" and
# 1.5E1 as "15" (and 1e1 as "1E+1"), so equivalent integer encodings arrive as
# their value. That is accepted deliberately. These payloads travel through the
# API and gh, and the decision only ever asks whether the count EQUALS the
# number of entries — a question about value, not spelling. The exponent branch
# below exists so `1E1` against ten entries is treated as the ten it is.
#
# `01` is a different matter: it is not legal JSON at all, and jq silently
# normalises it to 1. That is caught before jq runs, by the strict JSON.parse in
# pr-scope.sh — not here.
#
# Rejects: 1.0, 1.5, 1.0000000000000000001, 0.9999999999999999999, -1, 1E-1.
def whole_number:
  (type == "number") and (tostring | test("^(0|[1-9][0-9]*)([Ee][+]?[0-9]+)?$"));

entries as $entries
| ( if ($pr | type) == "array" and ($pr | length) == 1 and ($pr[0] | type) == "object"
    then $pr[0].changed_files
    else null
    end ) as $total
| if $entries == null then true

  # An empty list means we never learned what changed, not that nothing changed.
  elif ($entries | length) == 0 then true

  elif ($total | whole_number | not) then true

  # GET .../files stops at 3,000 entries and never says so. At or past the
  # ceiling "complete" and "truncated" are indistinguishable, so neither is trusted.
  elif $total >= 3000 then true

  # Below the ceiling, the count is what proves we read the whole PR.
  elif ($entries | length) != $total then true

  else
    [ $entries[] | entry_paths ] as $sets
    | if ($sets | any(. == null)) then true

      # The count only proves completeness if the entries are distinct. Two
      # copies of docs/a.md against changed_files:2 would otherwise satisfy the
      # length check while hiding whatever the real second file was.
      elif ($entries | map(.filename) | unique | length) != ($entries | length) then true

      else ([ $sets[][] ] | all(is_docs) | not)
      end
  end
