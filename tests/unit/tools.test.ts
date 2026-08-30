import { describe, expect, it } from 'vitest';
import { KINDS, buildModel, parseDeck, validateDeck } from '../../vendor/format-dist/index.js';
import { FLOW_INNER, VENN_INNER } from '../fixtures.js';
import { DeckStore } from '../../src/core/deck-store.js';
import { ProposalStore } from '../../src/core/proposal-store.js';
import { createRegistry } from '../../src/core/tools.js';
import { RECIPES } from '../../src/core/recipes.js';
import { harness, innerWith, runtimeJs, sampleDeck } from './harness.js';

/* These run against the REAL vendored @origami/format + @origami/runtime — no mocks, no
   stubs. Every assertion is about observable deck state (what the model holds, what the
   serialized file contains), never about which internal function was called. */

describe('tool surface', () => {
  it('registers exactly the 22 web tools, including accept/reject so an agent runs unattended', () => {
    const h = harness();
    const names = h.registry.list().map((t) => t.name).sort();
    expect(names).toEqual([
      'accept_proposal',
      'add_chunk',
      'add_custom_fold',
      'create_deck',
      'define_block',
      'delete_block',
      'delete_chunk',
      'get_kind_schema',
      'list_block_defs',
      'list_chunks',
      'list_proposals',
      'origami_guide',
      'propose_add',
      'propose_chunk',
      'propose_delete',
      'read_chunk',
      'reject_proposal',
      'save_deck',
      'set_fold_type',
      'set_header',
      'undo',
      'write_chunk',
    ]);
    // the filesystem-bound trio stays out
    for (const absent of ['list_decks', 'open_deck', 'refresh_sources']) {
      expect(h.registry.get(absent), absent).toBeUndefined();
    }
  });

  it("origami_guide's kind catalog matches the format library's actual KINDS", async () => {
    const guide = await harness().json('origami_guide');
    expect(Object.keys(guide.kinds).sort()).toEqual(Object.keys(KINDS).sort());
    for (const key of Object.keys(KINDS)) {
      expect(guide.kinds[key].name, key).toBe(KINDS[key]!.name);
      expect(guide.kinds[key].schema, key).toEqual(KINDS[key]!.schemaComment);
    }
  });

  it('origami_guide advertises every registered tool and no phantom ones', async () => {
    const h = harness();
    const guide = await h.json('origami_guide');
    const registered = h.registry.list().map((t) => t.name).sort();
    expect(Object.keys(guide.tools).sort()).toEqual(registered);
    // and the review protocol no longer claims only a human can resolve a proposal
    expect(guide.reviewProtocol).toMatch(/EITHER a human .* OR by you calling accept_proposal \/ reject_proposal/);
    expect(guide.knownGaps).toBeUndefined();
    expect(Object.keys(guide.notAvailableHere).sort()).toEqual(['list_decks', 'open_deck', 'refresh_sources']);
  });

  it('every tool carries a description and an object input schema', () => {
    for (const t of harness().registry.list()) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.inputSchema.type, t.name).toBe('object');
      for (const req of t.inputSchema.required ?? []) {
        expect(t.inputSchema.properties[req], `${t.name}.${req}`).toBeDefined();
      }
    }
  });

  it('no tool description tells an agent that a registered tool does not exist', async () => {
    /* Round 2 shipped accept_proposal, but the three propose_* descriptions still read "only
       THEY can accept or reject" and "there is deliberately no accept tool" — prose that would
       stop an unattended agent from finishing even though the tool was right there. Descriptions
       are the API here, so drift between them and the tool set is a bug, not a typo. */
    const h = harness();
    const banned = [/deliberately no accept tool/i, /only the human can accept/i, /only THEY can accept/i, /no accept tool/i];
    for (const t of h.registry.list()) {
      for (const re of banned) expect(t.description, `${t.name} description`).not.toMatch(re);
    }
    // every tool a description points at must actually be registered
    const names = new Set(h.registry.list().map((t) => t.name));
    const referenced = new Set<string>();
    for (const t of h.registry.list()) {
      for (const m of t.description.matchAll(/\b(accept_proposal|reject_proposal|save_deck|list_proposals|define_block|list_block_defs|add_chunk|write_chunk|get_kind_schema|list_chunks|propose_chunk|propose_delete|undo|open_deck|list_decks|refresh_sources)\b/g)) {
        referenced.add(m[1]!);
      }
    }
    expect([...referenced].filter((n) => !names.has(n))).toEqual([]);

    /* The same rule for the GUIDE payload, which is now much larger than the descriptions and
       is the first thing an agent reads. notAvailableHere is excluded: naming an absent tool is
       the entire point of that section. */
    const guide = await h.json('origami_guide');
    delete guide.notAvailableHere;
    const inGuide = new Set<string>();
    for (const m of JSON.stringify(guide).matchAll(/\b([a-z_]+_(?:chunk|deck|proposal|proposals|block|defs|schema|fold|type|header|starters|render))\b|\b(undo|origami_guide|add_custom_fold)\b/g)) {
      inGuide.add((m[1] ?? m[2])!);
    }
    expect([...inGuide].filter((n) => !names.has(n)).sort()).toEqual([]);
  });

  it('origami_guide answers with the live format constants and one kind on request', async () => {
    const h = harness();
    const guide = await h.json('origami_guide');
    expect(guide.formatVersion).toBe('1');
    expect(Object.keys(guide.kinds)).toContain('free');
    // v1 listed accept/reject as unavailable-by-design; they are real tools now
    expect(guide.notAvailableHere.accept_proposal).toBeUndefined();
    expect(guide.tools.accept_proposal).toMatch(/Apply a staged proposal/);
    expect(guide.tools.save_deck).toMatch(/writable handle/);

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

  it('create_deck refuses to discard an open Fold with unsaved changes, unless told to', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'First' });
    await h.json('add_chunk', {});
    const r = await h.call('create_deck', { title: 'Second' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text).error).toMatch(/discard:true/);
    expect(h.deck.model().title).toBe('First');

    // an unattended agent can proceed on its own say-so
    const forced = await h.json('create_deck', { title: 'Second', discard: true });
    expect(forced.title).toBe('Second');
    expect(h.deck.model().title).toBe('Second');
  });

  it('create_deck honours foldType scroll and it survives serialization', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Long Read', foldType: 'scroll' });
    expect(created.foldType).toBe('scroll');
    expect(buildModel(parseDeck(h.deck.serialize())).foldType).toBe('scroll');

    const ledger = await h.json('create_deck', { title: 'Ledger One', foldType: 'ledger', discard: true });
    expect(ledger.foldType).toBe('ledger');
  });

  it('add_custom_fold takes a whole page and reports the padlock honestly', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Custom' });

    const inert = await h.json('add_custom_fold', {
      html: '<div class="slide-inner"><h2>Quarterly report</h2><div class="card-grid"><div class="stat-card"><div class="big">42</div><div class="lbl">Sites</div></div></div></div>',
      label: 'Report',
    });
    expect(inert.padlock).toBe(false);
    expect(inert.activeContent).toEqual([]);
    expect(h.deck.model().slides.get(inert.foldId)!.label).toBe('Report');
    expect(h.deck.serialize()).toContain('Quarterly report');

    const active = await h.json('add_custom_fold', { html: '<div class="slide-inner"><style>h2{color:red}</style><h2>Styled</h2></div>' });
    expect(active.padlock).toBe(true);
    expect(active.activeContent.length).toBeGreaterThan(0);
    expect(active.note).toMatch(/padlock/);
  });
});

