import { buildModel, parseDeck, serializeModel, type DeckModel } from '../../vendor/format-dist/index.js';

export interface DeckState {
  model: DeckModel;
  /** Suggested filename, e.g. "welcome.origami.html". */
  name: string;
  /** True once a tool or the human has changed the model since the last save. */
  dirty: boolean;
}

export type DeckEvent = 'open' | 'change' | 'close' | 'saved';

/**
 * The ONE in-memory deck. Every tool, the preview iframe and the save path read this same
 * model; there is no second copy and no re-parse per call (the stdio server re-reads the file
 * each call because it is stateless across processes — a page is not).
 */
export class DeckStore {
  private state: DeckState | null = null;
  private readonly listeners = new Set<(ev: DeckEvent) => void>();

  /** Parse deck TEXT and make it the open deck. Throws FormatError on an unparseable file. */
  open(text: string, name: string): void {
    const model = buildModel(parseDeck(text));
    this.state = { model, name, dirty: false };
    this.emit('open');
  }

  close(): void {
    this.state = null;
    this.emit('close');
  }

  isOpen(): boolean {
    return this.state !== null;
  }

  peek(): DeckState | null {
    return this.state;
  }

  /** The open model, or a refusal-shaped throw for the tools to convert. */
  model(): DeckModel {
    if (!this.state) throw new Error('no deck is open — call create_deck, or the human opens one with the Open button');
    return this.state.model;
  }

  name(): string {
    return this.state?.name ?? 'untitled.origami.html';
  }

  setName(name: string): void {
    if (this.state) this.state.name = name;
  }

  /** Run a mutation against the live model and notify every view. The callback applies ops
      itself (applyOp) so a refusal thrown inside it aborts BEFORE anything is emitted. */
  mutate<T>(fn: (m: DeckModel) => T): T {
    const m = this.model();
    const out = fn(m);
    this.state!.dirty = true;
    this.emit('change');
    return out;
  }

  /** Full .origami.html text for the current model. `now` stamps manifest.modified (the save
      path); omit it for byte-stable serialization (the preview path). */
  serialize(now?: string): string {
    return serializeModel(this.model(), now ? { now } : undefined);
  }

  markSaved(): void {
    if (this.state) this.state.dirty = false;
    this.emit('saved');
  }

  subscribe(fn: (ev: DeckEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: DeckEvent): void {
    for (const l of [...this.listeners]) l(ev);
  }
}
