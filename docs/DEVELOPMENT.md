# Development

This guide describes the lightweight checks and local workflows that are useful before changing AirBridge.

## Repository Shape

- `airbridge.py` is the browser-compatible Python app.
- `airbridge_desktop.py` is the Windows desktop app entry point.
- `AirBridgeAndroid/` contains the native Android project.
- `AirBridgeIOS/` contains the native iPhone/iPad SwiftUI project.
- `AirBridgeMac/` contains the native macOS SwiftUI project.
- `AirBridgeWeb/` contains the public WebRTC P2P room app and signaling server.
- `docs/PROTOCOL.md` documents the shared LAN protocol.
- `docs/WEB_P2P.md` documents the public web signaling and DataChannel protocol.
- `docs/WEB_DEPLOYMENT.md` documents Render and Railway deployment.

## Local Python Checks

Run these from the repository root:

```powershell
python -m py_compile airbridge.py airbridge_desktop.py
```

Install desktop dependencies when you need to run the Windows UI from source:

```powershell
python -m pip install -r requirements.txt
python airbridge_desktop.py
```

## Protocol Compatibility

Before changing transfer behavior, check whether the change affects:

- UDP discovery on port `45678`.
- `GET /api/state`.
- `POST /api/inbox/message`.
- `POST /api/inbox/file`.
- Manual peer entry when broadcast discovery is blocked.

If any of those change, update `docs/PROTOCOL.md`, `README.md`, and the pull request notes.

## Public Web Checks

Run these from `AirBridgeWeb/` after changing the web app or signaling server:

```powershell
npm install
npm run typecheck
npm run build
```

For local manual testing, run:

```powershell
npm run dev
```

Open two browser windows at `http://localhost:5173`, join the same room with different nicknames, select a peer, and test a text message plus a small file transfer.

## Platform Notes

- Windows packaging uses `build_zip.ps1` and `build_exe.ps1`.
- Android work should be opened in Android Studio through `AirBridgeAndroid/`.
- iOS work requires Xcode and `AirBridgeIOS/AirBridgeIOS.xcodeproj`.
- macOS work requires Xcode and `AirBridgeMac/AirBridgeMac.xcodeproj`.
- Public web work requires Node.js and uses `AirBridgeWeb/package.json`.

## Release Checklist

Before publishing a Windows release:

1. Run the Python syntax check.
2. Build the zip or EXE package.
3. Confirm the release asset names match the updater expectations.
4. Check the release notes against `CHANGELOG.md`.
5. Keep the local-network and trusted-LAN security notes visible.