describe('composite blocks', () => {
  const DEF = {
    kind: 'x.kpi',
    name: 'KPI card',
    version: 1,
    fields: [
      { name: 'value', type: 'text', label: 'Value' },
      { name: 'label', type: 'text', label: 'Label' },
    ],
    template: '<div class="stat-card"><div class="big">{{value}}</div><div class="lbl">{{label}}</div></div>',
  };

  it('define -> instance -> list -> delete keeps the placed content as inert markup', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });

    const defined = await h.json('define_block', { def: DEF });
    expect(defined).toMatchObject({ defined: 'x.kpi', version: 1, fields: ['value', 'label'] });

    const listed = await h.json('list_block_defs', {});
    expect(listed.blocks).toHaveLength(1);
    expect(listed.blocks[0]).toMatchObject({ kind: 'x.kpi', name: 'KPI card', version: 1 });

    const placed = await h.json('add_chunk', { block: 'x.kpi', fields: { value: '128', label: 'Deployments' } });
    const inner = h.deck.model().slides.get(placed.chunkId)!.inner;
    expect(inner).toContain('128');
    expect(inner).toContain('Deployments');
    expect(inner).toContain('data-odata="block"');
    expect(h.deck.model().slides.get(placed.chunkId)!.label).toBe('KPI card');

    const deleted = await h.json('delete_block', { kind: 'x.kpi' });
    expect(deleted).toMatchObject({ deleted: 'x.kpi', name: 'KPI card', instancesFrozen: 1 });
    const after = h.deck.model().slides.get(placed.chunkId)!.inner;
    expect(after).toContain('128'); // the baked output survives
    expect(after).not.toContain('data-odata="block"'); // the dangling data-script does not
    expect(Object.keys(h.deck.model().blocks)).toHaveLength(0);
  });

  it('rejects a block def whose template would render active content', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Bad block' });
    const r = await h.call('define_block', {
      def: { ...DEF, kind: 'x.evil', template: '<div onclick="steal()">{{value}}</div>' },
    });
    expect(r.isError).toBe(true);
    expect(Object.keys(h.deck.model().blocks)).toHaveLength(0);
  });

  it('add_chunk refuses an unknown composite kind and names what IS defined', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Unknown block' });
    await h.json('define_block', { def: DEF });
    const r = await h.call('add_chunk', { block: 'x.nope', fields: {} });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text).availableBlocks).toEqual(['x.kpi']);
  });
});

