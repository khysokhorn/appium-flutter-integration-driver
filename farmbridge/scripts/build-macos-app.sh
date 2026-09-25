#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "A Mac with full Xcode is required to build the native app." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Install Node.js 20 or newer first." >&2; exit 1; }
xcrun --find swiftc >/dev/null

app="$(pwd)/dist/FarmBridge.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/farmbridge"
cp desktop/Info.plist "$app/Contents/Info.plist"
cp "$(command -v node)" "$app/Contents/MacOS/node"
cp -R src public package.json "$app/Contents/Resources/farmbridge/"

architecture="$(uname -m)"
xcrun swiftc -parse-as-library -O \
  -target "${architecture}-apple-macos14.0" \
  -framework SwiftUI \
  desktop/FarmBridgeApp.swift \
  -o "$app/Contents/MacOS/FarmBridge"

codesign --force --deep --sign - "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$(pwd)/dist/FarmBridge-macOS-${architecture}.zip"
echo "Built dist/FarmBridge-macOS-${architecture}.zip"
