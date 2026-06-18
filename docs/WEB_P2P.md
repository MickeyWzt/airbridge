# Public Web P2P Protocol

AirBridge Web adds a public website mode for users who cannot install an Apple App Store app or who want a browser-first transfer path.

The web mode is separate from the existing LAN UDP/HTTP protocol. It uses a Node.js WebSocket signaling service plus WebRTC DataChannel for peer-to-peer text and file transfer.

## Network Model

Public websites cannot reliably scan local networks such as `10.x.x.x` or `192.168.x.x`, and browser access to local network resources is increasingly restricted by browser security policies.

AirBridge Web therefore defines nearby discovery as:

1. Same room code.
2. Same hashed public network key from the signaling server.
3. Successful WebRTC P2P connection when a user selects a peer.

This means `Nearby` is a best-effort grouping, not a promise that the browser scanned the LAN.

## Roles

### Signaling Server

- Accepts WebSocket connections on `/signal`.
- Tracks short-lived room presence in memory.
- Computes `networkKey` from the request public IP plus `AIRBRIDGE_WEB_IP_SALT`.
- Forwards WebRTC offer, answer, and ICE candidate messages inside a room.
- Does not store, proxy, log, or relay file contents.

### Web Client

- Joins with room code, nickname, platform, and capabilities.
- Displays same-network peers under `Nearby` and other room peers under `Same Room`.
- Creates an `RTCPeerConnection` when a peer is selected.
- Sends text and files over DataChannel.
- Saves received files with browser download links.

### Native Clients

Native clients should connect to the same WSS endpoint, send `join_room`, and implement WebRTC DataChannel with the same control messages. Existing LAN UDP/HTTP functionality should remain available as a separate local-network mode.

## Signaling Messages

Client to server:

```json
{
  "type": "join_room",
  "roomCode": "CS-LAB",
  "nickname": "Alice",
  "peerId": "web-uuid",
  "platform": "web",
  "capabilities": {
    "webrtc": true,
    "text": true,
    "file": true,
    "native": false
  }
}
```

Server to client after join:

```json
{
  "type": "room_snapshot",
  "selfPeerId": "web-uuid",
  "roomCode": "CS-LAB",
  "peers": []
}
```

Peer presence:

```json
{ "type": "peer_joined", "peer": {} }
{ "type": "peer_left", "peerId": "peer-id" }
```

WebRTC forwarding:

```json
{
  "type": "offer",
  "targetPeerId": "peer-id",
  "connectionId": "conn-id",
  "description": {
    "type": "offer",
    "sdp": "..."
  }
}
```

The server forwards the same payload with `fromPeerId` instead of `targetPeerId`. `answer` and `ice_candidate` follow the same pattern.

## DataChannel Messages

Text:

```json
{
  "type": "text_message",
  "messageId": "msg-id",
  "text": "hello",
  "createdAt": 1790000000000,
  "fromName": "Alice"
}
```

File offer:

```json
{
  "type": "transfer_offer",
  "transferId": "file-id",
  "name": "photo.jpg",
  "size": 123456,
  "mime": "image/jpeg",
  "createdAt": 1790000000000
}
```

Receiver response:

```json
{ "type": "transfer_accept", "transferId": "file-id" }
{ "type": "transfer_reject", "transferId": "file-id", "reason": "Receiver rejected the file." }
```

Chunk header followed by a binary DataChannel frame:

```json
{
  "type": "transfer_chunk",
  "transferId": "file-id",
  "offset": 0,
  "byteLength": 65536
}
```

Completion:

```json
{ "type": "transfer_done", "transferId": "file-id" }
{ "type": "transfer_cancel", "transferId": "file-id", "reason": "cancelled" }
```

Default chunk size is 64 KiB. Senders should pause while `RTCDataChannel.bufferedAmount` is above the configured high-water mark.

## Native Integration Checklist

1. Add a `Web Room` or `Public Web Transfer` entry point.
2. Ask for room code and nickname.
3. Connect to the configured HTTPS/WSS AirBridge Web deployment.
4. Send `join_room` with a stable `peerId`, platform, and capabilities.
5. Render room peers and accept incoming offer/answer/ICE messages.
6. Use a platform WebRTC library to create a DataChannel named `airbridge`.
7. Implement the DataChannel control messages above.
8. Save received files to the platform's existing AirBridge receive directory.
9. Keep LAN UDP/HTTP transfer mode unchanged.

## Known Limitations

- No TURN server is included in the first version.
- Some networks will block direct P2P even when peers can see each other in the room.
- The server intentionally does not fall back to file relay.
- Browser downloads require the receiver to click `Save` after the transfer completes.
