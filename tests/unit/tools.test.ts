import { describe, expect, it } from 'vitest';
import { FORMAT_BLOCKS, KINDS, buildModel, parseDeck, validateDeck } from '../../vendor/format-dist/index.js';
import { FLOW_INNER, VENN_INNER } from '../fixtures.js';
import { ACTIVITY_CAP, ActivityLog } from '../../src/core/activity.js';
import { DeckStore } from '../../src/core/deck-store.js';
import { GUIDE_TOPICS } from '../../src/core/guide.js';
import { ProposalStore, restorableProposals } from '../../src/core/proposal-store.js';
import { createRegistry } from '../../src/core/tools.js';
import { RECIPES } from '../../src/core/recipes.js';
import { FOLD_STARTERS } from '../../src/core/fold-starters.js';
import { analyseRender, type FoldGeometry } from '../../src/core/inspect.js';
import { injectMeasurer } from '../../src/app/measure.js';
import { harness, innerWith, runtimeJs, sampleDeck } from './harness.js';

/* These run against the REAL vendored @origami/format + @origami/runtime — no mocks, no
   stubs. Every assertion is about observable deck state (what the model holds, what the
   serialized file contains), never about which internal function was called. */

describe('tool surface', () => {
  it('registers exactly the 29 web tools, including accept/reject so an agent runs unattended', () => {
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
      'export_deck',
      'get_kind_schema',
      'inspect_render',
      'list_activity',
      'list_block_defs',
      'list_chunks',
      'list_proposals',
      'list_starters',
      'move_chunk',
      'origami_guide',
      'propose_add',
      'propose_chunk',
      'propose_delete',
      'read_chunk',
      'reject_proposal',
      'save_deck',
      'set_chunk_meta',
      'set_deck_meta',
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
    /* The INDEX in the default answer and the FULL entries behind topic:"kinds" are both held
       to the same registry — a cold agent must be able to trust either one on its own. */
    const h = harness();
    const index = (await h.json('origami_guide')).kinds;
    const full = (await h.json('origami_guide', { topic: 'kinds' })).kinds;

    expect(Object.keys(index).sort()).toEqual(Object.keys(KINDS).sort());
    expect(Object.keys(full).sort()).toEqual(Object.keys(KINDS).sort());
    for (const key of Object.keys(KINDS)) {
      expect(index[key].name, key).toBe(KINDS[key]!.name);
      expect(full[key].name, key).toBe(KINDS[key]!.name);
      expect(full[key].schema, key).toEqual(KINDS[key]!.schemaComment);
    }
  });

  it('the default kind index carries NO schemas, and says where they are', async () => {
    /* The schemas are ~70% of the whole guide and an agent uses two or three of them. Dropping
       them from the default is the saving; the entries are worthless if it cannot then find
       one, so the routes to a schema are asserted alongside the absence. */
    const h = harness();
    const guide = await h.json('origami_guide');
    for (const key of Object.keys(KINDS)) {
      expect(guide.kinds[key].schema, key).toBeUndefined();
      expect(guide.kinds[key].howToAdd, key).toBeUndefined();
      expect(Object.keys(guide.kinds[key]).sort(), key).toEqual(['name', 'placement']);
    }
    expect(guide.kindsHowTo.schemas).toMatch(/get_kind_schema\(kind\)/);
    expect(guide.kindsHowTo.schemas).toMatch(/origami_guide\(\{topic:"kinds"\}\)/);
    // the free-card steer is stated ONCE here, not repeated on every block kind
    expect(guide.kindsHowTo.placementInSlideBlock).toMatch(/PREFER a FREE CARD holding one/);
    expect(guide.kindsHowTo.placementWholeFold).toMatch(/add_chunk\(\{ kind, html \}\)/);
    expect(JSON.stringify(guide).match(/PREFER a FREE CARD holding one/g)).toHaveLength(1);

    // and a schema really is one call away, by both routes it names
    expect((await h.json('origami_guide', { kind: 'venn' })).schema).toEqual(KINDS.venn!.schemaComment);
    expect((await h.json('get_kind_schema', { kind: 'venn' })).schema).toEqual(KINDS.venn!.schemaComment);
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
    const args = { chunkId: 'x', html: 'y', label: 'z', position: 0, title: 't' };
    for (const name of [
      'list_chunks',
      'read_chunk',
      'write_chunk',
      'add_chunk',
      'delete_chunk',
      'move_chunk',
      'set_chunk_meta',
      'set_deck_meta',
      'export_deck',
      'list_proposals',
    ]) {
      const r = await h.call(name, args);
      expect(r.isError, name).toBe(true);
      expect(JSON.parse(r.content[0]!.text).error, name).toMatch(/no deck is open/);
    }
    // list_activity is the exception BY DESIGN: the feed belongs to the session, not the Fold,
    // so it must still answer when nothing is open (that is when you most want to know why)
    const feed = await h.call('list_activity', {});
    expect(feed.isError).toBeFalsy();
    expect(JSON.parse(feed.content[0]!.text).entries.length).toBeGreaterThan(0);
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

describe('whole-fold starters, ported from the Studio rail', () => {
  it('adds EVERY starter to one deck and the Fold stays valid, inert and non-blank', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Starters' });

    for (const s of FOLD_STARTERS) {
      const res = await h.call('add_chunk', { starter: s.key });
      expect(res.isError, `${s.key} was refused: ${res.content[0]!.text}`).toBeFalsy();
      const body = JSON.parse(res.content[0]!.text);
      expect(body.activeContent, s.key).toEqual([]);
      const inner = h.deck.model().slides.get(body.chunkId)!.inner;
      expect(inner, s.key).toContain(`data-odata="${s.block}"`);
      expect(inner, s.key).toContain('class="slide-inner"'); // every starter is a FREE CARD holding the block
      expect(h.deck.model().slides.get(body.chunkId)!.kind, s.key).toBe('free');
      expect(h.deck.model().slides.get(body.chunkId)!.label, s.key).toBe(s.label);
    }

    // the real validator over the whole file: seeds that fail their kind's data schema would
    // make save_deck refuse the deck later, which is exactly what a starter must never do
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
    const saved = await h.json('save_deck');
    expect(saved.validated).toBe(true);
  });

  it('keeps the data-block carrier invariant: no raw "<" inside any seed', () => {
    for (const s of FOLD_STARTERS) {
      const json = /data-odata="[a-z]+">\n([\s\S]*?)\n<\/script>/.exec(s.inner());
      expect(json, s.key).not.toBeNull();
      expect(json![1], s.key).not.toContain('<'); // must be <-escaped, or it terminates the block
    }
  });

  it('list_starters catalogs them without dumping the markup', async () => {
    const body = await harness().json('list_starters');
    expect(body.starters.map((s: any) => s.starter)).toEqual(FOLD_STARTERS.map((s) => s.key));
    for (const s of body.starters) {
      expect(s.use.length).toBeGreaterThan(20);
      expect(s.block).toBeTruthy();
      expect(s.html).toBeUndefined(); // the catalog is a menu, not a payload
    }
  });

  it('refuses an unknown starter and names the real ones', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Bad starter' });
    const res = await h.call('add_chunk', { starter: 'gantt-chart' });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.error).toMatch(/unknown starter "gantt-chart" — call list_starters/);
    expect(body.availableStarters).toEqual(FOLD_STARTERS.map((s) => s.key));
    expect(h.deck.model().order).toHaveLength(1);
  });

  it('refuses starter together with html or block instead of silently picking one', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ambiguous' });
    for (const extra of [{ html: innerWith('A', 'B') }, { block: 'x.kpi' }]) {
      const res = await h.call('add_chunk', { starter: 'venn', ...extra });
      expect(res.isError, JSON.stringify(extra)).toBe(true);
      expect(JSON.parse(res.content[0]!.text).error).toMatch(/starter OR html\/block, not both/);
    }
    expect(h.deck.model().order).toHaveLength(1);
  });

  it('propose_add takes a starter too, and only lands on accept', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Proposed starter' });
    const staged = await h.json('propose_add', { starter: 'flowchart', author: 'agent:test' });
    expect(h.deck.model().order).toHaveLength(1);

    await h.json('accept_proposal', { proposalId: staged.proposalId });
    expect(h.deck.model().order).toHaveLength(2);
    expect(h.deck.model().slides.get(staged.newChunkId)!.inner).toContain('data-odata="flow"');
  });

  it('a starter fold is undoable like any other change', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Undo starter' });
    const before = h.deck.serialize();
    await h.json('add_chunk', { starter: 'roadmap' });
    await h.json('undo');
    expect(h.deck.serialize()).toBe(before);
  });

  it('the guide lists them and points at the same catalog', async () => {
    const h = harness();
    // the catalog moved behind origami_guide({topic:"starters"}); the default guide keeps the
    // prose and points at it, so nothing an agent needs became unreachable
    const guide = await h.json('origami_guide');
    expect(guide.starters.howToUse).toMatch(/add_chunk\(\{ starter: "<key>" \}\)/);
    expect(guide.starters.folds).toMatch(/origami_guide\(\{ topic: "starters" \}\)/);
    expect(guide.tools.list_starters).toBeTruthy();

    const topic = await h.json('origami_guide', { topic: 'starters' });
    expect(topic.starters.folds.map((s: any) => s.starter)).toEqual(FOLD_STARTERS.map((s) => s.key));
    expect(topic.starters.howToUse).toBe(guide.starters.howToUse);
  });
});

