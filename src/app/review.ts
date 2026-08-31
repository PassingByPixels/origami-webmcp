import type { ProposalView } from '../../vendor/format-dist/index.js';
import type { DeckStore } from '../core/deck-store.js';
import type { ProposalStore } from '../core/proposal-store.js';
import type { ToolResult } from '../core/result.js';

/** What the panel needs of the registry: run a tool AS THE HUMAN and hand back the result. */
export type HumanInvoke = (name: string, args: unknown) => Promise<ToolResult>;

/**
 * The human's half of propose-review-accept. Agents can stage; only a click here applies.
 *
 * Accept and Reject go through registry.invoke('accept_proposal' | 'reject_proposal', …,
 * 'human') rather than calling ProposalStore directly. The store would do the same work — but
 * only the registry route records the click, so a human resolving a card and an agent
 * resolving the same card leave the same trail in the Activity feed, differing in one field.
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
    private readonly onApplied: (message: string, bad?: boolean) => void,
    private readonly invoke: HumanInvoke
  ) {
    this.list.addEventListener('click', (ev) => void this.onClick(ev));
  }

  async refresh(): Promise<void> {
    const mine = ++this.generation;
    const count = this.proposals.count();
    // The badge keeps its "0" so anything reading the count still gets a number, but a zero
    // badge in the rail header is noise — the feed's own empty line says what the rail is for.
    this.countEl.textContent = String(count);
    this.countEl.hidden = count === 0;
    this.countEl.title = count === 1 ? '1 staged change waiting for you' : `${count} staged changes waiting for you`;
    if (!this.deck.isOpen() || count === 0) {
      this.list.replaceChildren();
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
      const res = await this.invoke('reject_proposal', { proposalId: id });
      this.onApplied(res.isError ? String(body(res).error) : 'Proposal rejected — the Fold is unchanged.', res.isError);
      return;
    }
    const res = await this.invoke('accept_proposal', { proposalId: id });
    const out = body(res);
    if (res.isError) this.onApplied(String(out.error), true);
    else this.onApplied(`Accepted: ${out.action} on ${out.applied}.`);
    await this.refresh();
  }
}

/** Every tool answers with one JSON text block; the tools' own results are the panel's data. */
function body(res: ToolResult): Record<string, unknown> {
  try {
    return JSON.parse(res.content[0]?.text ?? '{}') as Record<string, unknown>;
  } catch {
    return { error: res.content[0]?.text ?? 'the tool answered with something unreadable' };
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
