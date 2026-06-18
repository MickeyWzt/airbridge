import { FormEvent, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FILE_CHUNK_SIZE,
  LOW_BUFFERED_AMOUNT,
  MAX_BUFFERED_AMOUNT,
  type DataChannelControlMessage,
  type IceCandidatePayload,
  type PeerRecord,
  type Platform,
  type ServerSignalMessage
} from "../shared/protocol";

type SignalStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";
type ConnectionStatus = "idle" | "connecting" | "open" | "failed" | "closed";
type TransferStatus =
  | "waiting"
  | "offered"
  | "sending"
  | "receiving"
  | "complete"
  | "rejected"
  | "failed"
  | "cancelled";

type ConnectionView = {
  status: ConnectionStatus;
  error?: string;
};

type PeerConnectionEntry = {
  peerId: string;
  connectionId: string;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  openPromise: Promise<RTCDataChannel>;
  resolveOpen: (channel: RTCDataChannel) => void;
  rejectOpen: (error: Error) => void;
  queuedIce: IceCandidatePayload[];
};

type ChatItem = {
  id: string;
  peerId: string;
  direction: "incoming" | "outgoing" | "system";
  text: string;
  createdAt: number;
  fromName: string;
};

type TransferView = {
  transferId: string;
  peerId: string;
  peerName: string;
  direction: "incoming" | "outgoing";
  name: string;
  size: number;
  mime: string;
  status: TransferStatus;
  bytes: number;
  createdAt: number;
  downloadUrl?: string;
  error?: string;
};

type IncomingAssembly = {
  transferId: string;
  peerId: string;
  name: string;
  size: number;
  mime: string;
  chunks: ArrayBuffer[];
  received: number;
};

