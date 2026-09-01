import { History, applyOp, buildModel, parseDeck, serializeModel, type DeckModel, type Op } from '../../vendor/format-dist/index.js';

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
  /** @origami/format's bounded undo stack. applyOp returns each op's inverse; `apply` below is
      the only place that records one, which is why every mutating tool must route through it. */
  private history = new History();

  /** Parse deck TEXT and make it the open deck. Throws FormatError on an unparseable file. */
  open(text: string, name: string): void {
    const model = buildModel(parseDeck(text));
    this.state = { model, name, dirty: false };
    // A different deck is a different history. An inverse op recorded against the old model
    // names slide ids this one may not have, so keeping the stack would be a way to corrupt
    // the new Fold, not a convenience.
    this.history.clear();
    this.emit('open');
  }

  close(): void {
    this.state = null;
    this.history.clear();
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

  /**
   * Apply one op AND record its inverse, so `undo` can reverse the tool call that made it.
   * Use this instead of the raw applyOp everywhere inside mutate(): an op applied directly is
   * invisible to undo, which would leave the stack claiming a depth it cannot actually reverse.
   * Every tool call applies exactly one op (a batch where it needs several), so one entry here
   * is one undo step.
   */
  apply(m: DeckModel, op: Op): Op {
    const inverse = applyOp(m, op);
    this.history.push(op, inverse, Date.now());
    return inverse;
  }

  /** How many recorded steps `undo` can still reverse. */
  undoDepth(): number {
    return this.history.depth().undo;
  }

  /**
   * Reverse the newest recorded op. Returns the op that was undone, or null when the stack is
   * empty. The inverse is applied with the RAW applyOp: an undo is not itself an undoable step.
   * If the inverse is refused (the format library's own invariants, e.g. "cannot remove the last
   * slide") the entry goes back on the stack and the throw propagates — a half-undone deck with
   * a consumed history entry would be worse than a refusal.
   */
  undo(): Op | null {
    if (!this.history.canUndo()) return null;
    const m = this.model();
    const entry = this.history.undo()!;
    try {
      applyOp(m, entry.inverse);
    } catch (e) {
      this.history.redo();
      throw e;
    }
    this.state!.dirty = true;
    this.emit('change');
    return entry.op;
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