describe('table formulas are baked by the real calc engine', () => {
  /* The point of vendoring @origami/calc: assert the ARITHMETIC lands in the file, not that
     some function was called. B*C per row and a SUM over the column. */
  const tableInner = (rows: string[][]) =>
    `<div class="o-table-shell">
<script type="application/json" data-odata="table">
${JSON.stringify(
  {
    columns: [{ label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'Unit', align: 'right' }, { label: 'Total', align: 'right' }],
    rows,
    formulas: { D1: '=B1*C1', D2: '=B2*C2', D3: '=SUM(D1:D2)' },
    named: { grandTotal: '=D3' },
  },
  null,
  2
)}
</script>
      <div class="o-table" data-table-mount></div>
    </div>`;

  const tableJson = (text: string, chunkId: string) => {
    const inner = buildModel(parseDeck(text)).slides.get(chunkId)!.inner;
    return JSON.parse(/data-odata="table"[^>]*>([\s\S]*?)<\/script>/.exec(inner)![1]!.replace(/\\u003c/g, '<'));
  };

  it('computes 7*3, 5*4 and their SUM at write time', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    // deliberately WRONG stale values in the D column — the bake must overwrite them
    const added = await h.json('add_chunk', {
      kind: 'table',
      html: tableInner([
        ['Widgets', '7', '3', '999'],
        ['Gadgets', '5', '4', '999'],
        ['Total', '', '', '999'],
      ]),
    });

    const data = tableJson(h.deck.serialize(), added.chunkId);
    expect(data.rows[0][3]).toBe('21'); // 7 * 3
    expect(data.rows[1][3]).toBe('20'); // 5 * 4
    expect(data.rows[2][3]).toBe('41'); // SUM(D1:D2)
    expect(data.formulas.D3).toBe('=SUM(D1:D2)'); // the formulas ride along, inert
  });

  it('re-bakes on write_chunk too, so an edited table is never stale', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ledger 2' });
    const added = await h.json('add_chunk', { kind: 'table' });

    await h.json('write_chunk', {
      chunkId: added.chunkId,
      html: tableInner([
        ['Widgets', '10', '10', '0'],
        ['Gadgets', '2', '6', '0'],
        ['Total', '', '', '0'],
      ]),
    });

    const data = tableJson(h.deck.serialize(), added.chunkId);
    expect(data.rows[0][3]).toBe('100');
    expect(data.rows[1][3]).toBe('12');
    expect(data.rows[2][3]).toBe('112');
  });

  it('bakes the built-in table starter (3*4 + 2*5 = 22)', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Starter' });
    const added = await h.json('add_chunk', { kind: 'table' });
    const data = tableJson(h.deck.serialize(), added.chunkId);
    expect([data.rows[0][3], data.rows[1][3], data.rows[2][3]]).toEqual(['12', '10', '22']);
  });

  it('leaves a table with no formulas exactly as written', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'No formulas' });
    const plain = '<div class="o-table-shell">\n<script type="application/json" data-odata="table">\n{"columns":[{"label":"A"}],"rows":[["x"]]}\n</script>\n<div class="o-table" data-table-mount></div>\n</div>';
    const added = await h.json('add_chunk', { kind: 'table', html: plain });
    expect(tableJson(h.deck.serialize(), added.chunkId).rows).toEqual([['x']]);
  });
});

