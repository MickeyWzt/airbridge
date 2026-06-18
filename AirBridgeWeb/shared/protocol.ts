export const AIRBRIDGE_WEB_PROTOCOL_VERSION = "0.1.0";
export const DEFAULT_FILE_CHUNK_SIZE = 64 * 1024;
export const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;
export const LOW_BUFFERED_AMOUNT = 512 * 1024;

export type Platform = "web" | "windows" | "android" | "ios" | "macos" | "unknown";

export interface PeerCapabilities {
  webrtc: boolean;
  text: boolean;
  file: boolean;
  native?: boolean;
}

export interface PeerRecord {
  peerId: string;
  nickname: string;
  platform: Platform;
  roomCode: string;
  networkKey: string;
  capabilities: PeerCapabilities;
  joinedAt: number;
  lastSeen: number;
}

export interface SessionDescriptionPayload {
  type: "offer" | "answer";
  sdp: string;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type ClientSignalMessage =
  | {
      type: "join_room";
      roomCode: string;
      nickname: string;
      peerId?: string;
      platform?: Platform;
      capabilities?: Partial<PeerCapabilities>;
    }
  | { type: "leave_room" }
  | {
      type: "offer";
      targetPeerId: string;
      connectionId: string;
      description: SessionDescriptionPayload;
    }
  | {
      type: "answer";
      targetPeerId: string;
      connectionId: string;
      description: SessionDescriptionPayload;
    }
  | {
      type: "ice_candidate";
      targetPeerId: string;
      connectionId: string;
      candidate: IceCandidatePayload;
    };

export type ServerSignalMessage =
  | {
      type: "joined";
      selfPeerId: string;
      roomCode: string;
      networkKey: string;
      protocolVersion: string;
    }
  | {
      type: "room_snapshot";
      selfPeerId: string;
      roomCode: string;
      peers: PeerRecord[];
    }
  | { type: "peer_joined"; peer: PeerRecord }
  | { type: "peer_left"; peerId: string }
  | {
      type: "offer";
      fromPeerId: string;
      connectionId: string;
      description: SessionDescriptionPayload;
    }
  | {
      type: "answer";
      fromPeerId: string;
      connectionId: string;
      description: SessionDescriptionPayload;
    }
  | {
      type: "ice_candidate";
      fromPeerId: string;
      connectionId: string;
      candidate: IceCandidatePayload;
    }
  | { type: "error"; code: string; message: string };

export type DataChannelControlMessage =
  | {
      type: "transfer_offer";
      transferId: string;
      name: string;
      size: number;
      mime: string;
      createdAt: number;
    }
  | { type: "transfer_accept"; transferId: string }
  | { type: "transfer_reject"; transferId: string; reason?: string }
  | {
      type: "transfer_chunk";
      transferId: string;
      offset: number;
      byteLength: number;
    }
  | { type: "transfer_done"; transferId: string }
  | { type: "transfer_cancel"; transferId: string; reason?: string }
  | {
      type: "text_message";
      messageId: string;
      text: string;
      createdAt: number;
      fromName: string;
    };