describe('the kind catalog steers, and knownIssues is measured', () => {
  it('tells an agent to wrap every in-slide block kind in a free card — derived, not hard-coded', async () => {
    /* The steer comes off FORMAT_BLOCKS' own `placement` facet, not a list kept in this repo, so
       a kind added upstream picks up the right advice with no edit here. Asserting it against the
       same registry is the point: the test fails if the guide ever stops deriving it. The steer
       now reaches an agent two ways — `placement` on the default index plus the one shared
       paragraph, and the per-kind howToAdd behind topic:"kinds" — so both are held to it. */
    const h = harness();
    const guide = await h.json('origami_guide');
    const full = (await h.json('origami_guide', { topic: 'kinds' })).kinds;
    const dataKinds = FORMAT_BLOCKS.filter((b) => b.data?.placement === 'block').map((b) => b.key);
    expect(dataKinds.length, 'the registry must actually have block-placement kinds').toBeGreaterThan(5);

    for (const key of dataKinds) {
      expect(guide.kinds[key].placement, key).toBe('in-slide block'); // the index carries the fact
      const entry = full[key];
      expect(entry.placement, key).toBe('in-slide block');
      expect(entry.howToAdd, key).toMatch(/PREFER a FREE CARD holding one/);
      expect(entry.howToAdd, key).toContain(`add_chunk({ kind: "${key}"`); // the honest alternative is still named
    }
    // and the layout kinds are NOT told to wrap themselves
    for (const key of ['cover', 'free', 'document', 'bullets', 'stats']) {
      expect(guide.kinds[key].placement, key).toBe('whole fold');
      expect(full[key].howToAdd, key).toMatch(/A WHOLE FOLD/);
    }
    // the steer restates each kind's OWN schema, which says the same thing in prose
    expect(KINDS.flow!.schemaComment.join(' ')).toMatch(/a "Flowchart" fold is a free card holding one/);
  });

  it('knownIssues records what was MEASURED, not what was reported', async () => {
    const guide = await harness().json('origami_guide');
    const clip = guide.knownIssues.flowKindMastheadClip;
    // the number that was actually observed, and the correction to the original claim
    expect(clip).toMatch(/measured at 42px/);
    expect(clip).toMatch(/121px to 253px/);
    expect(clip).toMatch(/no rendered content is hidden/);
    // and it does not tell an agent to work around a defect that is not there
    expect(clip).not.toMatch(/avoid the flow kind|do not use/i);

    expect(guide.knownIssues.emptyDataBlockPassesUntilSave).toMatch(/renders completely blank/);
    expect(guide.knownIssues.studioTreeShakenCss).toMatch(/tree-shaken|stripped/);
  });
});

