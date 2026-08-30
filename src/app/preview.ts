import type { DeckStore } from '../core/deck-store.js';

/**
 * The live view of the Fold.
 *
 * The deck IS its own renderer, so the honest preview is the real file: serialize the current
 * model and hand the whole .origami.html to an iframe via srcdoc. The frame gets
 * `sandbox="allow-scripts"` and NEVER `allow-same-origin` — the embedded runtime may execute
 * so the deck renders, but it sits on an opaque origin with no reach into this page, no
 * storage, and no way to read the file the human opened.
 */
export class Preview {
  private readonly frame: HTMLIFrameElement;
  private readonly empty: HTMLElement;
  private timer: number | undefined;

  constructor(frame: HTMLIFrameElement, empty: HTMLElement) {
    this.frame = frame;
    this.empty = empty;
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
      this.empty.hidden = false;
      return;
    }
    this.empty.hidden = true;
    this.frame.hidden = false;
    this.frame.srcdoc = deck.serialize();
  }
}