describe('data-driven kinds an agent has to build by hand', () => {
  it('adds a venn and a flow from get_kind_schema shapes, and the Fold stays valid', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Kinds', foldType: 'scroll' });

    // the agent's actual first move
    const schema = await h.json('get_kind_schema', { kind: 'venn' });
    expect(schema.kind).toBe('venn');
    expect(schema.schema.join(' ')).toMatch(/data-odata="venn"/);

    const venn = await h.json('add_chunk', { kind: 'venn', html: VENN_INNER, label: 'Venn' });
    const flow = await h.json('add_chunk', { kind: 'flow', html: FLOW_INNER, label: 'Flow' });

    const text = h.deck.serialize();
    const parsed = parseDeck(text);
    // the real validator, not a shape guess: manifest/DOM bijection, kind data, capabilities
    expect(validateDeck(parsed)).toEqual([]);
    expect(parsed.manifest.kinds).toEqual(expect.arrayContaining(['venn', 'flow']));
    expect(parsed.manifest.slides[venn.chunkId]!.kind).toBe('venn');
    expect(parsed.manifest.slides[flow.chunkId]!.kind).toBe('flow');
    expect(text).toContain('data-odata="venn"');
    expect(text).toContain('A Fold');
    expect(text).toContain('Human or agent reviews');
  });

  it('refuses a data kind with no starter and tells the agent to fetch the schema', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'No starter' });
    const r = await h.call('add_chunk', { kind: 'venn' });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0]!.text).error).toMatch(/get_kind_schema\("venn"\)/);
  });
});

