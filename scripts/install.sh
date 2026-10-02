#!/usr/bin/env bash
# Installs or updates Branch Hop for Chrome and Brave from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/davidoliversteinberg/branch-hop/main/scripts/install.sh | bash
# Set BRANCH_HOP_DIR to use a different folder than ~/Documents/Branch Hop.
set -euo pipefail

REPO="davidoliversteinberg/branch-hop"
DEST="${BRANCH_HOP_DIR:-$HOME/Documents/Branch Hop}"

fail() { echo "Branch Hop: $*" >&2; exit 1; }

# Only ever replace an empty folder or an existing Branch Hop install.
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  grep -q '"name": *"Branch Hop"' "$DEST/manifest.json" 2>/dev/null || fail "$DEST already has other files in it. Choose an empty folder with BRANCH_HOP_DIR."
fi

url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"browser_download_url": *"[^"]*\.zip"' | head -1 | sed -E 's/.*"(https[^"]+)"$/\1/')
case "$url" in
  "https://github.com/$REPO/releases/download/"*) ;;
  *) fail "couldn't find the latest release. Check your connection and try again." ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/branch-hop.zip"
mkdir -p "$tmp/files"
unzip -q "$tmp/branch-hop.zip" -d "$tmp/files"
grep -q '"name": *"Branch Hop"' "$tmp/files/manifest.json" 2>/dev/null || fail "the download didn't look like Branch Hop, so nothing was changed."

mkdir -p "$DEST"
rsync -a --delete "$tmp/files/" "$DEST/"
version=$(grep -o '"version": *"[^"]*"' "$DEST/manifest.json" | head -1 | sed -E 's/.*"([0-9.]+)"$/\1/')

echo ""
echo "Branch Hop $version is in: $DEST"
echo "Already installed? Branch Hop reloads itself within a minute. Nothing else to do."
echo "First time? Open chrome://extensions (or brave://extensions), turn on Developer mode,"
echo "click Load unpacked, and choose the folder above."
