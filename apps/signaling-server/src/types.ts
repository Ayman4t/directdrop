export type DeviceType = 'laptop' | 'phone' | 'tablet';
export interface PeerInfo { id: string; name: string; deviceType: DeviceType; os: string }
export type SignalType = 'webrtc-offer' | 'webrtc-answer' | 'ice-candidate';

export type ClientMsg =
  | { type: 'join'; peerId: string; peer: Omit<PeerInfo, 'id'>; customRoom?: string }
  | { type: 'create-room' }
  | { type: SignalType; to: string; payload: unknown };

export type ServerMsg =
  | { type: 'peers'; room: string; peers: PeerInfo[] }
  | { type: 'room-created'; pin: string }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-disconnected'; peerId: string }
  | { type: SignalType; from: string; payload: unknown }
  | { type: 'error'; message: string };
