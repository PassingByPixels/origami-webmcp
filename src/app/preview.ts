import type { DeckStore } from '../core/deck-store.js';
import { injectMeasurer } from './measure.js';

/**
 * The live view of the Fold.
 *
 * The deck IS its own renderer, so the honest preview is the real file: serialize the current
 * model and hand the whole .origami.html to an iframe via srcdoc. The frame gets
 * `sandbox="allow-scripts"` and NEVER `allow-same-origin` — the embedded runtime may execute
 * so the deck renders, but it sits on an opaque origin with no reach into this page, no
 * storage, and no way to read the file the human opened.
 *
 * ONE PERMISSION, `allow="fullscreen"`. The deck's own Present button (vendor/runtime-dist,
 * `present()`) adds `html.o-present` and then calls `documentElement.requestFullscreen()`. A
 * frame that was not granted the fullscreen permission rejects that call — measured in real
 * Chromium: `document.fullscreenEnabled` false, the promise rejecting `TypeError: Disallowed by
 * permissions policy` — and the runtime swallows it (`.catch(() => void 0)`), so Present became
 * a near-silent no-op: the class landed, the deck's footer arrows and brand mark went away
 * inside the same small pane, and nothing presented. The permission is granted on the iframe
 * element in src/app/index.html and src/app/mini.html. It is fullscreen and nothing else; the
 * sandbox string is untouched, and `allow="fullscreen"` alone is enough for the build's own
 * targets (esbuild: chrome120 / firefox120 / safari17) — the legacy `allowfullscreen` beside it
 * only makes Chrome log "Allow attribute will take precedence".
 *
 * THE BRIDGE. The srcdoc copy — and ONLY the srcdoc copy — carries one small appended script.
 * The save path serializes separately (DeckStore.serialize, straight to disk/OPFS), so the
 * bytes a human or an agent saves are the deck and nothing else; an e2e check asserts the
 * saved file contains no BRIDGE_MARKER. Appending is safe for the same reason the measurer's
 * is (see measure.ts): every slide's content has already passed validateSlideContent, and the
 * insert goes at the LAST </body>, past the runtime bundle that carries that string itself.
 */

/** Grep handle. Present in the preview srcdoc; must NEVER appear in a saved Fold. */
export const BRIDGE_MARKER = 'origami-preview-bridge';

/* THE NAVIGATION HOOK, read out of vendor/runtime-dist rather than guessed:
     - vendor/runtime-dist/origami-runtime.iife.js ends with
         `window.__origami = { version: o.v, viewer: i }`
       where `i` is the object createViewer() returned.
     - vendor/runtime-dist/viewer.d.ts types that object:
         go(i: number) · next() · prev() · current(): string · visibleOrder: string[]
   So `window.__origami.viewer.go(n)` is the runtime's OWN navigation — the same call its tab
   strip and pips make — and `visibleOrder.indexOf(current())` is the fold on show. The older
   Folio build publishes the identical shape as `window.__folio`, so both are probed.
   The runtime fires no event on a fold change (no hashchange, no CustomEvent anywhere in the
   bundle), so the index is polled; comparing one integer every 250 ms is cheaper than a
   MutationObserver on the pip row.

   EDIT IS REMOVED. Measured on this build, 2026-08-31, in real Chromium against the shipped
   dist/: clicking the deck's own `✎ Edit` (.o-edit-toggle) turns on html.o-edit-mode and its
   "changes live here until you save a copy" banner, and typing into a [data-oedit] node does
   change the frame — but the parent's model never hears about it (the serialized deck did not
   contain the typed text even before any tool ran), and the next write tool re-rendered the
   frame and wiped it. A control that silently loses the human's work is a trap, so the bridge
   takes the button out. The runtime removes it the same way for published decks
   (`data-origami-published` -> `.o-edit-toggle.remove()`), so this is its own retirement path. */
