#!/usr/bin/env bash
# Installs or updates Branch Hop for Safari as a signed app, so Safari keeps it after it quits.
#   curl -fsSL https://raw.githubusercontent.com/davidoliversteinberg/branch-hop/main/scripts/safari-install.sh | bash
# Needs Xcode, signed in with your Apple ID (a free one works). Run it again to update.
set -euo pipefail

REPO="https://github.com/davidoliversteinberg/branch-hop.git"
SRC="${BRANCH_HOP_SRC:-$HOME/Library/Application Support/Branch Hop/source}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

say() { printf '\nBranch Hop: %s\n' "$*"; }
fail() { printf '\nBranch Hop: %s\n' "$*" >&2; exit 1; }

# 1. Xcode, set up
if [ ! -d "$DEVELOPER_DIR" ]; then
  open "macappstore://apps.apple.com/app/id497799835" 2>/dev/null || true
  fail "Safari builds need Xcode. The App Store is opening on it: install it, open it once, then run this command again."
fi
xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1 || fail "Open Xcode once and let it finish installing its components, then run this command again."
for tool in git node npm; do command -v "$tool" >/dev/null || fail "This needs $tool. Install Node.js from nodejs.org (it includes npm), then run this again."; done

# 2. Your Apple ID team, which signs the app so Safari keeps it
team="${SAFARI_TEAM_ID:-$(defaults read com.apple.dt.Xcode 2>/dev/null | grep -oE 'teamID = "?[A-Z0-9]{10}' | head -1 | grep -oE '[A-Z0-9]{10}$' || true)}"
if [ -z "$team" ]; then
  open -a Xcode 2>/dev/null || true
  fail "Xcode isn't signed in to an Apple ID yet. In Xcode, open Settings › Accounts, click +, choose Apple ID and sign in (a free Apple ID works). Then run this command again."
fi
say "signing with Apple ID team $team."

# 3. The newest source, in its own folder
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch --quiet --depth 1 origin main
  git -C "$SRC" reset --quiet --hard origin/main
else
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet --depth 1 "$REPO" "$SRC"
fi
cd "$SRC"
grep -q '"name": "branch-hop"' package.json || fail "The download didn't look like Branch Hop, so nothing was installed."
say "installing build tools (first time takes a minute)."
npm ci --silent --no-audit --no-fund

# 4. Build, sign, install
SAFARI_TEAM_ID="$team" bash scripts/safari.sh

version=$(grep -o '"version": *"[^"]*"' package.json | head -1 | sed -E 's/.*"([0-9.]+)"$/\1/')
cat <<MSG

Branch Hop $version for Safari is installed.
  1. In Safari › Settings › Extensions, turn on Branch Hop (the one under Installed).
  2. If a Temporary Branch Hop is still listed, click it and Uninstall, so you have just one.
  3. Allow it on vercel.app, github.com and api.github.com.
To update later, run this same command again.
MSG
