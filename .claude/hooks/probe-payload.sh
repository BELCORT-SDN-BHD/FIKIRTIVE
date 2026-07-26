#!/bin/sh
# Field-name probe. Registering this in place of a guard writes the raw hook
# payload to a timestamped file under $TMPDIR and allows the tool, so the exact
# JSON shape of the running harness version can be read instead of guessed.
# It blocks nothing and always exits 0.

out_dir="${TMPDIR:-/tmp}/fikirtive-hook-probe"
mkdir -p "$out_dir" 2>/dev/null || exit 0
cat > "$out_dir/payload-$(date -u +%Y%m%dT%H%M%SZ)-$$.json" 2>/dev/null

exit 0