const BRIDGE = `
<script data-${BRIDGE_MARKER}="1">(function(){
  // INERT UNLESS FRAMED. This script only ever belongs to a preview inside the app. If these
  // bytes ever reach a document opened on their own — a Fold scraped out of the srcdoc rather
  // than out of the save path — it must do nothing at all: no messages to itself, and above all
  // no removing that document's Edit button, which is not this app's to take away.
  if(window.parent===window) return;
  var POLL=250, last=-2;
  function viewer(){
    var g=window.__origami||window.__folio;
    return (g&&g.viewer&&typeof g.viewer.go==='function')?g.viewer:null;
  }
  function indexOf(v){
    try{ var i=v.visibleOrder.indexOf(v.current()); return i; }catch(e){ return -1; }
  }
  function report(v,force){
    var i=indexOf(v);
    if(i===last&&!force) return;
    last=i;
    parent.postMessage({type:'origami-fold',index:i,id:(i>=0?v.visibleOrder[i]:''),total:v.visibleOrder.length},'*');
  }
  window.addEventListener('message',function(ev){
    var d=ev.data;
    // the frame is an opaque origin, so ev.origin is the useless string "null" and the SHAPE is
    // the whole check: anything that is not exactly this message is not ours (the measurer's
    // nonce replies and any host chatter land here too).
    if(!d||typeof d!=='object'||d.type!=='origami-goto') return;
    if(typeof d.index!=='number'||typeof d.id!=='string') return;
    var v=viewer(); if(!v) return;
    var i=d.id?v.visibleOrder.indexOf(d.id):-1;
    if(i<0) i=d.index;
    if(!(i>=0&&i<v.visibleOrder.length)) return;
    try{ v.go(i); }catch(e){ return; }
    report(v,true);
  });
  function sweep(){
    var v=viewer(); if(!v) return;
    var edit=document.querySelector('.o-top .o-edit-toggle');
    if(edit) edit.remove();
    report(v,false);
  }
  sweep();
  setInterval(sweep,POLL);
})();</script>`;

/** The exact message the frame sends up. Anything else on the wire is not ours. */
interface FoldMessage {
  type: 'origami-fold';
  index: number;
  id: string;
  total: number;
}

function asFoldMessage(data: unknown): FoldMessage | null {
  const d = data as Partial<FoldMessage> | null;
  if (!d || typeof d !== 'object' || d.type !== 'origami-fold') return null;
  if (typeof d.index !== 'number' || typeof d.id !== 'string' || typeof d.total !== 'number') return null;
  return d as FoldMessage;
}

export class Preview {
  private readonly frame: HTMLIFrameElement;
  private readonly empty: HTMLElement;
  private timer: number | undefined;

  /** The fold the viewer is on, as the frame last reported it. */
  private index = -1;
  private id = '';
  /** Where the NEXT frame should land — set at render time, consumed by the first report. */
  private wanted: { id: string; index: number } | null = null;
  /** A fold an agent just changed. Outranks "keep the reader where they were" for one render. */
  private follows: string | null = null;

  constructor(frame: HTMLIFrameElement, empty: HTMLElement) {
    this.frame = frame;
    this.empty = empty;
    window.addEventListener('message', (ev) => this.onMessage(ev));
  }

  /** Re-render, coalescing the ops of one batch into a single frame swap. */
  schedule(deck: DeckStore): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.render(deck), 30) as unknown as number;
  }

  render(deck: DeckStore): void {
    if (!deck.isOpen()) {
      this.frame.hidden = true;
      this.frame.removeAttribute('srcdoc');
      this.frame.removeAttribute('data-fold-index');
      this.empty.hidden = false;
      this.index = -1;
      this.id = '';
      this.wanted = null;
      this.follows = null;
      return;
    }
    this.empty.hidden = true;
    this.frame.hidden = false;
    /* Every write re-mounts the whole deck, and a fresh mount starts on fold 1. Without this
       the reader is yanked back to the cover on every single agent edit. */
    this.wanted = { id: this.follows ?? this.id, index: this.index };
    this.follows = null;
    this.frame.srcdoc = injectMeasurer(deck.serialize(), BRIDGE);
  }

  /** Take the preview to a fold by chunk id. Ignored by the frame if the id is not a fold. */
  goto(targetId: string): void {
    this.follows = targetId;
    this.post(targetId, -1);
  }

  /** The fold index the frame last reported, for anything that needs to ask. */
  foldIndex(): number {
    return this.index;
  }

  private post(id: string, index: number): void {
    // targetOrigin '*' is unavoidable: a sandboxed frame without allow-same-origin has the
    // opaque origin "null", which no other value matches. The payload carries nothing private.
    this.frame.contentWindow?.postMessage({ type: 'origami-goto', id, index }, '*');
  }

  private onMessage(ev: MessageEvent): void {
    if (ev.source !== this.frame.contentWindow) return;
    const msg = asFoldMessage(ev.data);
    if (!msg) return;
    this.index = msg.index;
    this.id = msg.id;
    this.frame.dataset.foldIndex = String(msg.index);

    const wanted = this.wanted;
    this.wanted = null;
    if (!wanted) return;
    if (wanted.id === msg.id) return; // already where it should be
    if (!wanted.id && wanted.index === msg.index) return;
    this.post(wanted.id, wanted.index);
  }
}
