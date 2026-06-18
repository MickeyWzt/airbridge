# AirBridge Protocol

AirBridge is a no-login local network transfer protocol for trusted LANs.

The public website mode uses a separate WebSocket/WebRTC protocol documented in `docs/WEB_P2P.md`.

## Discovery

Devices announce themselves with UDP broadcast on port `45678`.

```json
{
  "app": "AirBridge",
  "version": "0.1.0",
  "id": "device-id",
  "name": "device-name",
  "host": "192.168.1.8",
  "port": 8765,
  "url": "http://192.168.1.8:8765",
  "ts": 1790000000000
}
```

Windows builds also scan nearby private subnets for `/api/state` because many school, dorm, and office networks block cross-subnet UDP broadcast while still allowing direct TCP connections.

## HTTP API

### `GET /api/state`

Returns app, device, peer, and inbox metadata.

### `POST /api/inbox/message`

Receives a UTF-8 JSON message.

```json
{
  "fromId": "device-id",
  "fromName": "Alice-PC",
  "text": "hello",
  "createdAt": 1790000000000
}
```

### `POST /api/inbox/file`

Receives a multipart form upload.

Fields:

- `from_id`
- `from_name`
- `created_at`
- `file`

## Security Model

AirBridge is designed for trusted local networks. It does not use accounts or cloud services. Do not accept unknown files on untrusted public Wi-Fi.
