const ADJ = ['Swift', 'Silent', 'Brave', 'Calm', 'Clever', 'Bright', 'Quiet', 'Lucky', 'Noble', 'Rapid'];
const ANIMAL = ['Falcon', 'Panther', 'Otter', 'Fox', 'Lynx', 'Heron', 'Wolf', 'Orca', 'Raven', 'Tiger'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export type DeviceType = 'laptop' | 'phone' | 'tablet';
export interface Identity { peerId: string; name: string; deviceType: DeviceType; os: string; browser: string }

export function detectDevice(ua = navigator.userAgent) {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const ipadOS = os === 'macOS' && navigator.maxTouchPoints > 1; // iPadOS masquerades as Mac
  const deviceType: DeviceType = /iPad|Tablet/.test(ua) || ipadOS || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? 'tablet' : /iPhone|Android|Mobi/.test(ua) ? 'phone' : 'laptop';
  return { os: ipadOS ? 'iPadOS' : os, browser, deviceType };
}

/** Stable per-browser identity, e.g. "Swift Falcon - Chrome on Mac". */
export function getIdentity(): Identity {
  const dev = detectDevice();
  let base = '', peerId = '';
  try {
    base = localStorage.getItem('dd:name') ?? '';
    peerId = sessionStorage.getItem('dd:peerId') ?? ''; // unique per tab so two tabs can coexist
  } catch { /* storage blocked: fall back to ephemeral identity */ }
  if (!base) base = `${pick(ADJ)} ${pick(ANIMAL)}`;
  if (!peerId) peerId = crypto.randomUUID();
  try { localStorage.setItem('dd:name', base); sessionStorage.setItem('dd:peerId', peerId); } catch {}
  return { peerId, name: `${base} - ${dev.browser} on ${dev.os}`, ...dev };
}