describe('inspect_render', () => {
  /* Two halves, tested separately. The RULES are arithmetic and are tested here with numbers
     fed in directly — no browser needed, and no browser flakiness. That the numbers reaching
     the rules are REAL is a different claim, and only tests/e2e/app.spec.ts can make it. */

  const geo = (id: string, over: Partial<FoldGeometry> = {}): FoldGeometry => ({
    id,
    measured: true,
    contentTop: 100,
    contentHeight: 400,
    mastheadBottom: 100,
    blockCount: 3,
    paintedLeaves: 4,
    textLength: 120,
    labels: [],
    ...over,
  });

  const deckOf = async (n: number) => {
    const h = harness();
    await h.json('create_deck', { title: 'Inspect' });
    for (let i = 1; i < n; i++) await h.json('add_chunk', { label: `Fold ${i}` });
    return h;
  };

  it('says so, loudly, when the host cannot measure a render at all', async () => {
    // The unit harness injects no measure route — exactly a host with no browser layout.
    const h = await deckOf(2);
    const body = await h.json('inspect_render');
    expect(body.measured).toBe(false);
    expect(body.why).toMatch(/no browser layout/);
    expect(body.warnings).toEqual([]);
    expect(body.note).toMatch(/does NOT mean the deck lays out correctly/);
    expect(body.folds).toHaveLength(2);
    expect(body.folds.every((f: any) => f.measured === false)).toBe(true);
    // and it never invents a number
    for (const f of body.folds) expect(f.contentHeight).toBeUndefined();
  });

  it('reports a failed measurement as unmeasured rather than as a clean deck', async () => {
    const deck = new DeckStore();
    const registry = createRegistry({
      deck,
      proposals: new ProposalStore(),
      runtimeJs,
      measure: async () => {
        throw new Error('the deck did not finish rendering within 15s, so nothing was measured');
      },
    });
    await registry.invoke('create_deck', { title: 'Timeout' });
    const body = JSON.parse((await registry.invoke('inspect_render', {})).content[0]!.text);
    expect(body.measured).toBe(false);
    expect(body.why).toMatch(/the measurement failed: the deck did not finish rendering/);
    expect(body.clean).toBeUndefined(); // a failure must never read as clean:true
  });

  it('flags a fold whose content is taller than the screen', async () => {
    const h = await deckOf(2);
    const [a, b] = h.deck.model().order;
    const out = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [geo(a!), geo(b!, { contentHeight: 2406 })],
    });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatchObject({ fold: b, issue: 'overflow' });
    expect(out.warnings[0]!.detail).toContain('2406px tall');
    expect(out.warnings[0]!.detail).toContain('the bottom 1686px is below the fold');
    expect((out.folds[0] as any).fits).toBe(true);
    expect((out.folds[1] as any).fits).toBe(false);
  });

  it('flags content clipped behind the masthead, with the real numbers', async () => {
    /* These are the numbers measured off a real render (see the e2e): a deck with a subtitle and
       chips has a 100px header.o-top that OVERLAYS the stage. A free fold's content starts at
       exactly 100 and is fine; a flow-KIND fold's figure starts at 27 and loses its top 73px. */
    const h = await deckOf(2);
    const [free, flow] = h.deck.model().order;
    const out = analyseRender(h.deck.model(), {
      viewport: { width: 940, height: 471 },
      folds: [geo(free!, { contentTop: 100, mastheadBottom: 100 }), geo(flow!, { contentTop: 27, mastheadBottom: 100 })],
    });
    expect(out.warnings.map((w) => w.issue)).toEqual(['masthead-clip']);
    expect(out.warnings[0]!.fold).toBe(flow);
    expect(out.warnings[0]!.detail).toContain('starts at 27px');
    expect(out.warnings[0]!.detail).toContain('the first 73px is hidden');
  });

  it('flags a fold that rendered nothing — which validation cannot catch', async () => {
    const h = await deckOf(1);
    const out = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [geo(h.deck.model().order[0]!, { blockCount: 2, paintedLeaves: 0, textLength: 0, contentHeight: 4, contentTop: 0, mastheadBottom: 66 })],
    });
    // a fold with no ink is EMPTY, not "clipped" — the contentTop fallback of 0 must not be
    // reported as content hidden behind the masthead (an empty flow block did exactly that)
    expect(out.warnings.map((w) => w.issue)).toEqual(['empty-fold']);
    expect(out.warnings[0]!.detail).toMatch(/0 painted element\(s\)/);
    expect((out.folds[0] as any).rendersAnything).toBe(false);
  });

  it('flags colliding diagram labels and leaves neighbouring ones alone', async () => {
    const h = await deckOf(1);
    const id = h.deck.model().order[0]!;
    const clash = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [
        geo(id, {
          labels: [
            { text: 'Editable', x: 100, y: 100, w: 60, h: 14 },
            { text: 'Portable', x: 130, y: 105, w: 60, h: 14 },
          ],
        }),
      ],
    });
    expect(clash.warnings.map((w) => w.issue)).toEqual(['label-collision']);
    expect(clash.warnings[0]!.detail).toContain('"Editable" and "Portable"');
    expect(clash.warnings[0]!.detail).toMatch(/overlap by \d+px²/);

    // the real venn labels measured off a render: close together, never touching
    const apart = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [
        geo(id, {
          labels: [
            { text: 'Inert', x: 394, y: 288, w: 23, h: 14 },
            { text: 'Editable', x: 517, y: 288, w: 38, h: 14 },
            { text: 'Portable', x: 450, y: 391, w: 40, h: 14 },
            { text: 'A Fold', x: 457, y: 332, w: 27, h: 11 },
          ],
        }),
      ],
    });
    expect(apart.warnings).toEqual([]);
  });

  it('never turns an unmeasured fold into a warning', async () => {
    const h = await deckOf(2);
    const [a, b] = h.deck.model().order;
    const out = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [geo(a!), { id: b!, measured: false, reason: 'this fold is hidden', contentTop: 0, contentHeight: 0, mastheadBottom: 0, blockCount: 0, paintedLeaves: 0, textLength: 0, labels: [] }],
    });
    expect(out.warnings).toEqual([]); // a 0px unmeasured fold is NOT an empty fold
    expect(out.folds[1]).toMatchObject({ id: b, measured: false, why: 'this fold is hidden' });
  });

  it('appends the measurer at the LAST </body>, not the first', () => {
    // the deck inlines its whole runtime, and that bundle contains the string "</body>"
    const deckText = '<html><body><script>var s="</body>";</script>CONTENT</body></html>';
    const out = injectMeasurer(deckText, '<!--M-->');
    expect(out).toBe('<html><body><script>var s="</body>";</script>CONTENT<!--M--></body></html>');
    // and a deck with no closing tag still gets the measurer rather than losing it
    expect(injectMeasurer('<html>no close', '<!--M-->')).toBe('<html>no close<!--M-->');
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
    const h = harness();
    // the cards' html moved behind origami_guide({topic:"recipes"}) — the default guide still
    // names them and says where to get them, so the provenance trail is unbroken
    const dflt = await h.json('origami_guide');
    expect(dflt.recipes.cards).toMatch(/origami_guide\(\{ topic: "recipes" \}\)/);
    expect(dflt.recipes.whyTheyExist).toMatch(/data-count-to/);

    const guide = await h.json('origami_guide', { topic: 'recipes' });
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

describe('a restored review queue', () => {
  /* The queue is now written into the autosave record with the deck. The risk that buys is a
     queue restored from untrusted storage, so the sanitiser and the conflict gate are what these
     tests are about; tests/e2e/app.spec.ts proves the round trip through a real page reload. */

  it('keeps only entries the conflict gate can actually use', () => {
    const good = { id: 'p1', author: 'agent', title: 'Fine', op: { t: 'slide.inner', id: 's1', inner: 'x' }, targetId: 's1', baseHash: 'abc' };
    const kept = restorableProposals([
      good,
      { ...good, id: 'p2', baseHash: undefined }, // no base hash: accept could not detect a conflict
      { ...good, id: 'p3', op: undefined }, // no op: nothing to apply
      { ...good, id: 'p4', targetId: 42 }, // wrong type
      null,
      'not a proposal',
    ]);
    expect(kept.map((p) => p.id)).toEqual(['p1']);
    expect(restorableProposals(undefined)).toEqual([]);
    expect(restorableProposals({ nope: true })).toEqual([]);
  });

  it('keeps a proposal whose target is gone — stale is not corrupt', async () => {
    // dropping it would hide the fact that the human staged something; accept explains it instead
    const kept = restorableProposals([
      { id: 'p1', author: 'agent', title: 'Stale', op: { t: 'slide.inner', id: 'sgone', inner: 'x' }, targetId: 'sgone', baseHash: 'abc' },
    ]);
    expect(kept).toHaveLength(1);

    const h = harness();
    await h.json('create_deck', { title: 'Restored stale' });
    h.proposals.restore(kept);
    const res = await h.call('accept_proposal', { proposalId: 'p1' });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text)).toMatchObject({ conflicted: true });
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/no longer exists/);
  });

  it('still refuses a restored proposal whose chunk changed since it was staged', async () => {
    /* THE point of persisting baseHash rather than re-deriving it on restore: the queue comes
       back believing the content it was made against, so a change made in between is still a
       conflict after a reload, not a silent overwrite. */
    const h = harness();
    const created = await h.json('create_deck', { title: 'Restored conflict' });
    const id = created.chunks[0].id;
    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Staged before reload', 'Body') });
    const persisted = JSON.parse(JSON.stringify(h.proposals.all())); // exactly what localStorage holds

    // the human edits that chunk, then the page reloads and restores the queue
    await h.json('write_chunk', { chunkId: id, html: innerWith('Changed while away', 'Body') });
    h.proposals.restore(restorableProposals(persisted));
    expect(h.proposals.count()).toBe(1);

    const res = await h.call('accept_proposal', { proposalId: staged.proposalId });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body).toMatchObject({ conflicted: true, targetId: id });
    expect(body.current).toContain('Changed while away');
    expect(body.proposed).toContain('Staged before reload');
    expect(h.deck.model().slides.get(id)!.inner).toContain('Changed while away');
    expect(h.proposals.count()).toBe(1); // still reviewable
  });

  it('a restored proposal against an UNCHANGED chunk still applies', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Restored clean' });
    const id = created.chunks[0].id;
    const staged = await h.json('propose_chunk', { chunkId: id, html: innerWith('Survived the reload', 'Body'), author: 'agent:test' });
    const persisted = JSON.parse(JSON.stringify(h.proposals.all()));

    h.proposals.clear();
    h.proposals.restore(restorableProposals(persisted));
    const res = await h.json('accept_proposal', { proposalId: staged.proposalId });
    expect(res).toMatchObject({ action: 'edit', applied: id });
    expect(h.deck.serialize()).toContain('Survived the reload');
    expect(h.deck.model().slides.get(id)!.oby).toBe('agent:test'); // provenance survives too
  });
});

