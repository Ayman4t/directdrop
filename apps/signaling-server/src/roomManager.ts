import { createHash, randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ClientMsg, DeviceType, PeerInfo, ServerMsg, SignalType } from './types.js';

interface Member { info: PeerInfo; ws: WebSocket; room: string }
const PIN_RE = /^\d{6}$/;
const MAX_ROOM_SIZE = 50;
const DEVICES: DeviceType[] = ['laptop', 'phone', 'tablet'];

export const send = (ws: WebSocket, msg: ServerMsg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

export class RoomManager {
  private rooms = new Map<string, Map<string, Member>>();
  private members = new Map<string, Member>();

  /** SHA-256 of the public IP (optionally salted) — the raw IP is never stored. */
  static hashIp(ip: string) {
    return createHash('sha256').update((process.env.IP_SALT ?? '') + ip).digest('hex');
  }

  createPin() {
    let pin: string;
    do pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (this.rooms.has(`pin:${pin}`));
    return pin;
  }

  join(ws: WebSocket, msg: Extract<ClientMsg, { type: 'join' }>, ipHash: string): boolean {
    const { peerId, peer, customRoom } = msg;
    const fail = (message: string) => (send(ws, { type: 'error', message }), false);

    if (typeof peerId !== 'string' || !peerId || peerId.length > 64 || this.members.has(peerId))
      return fail('Invalid or duplicate peerId');
    if (customRoom !== undefined && !PIN_RE.test(customRoom)) return fail('Room code must be 6 digits');

    const room = customRoom ? `pin:${customRoom}` : `ip:${ipHash}`;
    const roomMembers = this.rooms.get(room) ?? new Map<string, Member>();
    if (roomMembers.size >= MAX_ROOM_SIZE) return fail('Room is full');

    const info: PeerInfo = {
      id: peerId,
      name: String(peer?.name ?? 'Unknown').slice(0, 64),
      deviceType: DEVICES.includes(peer?.deviceType) ? peer.deviceType : 'laptop',
      os: String(peer?.os ?? '').slice(0, 32),
    };
    const member: Member = { info, ws, room };

    send(ws, { type: 'peers', room: customRoom ?? 'local', peers: [...roomMembers.values()].map((m) => m.info) });
    roomMembers.set(peerId, member);
    this.rooms.set(room, roomMembers);
    this.members.set(peerId, member);
    this.broadcast(room, { type: 'peer-joined', peer: info }, peerId);
    return true;
  }

  /** Forward SDP/ICE only between peers of the same room. */
  relay(fromId: string, toId: string, type: SignalType, payload: unknown) {
    const from = this.members.get(fromId);
    const to = this.members.get(toId);
    if (!from || !to || from.room !== to.room) return;
    send(to.ws, { type, from: fromId, payload });
  }

  leave(peerId: string) {
    const m = this.members.get(peerId);
    if (!m) return;
    this.members.delete(peerId);
    const roomMembers = this.rooms.get(m.room);
    roomMembers?.delete(peerId);
    if (roomMembers?.size === 0) this.rooms.delete(m.room);
    else this.broadcast(m.room, { type: 'peer-disconnected', peerId });
  }

  private broadcast(room: string, msg: ServerMsg, exceptId?: string) {
    for (const [id, m] of this.rooms.get(room) ?? []) if (id !== exceptId) send(m.ws, msg);
  }
}