describe('save_deck', () => {
  it('validates and never throws when the host has no save route', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Nowhere' });
    const res = await h.call('save_deck', {});
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0]!.text);
    expect(body).toMatchObject({ saved: false, validated: true, title: 'Nowhere', slides: 1 });
    expect(body.bytes).toBeGreaterThan(1000);
  });

  it('reports written:true through an injected save route, and passes it the real bytes', async () => {
    const deck = new DeckStore();
    const proposals = new ProposalStore();
    let captured = '';
    const registry = createRegistry({
      deck,
      proposals,
      runtimeJs,
      save: async (text) => {
        captured = text;
        return { written: true, where: 'deck.origami.html', note: 'written to the file on disk.' };
      },
    });
    await registry.invoke('create_deck', { title: 'Somewhere' });
    await registry.invoke('add_chunk', { html: innerWith('Saved heading', 'Saved body') });
    const body = JSON.parse((await registry.invoke('save_deck', {})).content[0]!.text);

    expect(body).toMatchObject({ saved: true, validated: true, where: 'deck.origami.html', slides: 2 });
    // the bytes handed to the page are the real, complete, re-parseable Fold
    expect(captured).toContain('Saved heading');
    expect(buildModel(parseDeck(captured)).order).toHaveLength(2);
    expect(body.bytes).toBe(new TextEncoder().encode(captured).length);
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

describe('guide recipes: every one is real markup that really lands', () => {
  /* A recipe an agent copies and gets a refusal from is worse than no recipe. The bar is not
     "validateSlideContent likes it" — it is: added to a real deck through the real tool, the
     WHOLE Fold still passes validateDeck, and the deck did not go active (a recipe that put the
     human's Fold behind the padlock would be a trap). The cover recipe would fail this today if
     it had kept the monorepo's <img data-oasset="brand-logo">: nothing here writes the asset
     table, so the reference would dangle and validateDeck would return assets.ref. */

  it('adds EVERY recipe to one deck and the Fold stays valid and inert', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Recipe book' });

    for (const r of RECIPES) {
      const added = await h.call('add_chunk', { kind: 'free', html: r.inner, label: r.title });
      expect(added.isError, `${r.key} was refused: ${added.content[0]!.text}`).toBeFalsy();
      const body = JSON.parse(added.content[0]!.text);
      expect(body.activeContent, `${r.key} flags the deck active`).toEqual([]);
      expect(body.capabilitiesGranted, `${r.key} demands a capability`).toEqual([]);
    }

    const parsed = parseDeck(h.deck.serialize());
    expect(validateDeck(parsed), 'the whole Fold must still validate').toEqual([]);
    expect(h.deck.model().order).toHaveLength(RECIPES.length + 1);
  });

  it('every recipe survives serialize -> reparse with its markup intact', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Recipe round trip' });
    const ids: Record<string, string> = {};
    for (const r of RECIPES) ids[r.key] = (await h.json('add_chunk', { kind: 'free', html: r.inner })).chunkId;

    const reloaded = buildModel(parseDeck(h.deck.serialize()));
    for (const r of RECIPES) {
      // the distinctive class of each recipe has to still be there after a full file round trip
      const marker = /class="([a-z0-9 -]*?)(anim)?"/.exec(r.inner.split('\n')[1] ?? '')?.[0] ?? '';
      expect(reloaded.slides.get(ids[r.key]!)!.inner, r.key).toContain(marker.split('"')[1]!.replace(' anim', '').trim() || 'slide-inner');
    }
  });

  it('exposes them through origami_guide with provenance an auditor can follow', async () => {
    const guide = await harness().json('origami_guide');
    expect(Object.keys(guide.recipes.cards).sort()).toEqual(RECIPES.map((r) => r.key).sort());
    for (const r of RECIPES) {
      const card = guide.recipes.cards[r.key];
      expect(card.html, r.key).toBe(r.inner);
      expect(card.source, r.key).toMatch(/\.(ts|mjs|html)\b|RECONSTRUCTED/); // a real file, or an explicit admission
      expect(card.use.length, r.key).toBeGreaterThan(20);
    }
    // the two idioms the free schema names but never demonstrates, and the one it forbids
    expect(guide.recipes.cards['text-columns-2'].caveat).toMatch(/data-ocols/);
    expect(guide.recipes.cards['stat-cards'].caveat).toMatch(/data-count-to/);
    expect(guide.recipes.cards['image-figure'].caveat).toMatch(/DEVIATION/);
  });

  it('the two multi-column recipes carry the attribute, not an invented class', async () => {
    // .o-tcols-2 / .cols-3 do not exist in the monorepo; an agent that guesses them gets an
    // unstyled stack. The recipes are the only place this is stated.
    for (const key of ['text-columns-2', 'text-columns-3']) {
      const r = RECIPES.find((x) => x.key === key)!;
      expect(r.inner, key).toMatch(/class="o-tcols anim" data-ocols="[23]"/);
      expect(r.inner, key).not.toMatch(/o-tcols-\d/);
      expect(r.inner.match(/class="o-text"/g)!.length, key).toBe(Number(key.slice(-1)));
      expect(r.source, key).toMatch(/RECONSTRUCTED/); // no rendered example exists to copy
    }
  });

  it('no recipe references an asset the deck does not carry', async () => {
    // data-oasset is the Studio's image route and there is no tool here to fill the asset table,
    // so a recipe using it would fail validateDeck the moment save_deck ran.
    for (const r of RECIPES) expect(r.inner, r.key).not.toContain('data-oasset');
  });
});

