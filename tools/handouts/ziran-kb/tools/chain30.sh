#!/bin/bash
# Build given book numbers, compress all, render back covers/spines, finalize.
cd /tmp/claude-0/zhw/pkg/ziran
mkdir -p dist/books30 dist/books30-final
for v in "$@"; do
  SERIES=books30 flock /tmp/claude-0/zhw/sci/build.lock node build.mjs $v 2>&1 | tail -2 | grep -v '^{'
done
for f in dist/books30/*.pdf; do
  b=$(basename "$f"); o="dist/books30-final/$b"
  if [ ! -f "$o" ] || [ "$f" -nt "$o" ]; then
    python3 -I /tmp/claude-0/zhw/sci/tools/pdfgray.py "$f" "$o" >/dev/null 2>&1 || cp "$f" "$o"
  fi
done
node covers30.mjs 1 30 | tail -1 > /tmp/claude-0/zhw/sci/tmp/covers30.json
python3 -I /tmp/claude-0/zhw/sci/tools/finalize30.py 1 30
du -sh dist/books30-out
