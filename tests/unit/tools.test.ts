import { describe, expect, it } from 'vitest';
import { buildModel, parseDeck } from '../../vendor/format-dist/index.js';
import { harness, innerWith, sampleDeck } from './harness.js';

/* These run against the REAL vendored @origami/format + @origami/runtime — no mocks, no
   stubs. Every assertion is about observable deck state (what the model holds, what the
   serialized file contains), never about which internal function was called. */

describe('tool surface', () => {
  it('registers exactly the 14 web tools, and NOT accept/reject', () => {
    const h = harness();
    const names = h.registry.list().map((t) => t.name).sort();
    expect(names).toEqual([
      'add_chunk',
      'create_deck',
      'delete_chunk',
      'get_kind_schema',
      'list_chunks',
      'list_proposals',
      'origami_guide',
      'propose_add',
      'propose_chunk',
      'propose_delete',
      'read_chunk',
      'set_fold_type',
      'set_header',
      'write_chunk',
    ]);
    // the deliberate design change: no agent can apply its own proposal
    expect(h.registry.get('accept_proposal')).toBeUndefined();
    expect(h.registry.get('reject_proposal')).toBeUndefined();
  });

  it('every tool carries a description and an object input schema', () => {
    for (const t of harness().registry.list()) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type, t.name).toBe('object');
    }
  });

  it('origami_guide answers with the live format constants and one kind on request', async () => {
    const h = harness();
    const guide = await h.json('origami_guide');
    expect(guide.formatVersion).toBe('1');
    expect(Object.keys(guide.kinds)).toContain('free');
    expect(guide.notAvailableHere.accept_proposal).toMatch(/only the human/i);

    const one = await h.json('origami_guide', { kind: 'free' });
    expect(one.kind).toBe('free');
    expect(Array.isArray(one.schema)).toBe(true);

    const bad = await h.call('origami_guide', { kind: 'nope' });
    expect(bad.isError).toBe(true);
  });

  it('refuses every deck tool with a usable message when nothing is open', async () => {
    const h = harness();
    for (const name of ['list_chunks', 'read_chunk', 'write_chunk', 'add_chunk', 'delete_chunk', 'list_proposals']) {
      const r = await h.call(name, { chunkId: 'x', html: 'y' });
      expect(r.isError, name).toBe(true);
      expect(JSON.parse(r.content[0]!.text).error, name).toMatch(/no deck is open/);
    }
  });
});