describe('undo reverses the last change to the open Fold', () => {
  /* The bar is byte-equality, not "the heading is gone": an undo that leaves the deck merely
     LOOKING right has still corrupted the file for anyone diffing it. Every case below
     serializes before and after and compares the whole Fold. */

  it('write -> undo returns the Fold to its exact previous bytes', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Undo write' });
    const id = created.chunks[0].id;
    const before = h.deck.serialize();

    await h.json('write_chunk', { chunkId: id, html: innerWith('Regrettable', 'Edit') });
    expect(h.deck.serialize()).not.toBe(before);

    const res = await h.json('undo');
    expect(res).toMatchObject({ undone: { op: 'slide.inner', targetId: id }, remainingUndoSteps: 0 });
    expect(h.deck.serialize()).toBe(before);
  });

  it('undo unwinds one tool call per call, in reverse order', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Undo stack' });
    const afterCreate = h.deck.serialize();
    await h.json('add_chunk', { label: 'One' });
    const afterOne = h.deck.serialize();
    await h.json('add_chunk', { label: 'Two' });
    await h.json('set_header', { subtitle: 'Third change' });

    expect((await h.json('undo')).undone.op).toBe('deck.header');
    expect(h.deck.serialize()).not.toContain('Third change');

    expect((await h.json('undo')).undone.op).toBe('slide.insert');
    expect(h.deck.serialize()).toBe(afterOne);

    const last = await h.json('undo');
    expect(last).toMatchObject({ undone: { op: 'slide.insert' }, remainingUndoSteps: 0, chunks: 1 });
    expect(h.deck.serialize()).toBe(afterCreate);
  });

  it('undoes a delete, restoring the slide at its original index with its content', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Undo delete' });
    const a = await h.json('add_chunk', { html: innerWith('Fold A', 'A'), label: 'A' });
    await h.json('add_chunk', { html: innerWith('Fold B', 'B'), label: 'B' });
    const before = h.deck.serialize();

    await h.json('delete_chunk', { chunkId: a.chunkId, mode: 'delete' });
    expect(h.deck.model().slides.has(a.chunkId)).toBe(false);

    await h.json('undo');
    expect(h.deck.model().order[1]).toBe(a.chunkId); // back where it was, not appended
    expect(h.deck.model().slides.get(a.chunkId)!.label).toBe('A');
    expect(h.deck.serialize()).toBe(before);
  });

  it('undoes an ACCEPTED proposal — the agent route and the human card land on the same stack', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Undo accept' });
    const id = created.chunks[0].id;
    const before = h.deck.serialize();

    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Accepted then regretted', 'Body'), author: 'agent:test' });
    expect(h.deck.serialize()).toBe(before); // staging is not a change, so it is not an undo step
    await h.json('accept_proposal', { proposalId: staged.proposalId });
    expect(h.deck.serialize()).toContain('Accepted then regretted');

    await h.json('undo');
    expect(h.deck.serialize()).toBe(before);
    expect(h.deck.model().slides.get(id)!.oby).toBe(''); // the provenance stamp is reversed too
  });

  it('refuses cleanly on an empty history instead of throwing or half-working', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Nothing done' });
    const before = h.deck.serialize();

    const res = await h.call('undo');
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/nothing to undo/);
    expect(h.deck.serialize()).toBe(before);

    // and with no Fold open at all it is the standard no-deck refusal, not a crash
    const empty = harness();
    const none = await empty.call('undo');
    expect(none.isError).toBe(true);
  });

  it('create_deck resets the stack — undo cannot cross a new Fold', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'First deck' });
    await h.json('add_chunk', { label: 'Doomed' });
    await h.json('create_deck', { title: 'Second deck', discard: true });

    const res = await h.call('undo');
    expect(res.isError).toBe(true);
    expect(h.deck.model().title).toBe('Second deck'); // the old deck is NOT resurrected
  });

  it('opening a different Fold resets the stack too', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'In memory' });
    await h.json('add_chunk', {});
    h.deck.open(await sampleDeck(), 'welcome.origami.html');
    expect((await h.call('undo')).isError).toBe(true);
  });
});