describe('tool annotations', () => {
  /* Annotations are HINTS: a host may honour them, ignore them, or not read them at all
     (Chrome 151 drops them — measured in tests/e2e/webmcp-native.spec.ts). So the rule enforced
     here is that they can never be the ONLY place a caveat is stated, and that they match what
     the tools actually do. */
  const READ_ONLY = [
    'export_deck',
    'get_kind_schema',
    'inspect_render',
    'list_activity',
    'list_block_defs',
    'list_chunks',
    'list_proposals',
    'list_starters',
    'origami_guide',
    'read_chunk',
  ];
  const DESTRUCTIVE = ['create_deck', 'delete_block', 'delete_chunk'];

  it('marks exactly the read-only tools readOnlyHint', () => {
    const h = harness();
    const marked = h.registry.list().filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(marked).toEqual(READ_ONLY);
    // the mutating tools must NOT claim to be read-only — the dangerous direction of a wrong hint
    for (const name of ['write_chunk', 'add_chunk', 'add_custom_fold', 'save_deck', 'undo', 'accept_proposal', 'set_header']) {
      expect(h.registry.get(name)!.annotations?.readOnlyHint, name).toBeFalsy();
    }
  });

  it('marks exactly the tools that can destroy content destructiveHint', () => {
    const h = harness();
    expect(h.registry.list().filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort()).toEqual(DESTRUCTIVE);
    // and nothing claims both
    for (const t of h.registry.list()) {
      expect(t.annotations?.readOnlyHint && t.annotations?.destructiveHint, t.name).toBeFalsy();
    }
  });

  it('a read-only tool really does leave the Fold byte-identical', async () => {
    /* The hint has to be TRUE, not just declared. Every readOnlyHint tool is called against a
       real deck and the serialized bytes are compared before and after. inspect_render is the
       one worth the trouble: it renders the deck in a second frame, and a hint that let a host
       call it unattended would be a lie if that mutated anything. */
    const h = harness();
    await h.json('create_deck', { title: 'Read only' });
    const extra = await h.json('add_chunk', { starter: 'venn' });
    await h.json('propose_chunk', { chunkId: extra.chunkId, html: innerWith('Staged', 'Body') });
    const before = h.deck.serialize();
    const dirtyBefore = h.deck.peek()!.dirty;

    const args: Record<string, unknown> = { kind: 'free', chunkId: extra.chunkId };
    for (const name of READ_ONLY) {
      const res = await h.call(name, args);
      expect(res.isError, `${name}: ${res.content[0]!.text.slice(0, 160)}`).toBeFalsy();
      expect(h.deck.serialize(), `${name} changed the Fold`).toBe(before);
      expect(h.deck.peek()!.dirty, `${name} dirtied the Fold`).toBe(dirtyBefore);
      expect(h.proposals.count(), `${name} touched the queue`).toBe(1);
    }
  });

  it('every annotated caveat is also stated in prose, because a host may ignore the hint', () => {
    const h = harness();
    // destructive tools must SAY they can destroy something; a dropped annotation must not be
    // the difference between an agent knowing and not knowing
    expect(h.registry.get('delete_chunk')!.description).toMatch(/removes the slide template entirely/);
    expect(h.registry.get('delete_block')!.description).toMatch(/Delete a composite block definition/);
    expect(h.registry.get('create_deck')!.description).toMatch(/discard:true/);
  });
});

describe('save_deck never claims a save that did not happen', () => {
  /* The user's challenge behind this work was "you saved the demo file without me, so it must be
     possible". It was: a NODE script wrote those bytes, outside the page sandbox. What the page
     itself can do is narrower, and the whole point of these tests is that the result says which
     of the three things actually happened rather than rounding all of them up to "saved". */

  const deckWith = async (save: (text: string) => Promise<any>) => {
    const deck = new DeckStore();
    const registry = createRegistry({ deck, proposals: new ProposalStore(), runtimeJs, save });
    await registry.invoke('create_deck', { title: 'Save shapes' });
    return async () => JSON.parse((await registry.invoke('save_deck', {})).content[0]!.text);
  };

  it('saved:true ONLY for a verified file write', async () => {
    const run = await deckWith(async (text) => ({
      written: true,
      where: 'deck.origami.html',
      note: `written to the file on disk and read back: ${text.length} bytes.`,
      opfs: { written: true, path: 'saves/deck.origami.html', bytes: 10 },
    }));
    const body = await run();
    expect(body.saved).toBe(true);
    expect(body.durability).toBe("on the human's disk");
  });

  it('a started DOWNLOAD is never reported as saved', async () => {
    // Chrome was measured starting a gesture-less download, but the page cannot see where the
    // bytes went — so downloadStarted is its own field and `saved` stays false.
    const run = await deckWith(async () => ({
      written: false,
      where: 'saves/deck.origami.html (browser storage)',
      downloadStarted: true,
      opfs: { written: true, path: 'saves/deck.origami.html', bytes: 4242 },
      note: 'a download was STARTED without a user gesture — the page cannot see whether it landed.',
    }));
    const body = await run();
    expect(body.saved).toBe(false);
    expect(body.downloadStarted).toBe(true);
    expect(body.durability).toMatch(/in this browser only/);
    expect(body.note).toMatch(/cannot see whether it landed/);
  });

  it('reports the OPFS backstop failing rather than hiding it behind "saved: false"', async () => {
    const run = await deckWith(async () => ({
      written: false,
      where: 'the browser autosave slot',
      downloadStarted: false,
      opfs: { written: false, why: 'this browser has no Origin Private File System (navigator.storage.getDirectory)' },
      note: 'nothing durable was written.',
    }));
    const body = await run();
    expect(body.saved).toBe(false);
    expect(body.opfs).toMatchObject({ written: false });
    expect(body.opfs.why).toMatch(/no Origin Private File System/);
    expect(body.durability).toMatch(/in memory only/);
  });

  it('a handle whose permission lapsed is reported as NOT saved, with the reason', async () => {
    const run = await deckWith(async () => ({
      written: false,
      where: 'saves/deck.origami.html (browser storage)',
      opfs: { written: true, path: 'saves/deck.origami.html', bytes: 99 },
      note: 'the file could NOT be written (write permission for this file has lapsed and re-granting it needs a click — press Save in the page).',
    }));
    const body = await run();
    expect(body.saved).toBe(false);
    expect(body.note).toMatch(/permission for this file has lapsed/);
    expect(body.durability).toMatch(/not on their disk/);
  });

  it('describes all three outcomes, so an agent can read the result correctly', () => {
    const d = harness().registry.get('save_deck')!.description;
    expect(d).toMatch(/saved:true means/);
    expect(d).toMatch(/opfs\.written means/);
    expect(d).toMatch(/downloadStarted means/);
    expect(d).toMatch(/NEVER reported as saved/);
    expect(d).toMatch(/evict/); // the browser-storage caveat is stated, not glossed
  });
});

