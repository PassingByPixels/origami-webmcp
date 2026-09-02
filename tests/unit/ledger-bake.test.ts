import { describe, expect, it } from 'vitest';
import { harness } from './harness.js';

/* A ledger is a FREE card holding a table data block (that is what the `ledger` starter mints,
   and what every kind's howToAdd steers an agent toward). The guide promises that formulas an
   agent writes into it "are baked by the calc engine on write". These tests hold the app to
   that promise on the free-card shape, not only on a slide whose kind is literally `table`. */

const tableBlock = (data: unknown): string =>
  `<script type="application/json" data-odata="table">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const ledgerInner = (data: unknown): string =>
  `<div class="slide-inner"><p class="eyebrow">Ledger</p><h2>Budget</h2><figure class="o-tablefig anim">${tableBlock(data)}<div class="o-table" data-table-mount></div><figcaption>Budget</figcaption></figure></div>`;

const rowsOf = (deckText: string): string[][] => {
  const m = /data-odata="table"[^>]*>([\s\S]*?)<\/script>/.exec(deckText);
  return JSON.parse(m![1]!).rows;
};

describe('ledger formulas bake on a free card', () => {
  const data = {
    columns: [{ label: 'Item' }, { label: 'Cost', format: { kind: 'number' } }],
    rows: [
      ['Rent', '1200'],
      ['Food', '300'],
      ['Total', ''],
    ],
    formulas: { B3: '=SUM(B1:B2)' },
  };

  it('write_chunk on the ledger starter bakes the formula into rows', async () => {
    const h = harness();
    await h.call('create_deck', { title: 'Bake' });
    const added = await h.json('add_chunk', { starter: 'ledger' });
    expect(added.chunkId).toBeTypeOf('string');
    const res = await h.json('write_chunk', { chunkId: added.chunkId, html: ledgerInner(data) });
    expect(res.applied).toBe(added.chunkId);
    expect(rowsOf(h.deck.serialize())[2]![1]).toBe('1500');
  });

  it('add_chunk with a free card holding a table block bakes it too', async () => {
    const h = harness();
    await h.call('create_deck', { title: 'Bake' });
    const added = await h.json('add_chunk', { kind: 'free', html: ledgerInner(data) });
    expect(added.chunkId).toBeTypeOf('string');
    expect(rowsOf(h.deck.serialize())[2]![1]).toBe('1500');
  });
});
