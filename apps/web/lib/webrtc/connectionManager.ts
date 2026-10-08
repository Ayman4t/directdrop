import { LOW_WATER } from './streamChunker';

export type SignalType = 'webrtc-offer' | 'webrtc-answer' | 'ice-candidate';
export type SignalFn = (type: SignalType, to: string, payload: unknown) => void;

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Optional TURN fallback for symmetric NATs / strict 4G-5G carriers
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [{ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USER, credential: process.env.NEXT_PUBLIC_TURN_PASS }]
      : []),
  ],
};

interface Conn { pc: RTCPeerConnection; channel?: RTCDataChannel; pending: RTCIceCandidateInit[] }

/** One RTCPeerConnection per peer. The sender is always the offerer; the receiver gets the channel via ondatachannel. */
export class ConnectionManager {
  private conns = new Map<string, Conn>();
  constructor(
    private signal: SignalFn,
    private onChannel: (peerId: string, ch: RTCDataChannel) => void, // fires for incoming channels
  ) {}

  private create(peerId: string): Conn {
    const pc = new RTCPeerConnection(ICE);
    const conn: Conn = { pc, pending: [] };
    pc.onicecandidate = (e) => e.candidate && this.signal('ice-candidate', peerId, e.candidate.toJSON());
    pc.ondatachannel = (e) => { this.setup(peerId, e.channel); this.onChannel(peerId, e.channel); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(peerId);
    };
    this.conns.set(peerId, conn);
    return conn;
  }

  private setup(peerId: string, ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = LOW_WATER;
    const c = this.conns.get(peerId);
    if (c) c.channel = ch;
  }

  /** Initiator side: resolves with an open DataChannel (reuses an existing one). */
  async connect(peerId: string): Promise<RTCDataChannel> {
    const existing = this.conns.get(peerId)?.channel;
    if (existing?.readyState === 'open') return existing;
    this.close(peerId);

    const { pc } = this.create(peerId);
    const ch = pc.createDataChannel('directdrop', { ordered: true });
    this.setup(peerId, ch);
    const opened = new Promise<RTCDataChannel>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 20_000);
      ch.onopen = () => (clearTimeout(timer), resolve(ch));
      ch.onclose = () => (clearTimeout(timer), reject(new Error('Channel closed')));
    });
    await pc.setLocalDescription(await pc.createOffer());
    this.signal('webrtc-offer', peerId, pc.localDescription);
    return opened;
  }

  /** Feed every relayed signaling message here. */
  async handleSignal(from: string, type: SignalType, payload: any) {
    if (type === 'webrtc-offer') {
      this.close(from); // a fresh offer supersedes any stale connection
      const conn = this.create(from);
      await conn.pc.setRemoteDescription(payload);
      await this.flush(conn);
      await conn.pc.setLocalDescription(await conn.pc.createAnswer());
      this.signal('webrtc-answer', from, conn.pc.localDescription);
      return;
    }
    const conn = this.conns.get(from);
    if (!conn) return;
    if (type === 'webrtc-answer') {
      await conn.pc.setRemoteDescription(payload);
      await this.flush(conn);
    } else if (conn.pc.remoteDescription) {
      await conn.pc.addIceCandidate(payload).catch(() => {});
    } else conn.pending.push(payload); // trickle ICE can arrive before the SDP
  }

  private async flush(conn: Conn) {
    for (const c of conn.pending.splice(0)) await conn.pc.addIceCandidate(c).catch(() => {});
  }

  close(peerId: string) {
    const c = this.conns.get(peerId);
    if (!c) return;
    this.conns.delete(peerId);
    c.channel?.close();
    c.pc.close();
  }

  closeAll() { [...this.conns.keys()].forEach((id) => this.close(id)); }
}
