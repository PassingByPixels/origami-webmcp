import type { ProposalView } from '../../vendor/format-dist/index.js';
import type { DeckStore } from '../core/deck-store.js';
import type { ProposalStore } from '../core/proposal-store.js';

/**
 * The human's half of propose-review-accept. Agents can stage; only a click here applies.
 * Accept runs ProposalStore.accept, which goes through the SAME model ops a direct
 * write_chunk uses — a reviewed change and a trusted change land identically.
 */
export class ReviewPanel {
  /* refresh() awaits a hash per proposal, so two refreshes can be in flight at once — an
     accept fires one from the deck's change event and another from the queue's. Without a
     generation token the SLOWER, older render can land last and paint the card that was just
     accepted back onto the page. Every refresh claims a generation and drops its own result
     if a newer one started while it was awaiting. */
  private generation = 0;

  constructor(
    private readonly list: HTMLElement,
    private readonly countEl: HTMLElement,
    private readonly deck: DeckStore,
    private readonly proposals: ProposalStore,
    private readonly onApplied: (message: string, bad?: boolean) => void
  ) {
    this.list.addEventListener('click', (ev) => void this.onClick(ev));
  }

  async refresh(): Promise<void> {
    const mine = ++this.generation;
    this.countEl.textContent = String(this.proposals.count());
    if (!this.deck.isOpen() || this.proposals.count() === 0) {
      this.list.replaceChildren(
        el('div', 'queue-empty', this.deck.isOpen()
          ? 'Nothing staged. When an agent calls propose_chunk, propose_add or propose_delete, the change waits here for you.'
          : 'Open a Fold to review changes against it.')
      );
      return;
    }
    const views = await this.proposals.views(this.deck.model());
    if (mine !== this.generation) return; // a newer refresh started while we hashed — it wins
    this.list.replaceChildren(...views.map((v) => this.card(v)));
  }

  private card(v: ProposalView): HTMLElement {
    const card = el('div', 'card' + (v.conflicted ? ' conflicted' : ''));
    card.dataset.proposal = v.id;
    card.setAttribute('data-testid', 'proposal-card');

    const head = el('div', 'card-head');
    head.append(el('span', 'card-action', v.action), el('span', 'card-title', v.title));
    card.append(head);

    const meta = el('div', 'card-meta');
    meta.append(document.createTextNode(`${v.author} · `), el('code', '', v.targetId));
    card.append(meta);

    if (v.prompt) card.append(el('p', 'card-prompt', v.prompt));
    if (v.conflicted) {
      card.append(
        el('div', 'card-conflict', v.action === 'edit'
          ? 'That chunk changed after this was proposed. Accepting is blocked — ask for a fresh proposal against the current text.'
          : 'That chunk is already gone. This proposal is stale.')
      );
    }

    // The proposed text is what the decision turns on, so it is open; the current text is
    // one click away. Two tall blocks pushed Accept/Reject off the panel.
    if (v.after !== undefined) {
      card.append(el('div', 'diff-label', v.action === 'add' ? 'New chunk' : 'Proposed'), el('pre', '', trim(v.after)));
    }
    if (v.before !== undefined && v.action !== 'add') {
      const details = document.createElement('details');
      details.className = 'before';
      const summary = document.createElement('summary');
      summary.textContent = v.action === 'edit' ? 'Current text' : 'The chunk as it stands';
      details.append(summary, el('pre', '', trim(v.before)));
      card.append(details);
    }

    const actions = el('div', 'card-actions');
    const accept = el('button', 'primary', 'Accept') as HTMLButtonElement;
    accept.type = 'button';
    accept.dataset.act = 'accept';
    accept.setAttribute('data-testid', 'accept-proposal');
    const reject = el('button', 'danger', 'Reject') as HTMLButtonElement;
    reject.type = 'button';
    reject.dataset.act = 'reject';
    reject.setAttribute('data-testid', 'reject-proposal');
    actions.append(accept, reject);
    card.append(actions);
    return card;
  }

  private async onClick(ev: Event): Promise<void> {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn) return;
    const id = btn.closest<HTMLElement>('[data-proposal]')?.dataset.proposal;
    if (!id) return;

    if (btn.dataset.act === 'reject') {
      this.proposals.reject(id);
      this.onApplied('Proposal rejected — the Fold is unchanged.');
      return;
    }
    const res = await this.proposals.accept(this.deck, id);
    if (res.ok) this.onApplied(`Accepted: ${res.action} on ${res.targetId}.`);
    else this.onApplied(res.error, true);
    await this.refresh();
  }
}

const MAX_PREVIEW = 700;
const trim = (s: string): string => (s.length > MAX_PREVIEW ? s.slice(0, MAX_PREVIEW) + '\n…' : s);

function el(tag: string, cls = '', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}
