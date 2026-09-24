# FarmBridge

FarmBridge is a macOS-friendly device automation bridge with one workflow API for **Android via ADB** and **iOS via Appium/XCUITest**.

It is an original implementation for devices and accounts you control. It intentionally does not include anti-detection, account farming, CAPTCHA bypassing, credential harvesting, or proxy-rotation/evasion features.

## Features

- Android and iOS device discovery
- Tap, swipe, text input, Home, app launch/terminate
- Screenshot and UI/source capture
- Android APK install and file push in the bridge layer
- iOS interaction through Appium + XCUITest
- REST API and a small browser dashboard
- JSON workflow runner
- Persistent one-shot/recurring scheduler
- No runtime npm dependencies

## Architecture

```text
FarmBridge
  DeviceManager
    AndroidBridge -> adb -> Android device/emulator
    IosBridge     -> Appium/XCUITest -> iPhone/iOS Simulator
  ActionRunner
  Scheduler
  REST API / Dashboard
```

The shared action format means a higher-level workflow can target either platform without knowing the underlying transport.

## Run on macOS

Install Node and Android Platform Tools:

```bash
brew install node android-platform-tools
```

For iOS, install full Xcode and select it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcrun xctrace list devices
```

For interactive iOS automation install Appium/XCUITest:

```bash
npm install -g appium
appium driver install xcuitest
appium
```

For a physical iPhone, WebDriverAgent needs normal Apple developer signing the first time.

Then:

```bash
cd farmbridge
chmod +x scripts/check-macos.sh
./scripts/check-macos.sh
npm test
npm start
```

Open `http://127.0.0.1:8787`.

## Device discovery

```bash
npm run devices
```

IDs look like:

```text
android:emulator-5554
ios:00008110-...
```

## Workflow example

```json
{
  "actions": [
    {"type":"launch","appId":"com.android.settings"},
    {"type":"wait","ms":1000},
    {"type":"tap","x":300,"y":500},
    {"type":"screenshot","path":"./screen.png"},
    {"type":"home"}
  ]
}
```

Run it:

```bash
node src/farmbridge.mjs run android:YOUR_SERIAL examples/android-demo.json
```

Supported shared actions are `tap`, `swipe`, `text`, `launch`, `terminate`, `home`, `wait`, `screenshot`, and `source`.

## REST API

```bash
curl http://127.0.0.1:8787/api/devices
```

```bash
curl -X POST http://127.0.0.1:8787/api/run \
  -H 'content-type: application/json' \
  -d '{"deviceId":"android:SERIAL","actions":[{"type":"home"}]}'
```

Schedule a workflow:

```bash
curl -X POST http://127.0.0.1:8787/api/jobs \
  -H 'content-type: application/json' \
  -d '{"deviceId":"android:SERIAL","runAt":"2026-09-25T09:00:00+07:00","actions":[{"type":"home"}]}'
```

Recurring jobs support `repeatEveryMs` with a minimum interval of 60 seconds.

## Environment variables

- `PORT` defaults to `8787`
- `HOST` defaults to `127.0.0.1`
- `ADB_PATH` defaults to `adb`
- `APPIUM_URL` defaults to `http://127.0.0.1:4723`
- `FARMBRIDGE_STATE` defaults to `~/.farmbridge/state.json`

## Notes

`xcrun` handles iOS device discovery, but Apple does not expose a general ADB-like touch API. Interactive iOS control therefore goes through XCUITest/Appium. Android remains direct ADB.
