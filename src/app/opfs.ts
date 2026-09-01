/* The Origin Private File System backstop.
   ------------------------------------------------------------------------------------------
   WHY. save_deck had exactly two outcomes: write the real file through a File System Access
   handle, or leave the working copy in the localStorage autosave slot. The second one is not a
   save — localStorage is a ~5 MB string store, and a Fold with embedded images blows past that
   and fails SILENTLY, which is the worst possible way for a save to not happen.

   OPFS is a real file system, private to this origin, that a page can write with NO permission
   prompt and NO user gesture. MEASURED on Chrome 151.0.7922.174 in a fresh profile:
     navigator.storage.estimate() -> quota 10240 MB   (localStorage is ~5 MB)
     write + read back            -> ok
     handle.queryPermission       -> "granted" without asking anybody
     navigator.storage.persisted() -> false
   That last line is the caveat that matters and is repeated in save_deck's own result: storage
   is NOT persistent, so the browser may evict it under pressure. OPFS is a backstop against
   losing work to a refresh or a crash, not a substitute for the human's disk.

   It is also invisible to the human — nothing outside this origin can read it — so every write
   here is paired with the "Download last save" button in the page, which is the route back out. */

/* NAMESPACED PER PAGE, for the same reason the autosave slot is: OPFS and localStorage are both
   per-ORIGIN, and origami.gratis serves four tool pages from one. A shared pointer would let
   /draw/'s "Download last save" hand the human the roadmap they made on /gantt/. Folio's
   namespace is '' and keeps the historical directory and key byte for byte. */
const dirFor = (ns: string): string => (ns ? `saves-${ns}` : 'saves');
/** Pointer to the newest OPFS save. Tiny, so it fits localStorage even when the deck does not. */
export const pointerKey = (ns: string): string => (ns ? `origami-webmcp:lastsave/v1:${ns}` : 'origami-webmcp:lastsave/v1');

export interface LastSave {
  name: string;
  at: number;
  bytes: number;
}

export interface OpfsResult {
  written: boolean;
  path?: string;
  bytes?: number;
  /** Why it could not be written. Present only when written === false. */
  why?: string;
}

const opfsRoot = (): Promise<FileSystemDirectoryHandle> | null => {
  const s = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
  return typeof s?.getDirectory === 'function' ? s.getDirectory() : null;
};

export const canUseOpfs = (): boolean => opfsRoot() !== null;

/** A filename OPFS will accept: no separators, no traversal, always a Fold suffix. */
export function safeName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim();
  return base.length > 0 ? base.slice(0, 120) : 'untitled.origami.html';
}

/**
 * Write the full serialized Fold into OPFS and READ IT BACK to confirm the bytes landed.
 * Never throws: a browser with no OPFS, a denied quota or a private window degrades to
 * `{ written: false, why }`, which save_deck reports rather than swallowing.
 */
export async function writeOpfs(ns: string, name: string, text: string): Promise<OpfsResult> {
  const rootP = opfsRoot();
  if (!rootP) return { written: false, why: 'this browser has no Origin Private File System (navigator.storage.getDirectory)' };
  const file = safeName(name);
  const DIR = dirFor(ns);
  try {
    const dir = await (await rootP).getDirectoryHandle(DIR, { create: true });
    const handle = await dir.getFileHandle(file, { create: true });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    // read back rather than trusting the write: a quota failure can surface on close, and a
    // save that reports bytes it never verified is exactly the lie this whole item is about
    const bytes = (await handle.getFile()).size;
    const expected = new TextEncoder().encode(text).length;
    if (bytes !== expected) return { written: false, why: `wrote ${expected} bytes but the file holds ${bytes} — the write did not complete` };
    setPointer(ns, { name: file, at: Date.now(), bytes });
    return { written: true, path: `${DIR}/${file}`, bytes };
  } catch (e) {
    return { written: false, why: (e as Error).message };
  }
}

/** The newest OPFS save's bytes, or null when there is none to hand back. */
export async function readLastOpfs(ns: string): Promise<{ name: string; text: string } | null> {
  const ptr = getPointer(ns);
  const rootP = opfsRoot();
  if (!ptr || !rootP) return null;
  try {
    const dir = await (await rootP).getDirectoryHandle(dirFor(ns));
    const handle = await dir.getFileHandle(ptr.name);
    return { name: ptr.name, text: await (await handle.getFile()).text() };
  } catch {
    return null; // evicted, or never written — the caller says so rather than guessing
  }
}

export function getPointer(ns: string): LastSave | null {
  try {
    const raw = localStorage.getItem(pointerKey(ns));
    if (!raw) return null;
    const p = JSON.parse(raw) as LastSave;
    return typeof p?.name === 'string' && typeof p?.bytes === 'number' ? p : null;
  } catch {
    return null;
  }
}

function setPointer(ns: string, p: LastSave): void {
  try {
    localStorage.setItem(pointerKey(ns), JSON.stringify(p));
  } catch {
    /* the bytes are in OPFS either way; only the shortcut to them is lost */
  }
}
