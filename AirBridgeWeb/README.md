# AirBridge Web

AirBridge Web is the public website version of AirBridge. Users join with a room code and nickname. Devices in the same room can discover each other, establish a WebRTC DataChannel, and transfer text or files directly peer-to-peer.

The signaling server does not store or relay file contents. It only keeps short-lived room presence and forwards WebRTC offer, answer, and ICE candidate messages.

## Current Scope

- Web-to-Web room discovery through WebSocket signaling.
- Nearby grouping by same room plus same public IP hash.
- WebRTC DataChannel connection per selected peer.
- Text messages over DataChannel.
- File offers, accept/reject, 64 KiB chunks, progress, and browser download links.
- No account password flow.
- No TURN relay and no server file relay.

Native Windows, Android, iOS, and macOS clients can use the same signaling protocol later. See `../docs/WEB_P2P.md`.

Deployment details are in `../docs/WEB_DEPLOYMENT.md`.

## Local Development

Install dependencies:

```powershell
cd AirBridgeWeb
npm install
```

Run the signaling server and Vite app together:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173
```

The Vite dev server proxies `/signal` WebSocket traffic to the Node server on port `8787`.

Run only the server:

```powershell
npm run dev:server
```

Run only the frontend:

```powershell
npm run dev:web
```

## Production Build

```powershell
npm run build
npm start
```

By default the production server listens on:

```text
http://localhost:8787
```

Set `PORT` when deploying:

```powershell
$env:PORT="8787"
npm start
```

## Environment Variables

| Name | Purpose |
| --- | --- |
| `PORT` | Production HTTP/WSS port. Render and Railway usually set this automatically. |
| `AIRBRIDGE_WEB_PORT` | Local fallback port when `PORT` is not set. |
| `AIRBRIDGE_WEB_IP_SALT` | Salt used to hash public IPs into `networkKey`. Use a stable random value in production. |
| `VITE_SIGNAL_URL` | Optional frontend override for the signaling WebSocket URL. |
| `VITE_DEV_SIGNAL_TARGET` | Optional Vite dev proxy target, default `http://localhost:8787`. |

## Render Deployment

Use a Web Service:

- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Root directory: `AirBridgeWeb`
- Environment: set `AIRBRIDGE_WEB_IP_SALT` to a long random value

Render provides HTTPS and WSS automatically on the public service URL.

## Railway Deployment

Create a service from the repository:

- Root directory: `AirBridgeWeb`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: set `AIRBRIDGE_WEB_IP_SALT` to a long random value

Railway sets `PORT` automatically.

## Privacy Notes

- Files are never uploaded to the Node server.
- File bytes are sent only across WebRTC DataChannel.
- The server stores hashed public network keys, not raw public IPs.
- Without TURN, some NAT, school, company, guest Wi-Fi, or VPN networks may not allow P2P. In that case the UI shows that server relay is disabled.