describe('create_deck -> add_chunk -> list/read/write_chunk -> serialize round-trip', () => {
  it('walks the whole authoring protocol and the result re-parses', async () => {
    const h = harness();

    const created = await h.json('create_deck', { title: 'Round Trip' });
    expect(created.title).toBe('Round Trip');
    expect(created.slides).toBe(1);
    expect(h.deck.name()).toBe('round-trip.origami.html');

    const added = await h.json('add_chunk', { label: 'Second' });
    expect(added.chunkId).toMatch(/^s[0-9a-f]{8}$/);
    expect(added.index).toBe(1);

    const toc = await h.json('list_chunks');
    expect(toc.title).toBe('Round Trip');
    expect(toc.chunks.map((c: any) => c.label)).toEqual(['Cover', 'Second']);
    expect(toc.chunks.every((c: any) => c.hidden === false)).toBe(true);

    const payload = await h.text('read_chunk', { chunkId: added.chunkId });
    expect(payload).toContain(added.chunkId);
    expect(payload).toContain('<template');

    const written = await h.json('write_chunk', { chunkId: added.chunkId, html: innerWith('Edited heading', 'Edited body') });
    expect(written.applied).toBe(added.chunkId);
    expect(written.activeContent).toEqual([]);

    // round trip: serialize -> parse -> build; the edit survives as deck bytes, not just memory
    const text = h.deck.serialize();
    const reloaded = buildModel(parseDeck(text));
    expect(reloaded.order).toEqual([created.chunks[0].id, added.chunkId]);
    expect(reloaded.slides.get(added.chunkId)!.inner).toContain('Edited heading');
    expect(reloaded.slides.get(added.chunkId)!.label).toBe('Second');
    expect(reloaded.title).toBe('Round Trip');
    // and the assembled file is a real, playable Fold
    expect(text).toContain('id="origami-runtime"');
    expect(text).toContain('id="origami-manifest"');
  });

  it('rejects a chunk reply that targets a different slide id', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Drift' });
    const id = created.chunks[0].id;
    const before = h.deck.model().slides.get(id)!.inner;

    const r = await h.call('write_chunk', {
      chunkId: id,
      html: `<template data-origami-slide="sdeadbeef" data-kind="free">${innerWith('Nope', 'Nope')}</template>`,
    });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text).error).toMatch(/slide id drift/);
    expect(h.deck.model().slides.get(id)!.inner).toBe(before);
  });

  it('delete_chunk hides by default and removes on mode=delete', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Delete Me' });
    const extra = await h.json('add_chunk', {});

    await h.json('delete_chunk', { chunkId: extra.chunkId });
    expect(h.deck.model().slides.get(extra.chunkId)!.hidden).toBe(true);

    await h.json('delete_chunk', { chunkId: extra.chunkId, mode: 'delete' });
    expect(h.deck.model().slides.has(extra.chunkId)).toBe(false);
    expect(h.deck.model().order).not.toContain(extra.chunkId);
  });

  it('set_header and set_fold_type change the serialized manifest', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Meta' });

    await h.json('set_header', { subtitle: 'A subtitle', chips: ['Q3 2026'] });
    const ft = await h.json('set_fold_type', { foldType: 'scroll' });
    expect(ft.foldType).toBe('scroll');
    expect(ft.warning).toMatch(/no document-kind folds/);

    const manifest = JSON.parse(
      /<script type="application\/json" id="origami-manifest">([\s\S]*?)<\/script>/.exec(h.deck.serialize())![1]!.replace(/\\u003c/g, '<')
    );
    expect(manifest.header).toEqual({ subtitle: 'A subtitle', chips: ['Q3 2026'] });
    expect(manifest.foldType).toBe('scroll');
  });

  it('create_deck refuses to discard an open Fold with unsaved changes', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'First' });
    await h.json('add_chunk', {});
    const r = await h.call('create_deck', { title: 'Second' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text).error).toMatch(/unsaved changes/);
    expect(h.deck.model().title).toBe('First');
  });
});

describe('the real sample deck', () => {
  it('opens, lists its chunks and serializes byte-identically when untouched', async () => {
    const h = harness();
    const text = await sampleDeck();
    h.deck.open(text, 'welcome.origami.html');

    const toc = await h.json('list_chunks');
    expect(toc.chunks.length).toBeGreaterThan(0);
    // byte-stability: an unmodified model must serialize back to the exact input bytes
    expect(h.deck.serialize()).toBe(text);

    const first = toc.chunks[0].id;
    const written = await h.json('write_chunk', { chunkId: first, html: innerWith('Sample edited', 'By the unit test') });
    expect(written.applied).toBe(first);
    expect(h.deck.serialize()).toContain('Sample edited');
  });
});