describe('dryRun: the whole gate, none of the mutation', () => {
  /* The requirement is parity, not a second code path: a dry run must produce the SAME verdict
     and the SAME error body a real write would, while leaving the file byte-identical. Both are
     asserted by comparing the two calls against each other, not against a hand-written shape. */

  it('write_chunk dryRun validates, applies nothing and leaves the deck byte-identical', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Dry' });
    const id = created.chunks[0].id;
    const before = h.deck.serialize();
    expect(h.deck.peek()!.dirty).toBe(false);

    const res = await h.call('write_chunk', { chunkId: id, html: innerWith('Never lands', 'Dry run'), dryRun: true });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.content[0]!.text);
    expect(body).toMatchObject({ dryRun: true, wouldApply: id, capabilitiesWouldGrant: [], activeContent: [] });
    expect(body.note).toMatch(/DRY RUN/);

    expect(h.deck.serialize()).toBe(before);
    expect(h.deck.serialize()).not.toContain('Never lands');
    expect(h.deck.peek()!.dirty).toBe(false); // no mutate() ⇒ no dirty flag, no re-render, no autosave
  });

  it('write_chunk dryRun returns the SAME error body a real write returns', async () => {
    const bad = '<div class="slide-inner"><h2>Hi</h2><template data-x="1">smuggled</template></div>';

    const dry = harness();
    await dry.json('create_deck', { title: 'Dry error' });
    const dryId = dry.deck.model().order[0]!;
    const dryRes = await dry.call('write_chunk', { chunkId: dryId, html: bad, dryRun: true });

    const wet = harness();
    await wet.json('create_deck', { title: 'Dry error' });
    const wetId = wet.deck.model().order[0]!;
    const wetRes = await wet.call('write_chunk', { chunkId: wetId, html: bad });

    expect(dryRes.isError).toBe(true);
    expect(wetRes.isError).toBe(true);
    expect(JSON.parse(dryRes.content[0]!.text)).toEqual(JSON.parse(wetRes.content[0]!.text));
  });

  it('write_chunk dryRun refuses id drift exactly as the real write does', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Dry drift' });
    const id = created.chunks[0].id;
    const res = await h.call('write_chunk', {
      chunkId: id,
      html: `<template data-origami-slide="sdeadbeef" data-kind="free">${innerWith('Nope', 'Nope')}</template>`,
      dryRun: true,
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/slide id drift/);
  });

  it('add_chunk dryRun builds and bakes the slide but adds nothing', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Dry add' });
    const before = h.deck.serialize();
    const orderBefore = [...h.deck.model().order];

    const body = await h.json('add_chunk', { kind: 'table', label: 'Budget', dryRun: true });
    expect(body).toMatchObject({ dryRun: true, wouldAdd: { kind: 'table', label: 'Budget', index: 1 }, activeContent: [] });
    expect(body.chunkId).toBeUndefined(); // no id is minted for a slide that does not exist

    expect(h.deck.model().order).toEqual(orderBefore);
    expect(h.deck.serialize()).toBe(before);
    expect(h.deck.peek()!.dirty).toBe(false);
  });

  it('add_chunk dryRun returns the SAME error body a real add returns', async () => {
    const dry = harness();
    await dry.json('create_deck', { title: 'Dry add error' });
    const dryRes = await dry.call('add_chunk', { kind: 'venn', dryRun: true });

    const wet = harness();
    await wet.json('create_deck', { title: 'Dry add error' });
    const wetRes = await wet.call('add_chunk', { kind: 'venn' });

    expect(dryRes.isError).toBe(true);
    expect(JSON.parse(dryRes.content[0]!.text)).toEqual(JSON.parse(wetRes.content[0]!.text));
    expect(JSON.parse(dryRes.content[0]!.text).error).toMatch(/get_kind_schema\("venn"\)/);
  });

  it('a dry run with no deck open fails the same way a real one does', async () => {
    const h = harness();
    const res = await h.call('add_chunk', { dryRun: true });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/no deck is open/);
  });

  it('both dryRun tools say so in their description and the guide teaches it', async () => {
    const h = harness();
    for (const name of ['write_chunk', 'add_chunk']) {
      expect(h.registry.get(name)!.description, name).toMatch(/dryRun:true/);
      expect(h.registry.get(name)!.inputSchema.properties.dryRun, name).toBeDefined();
    }
    const guide = await h.json('origami_guide');
    expect(guide.editProtocol.join(' ')).toMatch(/dryRun:true/);
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

describe('an agent can resolve its own proposals — the same path the card uses', () => {
  it('propose_chunk -> accept_proposal applies, with provenance, end to end', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Unattended' });
    const id = created.chunks[0].id;

    const staged = await h.json('propose_chunk', {
      chunkId: id,
      html: innerWith('Agent decided', 'No human present'),
      author: 'agent:codex',
    });
    expect(h.deck.model().slides.get(id)!.inner).not.toContain('Agent decided');

    const accepted = await h.json('accept_proposal', { proposalId: staged.proposalId });
    expect(accepted).toMatchObject({ accepted: staged.proposalId, action: 'edit', applied: id, remainingProposals: 0 });
    expect(h.deck.model().slides.get(id)!.inner).toContain('Agent decided');
    expect(h.deck.model().slides.get(id)!.oby).toBe('agent:codex'); // same stamp as a card accept
    expect(h.proposals.count()).toBe(0);
  });

  it('reject_proposal drops it and leaves the Fold byte-identical', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Unattended reject' });
    const before = h.deck.serialize();
    const staged = await h.json('propose_chunk', { chunkId: created.chunks[0].id, html: innerWith('Dropped', 'Dropped') });

    const rejected = await h.json('reject_proposal', { proposalId: staged.proposalId });
    expect(rejected).toMatchObject({ rejected: staged.proposalId, remainingProposals: 0 });
    expect(h.deck.serialize()).toBe(before);

    const again = await h.call('reject_proposal', { proposalId: staged.proposalId });
    expect(again.isError).toBe(true); // and a second reject is an error envelope, not a throw
  });

  it('accept_proposal refuses a conflicted proposal with the 3-way view', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Unattended conflict' });
    const id = created.chunks[0].id;
    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Stale', 'Stale') });
    await h.json('write_chunk', { chunkId: id, html: innerWith('Moved on', 'Moved on') });

    const res = await h.call('accept_proposal', { proposalId: staged.proposalId });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body).toMatchObject({ conflicted: true, targetId: id });
    expect(body.proposed).toContain('Stale');
    expect(body.current).toContain('Moved on');
    expect(h.deck.model().slides.get(id)!.inner).toContain('Moved on');
    expect(h.proposals.count()).toBe(1); // still reviewable
  });

  it('accepting an unknown proposal id returns an error envelope', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Unattended unknown' });
    const res = await h.call('accept_proposal', { proposalId: 'pdeadbeef' });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/unknown proposal/);
  });

  it('propose_add -> accept_proposal adds the slide with the proposed label', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Unattended add' });
    const staged = await h.json('propose_add', { html: innerWith('Agent added', 'Body'), label: 'Agent fold', author: 'agent:codex' });
    expect(h.deck.model().order).toHaveLength(1);

    await h.json('accept_proposal', { proposalId: staged.proposalId });
    expect(h.deck.model().order).toHaveLength(2);
    expect(h.deck.model().slides.get(staged.newChunkId)!.label).toBe('Agent fold');
    expect(h.deck.serialize()).toContain('Agent added');
  });
});
