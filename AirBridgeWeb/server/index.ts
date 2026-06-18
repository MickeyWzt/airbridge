import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  AIRBRIDGE_WEB_PROTOCOL_VERSION,
  type ClientSignalMessage,
  type PeerCapabilities,
  type PeerRecord,
  type Platform,
  type ServerSignalMessage
} from "../shared/protocol.js";

const PORT = Number(process.env.PORT || process.env.AIRBRIDGE_WEB_PORT || 8787);
const IP_HASH_SALT = process.env.AIRBRIDGE_WEB_IP_SALT || "airbridge-web-dev-salt";
const ROOM_CODE_MAX_LENGTH = 48;
const NICKNAME_MAX_LENGTH = 40;
const MAX_PEERS_PER_ROOM = Number(process.env.AIRBRIDGE_WEB_MAX_PEERS_PER_ROOM || 64);

type ClientState = {
  socket: WebSocket;
  peer?: PeerRecord;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.resolve(__dirname, "../../dist");
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/signal", maxPayload: 256 * 1024 });
const clients = new Map<WebSocket, ClientState>();
const rooms = new Map<string, Map<string, PeerRecord>>();

app.disable("x-powered-by");
app.set("trust proxy", true);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "AirBridgeWeb",
    protocolVersion: AIRBRIDGE_WEB_PROTOCOL_VERSION,
    rooms: rooms.size
  });
});

app.use(express.static(staticRoot));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(staticRoot, "index.html"));
});

wss.on("connection", (socket, request) => {
  clients.set(socket, { socket });

  socket.on("message", (raw) => {
    let message: ClientSignalMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientSignalMessage;
    } catch {
      send(socket, { type: "error", code: "bad_json", message: "Invalid JSON message." });
      return;
    }

    handleClientMessage(socket, message, request);
  });

  socket.on("close", () => {
    leave(socket);
    clients.delete(socket);
  });

  socket.on("error", () => {
    leave(socket);
    clients.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    }
  }
}, 30_000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

