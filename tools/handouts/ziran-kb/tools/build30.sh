#!/bin/bash
# Build all 30 books, then losslessly compress gray scans.
cd /tmp/claude-0/zhw/pkg/ziran
mkdir -p dist/books30 dist/books30-final
for v in $(seq ${1:-1} ${2:-30}); do
  SERIES=books30 flock /tmp/claude-0/zhw/sci/build.lock node build.mjs $v 2>&1 | tail -2
done
for f in dist/books30/*.pdf; do
  b=$(basename "$f")
  python3 -I /tmp/claude-0/zhw/sci/tools/pdfgray.py "$f" "dist/books30-final/$b" >/dev/null 2>&1 || cp "$f" "dist/books30-final/$b"
done
ls -la dist/books30-final | awk '{s+=$5} END {print "total bytes", s}'