describe('bytes survive the round trip', () => {
  it('keeps non-ASCII content exact through write -> serialize -> reparse', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Café — 東京 · 🗻' });
    const id = created.chunks[0].id;
    const body = 'Naïve résumé — 東京タワー · Ελληνικά · 🗻 «quoted» — ok?';

    await h.json('write_chunk', { chunkId: id, html: innerWith('Café — 東京', body) });
    const reloaded = buildModel(parseDeck(h.deck.serialize()));

    expect(reloaded.title).toBe('Café — 東京 · 🗻');
    expect(reloaded.slides.get(id)!.inner).toContain(body);
    // and it survives a SECOND trip — nothing is double-escaped on the way back out
    expect(buildModel(parseDeck(h.deck.serialize())).slides.get(id)!.inner).toBe(reloaded.slides.get(id)!.inner);
  });

  it('preserves a CRLF deck as CRLF (a Windows file must not be rewritten to LF)', async () => {
    const h = harness();
    const crlf = (await sampleDeck()).replace(/\r?\n/g, '\r\n');
    h.deck.open(crlf, 'crlf.origami.html');
    expect(h.deck.model().base.eol).toBe('\r\n');

    const toc = await h.json('list_chunks');
    await h.json('write_chunk', { chunkId: toc.chunks[0].id, html: innerWith('CRLF safe', 'Line one') });

    const out = h.deck.serialize();
    expect(out).not.toMatch(/[^\r]\n/); // every LF still carries its CR
    expect(out).toContain('CRLF safe');
  });
});

describe('content policy is the write gate', () => {
  it('REJECTS a stray <template> in inner content and leaves the model unchanged', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Policy' });
    const id = created.chunks[0].id;
    const before = h.deck.model().slides.get(id)!.inner;
    const beforeText = h.deck.serialize();

    const r = await h.call('write_chunk', {
      chunkId: id,
      html: '<div class="slide-inner"><h2>Hi</h2><template data-x="1">smuggled</template></div>',
    });

    expect(r.isError).toBe(true);
    const body = JSON.parse(r.content[0]!.text);
    expect(body.error).toMatch(/would break the deck structure/);
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.violations.length).toBeGreaterThan(0);
    // the model is untouched — not partially applied, not repaired
    expect(h.deck.model().slides.get(id)!.inner).toBe(before);
    expect(h.deck.serialize()).toBe(beforeText);
  });

  it('REJECTS the same content through the proposal path, so it never reaches review', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Policy 2' });
    const id = created.chunks[0].id;

    const r = await h.call('propose_chunk', {
      chunkId: id,
      html: '<div class="slide-inner"><template>smuggled</template></div>',
    });
    expect(r.isError).toBe(true);
    expect(h.proposals.count()).toBe(0);
  });

  it('REJECTS an unbalanced <script> and allows a well-formed JSON data block', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Policy 3' });
    const id = created.chunks[0].id;

    const bad = await h.call('write_chunk', { chunkId: id, html: '<div class="slide-inner"><script>alert(1)</div>' });
    expect(bad.isError).toBe(true);

    const good = await h.call('write_chunk', {
      chunkId: id,
      html: '<div class="slide-inner"><h2>Data</h2><script type="application/json" data-odata="notes">{"notes":[]}</script></div>',
    });
    expect(good.isError).toBeFalsy();
  });

  it('flags active content without blocking it', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Active' });
    const id = created.chunks[0].id;
    const res = await h.json('write_chunk', { chunkId: id, html: '<div class="slide-inner"><h2 onclick="x()">Hi</h2></div>' });
    expect(res.applied).toBe(id);
    expect(res.activeContent.length).toBeGreaterThan(0);
  });
});