describe('move_chunk reorders without touching content', () => {
  const labels = async (h: ReturnType<typeof harness>) =>
    (await h.json('list_chunks')).chunks.map((c: any) => c.label);

  it('changes the order list_chunks reports, and undo puts it back exactly', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Reorder' });
    await h.json('add_chunk', { label: 'B', html: innerWith('B', 'body B') });
    await h.json('add_chunk', { label: 'C', html: innerWith('C', 'body C') });
    expect(await labels(h)).toEqual(['Cover', 'B', 'C']);
    const before = h.deck.serialize();

    // a MOVE, not a swap: C is lifted out and re-inserted at 0, and the folds it passed shift
    const moved = await h.json('move_chunk', { chunkId: h.deck.model().order[2]!, position: 0 });
    expect(moved).toMatchObject({ from: 2, to: 0 });
    expect(moved.order.map((o: any) => o.label)).toEqual(['C', 'Cover', 'B']);
    expect(await labels(h)).toEqual(['C', 'Cover', 'B']);

    // the whole file, not just the order array: a reorder that left the templates elsewhere
    // would still list correctly and diff wrong
    await h.json('undo');
    expect(await labels(h)).toEqual(['Cover', 'B', 'C']);
    expect(h.deck.serialize()).toBe(before);
  });

  it('moves content with the fold — the slide that moved is the slide that was named', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Reorder content' });
    const b = await h.json('add_chunk', { label: 'B', html: innerWith('Heading B', 'body B') });
    await h.json('add_chunk', { label: 'C', html: innerWith('Heading C', 'body C') });

    await h.json('move_chunk', { chunkId: b.chunkId, position: 2 });
    const m = h.deck.model();
    expect(m.order[2]).toBe(b.chunkId);
    expect(m.slides.get(b.chunkId)!.inner).toContain('Heading B'); // not swapped, moved
    expect(buildModel(parseDeck(h.deck.serialize())).order[2]).toBe(b.chunkId);
  });

  it('REFUSES a position outside the deck instead of silently clamping it', async () => {
    /* applyOp clamps `to` into range, so an agent that miscounted would be told "moved to 9"
       and get a move to the end. The refusal is the whole point of the extra check. */
    const h = harness();
    await h.json('create_deck', { title: 'Out of range' });
    await h.json('add_chunk', { label: 'B' });
    const before = h.deck.serialize();

    const res = await h.call('move_chunk', { chunkId: h.deck.model().order[0]!, position: 9 });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/valid range is 0 to 1/);
    expect(h.deck.serialize()).toBe(before);

    const unknown = await h.call('move_chunk', { chunkId: 'sdeadbeef', position: 0 });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(unknown.content[0]!.text).error).toMatch(/unknown chunk/);
    expect(h.deck.serialize()).toBe(before);
  });

  it('a move to where the chunk already is changes nothing at all', async () => {
    /* Not just "the order is the same": running it through mutate() would dirty the Fold and
       re-render it, so the Save button would go amber for a call that moved nothing. */
    const h = harness();
    await h.json('create_deck', { title: 'No-op move' });
    await h.json('add_chunk', { label: 'B' });
    h.deck.markSaved();
    const depth = h.deck.undoDepth();
    let changes = 0;
    h.deck.subscribe((ev) => {
      if (ev === 'change') changes++;
    });

    const res = await h.json('move_chunk', { chunkId: h.deck.model().order[1]!, position: 1 });
    expect(res.moved).toBeUndefined();
    expect(res.note).toMatch(/already at index 1/);
    expect(res.order).toHaveLength(2); // it still answers with the order it was asked about
    expect(h.deck.undoDepth()).toBe(depth); // no phantom step on the stack
    expect(h.deck.peek()!.dirty).toBe(false); // and no phantom unsaved-changes flag
    expect(changes).toBe(0); // and no re-render
  });
});

