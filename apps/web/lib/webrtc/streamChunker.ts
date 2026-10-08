export const CHUNK_SIZE = 64 * 1024;      // 64 KB
export const HIGH_WATER = 1024 * 1024;    // pause reading above 1 MB buffered
export const LOW_WATER = 256 * 1024;      // resume when buffer drains below 256 KB

export interface FileMeta { id: string; name: string; size: number; mimeType: string; totalChunks: number }
export type Control =
  | ({ type: 'file-meta' } & FileMeta)
  | { type: 'accept' | 'decline' | 'cancel' | 'file-end'; id: string };
export interface Progress { bytes: number; total: number; speed: number } // speed in bytes/s

export const buildMeta = (file: File): FileMeta => ({
  id: crypto.randomUUID(), name: file.name, size: file.size,
  mimeType: file.type || 'application/octet-stream', totalChunks: Math.ceil(file.size / CHUNK_SIZE),
});

function waitForDrain(ch: RTCDataChannel, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ch.removeEventListener('bufferedamountlow', ok);
      ch.removeEventListener('close', fail);
      signal.removeEventListener('abort', fail);
    };
    const ok = () => (cleanup(), resolve());
    const fail = () => (cleanup(), reject(new Error('Transfer aborted')));
    ch.addEventListener('bufferedamountlow', ok);
    ch.addEventListener('close', fail);
    signal.addEventListener('abort', fail);
  });
}

/** Call only after the receiver has sent `accept`. Streams one 64 KB slice at a time. */
export async function sendFile(
  ch: RTCDataChannel, file: File, id: string,
  onProgress: (p: Progress) => void, signal: AbortSignal,
) {
  ch.bufferedAmountLowThreshold = LOW_WATER;
  let offset = 0, lastT = performance.now(), lastBytes = 0;

  while (offset < file.size) {
    if (signal.aborted || ch.readyState !== 'open') throw new Error('Transfer aborted');
    if (ch.bufferedAmount > HIGH_WATER) await waitForDrain(ch, signal);

    const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer(); // reads only this slice into RAM
    ch.send(buf);
    offset += buf.byteLength;

    const now = performance.now();
    if (now - lastT >= 250) {
      onProgress({ bytes: offset, total: file.size, speed: ((offset - lastBytes) / (now - lastT)) * 1000 });
      lastT = now; lastBytes = offset;
    }
  }
  ch.send(JSON.stringify({ type: 'file-end', id } satisfies Control));
  onProgress({ bytes: file.size, total: file.size, speed: 0 });
}

/** Receiver: streams to disk when the File System Access API exists, else buffers in memory. */
export class FileReceiver {
  received = 0;
  private chunks: ArrayBuffer[] = [];
  private writer?: FileSystemWritableFileStream;
  private queue: Promise<void> = Promise.resolve();
  private constructor(readonly meta: FileMeta) {}

  /** Call directly from the Accept click handler: showSaveFilePicker needs a user gesture. */
  static async create(meta: FileMeta) {
    const r = new FileReceiver(meta);
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker.call(window, { suggestedName: meta.name });
        r.writer = await handle.createWritable();
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') throw e; // user cancelled the save dialog
        // any other failure: fall back to in-memory assembly
      }
    }
    return r;
  }

  push(buf: ArrayBuffer) {
    this.received += buf.byteLength;
    if (this.writer) {
      const w = this.writer;
      this.queue = this.queue.then(() => w.write(buf)); // serialise writes, keep order
    } else this.chunks.push(buf);
  }

  /** Verifies byte count, then finalises. Returns a Blob only for the in-memory path. */
  async finish(): Promise<Blob | null> {
    if (this.received !== this.meta.size) throw new Error(`Incomplete: ${this.received}/${this.meta.size} bytes`);
    if (this.writer) { await this.queue; await this.writer.close(); return null; }
    const blob = new Blob(this.chunks, { type: this.meta.mimeType });
    this.chunks = [];
    return blob;
  }

  async abort() {
    this.chunks = [];
    await this.queue.catch(() => {});
    await this.writer?.abort().catch(() => {});
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
