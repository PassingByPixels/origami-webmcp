import { History, applyOp, buildModel, parseDeck, serializeModel, type DeckModel, type Op } from '../../vendor/format-dist/index.js';

export interface DeckState {
  model: DeckModel;
  /** Suggested filename, e.g. "welcome.origami.html". */
  name: string;
  /** True once a tool or the human has changed the model since the last save. */
  dirty: boolean;
  /** The deck's serialized text as of the last open() or markSaved() — what revertToSaved()
      reopens. Updated in the two places "the last durable point" can move; never by mutate(). */
  baseline: string;
  /** True once markSaved() has run since this open() — tells revertToSaved's caller whether it
      landed back on a save or on how the Fold was created/opened (see revertToSaved). */
  savedSinceOpen: boolean;
}

/** What revertToSaved() reports when it actually reverted something. */
export interface RevertResult {
  /** How many undo() steps were on the stack and are now gone (the stack is cleared, not
      unwound one at a time — open() resets History exactly as it does for create_deck). */
  droppedUndoSteps: number;
  /** Which baseline the Fold landed back on. */
  revertedTo: 'last save' | 'as created or opened';
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
    this.state = { model, name, dirty: false, baseline: text, savedSinceOpen: false };
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
    if (this.state) {
      this.state.dirty = false;
      // The bytes on disk (or in OPFS) now match the live model, so THIS is what
      // revertToSaved() should land back on — captured from the model rather than the caller's
      // text so it stays correct even if the write route stamped its own manifest.modified.
      this.state.baseline = this.serialize();
      this.state.savedSinceOpen = true;
    }
    this.emit('saved');
  }

  /**
   * Drop every unsaved change in ONE call: reopen the deck at its `baseline` (the last
   * markSaved(), or the text open() was given if it was never saved). This is NOT undo — it
   * does not unwind the stack one op at a time, it jumps straight to the baseline and clears
   * the stack in the same move (open() resets History), which is exactly what a human who
   * pressed New/Open would land on.
   *
   * Throws the standard no-deck-open message when nothing is open (model() below). Returns
   * null, and touches nothing, when the deck is not dirty — there is nothing to revert.
   */
  revertToSaved(): RevertResult | null {
    this.model(); // throws the standard refusal when nothing is open
    const st = this.state!;
    if (!st.dirty) return null;
    const droppedUndoSteps = this.history.depth().undo;
    const revertedTo: RevertResult['revertedTo'] = st.savedSinceOpen ? 'last save' : 'as created or opened';
    this.open(st.baseline, st.name);
    return { droppedUndoSteps, revertedTo };
  }

  subscribe(fn: (ev: DeckEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: DeckEvent): void {
    for (const l of [...this.listeners]) l(ev);
  }
}