describe('set_chunk_meta is the way back from hidden', () => {
  it('un-hides a fold delete_chunk hid — the only route on this surface', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Un-hide' });
    const extra = await h.json('add_chunk', { label: 'Hideable' });

    await h.json('delete_chunk', { chunkId: extra.chunkId }); // default mode is hide
    const hidden = await h.json('list_chunks');
    expect(hidden.chunks.find((c: any) => c.id === extra.chunkId).hidden).toBe(true);

    const back = await h.json('set_chunk_meta', { chunkId: extra.chunkId, hidden: false });
    expect(back).toMatchObject({ chunkId: extra.chunkId, hidden: false });
    const shown = await h.json('list_chunks');
    expect(shown.chunks.find((c: any) => c.id === extra.chunkId).hidden).toBe(false);
    // and the deck on disk agrees, not just the in-memory model
    expect(buildModel(parseDeck(h.deck.serialize())).slides.get(extra.chunkId)!.hidden).toBe(false);
  });

  it('sets label and notes, leaves the untouched fields and the content alone', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Meta' });
    const id = h.deck.model().order[0]!;
    const innerBefore = h.deck.model().slides.get(id)!.inner;

    await h.json('set_chunk_meta', { chunkId: id, label: 'Renamed cover' });
    expect(h.deck.model().slides.get(id)!.label).toBe('Renamed cover');
    expect(h.deck.model().slides.get(id)!.hidden).toBe(false); // not passed ⇒ not changed
    expect(h.deck.model().slides.get(id)!.inner).toBe(innerBefore); // content is write_chunk's job

    await h.json('set_chunk_meta', { chunkId: id, notes: 'Say the thing about the thing' });
    expect(h.deck.model().slides.get(id)!.label).toBe('Renamed cover'); // still there
    const reloaded = buildModel(parseDeck(h.deck.serialize()));
    expect(reloaded.slides.get(id)!.label).toBe('Renamed cover');
    expect(reloaded.slides.get(id)!.notes).toBe('Say the thing about the thing');
  });

  it('keeps a non-ASCII label and notes exact through the manifest', async () => {
    // label and notes are manifest JSON, not slide content — a different escaping path from
    // the inner html the round-trip tests already cover
    const h = harness();
    await h.json('create_deck', { title: 'Unicode meta' });
    const id = h.deck.model().order[0]!;
    await h.json('set_chunk_meta', { chunkId: id, label: 'Café — 東京 · 🗻', notes: '«quoted» — Ελληνικά' });

    const reloaded = buildModel(parseDeck(h.deck.serialize()));
    expect(reloaded.slides.get(id)!.label).toBe('Café — 東京 · 🗻');
    expect(reloaded.slides.get(id)!.notes).toBe('«quoted» — Ελληνικά');
  });

  it('refuses an empty patch and an unknown chunk, changing nothing', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Meta refusals' });
    const before = h.deck.serialize();

    const empty = await h.call('set_chunk_meta', { chunkId: h.deck.model().order[0]! });
    expect(empty.isError).toBe(true);
    expect(JSON.parse(empty.content[0]!.text).error).toMatch(/at least one of label, hidden or notes/);

    const unknown = await h.call('set_chunk_meta', { chunkId: 'sdeadbeef', label: 'x' });
    expect(unknown.isError).toBe(true);
    expect(h.deck.serialize()).toBe(before);
  });

  it('delete_chunk names the way back, because a hidden fold looks deleted', async () => {
    const d = harness().registry.get('delete_chunk')!.description;
    expect(d).toMatch(/set_chunk_meta\(\{chunkId, hidden:false\}\)/);
    expect(d).toMatch(/removes the slide template entirely/); // the destructive warning stays
  });
});

describe('set_deck_meta: title and theme', () => {
  it('round-trips a new title through serialize -> parseDeck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Before' });
    expect(h.deck.name()).toBe('before.origami.html');

    const res = await h.json('set_deck_meta', { title: 'After the rename' });
    expect(res.title).toBe('After the rename');
    expect(parseDeck(h.deck.serialize()).manifest.title).toBe('After the rename');
    expect(buildModel(parseDeck(h.deck.serialize())).title).toBe('After the rename');
    // the description promises the FILE is not renamed; hold it to that
    expect(h.deck.name()).toBe('before.origami.html');

    await h.json('undo');
    expect(h.deck.model().title).toBe('Before');
  });

  it('MERGES a token patch onto the theme in force instead of erasing the rest', async () => {
    /* The trap: a fresh Fold carries manifest.theme.tokens = {} while its :root block holds the
       full token set, and serializeModel re-projects that block from the model's tokens ALONE.
       Patching one token off the empty map would strip every other custom property out of the
       file — the deck would still validate and would render unstyled. */
    const h = harness();
    await h.json('create_deck', { title: 'Theme merge' });
    expect(h.deck.model().theme.tokens).toEqual({}); // the empty map that makes this dangerous
    const before = h.deck.serialize();
    expect(before).toContain('--bg: #F7F6F1;');

    const res = await h.json('set_deck_meta', { themeTokens: { accent: '#123456' } });
    expect(res.theme.tokens.accent).toBe('#123456');

    const after = h.deck.serialize();
    expect(after).toContain('--accent: #123456;'); // the patch landed
    expect(after).toContain('--bg: #F7F6F1;'); // and the untouched tokens survived
    expect(after).toContain('--ink: #22251F;');
    expect(after).toContain('--font-body:');
    expect(validateDeck(parseDeck(after))).toEqual([]);
  });

  it('a bare rename keeps the colours it did not change', async () => {
    // deck.theme carries name AND tokens, so renaming with the model's empty map would blank
    // the style block just as a patch would
    const h = harness();
    await h.json('create_deck', { title: 'Theme rename' });
    await h.json('set_deck_meta', { themeName: 'boardroom' });

    const text = h.deck.serialize();
    expect(parseDeck(text).manifest.theme!.name).toBe('boardroom');
    expect(text).toContain('--bg: #F7F6F1;');
    expect(text).toContain('--chrome-ink: #22251F;');
    expect(validateDeck(parseDeck(text))).toEqual([]);
  });

  it('merges onto a Fold the human OPENED, and keeps its CRLF line endings', async () => {
    /* The two decks this tool meets in the wild are one this app minted and one dropped on the
       page. The second is the harder case: the tokens in force are read out of the file's own
       :root block, and on Windows that file's lines end in CRLF. */
    const h = harness();
    const crlf = (await sampleDeck()).replace(/\r?\n/g, '\r\n');
    h.deck.open(crlf, 'crlf.origami.html');
    expect(h.deck.model().theme.tokens).toEqual({});

    await h.json('set_deck_meta', { title: 'Opened and re-themed', themeTokens: { accent: '#0A0B0C' } });

    const out = h.deck.serialize();
    expect(out).not.toMatch(/[^\r]\n/); // every LF still carries its CR
    expect(out).toContain('--accent: #0A0B0C;');
    expect(out).toContain('--bg: #F7F6F1;'); // the value parsed back out of the CRLF block
    expect(out).not.toContain('#F7F6F1\r'); // and the CR did not ride along into the token value
    expect(parseDeck(out).manifest.title).toBe('Opened and re-themed');
    expect(validateDeck(parseDeck(out))).toEqual([]);
  });

  it('sets title and theme in ONE undo step when both are asked for', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Both' });
    const before = h.deck.serialize();

    await h.json('set_deck_meta', { title: 'Both changed', themeTokens: { accent: '#ABCDEF' } });
    expect(h.deck.model().title).toBe('Both changed');
    expect(h.deck.serialize()).toContain('--accent: #ABCDEF;');

    const undone = await h.json('undo');
    expect(undone.undone.op).toBe('batch');
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses an empty call and a token value that could break out of :root', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Theme refusals' });
    const before = h.deck.serialize();

    const empty = await h.call('set_deck_meta', {});
    expect(empty.isError).toBe(true);
    expect(JSON.parse(empty.content[0]!.text).error).toMatch(/supply title, themeName and\/or themeTokens/);

    const evil = await h.call('set_deck_meta', { title: 'Still applied?', themeTokens: { accent: 'red; } body { display:none' } });
    expect(evil.isError).toBe(true);
    expect(JSON.parse(evil.content[0]!.text).violations.length).toBeGreaterThan(0);
    // the title in the SAME call must not have landed on its own
    expect(h.deck.model().title).toBe('Theme refusals');
    expect(h.deck.serialize()).toBe(before);
  });
});

