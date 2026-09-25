# FarmBridge

[![FarmBridge CI](https://github.com/khysokhorn/appium-flutter-integration-driver/actions/workflows/farmbridge-ci.yml/badge.svg)](https://github.com/khysokhorn/appium-flutter-integration-driver/actions/workflows/farmbridge-ci.yml)

FarmBridge is an original, cross-platform device automation bridge designed to run on macOS. It gives one API to Android devices through **ADB** and iOS devices through **Xcode discovery + Appium/XCUITest**.

It is intentionally a general device-control/test automation project. It does not include anti-detection, account farming, credential harvesting, proxy rotation, CAPTCHA bypassing, or platform-abuse features.

## What is included

- Android device discovery with `adb devices -l`
- Android tap, swipe, text input, app launch/terminate, screenshots, UI hierarchy dump, install, and file push
- iOS device/simulator discovery with Xcode command-line tools
- iOS tap, swipe, text input, app launch/terminate, screenshots, and Home button through Appium/XCUITest
- Unified `DeviceBridge` abstraction
- REST API
- Browser dashboard
- CLI
- Declarative JSON action runner
- One-shot and recurring scheduler with local JSON persistence
- macOS environment checker
- Node built-in test suite
- GitHub Actions on macOS and Ubuntu

## Architecture

```text
FarmBridge
├── core/
│   ├── DeviceBridge
│   ├── DeviceManager
│   └── ActionRunner
├── drivers/
│   ├── android/AdbBridge
│   └── ios/
│       ├── IosDiscovery
│       └── IosAppiumBridge
├── scheduler/
├── storage/
├── server/
├── CLI
└── dashboard
```

The important boundary is `DeviceBridge`. Higher-level workflows do not need to know whether the target is Android or iOS.

## macOS setup

Clone the repository and enter the FarmBridge project:

```bash
git clone https://github.com/khysokhorn/appium-flutter-integration-driver.git
cd appium-flutter-integration-driver/farmbridge
```

### 1. Install Node.js and Android Platform Tools

Using Homebrew:

```bash
brew install node android-platform-tools
```

Verify:

```bash
node --version
adb version
```

### 2. Android

Enable Developer Options and USB debugging on your Android device, connect it, then run:

```bash
adb devices
```

Accept the authorization dialog on the phone.

### 3. iOS

Install full Xcode from the App Store and make sure command-line tools point to it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcrun xctrace list devices
```

For interactive iOS automation, FarmBridge uses Appium + XCUITest:

```bash
npm install -g appium
appium driver install xcuitest
appium
```

For a physical iPhone, WebDriverAgent must be signed by your Apple development team the first time. Appium's XCUITest driver documentation covers that one-time setup.

### 4. Run the environment check

```bash
chmod +x scripts/check-macos.sh
./scripts/check-macos.sh
```

### 5. Start FarmBridge

No project dependencies are required:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787
```

By default FarmBridge looks for Appium at `http://127.0.0.1:4723`. Override it with:

```bash
APPIUM_URL=http://127.0.0.1:4723 npm start
```

## CLI

List devices:

```bash
npm run cli -- devices
```

Run a workflow:

```bash
npm run cli -- run android:YOUR_SERIAL examples/android-demo.json
```

For iOS:

```bash
npm run cli -- run ios:YOUR_UDID examples/ios-demo.json
```

## REST API

List devices:

```bash
curl http://127.0.0.1:8787/api/devices
```

Run actions:

```bash
curl -X POST http://127.0.0.1:8787/api/run \
  -H 'content-type: application/json' \
  -d '{
    "deviceId": "android:SERIAL",
    "actions": [
      {"type":"launch","appId":"com.android.settings"},
      {"type":"wait","ms":1000},
      {"type":"tap","x":300,"y":500}
    ]
  }'
```

Schedule the same action set:

```bash
curl -X POST http://127.0.0.1:8787/api/jobs \
  -H 'content-type: application/json' \
  -d '{
    "deviceId": "android:SERIAL",
    "runAt": "2026-09-25T09:00:00+07:00",
    "actions": [
      {"type":"launch","appId":"com.android.settings"}
    ]
  }'
```

## Supported actions

```json
[
  {"type":"tap","x":100,"y":200},
  {"type":"swipe","x1":100,"y1":600,"x2":100,"y2":200,"durationMs":450},
  {"type":"text","text":"hello"},
  {"type":"launch","appId":"com.example.app"},
  {"type":"terminate","appId":"com.example.app"},
  {"type":"home"},
  {"type":"wait","ms":1000},
  {"type":"screenshot","path":"./shot.png"},
  {"type":"source"}
]
```

Android additionally supports `install` and `pushFile` via the bridge API. iOS application install/deployment is deliberately left to Xcode/Appium because physical-device signing requirements vary by team.

## iOS notes

`xcrun` can discover devices and simulators but does not provide the same general touch/input API as ADB. That is why FarmBridge uses XCUITest through Appium for interactive actions. A session is created lazily on the first action for each iOS device.

## Development

```bash
npm test
npm run check
```

The project has no runtime npm dependencies, which keeps the host bridge auditable and easy to run.

## GitHub pipeline

Open [FarmBridge CI](https://github.com/khysokhorn/appium-flutter-integration-driver/actions/workflows/farmbridge-ci.yml) to see the latest result or use **Run workflow** to test it before cloning. Each run checks syntax and starts the real FarmBridge server on Linux and macOS. An HTTP smoke test discovers simulated Android and iOS devices, performs ADB and Appium actions, and runs a scheduled job. The macOS job also checks Xcode, installs Android platform tools and Appium/XCUITest, and reports setup failures.

Green CI means the code starts and the simulated workflows work on the GitHub runners. USB authorization, the versions installed on your Mac, physical iPhone signing, and real device behavior still need a check on your Mac with `./scripts/check-macos.sh` and `npm run cli -- devices`.