server.listen(PORT, () => {
  console.log(`AirBridge Web signaling server listening on ${PORT}`);
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function handleClientMessage(
  socket: WebSocket,
  message: ClientSignalMessage,
  request: http.IncomingMessage
) {
  switch (message.type) {
    case "join_room":
      joinRoom(socket, message, request);
      return;
    case "leave_room":
      leave(socket);
      return;
    case "offer":
    case "answer":
    case "ice_candidate":
      forwardSignal(socket, message);
      return;
    default:
      send(socket, {
        type: "error",
        code: "unknown_message",
        message: "Unsupported signaling message."
      });
  }
}

function joinRoom(
  socket: WebSocket,
  message: Extract<ClientSignalMessage, { type: "join_room" }>,
  request: http.IncomingMessage
) {
  const roomCode = cleanRoomCode(message.roomCode);
  const nickname = cleanNickname(message.nickname);

  if (!roomCode || !nickname) {
    send(socket, {
      type: "error",
      code: "bad_join",
      message: "Room code and nickname are required."
    });
    return;
  }

  leave(socket);

  const peerId = cleanPeerId(message.peerId) || crypto.randomUUID();
  const now = Date.now();
  const networkKey = hashNetworkKey(publicIpFromRequest(request));
  const capabilities: PeerCapabilities = {
    webrtc: message.capabilities?.webrtc ?? true,
    text: message.capabilities?.text ?? true,
    file: message.capabilities?.file ?? true,
    native: message.capabilities?.native ?? false
  };
  const peer: PeerRecord = {
    peerId,
    nickname,
    platform: cleanPlatform(message.platform),
    roomCode,
    networkKey,
    capabilities,
    joinedAt: now,
    lastSeen: now
  };

  let room = rooms.get(roomCode);
  if (!room) {
    room = new Map<string, PeerRecord>();
    rooms.set(roomCode, room);
  }

  if (!room.has(peerId) && room.size >= MAX_PEERS_PER_ROOM) {
    send(socket, {
      type: "error",
      code: "room_full",
      message: "This room is full. Create a new room code and try again."
    });
    return;
  }

  const replacedSocket = findSocket(roomCode, peerId);
  if (replacedSocket && replacedSocket !== socket) {
    clients.set(replacedSocket, { socket: replacedSocket });
    replacedSocket.close(4000, "peer rejoined");
  }

  room.set(peerId, peer);
  clients.set(socket, { socket, peer });

  send(socket, {
    type: "joined",
    selfPeerId: peerId,
    roomCode,
    networkKey,
    protocolVersion: AIRBRIDGE_WEB_PROTOCOL_VERSION
  });
  send(socket, {
    type: "room_snapshot",
    selfPeerId: peerId,
    roomCode,
    peers: [...room.values()]
  });
  broadcastToRoom(roomCode, { type: "peer_joined", peer }, peerId);
}

function forwardSignal(socket: WebSocket, message: Exclude<ClientSignalMessage, { type: "join_room" | "leave_room" }>) {
  const source = clients.get(socket)?.peer;
  if (!source) {
    send(socket, {
      type: "error",
      code: "not_joined",
      message: "Join a room before sending WebRTC signaling messages."
    });
    return;
  }

  source.lastSeen = Date.now();
  const targetSocket = findSocket(source.roomCode, message.targetPeerId);
  if (!targetSocket) {
    send(socket, {
      type: "error",
      code: "peer_unavailable",
      message: "The selected peer is no longer online in this room."
    });
    return;
  }

  const forwarded = {
    ...message,
    fromPeerId: source.peerId
  };
  delete (forwarded as { targetPeerId?: string }).targetPeerId;
  send(targetSocket, forwarded as ServerSignalMessage);
}

function leave(socket: WebSocket) {
  const state = clients.get(socket);
  const peer = state?.peer;
  if (!peer) {
    return;
  }

  const room = rooms.get(peer.roomCode);
  if (room) {
    room.delete(peer.peerId);
    if (room.size === 0) {
      rooms.delete(peer.roomCode);
    }
  }

  clients.set(socket, { socket });
  broadcastToRoom(peer.roomCode, { type: "peer_left", peerId: peer.peerId }, peer.peerId);
}

function findSocket(roomCode: string, peerId: string) {
  for (const [socket, state] of clients.entries()) {
    if (state.peer?.roomCode === roomCode && state.peer.peerId === peerId) {
      return socket;
    }
  }
  return undefined;
}

function broadcastToRoom(roomCode: string, message: ServerSignalMessage, excludePeerId?: string) {
  for (const [socket, state] of clients.entries()) {
    if (
      socket.readyState === WebSocket.OPEN &&
      state.peer?.roomCode === roomCode &&
      state.peer.peerId !== excludePeerId
    ) {
      send(socket, message);
    }
  }
}

function send(socket: WebSocket, message: ServerSignalMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function publicIpFromRequest(request: http.IncomingMessage) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const raw =
    typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0]?.trim()
      : request.socket.remoteAddress || "unknown";

  return raw.replace(/^::ffff:/, "");
}

function hashNetworkKey(ip: string) {
  return crypto
    .createHash("sha256")
    .update(`${IP_HASH_SALT}:${ip}`)
    .digest("hex")
    .slice(0, 16);
}

function cleanRoomCode(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase()
    .slice(0, ROOM_CODE_MAX_LENGTH);
}

function cleanNickname(value: string) {
  return String(value || "").trim().slice(0, NICKNAME_MAX_LENGTH);
}

function cleanPeerId(value: string | undefined) {
  const cleaned = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(cleaned) ? cleaned : "";
}

function cleanPlatform(value: Platform | undefined): Platform {
  if (value && ["web", "windows", "android", "ios", "macos", "unknown"].includes(value)) {
    return value;
  }
  return "unknown";
}

function shutdown(signal: string) {
  console.log(`Received ${signal}; closing AirBridge Web server.`);
  wss.close();
  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}
