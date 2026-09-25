#!/usr/bin/env bash
set -u

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Warning: this checker is intended for macOS."
fi

fail=0
check() {
  local cmd="$1"; local required="$2"; local note="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "✓ $cmd: $(command -v "$cmd")"
  else
    echo "✗ $cmd missing — $note"
    [[ "$required" == "yes" ]] && fail=1
  fi
}

check node yes "install with: brew install node"
check adb no "Android support: brew install android-platform-tools"
check xcrun no "iOS support: install Xcode and select it with xcode-select"
check appium no "Interactive iOS support: npm install -g appium && appium driver install xcuitest"

if command -v node >/dev/null 2>&1; then
  major=$(node -p 'Number(process.versions.node.split(".")[0])')
  if (( major < 20 )); then
    echo "✗ Node 20+ required; found $(node --version)"
    fail=1
  else
    echo "✓ Node $(node --version)"
  fi
fi

if command -v adb >/dev/null 2>&1; then
  echo "\nAndroid devices:"
  adb devices -l || true
fi

if command -v xcrun >/dev/null 2>&1; then
  echo "\niOS devices/simulators:"
  xcrun xctrace list devices 2>/dev/null | head -40 || true
fi

exit "$fail"
