#!/usr/bin/env bash
# Builds Branch Hop for Safari (needs Xcode) and installs the app in ~/Applications.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
npm run build --silent
xcodebuild -project "safari/Branch Hop/Branch Hop.xcodeproj" -scheme "Branch Hop" -configuration Release \
  -derivedDataPath safari/build CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" -quiet build
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Branch Hop.app"
cp -R "safari/build/Build/Products/Release/Branch Hop.app" "$HOME/Applications/"
open "$HOME/Applications/Branch Hop.app"
echo "Branch Hop for Safari is in ~/Applications. Turn it on in Safari › Settings › Extensions."
