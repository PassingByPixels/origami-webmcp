import { applyOp, proposalView, type DeckModel, type Op, type Proposal, type ProposalView } from '../../vendor/format-dist/index.js';
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
 * DELIBERATE DESIGN CHANGE vs the stdio server: accept and reject are NOT tools. An agent can
 * stage a proposal and read the queue; only a human clicking Accept in the page can apply one.
 * That is why `accept` lives here and not in tools.ts.
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
    const caps = newInner ? videoCapsNeeded(newInner).filter((c) => !m.capabilities.includes(c)) : [];
    const ops: Op[] = [p.op];
    if (caps.length > 0) ops.push({ t: 'deck.caps', capabilities: [...m.capabilities, ...caps] });
    // provenance: stamp who authored the chunk that persists (edit / add) — inert manifest meta
    if (p.author && (p.op.t === 'slide.inner' || p.op.t === 'slide.insert')) {
      ops.push({ t: 'slide.meta', id: p.targetId, patch: { oby: p.author } });
    }

    deck.mutate((model) => applyOp(model, ops.length > 1 ? { t: 'batch', ops } : ops[0]!));
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
