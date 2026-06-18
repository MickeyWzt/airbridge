# Changelog

All notable changes to AirBridge will be documented in this file.

This project follows a simple public changelog format inspired by Keep a Changelog. Dates use UTC.

## Unreleased

### Added

- Public WebRTC P2P web app in `AirBridgeWeb/` with room-code login, WebSocket signaling, Nearby grouping by public IP hash, DataChannel text messages, and file transfer progress.
- Public web P2P protocol documentation for web and future native client integration.
- Android GitHub update checks with APK download and Android installer handoff.
- Android APK install provider for downloaded update packages.
- English README and platform-specific README files for Windows, Android, iOS, and macOS workflows.
- English UI copy across the Windows desktop app, browser-compatible UI, Android app, iOS app, and macOS app.
- GitHub topics for local-network transfer, cross-platform support, and UDP discovery.
- Contributing guide, support guide, roadmap, security policy, and structured issue forms.

### Changed

- Repository description now emphasizes local-network AirDrop-style file and message transfer across Windows, Android, iOS, and macOS.
- README now links directly to releases, protocol documentation, support, roadmap, contributing, and security docs.
- Android version is now `0.1.4`; Windows version is now `0.1.4`.

## 0.1.2

### Added

- Windows desktop auto-update support through GitHub Releases.
- Windows release assets for the desktop app and source packages.
- Android, iOS, and macOS source ports using the same LAN protocol.

### Notes

- Earlier Windows builds do not include the updater, so users on older versions need to manually download `v0.1.2` or newer once.