describe('proposals: staged, human-applied', () => {
  it('propose_chunk stages without touching the model; accept applies it', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'PR' });
    const id = created.chunks[0].id;
    const before = h.deck.model().slides.get(id)!.inner;

    const staged = await h.json('propose_chunk', {
      chunkId: id,
      html: innerWith('Proposed heading', 'Proposed body'),
      title: 'Rewrite the cover',
      author: 'agent:test',
    });
    expect(staged.proposalId).toMatch(/^p[0-9a-f]{8}$/);
    expect(h.proposals.count()).toBe(1);
    // NOT applied
    expect(h.deck.model().slides.get(id)!.inner).toBe(before);

    const queue = await h.json('list_proposals');
    expect(queue.proposals).toHaveLength(1);
    expect(queue.proposals[0]).toMatchObject({ action: 'edit', targetId: id, conflicted: false, title: 'Rewrite the cover' });
    expect(queue.proposals[0].before).toBe(before);
    expect(queue.proposals[0].after).toContain('Proposed heading');

    const accepted = await h.proposals.accept(h.deck, staged.proposalId);
    expect(accepted).toMatchObject({ ok: true, action: 'edit', targetId: id, remaining: 0 });
    expect(h.deck.model().slides.get(id)!.inner).toContain('Proposed heading');
    expect(h.deck.serialize()).toContain('Proposed heading');
    // provenance stamped from the proposal author
    expect(h.deck.model().slides.get(id)!.oby).toBe('agent:test');
    expect(h.proposals.count()).toBe(0);
  });

  it('reject drops the proposal and leaves the model byte-identical', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'PR reject' });
    const id = created.chunks[0].id;
    const beforeText = h.deck.serialize();

    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Never applied', 'Never applied') });
    expect(h.proposals.count()).toBe(1);

    expect(h.proposals.reject(staged.proposalId)).toBe(true);
    expect(h.proposals.count()).toBe(0);
    expect(h.deck.serialize()).toBe(beforeText);
    expect(h.deck.serialize()).not.toContain('Never applied');
    // a second reject of the same id is a no-op, not a crash
    expect(h.proposals.reject(staged.proposalId)).toBe(false);
  });

  it('accept refuses when the target chunk changed since the proposal (no silent overwrite)', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Conflict' });
    const id = created.chunks[0].id;

    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Stale proposal', 'Stale') });
    await h.json('write_chunk', { chunkId: id, html: innerWith('Human got there first', 'Direct') });

    const res = await h.proposals.accept(h.deck, staged.proposalId);
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ conflicted: true });
    expect(h.deck.model().slides.get(id)!.inner).toContain('Human got there first');
    // still in the queue for the human to re-review
    expect(h.proposals.count()).toBe(1);
    const queue = await h.json('list_proposals');
    expect(queue.proposals[0].conflicted).toBe(true);
  });

  it('propose_add stages a new slide that only appears on accept', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'PR add' });
    const orderBefore = [...h.deck.model().order];

    const staged = await h.json('propose_add', { html: innerWith('Added by review', 'Body'), label: 'Reviewed', author: 'agent:test' });
    expect(h.deck.model().order).toEqual(orderBefore);

    const queue = await h.json('list_proposals');
    expect(queue.proposals[0]).toMatchObject({ action: 'add', conflicted: false });

    const res = await h.proposals.accept(h.deck, staged.proposalId);
    expect(res.ok).toBe(true);
    expect(h.deck.model().order).toHaveLength(orderBefore.length + 1);
    expect(h.deck.model().slides.get(staged.newChunkId)!.inner).toContain('Added by review');
    expect(h.deck.model().slides.get(staged.newChunkId)!.label).toBe('Reviewed');
  });

  it('propose_delete stages a hide that only takes effect on accept', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'PR delete' });
    const extra = await h.json('add_chunk', {});

    const staged = await h.json('propose_delete', { chunkId: extra.chunkId });
    expect(h.deck.model().slides.get(extra.chunkId)!.hidden).toBe(false);

    const res = await h.proposals.accept(h.deck, staged.proposalId);
    expect(res).toMatchObject({ ok: true, action: 'hide' });
    expect(h.deck.model().slides.get(extra.chunkId)!.hidden).toBe(true);
  });

  it('accept refuses a proposal whose target is already gone', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'PR stale' });
    const extra = await h.json('add_chunk', {});
    const staged = await h.json('propose_delete', { chunkId: extra.chunkId, mode: 'delete' });
    await h.json('delete_chunk', { chunkId: extra.chunkId, mode: 'delete' });

    const res = await h.proposals.accept(h.deck, staged.proposalId);
    expect(res).toMatchObject({ ok: false, conflicted: true });
  });

  it('accepting an unknown proposal id is an error, not a throw', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'PR unknown' });
    expect(await h.proposals.accept(h.deck, 'pdeadbeef')).toMatchObject({ ok: false, conflicted: false });
  });
});
