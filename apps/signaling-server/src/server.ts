import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager, send } from './roomManager.js';
import type { ClientMsg } from './types.js';

const PORT = Number(process.env.PORT ?? 8080);
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set behind Railway/Fly/Render proxies
const STATIC_DIR = normalize(process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web-static', import.meta.url)));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css',
};
const rooms = new RoomManager();

// Serves the static website (apps/web-static) and /join/<pin> deep links.
const http = createServer(async (req, res) => {
  let path = '/';
  try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { /* keep '/' */ }
  if (path === '/' || /^\/join\/\d{6}$/.test(path)) path = '/index.html';
  const file = normalize(join(STATIC_DIR, path));
  if (!file.startsWith(STATIC_DIR)) return void res.writeHead(403).end();
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': path === '/sw.js' || path === '/index.html' ? 'no-cache' : 'public, max-age=300',
    }).end(data);
  } catch { res.writeHead(404).end('Not found'); }
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 }); // signaling only

const clientIp = (req: IncomingMessage) =>
  (TRUST_PROXY ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() : undefined) ??
  req.socket.remoteAddress ?? 'unknown';

wss.on('connection', (ws, req) => {
  const ipHash = RoomManager.hashIp(clientIp(req));
  let peerId: string | null = null;
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg?.type) {
      case 'join':
        if (!peerId && rooms.join(ws, msg, ipHash)) peerId = msg.peerId;
        break;
      case 'create-room':
        send(ws, { type: 'room-created', pin: rooms.createPin() });
        break;
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'ice-candidate':
        if (peerId && typeof msg.to === 'string') rooms.relay(peerId, msg.to, msg.type, msg.payload);
        break;
    }
  });
  ws.on('close', () => { clearInterval(heartbeat); if (peerId) rooms.leave(peerId); });
  ws.on('error', () => ws.terminate());
});

http.listen(PORT, '0.0.0.0', () => console.log(`DirectDrop running → http://localhost:${PORT}`));
