# Decides whether a PR touches anything outside docs/.  (#809)
#
#   input      : slurped pages from GET /repos/{o}/{r}/pulls/{n}/files
#                (jq -s, so an array of the JSON array each page returned)
#   $pr        : slurped GET /repos/{o}/{r}/pulls/{n}  (--slurpfile, one object)
#   output     : exactly `true` (run every gate) or `false` (docs-only, skip)
#
# Everything is decided here, on parsed JSON, because four rounds of review
# proved the alternative unworkable: each time the shell re-parsed a projected
# string, some legal-but-unusual input punched through and produced a WRONG
# "false" — a green `quality` over unreviewed code. Illegal JSON escapes
# ("docs/a\q.md"), tabs and blank lines in a hand-made line format, and
# `previous_filename` being false/null/absent all did it. A real JSON parser has
# no such layer, so there is nothing left to punch through.
#
# The one rule that governs every branch below: any input that does not match
# the contract exactly yields `true`. Being wrong in that direction costs
# minutes of CI; being wrong the other way merges unreviewed code.

# A usable path: a non-empty string that cannot climb out of its directory.
# (Git never emits a `..` segment; if one appears, we are not reading what we
# think we are, so it is a contract violation rather than a path to classify.)
def path_ok:
  type == "string"
  and length > 0
  and (split("/") | any(. == "..") | not);

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
    elif $e.status == "renamed" or $e.status == "copied" then
      # The old name is mandatory here, and must be a real path. `false`, null,
      # a number, or an absent key are all contract violations, never "no rename".
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

entries as $entries
| ( if ($pr | type) == "array" and ($pr | length) == 1 and ($pr[0] | type) == "object"
    then $pr[0].changed_files
    else null
    end ) as $total
| if $entries == null then true

  # An empty list means we never learned what changed, not that nothing changed.
  elif ($entries | length) == 0 then true

  # The count has to be a real non-negative integer, straight out of the JSON —
  # no string arithmetic, so nothing can wrap into a bogus agreement.
  elif ($total | type) != "number" then true
  elif $total != ($total | floor) then true
  elif $total < 0 then true

  # GET .../files stops at 3,000 entries and never says so. At or past the
  # ceiling "complete" and "truncated" are indistinguishable, so neither is trusted.
  elif $total >= 3000 then true

  # Below the ceiling, the count is what proves we read the whole PR.
  elif ($entries | length) != $total then true

  else
    [ $entries[] | entry_paths ] as $sets
    | if ($sets | any(. == null)) then true
      else ([ $sets[][] ] | all(is_docs) | not)
      end
  end
