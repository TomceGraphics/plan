#!/bin/sh
# Regenerates the PNG icon set from assets/logo.svg (needs rsvg-convert: librsvg2-tools on Fedora).
set -e
cd "$(dirname "$0")/.."
OUT=src-tauri/icons
mkdir -p "$OUT"
rsvg-convert -w 32  -h 32  assets/logo.svg -o "$OUT/32x32.png"
rsvg-convert -w 64  -h 64  assets/logo.svg -o "$OUT/64x64.png"
rsvg-convert -w 128 -h 128 assets/logo.svg -o "$OUT/128x128.png"
rsvg-convert -w 256 -h 256 assets/logo.svg -o "$OUT/256x256.png"
rsvg-convert -w 512 -h 512 assets/logo.svg -o "$OUT/icon.png"
echo "icons written to $OUT"
