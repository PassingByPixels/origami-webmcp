import { proposalView, type DeckModel, type Op, type Proposal, type ProposalView, type Violation } from '../../vendor/format-dist/index.js';
import { DATA_BLOCK_REFUSAL, validateDataBlocks } from './data-blocks.js';
import type { DeckStore } from './deck-store.js';
import { sha256Hex } from './ids.js';
import { videoCapsNeeded } from './video-caps.js';

export interface AcceptOk {
  ok: true;
  action: 'edit' | 'add' | 'delete' | 'hide';
  targetId: string;
  capabilitiesGranted: string[];
  remaining: number;
}
export interface AcceptFail {
  ok: false;
  error: string;
  conflicted: boolean;
  targetId?: string;
  proposed?: string;
  current?: string;
  /** Data-block schema violations found when the proposal was re-gated at accept time. */
  violations?: Violation[];
}
export type AcceptResult = AcceptOk | AcceptFail;

const ACTION_OF: Record<string, AcceptOk['action']> = {
  'slide.inner': 'edit',
  'slide.insert': 'add',
  'slide.remove': 'delete',
  'slide.meta': 'hide',
};

/**
 * The review queue. In-memory and per-session by design: the stdio server persists proposals
 * to ~/.origami/proposals/ because the proposer (an MCP process) and the reviewer (the Studio)
 * are different processes. Here they are the same page, so there is nothing to hand across —
 * and nothing is written outside the deck.
 *
 * A proposal has TWO front doors and one code path: a human clicking Accept / Reject on the card,
 * and an agent calling accept_proposal / reject_proposal. Both land here, so the conflict gate and
 * the provenance stamp cannot drift apart between them — which is why `accept` lives in the store
 * and not inside a tool body.
 */
export class ProposalStore {
  private list: Proposal[] = [];
  private readonly listeners = new Set<() => void>();

  all(): readonly Proposal[] {
    return this.list;
  }

  count(): number {
    return this.list.length;
  }

  add(p: Proposal): void {
    this.list.push(p);
    this.emit();
  }

  /** Put a restored queue back (the page reloading its autosave). Replaces, never appends. */
  restore(list: Proposal[]): void {
    if (list.length === 0 && this.list.length === 0) return;
    this.list = [...list];
    this.emit();
  }

  find(id: string): Proposal | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** Drop a staged proposal without applying it (the human's Reject button). */
  reject(id: string): boolean {
    const i = this.list.findIndex((p) => p.id === id);
    if (i === -1) return false;
    this.list.splice(i, 1);
    this.emit();
    return true;
  }

  clear(): void {
    if (this.list.length === 0) return;
    this.list = [];
    this.emit();
  }

  /** Reviewable views against the live model: action + before/after + conflict flag. */
  async views(model: DeckModel): Promise<ProposalView[]> {
    const out: ProposalView[] = [];
    for (const p of this.list) {
      const cur = model.slides.get(p.targetId);
      out.push(proposalView(p, model, cur ? await sha256Hex(cur.inner) : undefined));
    }
    return out;
  }

  /**
   * Apply a staged proposal through the SAME model ops a direct write uses. Ported from the
   * stdio server's accept_proposal, minus the file write: same conflict gate (never a silent
   * overwrite), same capability grant, same `oby` provenance stamp.
   */
  async accept(deck: DeckStore, proposalId: string): Promise<AcceptResult> {
    const i = this.list.findIndex((p) => p.id === proposalId);
    if (i === -1) return { ok: false, error: `unknown proposal "${proposalId}"`, conflicted: false };
    const p = this.list[i]!;
    const m = deck.model();

    // conflict gate per op kind — never a silent overwrite or a double-remove
    if (p.op.t === 'slide.inner') {
      const cur = m.slides.get(p.targetId);
      if (!cur) {
        return { ok: false, conflicted: true, error: `the target chunk "${p.targetId}" no longer exists — this proposal is stale` };
      }
      if ((await sha256Hex(cur.inner)) !== p.baseHash) {
        return {
          ok: false,
          conflicted: true,
          error: 'the target chunk changed since this proposal — review and re-propose against the new content',
          targetId: p.targetId,
          proposed: p.op.inner,
          current: cur.inner,
        };
      }
    } else if (p.op.t === 'slide.remove' || p.op.t === 'slide.meta') {
      if (!m.slides.has(p.targetId)) {
        return { ok: false, conflicted: true, error: `the target chunk "${p.targetId}" is already gone — this proposal is stale` };
      }
    }
    // slide.insert never conflicts — it carries a fresh id

    const newInner = p.op.t === 'slide.inner' || p.op.t === 'slide.insert' ? p.op.inner : '';
    /* The data gate again, against the CURRENT deck. propose_* already ran it, but the registry
       it validated against can have moved since: delete_block between staging and accepting
       leaves a composite instance naming a def this Fold no longer carries. Re-gating is the
       difference between refusing that and writing a Fold save_deck would then reject. */
    if (newInner) {
      const violations = validateDataBlocks(newInner, m.blocks);
      if (violations.length > 0) return { ok: false, conflicted: false, error: DATA_BLOCK_REFUSAL, targetId: p.targetId, violations };
    }
    const caps = newInner ? videoCapsNeeded(newInner).filter((c) => !m.capabilities.includes(c)) : [];
    const ops: Op[] = [p.op];
    if (caps.length > 0) ops.push({ t: 'deck.caps', capabilities: [...m.capabilities, ...caps] });
    // provenance: stamp who authored the chunk that persists (edit / add) — inert manifest meta
    if (p.author && (p.op.t === 'slide.inner' || p.op.t === 'slide.insert')) {
      ops.push({ t: 'slide.meta', id: p.targetId, patch: { oby: p.author } });
    }

    // deck.apply, not the raw applyOp: an accepted proposal is a change to the Fold like any
    // other, so it has to be reversible by the undo tool too.
    deck.mutate((model) => deck.apply(model, ops.length > 1 ? { t: 'batch', ops } : ops[0]!));
    this.list.splice(i, 1);
    this.emit();
    return { ok: true, action: ACTION_OF[p.op.t]!, targetId: p.targetId, capabilitiesGranted: caps, remaining: this.list.length };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/**
 * Rebuild a proposal queue from whatever came back out of browser storage.
 *
 * Storage is not a trusted channel: the record may be from an older build, hand-edited, or left
 * by a different app on the same origin. Anything that does not carry the four fields the
 * conflict gate depends on (id, op.t, targetId, baseHash) is DROPPED rather than restored into a
 * shape the accept path would later trip over. A proposal whose target no longer exists is kept
 * on purpose — that is not corruption, it is a stale proposal, and accept already refuses it
 * with `conflicted` and a reason the human can read.
 */
export function restorableProposals(raw: unknown): Proposal[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is Proposal => {
    if (!p || typeof p !== 'object') return false;
    const q = p as Record<string, unknown>;
    const op = q.op as Record<string, unknown> | undefined;
    return typeof q.id === 'string' && typeof q.targetId === 'string' && typeof q.baseHash === 'string' && !!op && typeof op.t === 'string';
  });
}
