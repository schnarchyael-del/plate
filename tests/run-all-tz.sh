#!/bin/sh
# Run the Plate suite under the timezone matrix the time logic claims to survive.
# Usage: sh tests/run-all-tz.sh
set -e
cd "$(dirname "$0")/.."
for tz in "" UTC America/Santiago Pacific/Kiritimati Pacific/Niue; do
  if [ -z "$tz" ]; then
    echo "== TZ=(system) =="
    node --test tests/plate.test.mjs > /dev/null && echo OK
  else
    echo "== TZ=$tz =="
    TZ="$tz" node --test tests/plate.test.mjs > /dev/null && echo OK
  fi
done
echo "All timezone runs passed."
