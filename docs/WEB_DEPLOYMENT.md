# AirBridge Web Deployment

This guide covers publishing the public WebRTC P2P website. The server must be deployed as a web service because WebSocket signaling and the built React app are served by the same Node process.

## Production Requirements

- HTTPS/WSS public URL.
- Node.js `22.12.0` or newer.
- Build command: `npm ci && npm run build` from `AirBridgeWeb/`.
- Start command: `npm start` from `AirBridgeWeb/`.
- Health check path: `/health`.
- A stable `AIRBRIDGE_WEB_IP_SALT` secret.

The app does not need a database for the first version. Rooms and peers are short-lived in-memory state.

## Render

The repository includes `render.yaml` at the repo root. In Render:

1. Create a new Blueprint from the GitHub repository.
2. Select the `main` branch.
3. Render reads `render.yaml`.
4. Confirm the `airbridge-web` service.
5. Deploy.

The blueprint uses:

- `rootDir: AirBridgeWeb`
- `buildCommand: npm ci && npm run build`
- `startCommand: npm start`
- `healthCheckPath: /health`
- generated `AIRBRIDGE_WEB_IP_SALT`

Render provides HTTPS and WSS automatically on the generated `onrender.com` domain.

## Railway

The repository includes `railway.json` at the repo root. In Railway:

1. Create a project from the GitHub repository.
2. Keep the service root at the repository root, or set the config file path to `/railway.json`.
3. Add an environment variable named `AIRBRIDGE_WEB_IP_SALT`.
4. Deploy.
5. Generate a Railway domain from the service networking settings.

Generate a salt locally:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The Railway config runs:

```text
cd AirBridgeWeb && npm ci && npm run build
cd AirBridgeWeb && npm start
```

## After Deployment

Check the health endpoint:

```text
https://your-domain.example/health
```

Then open the site from two browsers or two devices:

1. Join the same room code with different nicknames.
2. Confirm the peers appear in `Nearby` or `Same Room`.
3. Send a text message.
4. Send a small file.

If peers can see each other but cannot transfer, the WebRTC P2P path is blocked by the network. AirBridge Web intentionally does not fall back to server file relay.

## Native Client Connection

Once a public domain exists, native clients should point their Web Room entry to:

```text
wss://your-domain.example/signal
```

The message protocol is documented in `docs/WEB_P2P.md`.