describe('export_deck hands the agent the bytes, and saves nothing', () => {
  it('returns the exact serialized Fold, and it is a valid deck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Export' });
    await h.json('add_chunk', { starter: 'venn' });
    const dirtyBefore = h.deck.peek()!.dirty;

    const res = await h.json('export_deck');
    expect(res.text).toBe(h.deck.serialize()); // byte-equal to what the page renders and saves
    expect(res.bytes).toBe(new TextEncoder().encode(res.text).length);
    expect(res).toMatchObject({ name: 'export.origami.html', title: 'Export', slides: 2 });

    const parsed = parseDeck(res.text);
    expect(validateDeck(parsed)).toEqual([]);
    expect(buildModel(parsed).order).toEqual(h.deck.model().order);

    // readOnlyHint has to be true: exporting must not dirty the Fold or restamp anything
    expect(h.deck.peek()!.dirty).toBe(dirtyBefore);
    expect(h.deck.serialize()).toBe(res.text);
  });

  it('says it is NOT a save, so an agent cannot end the job on it', async () => {
    const d = harness().registry.get('export_deck')!.description;
    expect(d).toMatch(/writes NOTHING, saves NOTHING/);
    expect(d).toMatch(/save_deck/);
    expect(d).toMatch(/4 MB/);
  });

  it('refuses a Fold over the 4 MB limit and names its size', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Huge' });
    // one inert paragraph big enough to push the file past the limit on its own
    await h.json('add_custom_fold', { html: `<div class="slide-inner"><p>${'x'.repeat(4_300_000)}</p></div>`, label: 'Big' });

    const res = await h.call('export_deck');
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.bytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(body.limit).toBe(4 * 1024 * 1024);
    expect(body.error).toMatch(/Call save_deck instead/);
    expect(body.text).toBeUndefined(); // the payload it refused is not smuggled into the error
  });
});

describe('the activity feed records every call at the one hook', () => {
  it('reflects a real sequence newest-first, including the call that failed', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Feed' });
    const added = await h.json('add_chunk', { starter: 'venn', position: 1 });
    await h.json('write_chunk', { chunkId: added.chunkId, html: innerWith('Feed heading', 'Feed body') });
    const bad = await h.call('delete_chunk', { chunkId: 'sdeadbeef' });
    expect(bad.isError).toBe(true);

    const feed = await h.json('list_activity');
    const tools = feed.entries.map((e: any) => e.tool);
    expect(tools).toEqual(['delete_chunk', 'write_chunk', 'add_chunk', 'create_deck']);
    expect(feed.held).toBe(4); // this call is recorded AFTER its own answer, so it is not in it

    // newest first, by the log's own counter
    const seqs = feed.entries.map((e: any) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a: number, b: number) => b - a));

    const [failed, written, addedEntry, created] = feed.entries;
    expect(failed).toMatchObject({ ok: false, targetId: 'sdeadbeef', source: 'agent' });
    expect(failed.error).toMatch(/unknown chunk "sdeadbeef"/);
    expect(written).toMatchObject({ ok: true, targetId: added.chunkId });
    expect(addedEntry.summary).toBe('add_chunk — venn starter at index 1');
    expect(created.summary).toBe('create_deck — "Feed"');
    for (const e of feed.entries) {
      expect(typeof e.ms, e.tool).toBe('number');
      expect(e.ms, e.tool).toBeGreaterThanOrEqual(0);
      expect(new Date(e.at).toISOString(), e.tool).toBe(e.at);
    }
  });

  it('never lets a slide payload into a summary', async () => {
    /* The feed is read far more often than the deck. A summary that pasted the html an agent
       wrote would make reading the log cost what reading the deck costs, and would leak the
       document into every UI that shows the feed. */
    const h = harness();
    await h.json('create_deck', { title: 'No payloads' });
    const id = h.deck.model().order[0]!;
    await h.json('write_chunk', { chunkId: id, html: innerWith('Secret heading', 'Secret body') });
    await h.json('add_custom_fold', { html: '<div class="slide-inner"><h2>Whole page</h2></div>', label: 'Page' });

    const feed = await h.json('list_activity');
    const summaries = feed.entries.map((e: any) => e.summary).join('\n');
    expect(summaries).not.toContain('<');
    expect(summaries).not.toContain('Secret body');
    expect(summaries).not.toContain('slide-inner');
    for (const e of feed.entries) expect(e.summary.length, e.tool).toBeLessThan(160);
  });

  it('records the source the caller declared, and the page can push its own events', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Sources' });
    await h.registry.invoke('list_chunks', {}, 'console');
    h.registry.activity.push({ source: 'human', tool: 'open', ok: true, ms: 0, summary: 'open — welcome.origami.html' });

    const feed = await h.json('list_activity');
    expect(feed.entries.map((e: any) => [e.tool, e.source])).toEqual([
      ['open', 'human'],
      ['list_chunks', 'console'],
      ['create_deck', 'agent'], // no source stated ⇒ an agent call
    ]);
  });

  it('records a call to a tool that does not exist — a guessed name is worth seeing', async () => {
    const h = harness();
    await h.call('summon_pony', { colour: 'pink' });
    const feed = await h.json('list_activity');
    expect(feed.entries[0]).toMatchObject({ tool: 'summon_pony', ok: false });
    expect(feed.entries[0].error).toMatch(/unknown tool "summon_pony"/);
  });

  it('honours limit, refuses a bad one, and keeps only the newest 500', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Limits' });
    for (let i = 0; i < 5; i++) await h.json('list_chunks');
    expect((await h.json('list_activity', { limit: 2 })).entries).toHaveLength(2);

    const bad = await h.call('list_activity', { limit: 0 });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text).error).toMatch(/positive integer/);

    const log = new ActivityLog();
    for (let i = 0; i < ACTIVITY_CAP + 42; i++) log.push({ source: 'agent', tool: 't', ok: true, ms: 0, summary: `call ${i}` });
    expect(log.count()).toBe(ACTIVITY_CAP);
    expect(log.recent(1)[0]!.summary).toBe(`call ${ACTIVITY_CAP + 41}`); // newest kept
    expect(log.all()[0]!.summary).toBe('call 42'); // oldest dropped
    expect(log.all()[0]!.seq).toBe(43); // and the gap in seq says so
  });

  it('notifies a subscriber once per entry, so the page rail can follow live', async () => {
    const h = harness();
    const seen: string[] = [];
    const off = h.registry.activity.subscribe((e) => seen.push(e.tool));
    await h.json('create_deck', { title: 'Subscribe' });
    await h.json('list_chunks');
    off();
    await h.json('list_chunks');
    expect(seen).toEqual(['create_deck', 'list_chunks']); // and nothing after unsubscribing
  });
});

