# AirBridge

[![CI](https://github.com/MickeyWzt/airbridge/actions/workflows/ci.yml/badge.svg)](https://github.com/MickeyWzt/airbridge/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/MickeyWzt/airbridge?label=release)](https://github.com/MickeyWzt/airbridge/releases/latest)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Android%20%7C%20iOS%20%7C%20macOS-blue)](#platforms)

AirBridge is a no-login file and message transfer tool. It works a bit like AirDrop: run AirBridge on two devices connected to the same Wi-Fi or LAN, and they can discover each other, send text, and transfer files without a cloud server. A public web P2P mode is also available for browser-based room transfer through WebRTC.

## At a Glance

| Field | Details |
| --- | --- |
| Project status | Usable Windows release, source-first Android/iOS/macOS ports, and a new public WebRTC P2P web app. |
| Best for | Moving files or text between your own devices on a trusted local network. |
| First thing to try | Download the latest Windows build, run it on two devices, and send a small text message first. |
| Important caveat | Discovery depends on the local network allowing device-to-device traffic; some guest, school, corporate, VPN, or firewall setups block it. |

## Project Links

- [Download the latest Windows build](https://github.com/MickeyWzt/airbridge/releases/latest)
- [Protocol documentation](docs/PROTOCOL.md)
- [Public Web P2P protocol](docs/WEB_P2P.md)
- [Public Web deployment guide](docs/WEB_DEPLOYMENT.md)
- [Development guide](docs/DEVELOPMENT.md)
- [FAQ](docs/FAQ.md)
- [Examples](docs/EXAMPLES.md)
- [Changelog](CHANGELOG.md)
- [Support and troubleshooting](SUPPORT.md)
- [Roadmap](ROADMAP.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## Download

The latest Windows build is available from GitHub Releases:

```text
https://github.com/MickeyWzt/airbridge/releases/latest
```

If you want to run from source or work on the project, continue with the sections below.

## Features

- No account, login, or cloud relay server required.
- Public web room mode with nickname + room code, WebSocket signaling, and WebRTC DataChannel transfer.
- Standalone Windows desktop app; no browser is required for the main experience.
- Automatic peer discovery on the same LAN and nearby network segments.
- Manual peer entry for networks where broadcast discovery is blocked by routers or firewalls.
- Windows desktop auto-update support through GitHub Releases.
- Android GitHub update checks with APK download and install prompts.
- Text message sending.
- Drag-and-drop or file-picker based file transfer.
- Tray icon and receive notifications.
- Received files are saved to `AirBridge-Received` on Windows.
- Native platform ports for Android, iOS, and macOS using the same local-network protocol.
- Included Windows app icon and browser favicon assets.

## Run

If you are using a packaged Windows build, run:

```text
dist\AirBridge.exe
```

To run from source, install the desktop dependencies first:

```powershell
python -m pip install -r requirements.txt
```

On Windows, double-click:

```bat
run_airbridge.bat
```

Or run from the command line:

```powershell
python airbridge_desktop.py
```

After startup, AirBridge opens a desktop window and shows the local device address, for example:

```text
http://192.168.1.8:8765
```

When another device is running AirBridge on the same network, it should usually appear in the nearby devices list automatically. AirBridge first uses UDP broadcast discovery, then scans common ports in nearby network segments. This helps on networks where devices are technically on the same larger network but broadcast traffic does not cross segments, such as `10.85.167.x` and `10.85.168.x`.

If a device still does not appear, copy the other device's local address into the manual peer entry field and add it manually.

Enhanced discovery scans the current network segment and adjacent segments on ports `8765-8767` by default. You can tune this behavior with environment variables:

```powershell
$env:AIRBRIDGE_SCAN_RADIUS="2"
$env:AIRBRIDGE_SCAN_PORTS="8765,8766,8767,8768"
```

The browser-compatible version is still available:

```powershell
python airbridge.py
```

## Public Web P2P Mode

The public web version lives in `AirBridgeWeb/`:

```powershell
cd AirBridgeWeb
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Users enter a room code and nickname. Devices in the same room are shown together, and devices with the same hashed public network key are prioritized under `Nearby`. Text messages and file bytes travel over WebRTC DataChannel; the Node server only handles room presence and WebRTC signaling.

Read the deployment and protocol notes in:

```text
AirBridgeWeb\README.md
docs\WEB_P2P.md
```

## Build a Distributable Zip

Generate a distributable zip package:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_zip.ps1
```

Output:

```text
dist\AirBridge.zip
```

## Build a Windows EXE

If PyInstaller is installed, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

Output:

```text
dist\AirBridge.exe
```

The build uses `airbridge_desktop.py` as the desktop app entry point and `assets\airbridge.ico` as the EXE icon.

If PyInstaller is missing, install the build dependencies first:

```powershell
python -m pip install pyinstaller PySide6
```

## Auto-Update

The Windows desktop app supports auto-update starting with `v0.1.2`. On startup, it checks the latest GitHub Release:

```text
https://github.com/MickeyWzt/airbridge/releases/latest
```

When a newer version is available, the app prompts the user, downloads the new `AirBridge.exe`, exits the current process, replaces the old executable, and restarts automatically.

Note: `v0.1.1` and earlier builds do not include the updater. Users on those versions need to manually download `v0.1.2` or newer once before future updates can be prompted automatically.

The Android app supports GitHub update checks starting with `v0.1.4`. On startup, it checks the latest GitHub Release, prompts when a newer APK is available, downloads `AirBridgeAndroid-release.apk`, and opens the Android installer. Android requires the user to confirm installation and may ask for "install unknown apps" permission.

Note: `v0.1.3` and earlier Android builds do not include the updater. Android users need to manually install `v0.1.4` or newer once before future APK updates can be prompted automatically.

## iOS Port

The iPhone/iPad version lives in the `AirBridgeIOS` folder as a separate native SwiftUI project:

```text
AirBridgeIOS\AirBridgeIOS.xcodeproj
```

The iOS app uses the same LAN protocol as the Windows app: UDP peer discovery plus HTTP endpoints for messages and files. Windows PCs and iPhone/iPad devices can transfer messages and files when they are on the same Wi-Fi network. Allow Local Network access the first time the iOS app runs.

## Android Port

The Android version lives in the `AirBridgeAndroid` folder as a separate native Android project:

```text
AirBridgeAndroid
```

Open the folder in Android Studio, connect an Android phone with USB debugging enabled, and run the app. The Android app uses the same UDP/HTTP protocol and can exchange messages and files with Windows, iOS, and macOS devices.

It also scans the current and adjacent network segments on ports `8765-8767`, which is useful on school or office networks where broadcast discovery does not cross segments.

Starting with `v0.1.4`, the Android app can check GitHub Releases for newer APKs and prompt the user to download and install them.

Generate the Android release APK:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_android_release_apk.ps1
```

Output:

```text
dist\AirBridgeAndroid-release.apk
```

Generate the Android source package:

```powershell
powershell -ExecutionPolicy Bypass -File .\build_android_zip.ps1
```

Output:

```text
dist\AirBridgeAndroid-source.zip
```

## macOS Port

The macOS version lives in the `AirBridgeMac` folder as a separate native SwiftUI project:

```text
AirBridgeMac\AirBridgeMac.xcodeproj
```

The macOS app uses the same UDP/HTTP protocol and can transfer with Windows, iPhone/iPad, Android, and other Macs. Received files are saved by default to:

```text
~/Downloads/AirBridge Received
```

## Protocol

The local-network discovery and transfer protocol is documented in:

```text
docs\PROTOCOL.md
```

The public website P2P protocol is documented in:

```text
docs\WEB_P2P.md
```

The short version:

- UDP discovery on port `45678`.
- HTTP app server on the local device.
- Message and file transfer endpoints under `/api`.
- Manual peer entry as a fallback when discovery is blocked.

## Network and Security Notes

AirBridge is designed for trusted local networks. It does not upload files to the cloud and does not require login. On first run, Windows Firewall may ask whether to allow network access. To receive files from other devices on your LAN, allow access on private networks.

Do not accept files from unknown devices on untrusted public Wi-Fi.

## License

AirBridge is released under the MIT License.