type PendingBinary = {
  transferId: string;
  offset: number;
  byteLength: number;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const PLATFORM_LABELS: Record<Platform, string> = {
  web: "Web",
  windows: "Windows",
  android: "Android",
  ios: "iOS",
  macos: "macOS",
  unknown: "Unknown"
};

const PLATFORM_OPTIONS: Platform[] = ["web", "windows", "android", "ios", "macos"];

const STORAGE_KEYS = {
  peerId: "airbridge-web-peer-id",
  roomCode: "airbridge-web-room-code",
  nickname: "airbridge-web-nickname",
  platform: "airbridge-web-platform"
};

function App() {
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(STORAGE_KEYS.roomCode) || "");
  const [nickname, setNickname] = useState(() => localStorage.getItem(STORAGE_KEYS.nickname) || "");
  const [platform, setPlatform] = useState<Platform>(
    () => (localStorage.getItem(STORAGE_KEYS.platform) as Platform | null) || detectPlatform()
  );
  const [selfPeerId, setSelfPeerId] = useState(() => getOrCreatePeerId());
  const [selfNetworkKey, setSelfNetworkKey] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [signalStatus, setSignalStatus] = useState<SignalStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Not connected");
  const [peers, setPeers] = useState<PeerRecord[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState("");
  const [connectionViews, setConnectionViews] = useState<Record<string, ConnectionView>>({});
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [textDraft, setTextDraft] = useState("");
  const [transfers, setTransfers] = useState<TransferView[]>([]);
  const [dropActive, setDropActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const shouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const activeJoinRef = useRef<{ roomCode: string; nickname: string; platform: Platform } | null>(null);
  const connectionsRef = useRef(new Map<string, PeerConnectionEntry>());
  const pendingBinaryRef = useRef(new Map<string, PendingBinary>());
  const incomingAssembliesRef = useRef(new Map<string, IncomingAssembly>());
  const transferDecisionRef = useRef(new Map<string, (accepted: boolean) => void>());

  const sortedPeers = useMemo(
    () => peers.filter((peer) => peer.peerId !== selfPeerId).sort(sortPeers),
    [peers, selfPeerId]
  );
  const nearbyPeers = sortedPeers.filter((peer) => peer.networkKey && peer.networkKey === selfNetworkKey);
  const sameRoomPeers = sortedPeers.filter((peer) => peer.networkKey !== selfNetworkKey);
  const selectedPeer = sortedPeers.find((peer) => peer.peerId === selectedPeerId);
  const selectedConnection = selectedPeerId ? connectionViews[selectedPeerId] : undefined;
  const selectedChat = chatItems.filter((item) => item.peerId === selectedPeerId);
  const selectedTransfers = transfers.filter((item) => item.peerId === selectedPeerId);

  function connectToRoom(nextRoomCode = roomCode, nextNickname = nickname, nextPlatform = platform) {
    const cleanRoomCode = nextRoomCode.trim().replace(/\s+/g, "-").toUpperCase();
    const cleanNickname = nextNickname.trim();

    if (!cleanRoomCode || !cleanNickname) {
      setStatusMessage("Room code and nickname are required.");
      return;
    }

    localStorage.setItem(STORAGE_KEYS.roomCode, cleanRoomCode);
    localStorage.setItem(STORAGE_KEYS.nickname, cleanNickname);
    localStorage.setItem(STORAGE_KEYS.platform, nextPlatform);
    localStorage.setItem(STORAGE_KEYS.peerId, selfPeerId);

    shouldReconnectRef.current = true;
    activeJoinRef.current = { roomCode: cleanRoomCode, nickname: cleanNickname, platform: nextPlatform };
    setRoomCode(cleanRoomCode);
    setNickname(cleanNickname);
    setSignalStatus("connecting");
    setStatusMessage("Connecting to signaling server...");
    openSignalSocket(cleanRoomCode, cleanNickname, nextPlatform);
  }

  function openSignalSocket(nextRoomCode: string, nextNickname: string, nextPlatform: Platform) {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    const ws = new WebSocket(signalUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join_room",
          roomCode: nextRoomCode,
          nickname: nextNickname,
          peerId: selfPeerId,
          platform: nextPlatform,
          capabilities: { webrtc: true, text: true, file: true, native: false }
        })
      );
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerSignalMessage;
      handleSignalMessage(message);
    };

    ws.onclose = () => {
      if (!shouldReconnectRef.current) {
        setSignalStatus("closed");
        setStatusMessage("Disconnected from room.");
        return;
      }

      setSignalStatus("reconnecting");
      setStatusMessage("Signal connection dropped. Reconnecting...");
      reconnectTimerRef.current = window.setTimeout(() => {
        const active = activeJoinRef.current;
        if (active) {
          openSignalSocket(active.roomCode, active.nickname, active.platform);
        }
      }, 1800);
    };

    ws.onerror = () => {
      setStatusMessage("Signal server is unreachable.");
    };
  }

  function handleSignalMessage(message: ServerSignalMessage) {
    switch (message.type) {
      case "joined":
        setSelfPeerId(message.selfPeerId);
        setSelfNetworkKey(message.networkKey);
        setJoinedRoom(message.roomCode);
        setSignalStatus("connected");
        setStatusMessage("Connected to room.");
        return;
      case "room_snapshot":
        setPeers(message.peers);
        return;
      case "peer_joined":
        setPeers((current) => upsertPeer(current, message.peer));
        addSystemMessage(message.peer.peerId, `${message.peer.nickname} joined the room.`);
        return;
      case "peer_left":
        setPeers((current) => current.filter((peer) => peer.peerId !== message.peerId));
        updateConnectionView(message.peerId, "closed");
        connectionsRef.current.get(message.peerId)?.pc.close();
        connectionsRef.current.delete(message.peerId);
        return;
      case "offer":
        void receiveOffer(message.fromPeerId, message.connectionId, message.description);
        return;
      case "answer":
        void receiveAnswer(message.fromPeerId, message.description);
        return;
      case "ice_candidate":
        void receiveIce(message.fromPeerId, message.connectionId, message.candidate);
        return;
      case "error":
        setStatusMessage(message.message);
        return;
    }
  }

  function leaveRoom() {
    shouldReconnectRef.current = false;
    activeJoinRef.current = null;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
    wsRef.current?.send(JSON.stringify({ type: "leave_room" }));
    wsRef.current?.close();
    wsRef.current = null;

    for (const entry of connectionsRef.current.values()) {
      entry.pc.close();
    }
    connectionsRef.current.clear();

    setJoinedRoom("");
    setPeers([]);
    setSelectedPeerId("");
    setConnectionViews({});
    setSignalStatus("closed");
    setStatusMessage("Left room.");
  }

  async function connectPeer(peerId: string) {
    try {
      updateConnectionView(peerId, "connecting");
      await ensureDataChannel(peerId);
    } catch (error) {
      updateConnectionView(peerId, "failed", p2pErrorMessage(error));
    }
  }

  async function ensureDataChannel(peerId: string) {
    const existing = connectionsRef.current.get(peerId);
    if (existing?.channel?.readyState === "open") {
      return existing.channel;
    }
    if (existing) {
      return existing.openPromise;
    }

    const entry = createConnection(peerId, randomId("conn"));
    const channel = entry.pc.createDataChannel("airbridge", { ordered: true });
    setupChannel(peerId, channel, entry);

    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    sendSignal({
      type: "offer",
      targetPeerId: peerId,
      connectionId: entry.connectionId,
      description: { type: "offer", sdp: offer.sdp || "" }
    });

    return entry.openPromise;
  }

  async function receiveOffer(
    fromPeerId: string,
    connectionId: string,
    description: RTCSessionDescriptionInit
  ) {
    const existing = connectionsRef.current.get(fromPeerId);
    const entry = existing || createConnection(fromPeerId, connectionId);

    try {
      updateConnectionView(fromPeerId, "connecting");
      await entry.pc.setRemoteDescription(description);
      await flushQueuedIce(entry);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      sendSignal({
        type: "answer",
        targetPeerId: fromPeerId,
        connectionId,
        description: { type: "answer", sdp: answer.sdp || "" }
      });
    } catch (error) {
      updateConnectionView(fromPeerId, "failed", p2pErrorMessage(error));
    }
  }

  async function receiveAnswer(fromPeerId: string, description: RTCSessionDescriptionInit) {
    const entry = connectionsRef.current.get(fromPeerId);
    if (!entry) {
      return;
    }

    try {
      await entry.pc.setRemoteDescription(description);
      await flushQueuedIce(entry);
    } catch (error) {
      updateConnectionView(fromPeerId, "failed", p2pErrorMessage(error));
    }
  }

  async function receiveIce(fromPeerId: string, connectionId: string, candidate: IceCandidatePayload) {
    const entry = connectionsRef.current.get(fromPeerId) || createConnection(fromPeerId, connectionId);

    if (!entry.pc.remoteDescription) {
      entry.queuedIce.push(candidate);
      return;
    }

    try {
      await entry.pc.addIceCandidate(candidate);
    } catch (error) {
      updateConnectionView(fromPeerId, "failed", p2pErrorMessage(error));
    }
  }

  function createConnection(peerId: string, connectionId: string) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    let resolveOpen!: (channel: RTCDataChannel) => void;
    let rejectOpen!: (error: Error) => void;
    const openPromise = new Promise<RTCDataChannel>((resolve, reject) => {
      resolveOpen = resolve;
      rejectOpen = reject;
    });
    const entry: PeerConnectionEntry = {
      peerId,
      connectionId,
      pc,
      openPromise,
      resolveOpen,
      rejectOpen,
      queuedIce: []
    };

    pc.ondatachannel = (event) => setupChannel(peerId, event.channel, entry);
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      sendSignal({
        type: "ice_candidate",
        targetPeerId: peerId,
        connectionId: entry.connectionId,
        candidate: event.candidate.toJSON()
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        updateConnectionView(peerId, "open");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        const message = "P2P connection failed. Server relay is disabled for file privacy.";
        updateConnectionView(peerId, "failed", message);
        entry.rejectOpen(new Error(message));
      } else if (pc.connectionState === "closed") {
        updateConnectionView(peerId, "closed");
      } else if (pc.connectionState === "connecting") {
        updateConnectionView(peerId, "connecting");
      }
    };

    connectionsRef.current.set(peerId, entry);
    updateConnectionView(peerId, "connecting");
    return entry;
  }

  function setupChannel(peerId: string, channel: RTCDataChannel, entry: PeerConnectionEntry) {
    entry.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_BUFFERED_AMOUNT;

    channel.onopen = () => {
      updateConnectionView(peerId, "open");
      entry.resolveOpen(channel);
    };
    channel.onclose = () => updateConnectionView(peerId, "closed");
    channel.onerror = () => {
      const message = "DataChannel error. The P2P path may be blocked by this network.";
      updateConnectionView(peerId, "failed", message);
      entry.rejectOpen(new Error(message));
    };
    channel.onmessage = (event) => handleDataChannelMessage(peerId, event.data);
  }

  async function flushQueuedIce(entry: PeerConnectionEntry) {
    while (entry.queuedIce.length > 0) {
      const candidate = entry.queuedIce.shift();
      if (candidate) {
        await entry.pc.addIceCandidate(candidate);
      }
    }
  }

  function sendSignal(message: Record<string, unknown>) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }

  async function sendText() {
    const text = textDraft.trim();
    if (!selectedPeerId || !text) {
      return;
    }

    try {
      const channel = await ensureDataChannel(selectedPeerId);
      const message: DataChannelControlMessage = {
        type: "text_message",
        messageId: randomId("msg"),
        text,
        createdAt: Date.now(),
        fromName: nickname
      };
      channel.send(JSON.stringify(message));
      setChatItems((current) => [
        ...current,
        {
          id: message.messageId,
          peerId: selectedPeerId,
          direction: "outgoing",
          text,
          createdAt: message.createdAt,
          fromName: nickname
        }
      ]);
      setTextDraft("");
    } catch (error) {
      updateConnectionView(selectedPeerId, "failed", p2pErrorMessage(error));
    }
  }

  async function sendFiles(fileList: FileList | File[]) {
    if (!selectedPeerId) {
      return;
    }

    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }

    try {
      const channel = await ensureDataChannel(selectedPeerId);
      for (const file of files) {
        await offerAndSendFile(channel, selectedPeerId, file);
      }
    } catch (error) {
      updateConnectionView(selectedPeerId, "failed", p2pErrorMessage(error));
    }
  }

  async function offerAndSendFile(channel: RTCDataChannel, peerId: string, file: File) {
    const transferId = randomId("file");
    const peerName = peerNameFor(peerId);
    const createdAt = Date.now();

    setTransfers((current) => [
      {
        transferId,
        peerId,
        peerName,
        direction: "outgoing",
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        status: "waiting",
        bytes: 0,
        createdAt
      },
      ...current
    ]);

    const offer: DataChannelControlMessage = {
      type: "transfer_offer",
      transferId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      createdAt
    };

    channel.send(JSON.stringify(offer));
    const accepted = await waitForTransferDecision(transferId);
    if (!accepted) {
      patchTransfer(transferId, { status: "rejected", error: "Receiver rejected the file." });
      return;
    }

    patchTransfer(transferId, { status: "sending", bytes: 0 });
    await sendFileChunks(channel, transferId, file);
    channel.send(JSON.stringify({ type: "transfer_done", transferId } satisfies DataChannelControlMessage));
    patchTransfer(transferId, { status: "complete", bytes: file.size });
  }

  async function sendFileChunks(channel: RTCDataChannel, transferId: string, file: File) {
    let offset = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + DEFAULT_FILE_CHUNK_SIZE);
      const buffer = await chunk.arrayBuffer();
      const header: DataChannelControlMessage = {
        type: "transfer_chunk",
        transferId,
        offset,
        byteLength: buffer.byteLength
      };

      await waitForChannelBackpressure(channel);
      channel.send(JSON.stringify(header));
      await waitForChannelBackpressure(channel);
      channel.send(buffer);

      offset += buffer.byteLength;
      patchTransfer(transferId, { bytes: offset });
    }
  }

  function waitForTransferDecision(transferId: string) {
    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        transferDecisionRef.current.delete(transferId);
        resolve(false);
      }, 60_000);

      transferDecisionRef.current.set(transferId, (accepted) => {
        window.clearTimeout(timeout);
        transferDecisionRef.current.delete(transferId);
        resolve(accepted);
      });
    });
  }

  async function waitForChannelBackpressure(channel: RTCDataChannel) {
    while (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      if (channel.readyState !== "open") {
        throw new Error("DataChannel closed during transfer.");
      }
      await delay(25);
    }
  }

  function handleDataChannelMessage(peerId: string, data: string | ArrayBuffer | Blob) {
    if (typeof data === "string") {
      const message = JSON.parse(data) as DataChannelControlMessage;
      handleControlMessage(peerId, message);
      return;
    }

    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => handleBinaryChunk(peerId, buffer));
      return;
    }

    handleBinaryChunk(peerId, data);
  }

  function handleControlMessage(peerId: string, message: DataChannelControlMessage) {
    switch (message.type) {
      case "text_message":
        setChatItems((current) => [
          ...current,
          {
            id: message.messageId,
            peerId,
            direction: "incoming",
            text: message.text,
            createdAt: message.createdAt,
            fromName: message.fromName
          }
        ]);
        return;
      case "transfer_offer":
        incomingAssembliesRef.current.set(message.transferId, {
          transferId: message.transferId,
          peerId,
          name: message.name,
          size: message.size,
          mime: message.mime,
          chunks: [],
          received: 0
        });
        setTransfers((current) => [
          {
            transferId: message.transferId,
            peerId,
            peerName: peerNameFor(peerId),
            direction: "incoming",
            name: message.name,
            size: message.size,
            mime: message.mime,
            status: "offered",
            bytes: 0,
            createdAt: message.createdAt
          },
          ...current
        ]);
        return;
      case "transfer_accept":
        transferDecisionRef.current.get(message.transferId)?.(true);
        return;
      case "transfer_reject":
        transferDecisionRef.current.get(message.transferId)?.(false);
        patchTransfer(message.transferId, {
          status: "rejected",
          error: message.reason || "Receiver rejected the file."
        });
        return;
      case "transfer_chunk":
        pendingBinaryRef.current.set(peerId, message);
        return;
      case "transfer_done":
        finishIncomingTransfer(message.transferId);
        return;
      case "transfer_cancel":
        patchTransfer(message.transferId, {
          status: "cancelled",
          error: message.reason || "Transfer cancelled."
        });
        incomingAssembliesRef.current.delete(message.transferId);
        return;
    }
  }

  function handleBinaryChunk(peerId: string, buffer: ArrayBuffer) {
    const pending = pendingBinaryRef.current.get(peerId);
    if (!pending) {
      return;
    }

    pendingBinaryRef.current.delete(peerId);
    const assembly = incomingAssembliesRef.current.get(pending.transferId);
    if (!assembly) {
      return;
    }

    assembly.chunks.push(buffer);
    assembly.received += buffer.byteLength;
    patchTransfer(assembly.transferId, {
      status: "receiving",
      bytes: assembly.received
    });
  }

  function finishIncomingTransfer(transferId: string) {
    const assembly = incomingAssembliesRef.current.get(transferId);
    if (!assembly) {
      return;
    }

    const blob = new Blob(assembly.chunks, { type: assembly.mime || "application/octet-stream" });
    const downloadUrl = URL.createObjectURL(blob);
    incomingAssembliesRef.current.delete(transferId);
    patchTransfer(transferId, {
      status: "complete",
      bytes: assembly.size,
      downloadUrl
    });
  }

  function acceptTransfer(transfer: TransferView) {
    sendControl(transfer.peerId, { type: "transfer_accept", transferId: transfer.transferId });
    patchTransfer(transfer.transferId, { status: "receiving", bytes: 0 });
  }

  function rejectTransfer(transfer: TransferView) {
    sendControl(transfer.peerId, {
      type: "transfer_reject",
      transferId: transfer.transferId,
      reason: "Receiver rejected the file."
    });
    patchTransfer(transfer.transferId, { status: "rejected" });
    incomingAssembliesRef.current.delete(transfer.transferId);
  }

  function sendControl(peerId: string, message: DataChannelControlMessage) {
    const channel = connectionsRef.current.get(peerId)?.channel;
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(message));
    }
  }

  function patchTransfer(transferId: string, patch: Partial<TransferView>) {
    setTransfers((current) =>
      current.map((transfer) =>
        transfer.transferId === transferId ? { ...transfer, ...patch } : transfer
      )
    );
  }

  function updateConnectionView(peerId: string, status: ConnectionStatus, error?: string) {
    setConnectionViews((current) => ({
      ...current,
      [peerId]: { status, error }
    }));
  }

  function addSystemMessage(peerId: string, text: string) {
    setChatItems((current) => [
      ...current,
      {
        id: randomId("system"),
        peerId,
        direction: "system",
        text,
        createdAt: Date.now(),
        fromName: "AirBridge"
      }
    ]);
  }

  function peerNameFor(peerId: string) {
    return peers.find((peer) => peer.peerId === peerId)?.nickname || "Peer";
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    connectToRoom();
  }

  function handlePeerSelect(peerId: string) {
    setSelectedPeerId(peerId);
    void connectPeer(peerId);
  }

  const isConnected = signalStatus === "connected" || signalStatus === "reconnecting";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <h1>AirBridge</h1>
            <p>Public Web P2P</p>
          </div>
        </div>

        <form className="join-form" onSubmit={handleJoinSubmit}>
          <label>
            Room code
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder="CS-LAB"
              autoCapitalize="characters"
            />
          </label>
          <label>
            Nickname
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="Alice"
            />
          </label>
          <label>
            Platform
            <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
              {PLATFORM_OPTIONS.map((value) => (
                <option value={value} key={value}>
                  {PLATFORM_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {isConnected ? "Reconnect" : "Enter Room"}
            </button>
            {joinedRoom && (
              <button className="ghost-button" type="button" onClick={leaveRoom}>
                Leave
              </button>
            )}
          </div>
        </form>

        <div className={`signal-card status-${signalStatus}`}>
          <span className="status-dot" />
          <div>
            <strong>{signalStatusLabel(signalStatus)}</strong>
            <span>{statusMessage}</span>
          </div>
        </div>

        <dl className="room-meta">
          <div>
            <dt>Room</dt>
            <dd>{joinedRoom || "-"}</dd>
          </div>
          <div>
            <dt>Your ID</dt>
            <dd>{shortId(selfPeerId)}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{selfNetworkKey ? shortId(selfNetworkKey) : "-"}</dd>
          </div>
        </dl>
      </aside>

      <section className="device-panel">
        <div className="panel-heading">
          <div>
            <h2>Devices</h2>
            <p>Same room devices are visible; same public network is prioritized as Nearby.</p>
          </div>
          <span className="peer-count">{sortedPeers.length} online</span>
        </div>

        <PeerGroup
          title="Nearby"
          emptyText="No same-network peers yet."
          peers={nearbyPeers}
          selectedPeerId={selectedPeerId}
          connectionViews={connectionViews}
          onSelect={handlePeerSelect}
        />
        <PeerGroup
          title="Same Room"
          emptyText="Share the room code with another device."
          peers={sameRoomPeers}
          selectedPeerId={selectedPeerId}
          connectionViews={connectionViews}
          onSelect={handlePeerSelect}
        />
      </section>

      <section className="transfer-panel">
        {selectedPeer ? (
          <>
            <div className="peer-header">
              <div>
                <h2>{selectedPeer.nickname}</h2>
                <p>
                  {PLATFORM_LABELS[selectedPeer.platform]} - {shortId(selectedPeer.peerId)}
                </p>
              </div>
              <ConnectionBadge status={selectedConnection?.status || "idle"} />
            </div>

            {selectedConnection?.error && <div className="error-banner">{selectedConnection.error}</div>}

            <div className="message-list">
              {selectedChat.length === 0 ? (
                <div className="empty-state">No messages yet.</div>
              ) : (
                selectedChat.map((item) => (
                  <div className={`message ${item.direction}`} key={item.id}>
                    <span>{item.fromName}</span>
                    <p>{item.text}</p>
                  </div>
                ))
              )}
            </div>

            <div className="composer">
              <input
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void sendText();
                  }
                }}
                placeholder="Send a message through DataChannel"
              />
              <button className="primary-button" type="button" onClick={() => void sendText()}>
                Send
              </button>
            </div>

            <div
              className={`drop-zone ${dropActive ? "drop-active" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDropActive(false);
                void sendFiles(event.dataTransfer.files);
              }}
            >
              <strong>Drop files here</strong>
              <span>Files stay off the server and travel over WebRTC P2P.</span>
              <label className="file-picker">
                Select files
                <input
                  type="file"
                  multiple
                  onChange={(event) => {
                    if (event.target.files) {
                      void sendFiles(event.target.files);
                      event.target.value = "";
                    }
                  }}
                />
              </label>
            </div>

            <div className="transfer-list">
              {selectedTransfers.length === 0 ? (
                <div className="empty-state">No file transfers for this peer.</div>
              ) : (
                selectedTransfers.map((transfer) => (
                  <TransferRow
                    key={transfer.transferId}
                    transfer={transfer}
                    onAccept={() => acceptTransfer(transfer)}
                    onReject={() => rejectTransfer(transfer)}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <div className="select-empty">
            <div className="select-mark">P2P</div>
            <h2>Select a device</h2>
            <p>Choose a peer in this room to open a direct WebRTC channel for messages and files.</p>
          </div>
        )}
      </section>
    </main>
  );
}

type PeerGroupProps = {
  title: string;
  emptyText: string;
  peers: PeerRecord[];
  selectedPeerId: string;
  connectionViews: Record<string, ConnectionView>;
  onSelect: (peerId: string) => void;
};

function PeerGroup({ title, emptyText, peers, selectedPeerId, connectionViews, onSelect }: PeerGroupProps) {
  return (
    <div className="peer-group">
      <h3>{title}</h3>
      {peers.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div className="peer-list">
          {peers.map((peer) => (
            <button
              className={`peer-row ${selectedPeerId === peer.peerId ? "selected" : ""}`}
              key={peer.peerId}
              type="button"
              onClick={() => onSelect(peer.peerId)}
            >
              <span className="peer-avatar">{peer.nickname.slice(0, 1).toUpperCase()}</span>
              <span className="peer-main">
                <strong>{peer.nickname}</strong>
                <span>{shortId(peer.peerId)}</span>
              </span>
              <span className="platform-chip">{PLATFORM_LABELS[peer.platform]}</span>
              <ConnectionBadge status={connectionViews[peer.peerId]?.status || "idle"} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return <span className={`connection-badge connection-${status}`}>{connectionLabel(status)}</span>;
}

function TransferRow({
  transfer,
  onAccept,
  onReject
}: {
  transfer: TransferView;
  onAccept: () => void;
  onReject: () => void;
}) {
  const progress = transfer.size > 0 ? Math.min(100, Math.round((transfer.bytes / transfer.size) * 100)) : 0;
  return (
    <div className="transfer-row">
      <div className="transfer-main">
        <strong>{transfer.name}</strong>
        <span>
          {transfer.direction === "incoming" ? "From" : "To"} {transfer.peerName} -{" "}
          {formatBytes(transfer.bytes)} / {formatBytes(transfer.size)}
        </span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="transfer-actions">
        <span className={`transfer-status transfer-${transfer.status}`}>{transfer.status}</span>
        {transfer.status === "offered" && (
          <>
            <button type="button" className="small-button" onClick={onAccept}>
              Accept
            </button>
            <button type="button" className="small-button danger" onClick={onReject}>
              Reject
            </button>
          </>
        )}
        {transfer.downloadUrl && (
          <a className="small-button" href={transfer.downloadUrl} download={transfer.name}>
            Save
          </a>
        )}
      </div>
      {transfer.error && <p className="transfer-error">{transfer.error}</p>}
    </div>
  );
}

function getOrCreatePeerId() {
  const existing = localStorage.getItem(STORAGE_KEYS.peerId);
  if (existing) {
    return existing;
  }
  const next = randomId("web");
  localStorage.setItem(STORAGE_KEYS.peerId, next);
  return next;
}

function signalUrl() {
  const explicit = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (explicit) {
    return explicit;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/signal`;
}

function detectPlatform(): Platform {
  return "web";
}

function upsertPeer(current: PeerRecord[], peer: PeerRecord) {
  const withoutPeer = current.filter((item) => item.peerId !== peer.peerId);
  return [...withoutPeer, peer];
}

function sortPeers(a: PeerRecord, b: PeerRecord) {
  return a.nickname.localeCompare(b.nickname);
}

function signalStatusLabel(status: SignalStatus) {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Online";
    case "reconnecting":
      return "Reconnecting";
    case "closed":
      return "Offline";
    default:
      return "Ready";
  }
}

function connectionLabel(status: ConnectionStatus) {
  switch (status) {
    case "connecting":
      return "P2P...";
    case "open":
      return "P2P";
    case "failed":
      return "Blocked";
    case "closed":
      return "Closed";
    default:
      return "Idle";
  }
}

function shortId(value: string) {
  return value ? value.slice(0, 8) : "-";
}

function randomId(prefix: string) {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function p2pErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "P2P connection failed. Server relay is disabled for file privacy.";
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default App;