describe('origami_guide by topic', () => {
  const size = (o: unknown) => JSON.stringify(o, null, 2).length;

  it('the default answer points at the two bulk payloads instead of pasting them', async () => {
    const h = harness();
    const guide = await h.json('origami_guide');

    // pointers, not bodies
    expect(typeof guide.recipes.cards).toBe('string');
    expect(guide.recipes.cards).toMatch(/origami_guide\(\{ topic: "recipes" \}\)/);
    expect(typeof guide.starters.folds).toBe('string');
    expect(guide.starters.folds).toMatch(/origami_guide\(\{ topic: "starters" \}\)/);
    // and each pointer says how much is behind it
    expect(guide.recipes.cards).toContain(`${RECIPES.length} recipe cards`);
    expect(guide.starters.folds).toContain(`${FOLD_STARTERS.length} ready-made folds`);

    // everything else is still there in full
    expect(Object.keys(guide.kinds).sort()).toEqual(Object.keys(KINDS).sort());
    expect(guide.knownIssues.flowKindMastheadClip).toMatch(/measured at 42px/);
    expect(guide.editProtocol.length).toBeGreaterThan(4);
    expect(guide.topics.howToUse).toMatch(/origami_guide\(\{ topic \}\)/);
  });

  it('every topic returns its section, and nothing in the guide is unreachable', async () => {
    const h = harness();
    const dflt = await h.json('origami_guide');

    // the sections the default answer keeps whole must be byte-for-byte the same by topic —
    // a topic that quietly returned a different edition would be a second source of truth
    expect((await h.json('origami_guide', { topic: 'issues' })).knownIssues).toEqual(dflt.knownIssues);
    expect((await h.json('origami_guide', { topic: 'tools' })).tools).toEqual(dflt.tools);

    // kinds is the third abridged section: the default has the index, the topic has the bodies
    const kinds = (await h.json('origami_guide', { topic: 'kinds' })).kinds;
    expect(Object.keys(kinds).sort()).toEqual(Object.keys(dflt.kinds).sort());
    for (const key of Object.keys(kinds)) {
      expect(kinds[key].name, key).toBe(dflt.kinds[key].name);
      expect(kinds[key].placement, key).toBe(dflt.kinds[key].placement);
      expect(Array.isArray(kinds[key].schema), key).toBe(true); // the body the index left behind
    }

    // and the two the default answer only points at come back in FULL from their topic,
    // prose included — that is what makes "nothing is deleted" true
    const recipes = (await h.json('origami_guide', { topic: 'recipes' })).recipes;
    expect(Object.keys(recipes.cards).sort()).toEqual(RECIPES.map((r) => r.key).sort());
    expect(recipes.howToUse).toBe(dflt.recipes.howToUse);
    expect(recipes.styleCaveat).toBe(dflt.recipes.styleCaveat);
    const starters = (await h.json('origami_guide', { topic: 'starters' })).starters;
    expect(starters.folds.map((s: any) => s.starter)).toEqual(FOLD_STARTERS.map((s) => s.key));
    expect(starters.howToUse).toBe(dflt.starters.howToUse);

    const contract = await h.json('origami_guide', { topic: 'contract' });
    for (const key of ['formatVersion', 'host', 'whatIsOrigami', 'editProtocol', 'inertRules', 'notAvailableHere']) {
      expect(contract[key], key).toEqual(dflt[key]);
    }
    // the contract topic is prose only — the bulk sections are the other topics' job
    expect(contract.kinds).toBeUndefined();
    expect(contract.recipes).toBeUndefined();

    const bad = await h.call('origami_guide', { topic: 'nonsense' });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text).availableTopics).toEqual([...GUIDE_TOPICS]);

    // kind still wins, so the old one-kind call is untouched
    expect((await h.json('origami_guide', { kind: 'free', topic: 'kinds' })).kind).toBe('free');
  });

  it('MEASURED: the default answer costs a fraction of the whole guide', async () => {
    /* Numbers, not adjectives, and re-measured on every run so a section that grows back into
       the default is a failing test rather than a surprise. */
    const h = harness();
    const dflt = await h.json('origami_guide');
    const sizes: Record<string, number> = { default: size(dflt) };
    for (const topic of GUIDE_TOPICS) sizes[topic] = size(await h.json('origami_guide', { topic }));
    // what the default WOULD have cost with all three bodies inlined, composed from the topics
    // themselves rather than from a private export
    const whole = {
      ...dflt,
      kinds: (await h.json('origami_guide', { topic: 'kinds' })).kinds,
      recipes: (await h.json('origami_guide', { topic: 'recipes' })).recipes,
      starters: (await h.json('origami_guide', { topic: 'starters' })).starters,
    };
    delete whole.topics;
    delete whole.kindsHowTo;
    sizes.whole = size(whole);
    console.log('origami_guide bytes (JSON.stringify(...,null,2).length):', JSON.stringify(sizes, null, 2));

    // the budget this slice was built to: a cold agent's first call stays under 20 KB
    expect(sizes.default!).toBeLessThanOrEqual(20_000);
    expect(sizes.default!).toBeLessThan(sizes.whole! / 2);
    // the cheapest routes an agent has: the protocol alone, and the tool catalog alone
    expect(sizes.contract!).toBeLessThan(6_000);
    expect(sizes.tools!).toBeLessThan(6_000);
  });

  it('advertises every registered tool in the catalog, default answer included', async () => {
    /* The catalog IS the API description an agent reads first, so a tool missing from it is
       invisible and a phantom entry is a wild goose chase. Asserted on both the default answer
       and the tools topic, since either can be the only one an agent calls. */
    const h = harness();
    const registered = h.registry.list().map((t) => t.name).sort();
    expect(Object.keys((await h.json('origami_guide')).tools).sort()).toEqual(registered);
    expect(Object.keys((await h.json('origami_guide', { topic: 'tools' })).tools).sort()).toEqual(registered);
    for (const name of ['move_chunk', 'set_chunk_meta', 'set_deck_meta', 'export_deck', 'list_activity']) {
      expect(registered, name).toContain(name);
    }
  });
});

describe('the new writers say they write, because destructiveHint does not reach Chrome', () => {
  it('every mutating tool states the change in its own description', () => {
    const h = harness();
    for (const name of ['move_chunk', 'set_chunk_meta', 'set_deck_meta']) {
      const t = h.registry.get(name)!;
      expect(t.description, name).toMatch(/CHANGES THE DECK the human is looking at/);
      expect(t.annotations?.readOnlyHint, name).toBeFalsy();
    }
    // and the two read-only newcomers must not claim to write, nor be marked destructive
    for (const name of ['export_deck', 'list_activity']) {
      expect(h.registry.get(name)!.annotations?.readOnlyHint, name).toBe(true);
      expect(h.registry.get(name)!.annotations?.destructiveHint, name).toBeFalsy();
    }
  });
});

describe('the OPFS backstop', () => {
  it('sanitises a filename so a deck title can never escape the saves directory', async () => {
    const { safeName } = await import('../../src/app/opfs.js');
    expect(safeName('../../etc/passwd')).not.toContain('/');
    expect(safeName('..\\..\\win.ini')).not.toContain('\\');
    expect(safeName('a/b:c*d?e"f<g>h|i.origami.html')).toBe('a-b-c-d-e-f-g-h-i.origami.html');
    expect(safeName('')).toBe('untitled.origami.html');
    expect(safeName('...')).toBe('untitled.origami.html');
    expect(safeName('x'.repeat(400)).length).toBe(120);
    expect(safeName('welcome.origami.html')).toBe('welcome.origami.html');
  });
});
