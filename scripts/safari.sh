#!/usr/bin/env bash
# Builds Branch Hop for Safari (needs Xcode) and installs the app in ~/Applications.
#   npm run safari                          unsigned: Safari needs Developer › Allow unsigned extensions,
#                                           which it turns off again when it quits
#   SAFARI_TEAM_ID=ABCDE12345 npm run safari  signed with your Apple ID's team, so Safari keeps it
# Find your team ID in Xcode › Settings › Accounts (a free Apple ID works for your own Mac).
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
[ -d "$DEVELOPER_DIR" ] || { echo "Branch Hop: Safari builds need Xcode. Install it from the Mac App Store and open it once." >&2; exit 1; }
npm run build --silent

team="${SAFARI_TEAM_ID:-}"
if [ -n "$team" ]; then
  [[ "$team" =~ ^[A-Z0-9]{10}$ ]] || { echo "Branch Hop: SAFARI_TEAM_ID should be 10 letters and digits." >&2; exit 1; }
  signing=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$team" -allowProvisioningUpdates)
else
  signing=(CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="")
fi
xcodebuild -project "safari/Branch Hop/Branch Hop.xcodeproj" -scheme "Branch Hop" -configuration Release \
  -destination "generic/platform=macOS" -derivedDataPath safari/build "${signing[@]}" -quiet build

mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/Branch Hop.app"
cp -R "safari/build/Build/Products/Release/Branch Hop.app" "$HOME/Applications/"
open "$HOME/Applications/Branch Hop.app"
echo "Branch Hop for Safari is in ~/Applications. Turn it on in Safari › Settings › Extensions."
[ -n "$team" ] || echo "Unsigned build: Safari keeps it only while Developer › Allow unsigned extensions is on."
