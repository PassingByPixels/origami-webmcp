/* Disk in, disk out. File System Access where the browser has it, a download blob where it
   does not, plus a best-effort localStorage autosave so a refresh never costs the session.
   Every storage call is wrapped: a private window, a full quota or a blocked origin must
   degrade to "no autosave", never to a broken page. */

interface FsaWritable {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}
interface FsaFileHandle {
  name: string;
  createWritable(): Promise<FsaWritable>;
  getFile(): Promise<File>;
  /** Chrome keeps write permission across visits for a handle the human granted once; these
      let the page ask what it still holds. MEASURED present on Chrome 151 (both functions). */
  queryPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
}
interface FsaWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FsaFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FsaFileHandle>;
}

const fsa = (): FsaWindow => window as unknown as FsaWindow;

export const canPickFiles = (): boolean => typeof fsa().showOpenFilePicker === 'function';
export const canSaveInPlace = (): boolean => typeof fsa().showSaveFilePicker === 'function';

const PICKER_TYPES = [{ description: 'Origami Fold', accept: { 'text/html': ['.origami.html', '.html'] } }];

export interface OpenedFile {
  text: string;
  name: string;
  handle: FsaFileHandle | null;
}

/** Open a Fold. Uses the FSA picker when available (so Save can write back in place),
    otherwise a plain file input (Save then falls back to a download). Null = cancelled. */
export async function pickFile(): Promise<OpenedFile | null> {
  const w = fsa();
  if (w.showOpenFilePicker) {
    let handles: FsaFileHandle[];
    try {
      handles = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
    } catch {
      return null; // the user dismissed the picker
    }
    const handle = handles[0];
    if (!handle) return null;
    const file = await handle.getFile();
    return { text: await file.text(), name: file.name, handle };
  }
  return legacyOpen();
}

function legacyOpen(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,text/html';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? { text: await file.text(), name: file.name, handle: null } : null);
    });
    // a dismissed dialog fires no event in some browsers; the promise simply never settles,
    // which is harmless here (no state is held open behind it)
    input.click();
  });
}

export type SaveOutcome = { ok: true; how: 'in-place' | 'download'; name: string; bytes?: number } | { ok: false; reason: string };

/**
 * Write back to the handle the file came from, and VERIFY the bytes landed by reading the file
 * size back. save_deck reports `saved: true` on the strength of this, so "createWritable did not
 * throw" is not good enough.
 *
 * Permission is checked BEFORE the write rather than after a failure: Chrome can still hold the
 * handle while the write permission has lapsed, and `prompt` cannot be resolved by an unattended
 * agent (requestPermission needs a user gesture), so the honest move is to say so rather than to
 * throw an opaque error.
 */
export async function saveToHandle(handle: FsaFileHandle, text: string): Promise<SaveOutcome> {
  try {
    if (typeof handle.queryPermission === 'function') {
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted') {
        return {
          ok: false,
          reason:
            state === 'prompt'
              ? 'write permission for this file has lapsed and re-granting it needs a click — press Save in the page'
              : `write permission for this file is "${state}"`,
        };
      }
    }
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    const bytes = (await handle.getFile()).size;
    const expected = new TextEncoder().encode(text).length;
    if (bytes !== expected) return { ok: false, reason: `wrote ${expected} bytes but the file holds ${bytes}` };
    return { ok: true, how: 'in-place', name: handle.name, bytes };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export interface SaveAsResult extends Object {
  outcome: SaveOutcome;
  handle: FsaFileHandle | null;
}

/** Ask for a location (FSA), or fall back to a download of the same bytes. */
export async function saveAs(text: string, suggestedName: string): Promise<SaveAsResult> {
  const w = fsa();
  if (w.showSaveFilePicker) {
    let handle: FsaFileHandle;
    try {
      handle = await w.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
    } catch {
      return { outcome: { ok: false, reason: 'cancelled' }, handle: null };
    }
    return { outcome: await saveToHandle(handle, text), handle };
  }
  downloadBlob(text, suggestedName);
  return { outcome: { ok: true, how: 'download', name: suggestedName }, handle: null };
}

export function downloadBlob(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- autosave ---------- */

/* NAMESPACED PER PAGE. localStorage is shared by every page on the origin, so /draw/ and
   /charts/ would otherwise autosave over each other — and each would resume the other's
   document on load, silently. Folio's namespace is '' and its key is the historical string
   byte for byte, so nothing already in a human's browser is orphaned by this. */
export const autosaveKey = (ns: string): string => (ns ? `origami-webmcp:autosave/v1:${ns}` : 'origami-webmcp:autosave/v1');

export interface AutosaveRecord {
  name: string;
  text: string;
  at: number;
  /** The review queue at the time of the save. A refresh used to drop staged proposals on the
      floor while keeping the deck, which is the worst of both: the human came back to a Fold
      whose pending changes had silently vanished. Older records have no field here. */
  proposals?: readonly unknown[];
}

export function readAutosave(ns: string): AutosaveRecord | null {
  try {
    const raw = localStorage.getItem(autosaveKey(ns));
    if (!raw) return null;
    const rec = JSON.parse(raw) as AutosaveRecord;
    return typeof rec?.text === 'string' && rec.text.length > 0 ? rec : null;
  } catch {
    return null;
  }
}

export function writeAutosave(ns: string, name: string, text: string, proposals: readonly unknown[] = []): boolean {
  try {
    localStorage.setItem(autosaveKey(ns), JSON.stringify({ name, text, at: Date.now(), proposals } satisfies AutosaveRecord));
    return true;
  } catch {
    return false; // private window, quota, or storage blocked — the app keeps working
  }
}

export function clearAutosave(ns: string): void {
  try {
    localStorage.removeItem(autosaveKey(ns));
  } catch {
    /* nothing to do */
  }
}

export type { FsaFileHandle };
