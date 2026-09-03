import { describe, expect, it } from 'vitest';
import { FORMAT_BLOCKS, KINDS, buildModel, parseDeck, validateDeck } from '../../vendor/format-dist/index.js';
import { FLOW_INNER, VENN_INNER } from '../fixtures.js';
import { formatCell } from '../../vendor/format-dist/index.js';
import { CHARTS_MODE } from '../../src/core/modes.js';
import { ACTIVITY_CAP, ActivityLog } from '../../src/core/activity.js';
import { DeckStore } from '../../src/core/deck-store.js';
import { GUIDE_TOPICS } from '../../src/core/guide.js';
import { ProposalStore, restorableProposals } from '../../src/core/proposal-store.js';
import { createModeRegistry } from '../../src/core/mode-registry.js';
import { FOLIO_MODE } from '../../src/core/modes.js';
import { RECIPES } from '../../src/core/recipes.js';
import { COMPOSED_PLOT_HEIGHT, MIN_PLOT_HEIGHT, SIZE_RANGE, chartPlotHeight, graphFitHeight } from '../../src/core/compose.js';
import { MemoryThemeStore, THEME_TOKENS, contrastRatio, unknownTokens } from '../../src/core/themes.js';
import { BATCH_MAX } from '../../src/core/batch-tool.js';
import { FOLD_STARTERS, GRAPH_FIT_HEIGHT, MIN_GRAPH_HEIGHT } from '../../src/core/fold-starters.js';
import { analyseRender, summarise, type FoldGeometry, type MeasureFn } from '../../src/core/inspect.js';
import { injectMeasurer } from '../../src/app/measure.js';
import { harness, innerWith, miniHarness, runtimeJs, sampleDeck } from './harness.js';

/* These run against the REAL vendored @origami/format + @origami/runtime — no mocks, no
   stubs. Every assertion is about observable deck state (what the model holds, what the
   serialized file contains), never about which internal function was called. */

describe('tool surface', () => {
  it('registers exactly the 39 web tools, including accept/reject so an agent runs unattended', () => {
    const h = harness();
    const names = h.registry.list().map((t) => t.name).sort();
    expect(names).toEqual([
      'accept_proposal',
      'add_chunk',
      'add_custom_fold',
      'add_fold',
      'add_ledger',
      'apply_theme',
      'create_deck',
      'define_block',
      'delete_block',
      'delete_chunk',
      'delete_theme',
      'export_deck',
      'get_block',
      'get_kind_schema',
      'inspect_render',
      'list_activity',
      'list_block_defs',
      'list_chunks',
      'list_proposals',
      'list_starters',
      'list_themes',
      'move_chunk',
      'origami_guide',
      'propose_add',
      'propose_chunk',
      'propose_delete',
      'read_chunk',
      'reject_proposal',
      'revert_to_saved',
      'run_batch',
      'save_deck',
      'save_theme',
      'set_block',
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
    const registry = createModeRegistry({
      deck,
      proposals,
      runtimeJs,
      save: async (text) => {
        captured = text;
        return { written: true, where: 'deck.origami.html', note: 'written to the file on disk.' };
      },
    }, FOLIO_MODE);
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
    // the numbers actually observed after the 2026-09-02 runtime refresh changed them
    expect(clip).toMatch(/90-97px/);
    expect(clip).toMatch(/116-185px/);
    expect(clip).toMatch(/wrap a flow\/graph figure in a free card/);
    // and it does not tell an agent to work around it any other way
    expect(clip).not.toMatch(/avoid the flow kind|do not use/i);

    // the empty-data-block trap is FIXED, so the entry states the new behaviour: the gate
    // refuses it at authoring time with the rule named, and inspect_render still owns the rest
    expect(guide.knownIssues.dataBlocksAreGatedAtWriteTime).toMatch(/REFUSED at authoring time/);
    expect(guide.knownIssues.dataBlocksAreGatedAtWriteTime).toMatch(/flow\.nodes\.count/);
    expect(guide.knownIssues.dataBlocksAreGatedAtWriteTime).toMatch(/inspect_render/);
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
    const registry = createModeRegistry({
      deck,
      proposals: new ProposalStore(),
      runtimeJs,
      measure: async () => {
        throw new Error('the deck did not finish rendering within 15s, so nothing was measured');
      },
    }, FOLIO_MODE);
    await registry.invoke('create_deck', { title: 'Timeout' });
    const body = JSON.parse((await registry.invoke('inspect_render', {})).content[0]!.text);
    expect(body.measured).toBe(false);
    expect(body.why).toMatch(/the measurement failed: the deck did not finish rendering/);
    expect(body.clean).toBe(false); // a failure must never read as clean:true
    expect(body.outcome).toBe('unknown');
  });

  /* A registry with a scripted measure route, so the tool's own arithmetic (subsets, budgets,
     the verdict) is tested against numbers this test controls. */
  const scripted = async (n: number, measure: MeasureFn) => {
    const deck = new DeckStore();
    const registry = createModeRegistry({ deck, proposals: new ProposalStore(), runtimeJs, measure }, FOLIO_MODE);
    await registry.invoke('create_deck', { title: 'Scripted' });
    for (let i = 1; i < n; i++) await registry.invoke('add_chunk', { label: `Fold ${i}` });
    const call = async (args: Record<string, unknown> = {}) => {
      const r = await registry.invoke('inspect_render', args);
      return { ...JSON.parse(r.content[0]!.text), isError: r.isError === true };
    };
    return { deck, call, ids: () => [...deck.model().order] };
  };
  const measuredAs = (ids: string[]): MeasureFn => async (_text, want) => ({ viewport: { width: 1280, height: 720 }, folds: want.filter((id) => ids.includes(id)).map((id) => geo(id)) });

  it('never calls a 0x0 viewport clean — it is unknown, with the reason', async () => {
    // the report that prompted this: every fold "rendered with zero height", viewport 0 x 0, clean: true
    const { call, ids } = await scripted(2, async (_t, want) => ({
      viewport: { width: 0, height: 0 },
      folds: want.map((id) => ({ ...geo(id), measured: false, reason: 'the fold is in the deck but rendered with zero height, and no tab could bring it on screen' })),
    }));
    const body = await call();
    expect(body.measured).toBe(false);
    expect(body.outcome).toBe('unknown');
    expect(body.clean).toBe(false);
    expect(body.why).toMatch(/0x0 viewport/);
    expect(body.folds.map((f: any) => f.id)).toEqual(ids());
  });

  it('is clean only when EVERY fold was measured and none has a defect', async () => {
    const { call, ids } = await scripted(3, async (_t, want) => ({ viewport: { width: 1280, height: 720 }, folds: want.map((id) => geo(id)) }));
    const body = await call();
    expect(body).toMatchObject({ measured: true, outcome: 'clean', clean: true, coverage: { total: 3, requested: 3, measured: 3 } });
    expect(body.remeasure).toBeUndefined();
    expect(body.folds.map((f: any) => f.id)).toEqual(ids());
  });

  it('measures a subset with foldIds, and says clean is about the subset, not the deck', async () => {
    let asked: string[] = [];
    const { call, ids } = await scripted(3, async (_t, want) => {
      asked = want;
      return { viewport: { width: 1280, height: 720 }, folds: want.map((id) => geo(id)) };
    });
    const [a, b, c] = ids();
    const body = await call({ foldIds: [c, b] });
    expect(asked).toEqual([b, c]); // deck order is kept, whatever order was asked in
    expect(body.outcome).toBe('clean'); // every REQUESTED fold measured clean
    expect(body.clean).toBe(false); // but the deck was not fully measured
    expect(body.coverage).toEqual({ total: 3, requested: 2, measured: 2 });
    expect(body.folds[0]).toMatchObject({ id: a, skipped: true, measured: false });
    expect(body.folds[1]).toMatchObject({ id: b, measured: true, fits: true });
    expect(body.note).toMatch(/Only 2 of 3 folds were requested/);
  });

  it('refuses an unknown foldId and a bad maxFolds before measuring anything', async () => {
    let calls = 0;
    const { call } = await scripted(2, async (_t, want) => {
      calls++;
      return { viewport: { width: 1280, height: 720 }, folds: want.map((id) => geo(id)) };
    });
    const bad = await call({ foldIds: ['nope'] });
    expect(bad.isError).toBe(true);
    expect(bad.error).toMatch(/no such chunk: nope/);
    const zero = await call({ maxFolds: 0 });
    expect(zero.isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('maxFolds measures the first N in deck order', async () => {
    let asked: string[] = [];
    const { call, ids } = await scripted(4, async (_t, want) => {
      asked = want;
      return { viewport: { width: 1280, height: 720 }, folds: want.map((id) => geo(id)) };
    });
    const body = await call({ maxFolds: 2 });
    expect(asked).toEqual(ids().slice(0, 2));
    expect(body.coverage).toEqual({ total: 4, requested: 2, measured: 2 });
    expect(body.folds.filter((f: any) => f.skipped)).toHaveLength(2);
  });

  it('keeps what a budget-hit measurement reached, calls the verdict unknown, and names the rest', async () => {
    const { call, ids } = await scripted(3, async (_t, want) => ({
      viewport: { width: 1280, height: 720 },
      folds: [geo(want[0]!), geo(want[1]!, { contentHeight: 2000 }), { ...geo(want[2]!), measured: false, reason: 'not reached: the 15s measuring budget ran out after 2 of 3 folds' }],
      partial: { measuredCount: 2, requested: 3, budgetMs: 15_000 },
    }));
    const [, b, c] = ids();
    const body = await call();
    expect(body.measured).toBe(true); // something WAS measured
    expect(body.outcome).toBe('unknown'); // but not everything, so no verdict on the deck
    expect(body.clean).toBe(false);
    expect(body.remeasure).toEqual([c]);
    expect(body.partial).toEqual({ measuredCount: 2, requested: 3, budgetMs: 15_000 });
    expect(body.note).toMatch(/budget ran out after 2 of 3 folds/);
    // the overflow that WAS measured is still reported — partial is not silent
    expect(body.warnings).toEqual([expect.objectContaining({ fold: b, issue: 'overflow' })]);
    expect(body.folds[2]).toMatchObject({ id: c, measured: false, why: expect.stringMatching(/budget ran out/) });
  });

  it('summarise: defects beat clean, unknown beats both, and an empty request is unknown', () => {
    const w = { fold: 'x', label: 'x', issue: 'overflow' as const, detail: '' };
    expect(summarise([{ id: 'a', measured: true }], [])).toMatchObject({ outcome: 'clean', clean: true });
    expect(summarise([{ id: 'a', measured: true }], [w])).toMatchObject({ outcome: 'defects', clean: false });
    expect(summarise([{ id: 'a', measured: true }, { id: 'b', measured: false }], [w])).toMatchObject({ outcome: 'unknown', clean: false, remeasure: ['b'] });
    expect(summarise([{ id: 'a', skipped: true, measured: false }], [])).toMatchObject({ outcome: 'unknown', clean: false, coverage: { total: 1, requested: 0, measured: 0 } });
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

    // a treemap cell's name stacked over its value, measured off a real render (2026-09-03):
    // the two text boxes share a ~1px sliver across their width — touching, not colliding
    const stacked = analyseRender(h.deck.model(), {
      viewport: { width: 1280, height: 720 },
      folds: [
        geo(id, {
          labels: [
            { text: 'Engineering', x: 383, y: 570, w: 58, h: 13.5 },
            { text: '420', x: 402, y: 582.5, w: 20, h: 13.5 },
          ],
        }),
      ],
    });
    expect(stacked.warnings).toEqual([]);
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

describe('revert_to_saved drops every unsaved change in ONE call', () => {
  /* The bar is the same as undo's: byte-equality against a real baseline, not "the heading is
     gone". Unlike undo this does not unwind step by step — it jumps straight to the baseline
     and clears the stack in the same move, which is the whole point after a run_batch that
     went sideways (undo would be one call per step). */

  it('a dirty Fold reverts to how it was created, restores order and title, and clears the stack', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Revert me' });
    const beforeAnyEdit = h.deck.serialize();
    expect(h.deck.peek()!.dirty).toBe(false);

    await h.json('add_chunk', { html: innerWith('Regretted', 'Fold'), label: 'Regretted' });
    await h.json('set_header', { subtitle: 'Also regretted' });
    expect(h.deck.model().order).toHaveLength(2);
    expect(h.deck.peek()!.dirty).toBe(true);
    expect(h.deck.undoDepth()).toBe(2);

    const res = await h.json('revert_to_saved');
    expect(res).toMatchObject({ revertedTo: 'as created or opened', droppedUndoSteps: 2, chunks: 1 });
    expect(h.deck.serialize()).toBe(beforeAnyEdit);
    expect(h.deck.model().title).toBe('Revert me');
    expect(h.deck.model().order[0]).toBe(created.chunks[0].id);
    expect(h.deck.peek()!.dirty).toBe(false);
    expect(h.deck.undoDepth()).toBe(0); // the stack was cleared, not unwound
  });

  it('a save moves the baseline — revert then lands on the save, not on create_deck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Save then regret' });
    await h.json('add_chunk', { html: innerWith('Keep me', 'Saved'), label: 'Keep me' });
    h.deck.markSaved(); // the harness has no save route; markSaved is the documented fallback
    const afterSave = h.deck.serialize();
    expect(h.deck.peek()!.dirty).toBe(false);

    await h.json('add_chunk', { html: innerWith('Lose me', 'Unsaved'), label: 'Lose me' });
    expect(h.deck.model().order).toHaveLength(3);

    const res = await h.json('revert_to_saved');
    expect(res.revertedTo).toBe('last save');
    // droppedUndoSteps counts the WHOLE stack, not just the post-save edits — markSaved()
    // moves the baseline but does not touch History, so both add_chunk calls are still on it
    expect(res.droppedUndoSteps).toBe(2);
    expect(h.deck.serialize()).toBe(afterSave);
    expect(h.deck.model().order).toHaveLength(2);
  });

  it('refuses with a named reason when there is nothing unsaved to drop', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Untouched' });
    const before = h.deck.serialize();

    const res = await h.call('revert_to_saved');
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/nothing to revert/);
    expect(h.deck.serialize()).toBe(before); // refusal touches nothing

    // and with no Fold open at all it is the standard no-deck refusal, not a crash
    const empty = harness();
    const none = await empty.call('revert_to_saved');
    expect(none.isError).toBe(true);
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
    'get_block',
    'get_kind_schema',
    'inspect_render',
    'list_activity',
    'list_block_defs',
    'list_chunks',
    'list_proposals',
    'list_starters',
    'list_themes',
    'origami_guide',
    'read_chunk',
  ];
  const DESTRUCTIVE = ['create_deck', 'delete_block', 'delete_chunk', 'delete_theme', 'revert_to_saved'];

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

    // one bag of arguments serves every reader except get_block, whose `kind` is a DATA-block
    // kind (chart | venn | …), not a slide kind — omitted here so it reports the whole fold
    const args: Record<string, unknown> = { kind: 'free', chunkId: extra.chunkId };
    const argsFor = (name: string): Record<string, unknown> => (name === 'get_block' ? { chunkId: extra.chunkId } : args);
    for (const name of READ_ONLY) {
      const res = await h.call(name, argsFor(name));
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
    const registry = createModeRegistry({ deck, proposals: new ProposalStore(), runtimeJs, save }, FOLIO_MODE);
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
    expect(guide.knownIssues.flowKindMastheadClip).toMatch(/90-97px/);
    expect(guide.editProtocol.length).toBeGreaterThan(4);
    expect(guide.topics.howToUse).toMatch(/origami_guide\(\{ topic \}\)/);
  });

  it('every topic returns its section, and nothing in the guide is unreachable', async () => {
    const h = harness();
    const dflt = await h.json('origami_guide');

    // the sections the default answer keeps whole must be byte-for-byte the same by topic —
    // a topic that quietly returned a different edition would be a second source of truth
    expect((await h.json('origami_guide', { topic: 'issues' })).knownIssues).toEqual(dflt.knownIssues);

    /* tools is now abridged in the default answer too: per-turn description bytes are the scarce
       thing, so the prose the tool DESCRIPTIONS no longer carry moved into this topic. The
       default keeps the COMPLETE list of names with one line each — an agent must be able to
       trust it on its own — and each of those lines has to be the real entry's opening, not a
       separate blurb that could drift from it. */
    const tools = (await h.json('origami_guide', { topic: 'tools' })).tools;
    expect(Object.keys(tools).sort()).toEqual(Object.keys(dflt.tools).sort());
    for (const name of Object.keys(tools)) {
      expect(tools[name].startsWith(dflt.tools[name]), name).toBe(true);
    }
    expect(dflt.toolsHowTo).toMatch(/origami_guide\(\{ topic: "tools" \}\)/);

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

    // THE STANDING BUDGETS. quickstart is the answer a cold agent is pointed at first and it
    // has to be cheap enough to read before acting; the default is the whole contract and has
    // to stay a fraction of the guide it replaced. Both are re-measured on every run, so a
    // section that grows into either one is a failing test rather than a slow surprise.
    expect(sizes.quickstart!, 'quickstart must stay under 3 KB — it is the FIRST thing a cold agent reads').toBeLessThanOrEqual(3_000);
    expect(sizes.default!).toBeLessThanOrEqual(20_000);
    expect(sizes.default!).toBeLessThan(sizes.whole! / 2);
    // the cheapest route an agent has: the protocol alone
    expect(sizes.contract!).toBeLessThan(6_000);
    /* The tools topic is DELIBERATELY the biggest of the cheap ones: it is where the prose the
       tool descriptions no longer carry now lives. Descriptions are paid on every turn (the
       /folio/ registry's total is asserted in tests/unit/tool-bytes.test.ts); this answer is
       fetched at most once, and only when an agent wants the detail. */
    expect(sizes.tools!).toBeLessThan(10_000);
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

describe('S1 — one data gate, at authoring time', () => {
  /* The two gates used to disagree: add_chunk / write_chunk checked only the CARRIER (well-formed
     <script type="application/json">), while save_deck checked what was inside it. So a wrong
     shape was accepted for a whole authoring session and refused at the end, after the agent had
     built the deck around it. Every write path now runs the format library's OWN per-kind
     validator, so the verdict an agent gets at add time is the verdict save_deck gives. */

  const figure = (kind: string, data: unknown): string =>
    `<div class="slide-inner"><h2>Gate</h2><figure class="o-${kind}fig anim"><script type="application/json" data-odata="${kind}">${JSON.stringify(data).replace(/</g, '\u003c')}</script><div class="o-${kind}" data-${kind}-mount></div><figcaption>x</figcaption></figure></div>`;

  /** Sonnet's real refusal: a table column.format given as a STRING. add_chunk took it and only
      save_deck said no. */
  const STRING_FORMAT = { columns: [{ label: 'Item' }, { label: 'Cost', format: 'currency' }], rows: [['Widget', '10']] };

  it("refuses Sonnet's string column.format at add_chunk, with the rule save_deck names", async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    const before = h.deck.serialize();

    const res = await h.call('add_chunk', { kind: 'free', html: figure('table', STRING_FORMAT) });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.violations.map((v: any) => v.rule)).toContain('table.column.format');
    // and nothing landed: no fold, no dirty flag, the same bytes
    expect(h.deck.model().order).toHaveLength(1);
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses the same table at write_chunk, and the dryRun verdict is identical', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Gate' });
    const id = created.chunks[0].id;
    const before = h.deck.serialize();

    const dry = await h.call('write_chunk', { chunkId: id, html: figure('table', STRING_FORMAT), dryRun: true });
    const wet = await h.call('write_chunk', { chunkId: id, html: figure('table', STRING_FORMAT) });
    expect(dry.isError).toBe(true);
    expect(wet.isError).toBe(true);
    expect(JSON.parse(dry.content[0]!.text)).toEqual(JSON.parse(wet.content[0]!.text));
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses an EMPTY flow block — the blank fold is caught at add, not at save', async () => {
    /* knownIssues.emptyDataBlockPassesUntilSave described exactly this and said it passed until
       save_deck. It no longer does, so that entry has to change with it. */
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    const res = await h.call('add_chunk', { kind: 'free', html: figure('flow', { nodes: [], edges: [] }) });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('flow.nodes.count');
  });

  it('refuses a data block that is not valid JSON at all', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    const html = '<div class="slide-inner"><h2>Broken</h2><figure><script type="application/json" data-odata="chart">{ not json }</script><div class="o-chart" data-chart-mount></div></figure></div>';
    const res = await h.call('add_chunk', { kind: 'free', html });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('kind-data.json');
  });

  it('add_custom_fold runs the same gate', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    const res = await h.call('add_custom_fold', { html: figure('venn', { count: 3, sets: [{ label: 'A', color: '#4A8CC4' }] }) });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.length).toBeGreaterThan(0);
    expect(h.deck.model().order).toHaveLength(1);
  });

  it('propose_add and propose_chunk stage nothing when the data is wrong', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Gate' });
    expect((await h.call('propose_add', { kind: 'free', html: figure('flow', { nodes: [], edges: [] }) })).isError).toBe(true);
    expect((await h.call('propose_chunk', { chunkId: created.chunks[0].id, html: figure('flow', { nodes: [], edges: [] }) })).isError).toBe(true);
    expect(h.proposals.count()).toBe(0);
  });

  it('accept_proposal re-runs the gate, so a def deleted after staging cannot land a broken instance', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    await h.json('define_block', {
      def: { kind: 'x.note', name: 'Note', version: 1, fields: [{ name: 'body', type: 'text' }], template: '<p>{{body}}</p>' },
    });
    const staged = await h.json('propose_add', { block: 'x.note', fields: { body: 'hello' } });
    expect(staged.proposalId).toBeTruthy();
    await h.json('delete_block', { kind: 'x.note' });

    const res = await h.call('accept_proposal', { proposalId: staged.proposalId });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('block.unknown-def');
  });

  it('a VALID data block still lands, unchanged — the gate is not a wall', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Gate' });
    const good = { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19] }], yMax: null };
    const body = await h.json('add_chunk', { kind: 'free', html: figure('chart', good) });
    expect(body.chunkId).toBeTruthy();
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('the guide no longer claims an empty data block passes until save', async () => {
    const h = harness();
    const issues = (await h.json('origami_guide', { topic: 'issues' })).knownIssues;
    expect(issues.emptyDataBlockPassesUntilSave).toBeUndefined();
    expect(JSON.stringify(issues)).not.toMatch(/passes the content policy, so add_chunk returns ok/);
  });
});

describe('S2 — typed block tools on /folio/', () => {
  /* The mini pages have had typed writers since the block-tools slice; /folio/ had none, so an
     agent editing a chart on a deck had to read the whole fold template, hand-splice the figure,
     re-escape the JSON and write the template back. These two tools do that in one call each,
     through the same VALIDATORS, the same dataFigure and the same writeFoldInner. */

  const CHART = { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19] }], yMax: null };

  it('reads every data block on a fold in ONE call, and one block when asked', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });
    const added = await h.json('add_chunk', { starter: 'roadmap' });

    const all = await h.json('get_block', { chunkId: added.chunkId });
    expect(all.count).toBe(1);
    expect(all.blocks[0]).toMatchObject({ kind: 'gantt', nth: 0, caption: 'Roadmap' });
    expect((all.blocks[0].data as any).totalWeeks).toBe(16);

    const one = await h.json('get_block', { chunkId: added.chunkId, kind: 'gantt' });
    expect(one.data).toEqual(all.blocks[0].data);
    expect(one.schema).toEqual(KINDS.gantt!.schemaComment);
  });

  it('set_block replaces the JSON wholesale and the deck still validates', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });
    const added = await h.json('add_chunk', { starter: 'venn' });

    const res = await h.json('set_block', {
      chunkId: added.chunkId,
      kind: 'venn',
      data: { count: 2, sets: [{ label: 'Now', color: '#4A8CC4' }, { label: 'Next', color: '#D9A520' }] },
      caption: 'Where we are',
    });
    expect(res).toMatchObject({ chunkId: added.chunkId, kind: 'venn', nth: 0, caption: 'Where we are' });

    const read = await h.json('get_block', { chunkId: added.chunkId, kind: 'venn' });
    expect((read.data as any).sets.map((s: any) => s.label)).toEqual(['Now', 'Next']);
    expect(read.caption).toBe('Where we are');
    // the old seed is gone, not merged
    expect(h.deck.serialize()).not.toContain('"Us"');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('refuses data that breaks the kind schema, and leaves the fold byte-identical', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });
    const added = await h.json('add_chunk', { starter: 'flowchart' });
    const before = h.deck.serialize();

    const res = await h.call('set_block', { chunkId: added.chunkId, kind: 'flow', data: { nodes: [], edges: [] } });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('flow.nodes.count');
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses a kind the fold does not carry, and names the kinds it does', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });
    const added = await h.json('add_chunk', { starter: 'venn' });
    const res = await h.call('set_block', { chunkId: added.chunkId, kind: 'chart', data: CHART });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.error).toMatch(/carries no chart block/);
    expect(body.error).toMatch(/venn\[0\]/);
    expect(body.blocks).toEqual([{ kind: 'venn', nth: 0 }]);
  });

  it('nth addresses the SECOND block of a kind, and never splices the first', async () => {
    /* Two figures on one fold is what add_fold builds, and the figure finder used to walk
       backwards to the nearest "<figure" with no check that it had not already closed — which
       on the second block would have found the FIRST figure and deleted it. */
    const h = harness();
    await h.json('create_deck', { title: 'Two charts' });
    const fig = (labels: string[]) =>
      `<figure class="o-chartfig anim"><script type="application/json" data-odata="chart">${JSON.stringify({ ...CHART, labels }).replace(/</g, '\\u003c')}</script><div class="o-chart" data-chart-mount></div><figcaption>${labels[0]}</figcaption></figure>`;
    const added = await h.json('add_chunk', {
      kind: 'free',
      html: `<div class="slide-inner"><h2>Two</h2>${fig(['A1', 'A2'])}${fig(['B1', 'B2'])}</div>`,
    });

    const idx = await h.json('get_block', { chunkId: added.chunkId });
    expect(idx.blocks.map((b: any) => `${b.kind}${b.nth}`)).toEqual(['chart0', 'chart1']);
    expect(idx.blocks[1].caption).toBe('B1');

    await h.json('set_block', { chunkId: added.chunkId, kind: 'chart', nth: 1, data: { ...CHART, labels: ['Z1', 'Z2'] } });
    const after = await h.json('get_block', { chunkId: added.chunkId });
    expect(after.count, 'the first figure must survive').toBe(2);
    expect((after.blocks[0].data as any).labels).toEqual(['A1', 'A2']);
    expect((after.blocks[1].data as any).labels).toEqual(['Z1', 'Z2']);
  });

  it('never swallows a sibling figure when the block it edits has no figure of its own', async () => {
    /* A REAL data-loss bug in the figure finder, found while adding nth. It walked back to the
       nearest "<figure" before the block and forward to the next "</figure>", with no check that
       the opening tag it found had not already closed. On a fold shaped
       <figure>…</figure> <div><script data-odata="chart"></div> <figure>…</figure>
       — which is a hand-authored Fold, or one the Studio wrote — that span covers BOTH figures,
       and set_block/set_chart would have replaced the pair with one new figure. */
    const h = harness();
    await h.json('create_deck', { title: 'Siblings' });
    const venn = { count: 2, sets: [{ label: 'Us', color: '#4A8CC4' }, { label: 'Them', color: '#D9A520' }] };
    const esc = (d: unknown) => JSON.stringify(d).replace(/</g, '\u003c');
    const html =
      '<div class="slide-inner"><h2>Mixed</h2>' +
      `<figure class="o-vennfig anim"><script type="application/json" data-odata="venn">${esc(venn)}</script><div class="o-venn" data-venn-mount></div><figcaption>First</figcaption></figure>` +
      `<div class="o-chart-shell"><script type="application/json" data-odata="chart">${esc(CHART)}</script><div class="o-chart" data-chart-mount></div></div>` +
      `<figure class="o-ganttfig anim"><script type="application/json" data-odata="gantt">${esc({ totalWeeks: 4, startDate: null, lenses: [{ name: 'Plan', color: '#4a8cc4' }], swimlanes: [{ name: 'A', owner: 'O' }], cards: [{ id: 'C1', title: 'Do it', swimlane: 'A', start: 'W1', durationWeeks: 1, lens: 'Plan', type: 'Process', effort: 'EASY', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false }], milestones: [] })}</script><div class="o-gantt" data-gantt-mount></div><figcaption>Last</figcaption></figure>` +
      '</div>';
    const added = await h.json('add_chunk', { kind: 'free', html });
    expect((await h.json('get_block', { chunkId: added.chunkId })).count).toBe(3);

    await h.json('set_block', { chunkId: added.chunkId, kind: 'chart', data: { ...CHART, labels: ['Z1', 'Z2'] } });

    const after = await h.json('get_block', { chunkId: added.chunkId });
    expect(after.blocks.map((b: any) => b.kind), 'both figures must survive').toEqual(['venn', 'chart', 'gantt']);
    expect((after.blocks[1].data as any).labels).toEqual(['Z1', 'Z2']);
    expect(h.deck.model().slides.get(added.chunkId)!.inner).toContain('First');
    expect(h.deck.model().slides.get(added.chunkId)!.inner).toContain('Last');
  });

  it('bakes a table written through set_block, and rewrites a block that has no figure', async () => {
    /* add_chunk({kind:"table"}) mints the Studio's .o-table-shell, which is NOT a <figure>. The
       writer has to rewrite the JSON in place there rather than refuse, and the calc engine has
       to run on the way in exactly as it does for write_chunk. */
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    const added = await h.json('add_chunk', { kind: 'table', label: 'Budget' });
    expect(h.deck.model().slides.get(added.chunkId)!.inner).not.toContain('<figure');

    const res = await h.json('set_block', {
      chunkId: added.chunkId,
      kind: 'table',
      data: {
        columns: [{ label: 'Item' }, { label: 'Cost' }],
        rows: [['Rent', '1200'], ['Food', '300'], ['Total', '']],
        formulas: { B3: '=SUM(B1:B2)' },
      },
    });
    expect(res.captionApplied).toBe(false);
    const read = await h.json('get_block', { chunkId: added.chunkId, kind: 'table' });
    expect((read.data as any).rows[2][1], 'the formula baked').toBe('1500');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('one set_block is one undo step, and undo returns the exact previous bytes', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Undo' });
    const added = await h.json('add_chunk', { starter: 'venn' });
    const before = h.deck.serialize();
    await h.json('set_block', {
      chunkId: added.chunkId,
      kind: 'venn',
      data: { count: 2, sets: [{ label: 'X', color: '#4A8CC4' }, { label: 'Y', color: '#D9A520' }] },
    });
    expect(h.deck.serialize()).not.toBe(before);
    await h.json('undo');
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses an unknown chunk rather than guessing which fold was meant', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Blocks' });
    for (const name of ['get_block', 'set_block']) {
      const res = await h.call(name, { chunkId: 'snope', kind: 'chart', data: CHART });
      expect(res.isError, name).toBe(true);
      expect(JSON.parse(res.content[0]!.text).error, name).toMatch(/unknown chunk "snope"/);
    }
  });
});

describe('S3 — add_fold and add_ledger, the one-call fold', () => {
  /* The cost of a deck is TURNS. A titled card holding a chart used to be add_chunk (a starter,
     or hand-assembled figure markup with the JSON re-escaped) then read_chunk then write_chunk.
     These build it from data in one call, through the same insertFold — same bake, same content
     policy, same data gate, ONE op on the undo stack. */

  const CHART = { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19] }], yMax: null };
  const GRAPH = { nodes: [{ id: 'a', label: 'A', x: 20, y: 30, tone: '' }, { id: 'b', label: 'B', x: 70, y: 60, tone: '' }], edges: [{ from: 'a', to: 'b', label: '' }] };
  const FLOW = { nodes: [{ id: 'n1', label: 'Build', shape: 'box', tone: '' }, { id: 'n2', label: 'Ship', shape: 'box', tone: '' }], edges: [{ from: 'n1', to: 'n2', label: '' }] };
  const VENN = { count: 2, sets: [{ label: 'A', color: '#4A8CC4' }, { label: 'B', color: '#D9A520' }] };
  const DRAW = { elements: [{ id: 'e1', type: 'rect', x: 20, y: 20, width: 200, height: 100, stroke: '#1A1A1A', fill: '', seed: 7 }] };
  const innerOf = (h: ReturnType<typeof harness>, id: string) => h.deck.model().slides.get(id)!.inner;

  it('builds ONE card with an eyebrow, a heading and the blocks in order', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Composed' });
    const res = await h.json('add_fold', {
      title: 'Where we landed',
      eyebrow: 'Q3 review',
      blocks: [
        { text: '<p class="lede">One line of copy.</p>' },
        { stats: [{ value: '48', label: 'Decks shipped' }] },
        { chart: CHART, caption: 'Revenue by quarter' },
      ],
    });

    expect(res).toMatchObject({ index: 1, label: 'Where we landed', blocks: [{ kind: 'chart', nth: 0 }] });
    const inner = innerOf(h, res.chunkId);
    expect(inner.startsWith('<div class="slide-inner">')).toBe(true);
    expect(inner).toContain('<p class="eyebrow anim" style="--i:0">Q3 review</p>');
    expect(inner).toContain('<h2 class="anim" style="--i:1">Where we landed</h2>');
    // order is the order asked for: copy, then stats, then the figure
    expect(inner.indexOf('One line of copy')).toBeLessThan(inner.indexOf('Decks shipped'));
    expect(inner.indexOf('Decks shipped')).toBeLessThan(inner.indexOf('data-odata="chart"'));
    expect(h.deck.model().order).toHaveLength(2);
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('is ONE undo step, however many blocks are on it', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Composed' });
    const before = h.deck.serialize();
    await h.json('add_fold', {
      title: 'Four blocks',
      blocks: [{ text: '<p>a</p>' }, { bullets: ['one', 'two'] }, { quote: { text: 'Said once.', by: 'Someone' } }, { chart: CHART }],
    });
    expect(h.deck.model().order).toHaveLength(2);
    await h.json('undo');
    expect(h.deck.serialize(), 'one undo returns the exact previous bytes').toBe(before);
  });

  it('labels the fold from the title so the tabs never read FREEFORM', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Labels' });
    const short = await h.json('add_fold', { title: 'Short title', blocks: [{ text: '<p>x</p>' }] });
    expect(short.label).toBe('Short title');
    expect(h.deck.model().slides.get(short.chunkId)!.label).toBe('Short title');

    const long = await h.json('add_fold', { title: 'A heading long enough that a sidebar cannot show all of it', blocks: [{ text: '<p>x</p>' }] });
    expect(long.label.length).toBeLessThanOrEqual(29);
    expect(long.label.endsWith('…')).toBe(true);

    const named = await h.json('add_fold', { title: 'Ignored', label: 'Chosen', blocks: [{ text: '<p>x</p>' }] });
    expect(named.label).toBe('Chosen');
  });

  it('refuses a block that names no kind, or two, and says which entry', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Bad blocks' });
    const before = h.deck.serialize();

    const none = await h.call('add_fold', { title: 'T', blocks: [{ text: '<p>ok</p>' }, { nonsense: 1 }] });
    expect(none.isError).toBe(true);
    expect(JSON.parse(none.content[0]!.text).error).toMatch(/blocks\[1\] names no block/);

    const two = await h.call('add_fold', { title: 'T', blocks: [{ chart: CHART, bullets: ['a'] }] });
    expect(two.isError).toBe(true);
    expect(JSON.parse(two.content[0]!.text).error).toMatch(/blocks\[0\] names 2 blocks/);

    expect(h.deck.serialize(), 'nothing was added').toBe(before);
  });

  it('refuses data that breaks its kind schema, naming the block index and the violation', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Bad data' });
    const before = h.deck.serialize();
    const res = await h.call('add_fold', { title: 'T', blocks: [{ text: '<p>ok</p>' }, { flow: { nodes: [], edges: [] } }] });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.error).toMatch(/blocks\[1\]\.flow breaks its own schema/);
    expect(body.violations.map((v: any) => v.rule)).toContain('flow.nodes.count');
    expect(h.deck.serialize()).toBe(before);
  });

  it('sizes a chart to FIT unless the chart names its own plot height', async () => {
    /* MEASURED, not chosen: the chart schema's own default (318) puts eyebrow + heading + one
       captioned chart 22px past a 1280x720 screen. The e2e suite proves fits:true on the real
       render; this holds the number that produces it. */
    const h = harness();
    await h.json('create_deck', { title: 'Plot' });
    const auto = await h.json('add_fold', { title: 'Auto', blocks: [{ chart: CHART }] });
    expect((await h.json('get_block', { chunkId: auto.chunkId, kind: 'chart' })).data.plotHeight).toBe(COMPOSED_PLOT_HEIGHT);
    expect(COMPOSED_PLOT_HEIGHT).toBeLessThan(318);

    const own = await h.json('add_fold', { title: 'Own', blocks: [{ chart: { ...CHART, plotHeight: 420 } }] });
    expect((await h.json('get_block', { chunkId: own.chunkId, kind: 'chart' })).data.plotHeight).toBe(420);
  });

  it('sizes a graph to FIT, and lets a sized block name its own width and height', async () => {
    /* MEASURED, not chosen (tools/agent-bridge.mjs at 1280x720, 2026-09-03): a default node
       graph on a bare card renders 875px against 720px of screen. --obh GRAPH_FIT_HEIGHT brings
       the same card to 676px; the e2e suite proves fits:true on the real render, this holds the
       markup that produces it. A block that names its own size is obeyed. */
    const h = harness();
    await h.json('create_deck', { title: 'Sized' });

    const auto = await h.json('add_fold', { title: 'Auto', blocks: [{ graph: GRAPH, caption: 'Map' }] });
    expect(innerOf(h, auto.chunkId)).toContain(`<figure class="o-graphfig anim" style="--obh:${GRAPH_FIT_HEIGHT}px">`);

    const own = await h.json('add_fold', { title: 'Own', blocks: [{ graph: GRAPH, width: 700, height: 500 }] });
    expect(innerOf(h, own.chunkId)).toContain('<figure class="o-graphfig anim" style="--obw:700px;--obh:500px">');

    // width alone emits only --obw; the height stays the runtime's own
    const wide = await h.json('add_fold', { title: 'Wide', blocks: [{ flow: FLOW, width: 600 }] });
    expect(innerOf(h, wide.chunkId)).toContain('<figure class="o-flowfig anim" style="--obw:600px">');

    /* On a GRAPH, narrowing must not cost the fit: a width with no height still gets the
       measured default height, which is the whole point of narrowing to make room for copy. */
    const narrow = await h.json('add_fold', { title: 'Narrow', blocks: [{ graph: GRAPH, width: 600 }] });
    expect(innerOf(h, narrow.chunkId)).toContain(`<figure class="o-graphfig anim" style="--obw:600px;--obh:${GRAPH_FIT_HEIGHT}px">`);

    // and every fold built here is still a valid Fold
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('emits NO style attribute when a block names no size — the figure bytes are unchanged', async () => {
    /* The guarantee that lets the size ride on the ONE figure builder: a block with neither
       width nor height must produce exactly the markup the composer produced before sizes
       existed, or every fixture and every saved Fold shifts under it. */
    const h = harness();
    await h.json('create_deck', { title: 'Bare' });
    const bare = await h.json('add_fold', { title: 'Bare', blocks: [{ flow: FLOW, caption: 'Steps' }, { chart: CHART }, { venn: VENN }] });
    const inner = innerOf(h, bare.chunkId);
    expect(inner).toContain('<figure class="o-flowfig anim"><script type="application/json" data-odata="flow">');
    expect(inner).toContain('<figure class="o-chartfig anim"><script type="application/json" data-odata="chart">');
    expect(inner).toContain('<figure class="o-vennfig anim"><script type="application/json" data-odata="venn">');
    expect(inner, 'no block asked for a size, so no figure carries one').not.toContain('--obw');
    expect(inner, 'graph is the only kind with a default height, and there is no graph here').not.toContain('--obh');
  });

  it('takes prose on the card off the graph, the way it does off a chart', async () => {
    /* MEASURED on the same run: one lede paragraph costs a graph card 106-107px (875 -> 981
       with no --obh, 716 -> 823 at --obh 360) — the same PROSE_COST a chart pays. So the card
       decides the graph's height, not the block. */
    const h = harness();
    await h.json('create_deck', { title: 'Prose' });
    const withProse = await h.json('add_fold', {
      title: 'With copy',
      blocks: [{ text: '<p class="lede">A line of copy above the map.</p>' }, { graph: GRAPH }],
    });
    const shrunk = graphFitHeight([{ text: 'x' }, { graph: GRAPH }]);
    expect(shrunk).toBeLessThan(GRAPH_FIT_HEIGHT);
    expect(shrunk).toBeGreaterThanOrEqual(MIN_GRAPH_HEIGHT);
    expect(innerOf(h, withProse.chunkId)).toContain(`style="--obh:${shrunk}px"`);
    // and it never falls below the floor, however much prose is on the card
    expect(graphFitHeight([{ text: 'a' }, { bullets: ['b'] }, { quote: { text: 'c' } }, { graph: GRAPH }])).toBe(MIN_GRAPH_HEIGHT);
  });

  it('refuses a size on a block whose CSS would ignore it, and adds NOTHING', async () => {
    /* MEASURED in the real preview (2026-09-03): with --obw:600px;--obh:300px on the figure the
       rendered block narrows for venn/flow/graph/gantt/table (166px against 318px bare) and does
       NOT MOVE for chart (182 both) or draw (318 both). A key that changes nothing is refused,
       not dropped — an agent that cannot see the deck has no other way to find out. */
    const h = harness();
    await h.json('create_deck', { title: 'Refusals' });
    const before = h.deck.serialize();

    // a chart's HEIGHT is its plot box (plotHeight), so height is refused — but since the Folio
    // 610e732 runtime figure.o-chartfig reads --obw, width lands
    const chartH = await h.call('add_fold', { title: 'T', blocks: [{ chart: CHART, height: 300 }] });
    expect(chartH.isError).toBe(true);
    expect(JSON.parse(chartH.content[0]!.text).error).toMatch(/blocks\[0\] names height on a chart block, which the runtime would ignore .*plotHeight/);
    const chartW = await h.call('add_fold', { title: 'T', blocks: [{ chart: CHART, width: 600 }] });
    expect(chartW.isError).toBeUndefined();
    expect(h.deck.serialize()).toContain('<figure class="o-chartfig anim" style="--obw:600px">');
    h.deck.undo();

    const draw = await h.call('add_fold', { title: 'T', blocks: [{ text: '<p>ok</p>' }, { draw: DRAW, height: 300 }] });
    expect(draw.isError).toBe(true);
    expect(JSON.parse(draw.content[0]!.text).error).toMatch(/blocks\[1\] names height on a draw block.*wpct/);

    const prose = await h.call('add_fold', { title: 'T', blocks: [{ text: '<p>ok</p>', width: 600 }] });
    expect(prose.isError).toBe(true);
    expect(JSON.parse(prose.content[0]!.text).error).toMatch(/blocks\[0\] names width on a text block/);

    expect(h.deck.serialize(), 'every refusal left the Fold exactly as it was').toBe(before);
  });

  it('refuses a size that is not a whole number of px inside its range', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Range' });
    const before = h.deck.serialize();
    const bad = async (block: Record<string, unknown>) => {
      const r = await h.call('add_fold', { title: 'T', blocks: [block] });
      expect(r.isError).toBe(true);
      return JSON.parse(r.content[0]!.text).error as string;
    };

    expect(await bad({ graph: GRAPH, width: SIZE_RANGE.width[0] - 1 })).toMatch(/blocks\[0\]\.width must be a whole number of CSS px between 160 and 2600/);
    expect(await bad({ graph: GRAPH, height: SIZE_RANGE.height[1] + 1 })).toMatch(/blocks\[0\]\.height must be a whole number of CSS px between 120 and 2160/);
    expect(await bad({ graph: GRAPH, width: 600.5 })).toMatch(/got 600\.5/);
    expect(await bad({ graph: GRAPH, width: '600' })).toMatch(/got "600"/);
    expect(await bad({ graph: GRAPH, height: null })).toMatch(/got null/);

    expect(h.deck.serialize(), 'nothing was added').toBe(before);
  });

  it('set_block keeps the block size when it rebuilds the figure', async () => {
    /* set_block REPLACES the whole figure so the mount and the caption stay in step with the
       data. Without carrying the figure's style, the first data edit would silently undo the
       size the author asked add_fold for — and the runtime would go back to overflowing. */
    const h = harness();
    await h.json('create_deck', { title: 'Rebuild' });
    const added = await h.json('add_fold', { title: 'Map', blocks: [{ graph: GRAPH, width: 640, height: 420, caption: 'Map' }] });
    expect(innerOf(h, added.chunkId)).toContain('style="--obw:640px;--obh:420px"');

    const NEXT = { nodes: [{ id: 'x', label: 'X', x: 30, y: 30, tone: '' }, { id: 'y', label: 'Y', x: 70, y: 70, tone: '' }], edges: [{ from: 'x', to: 'y', label: 'to' }] };
    await h.json('set_block', { chunkId: added.chunkId, kind: 'graph', data: NEXT });

    const after = innerOf(h, added.chunkId);
    expect(after, 'the size survived the data rewrite').toContain('<figure class="o-graphfig anim" style="--obw:640px;--obh:420px">');
    expect(after).toContain('"label": "X"');
    expect((await h.json('get_block', { chunkId: added.chunkId, kind: 'graph' })).data).toMatchObject({ edges: [{ label: 'to' }] });
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('starts the node-graph starter at a height that fits, and leaves every other starter alone', async () => {
    /* The starter is the other way an agent gets a graph, and it overflowed for the same
       reason. Its seed, classes and caption stay palette.ts verbatim; only the size is added. */
    const h = harness();
    await h.json('create_deck', { title: 'Starters' });
    const graph = await h.json('add_chunk', { starter: 'node-graph' });
    expect(innerOf(h, graph.chunkId)).toContain(`<figure class="o-graphfig anim" style="--obh:${GRAPH_FIT_HEIGHT}px">`);

    const flow = await h.json('add_chunk', { starter: 'flowchart' });
    expect(innerOf(h, flow.chunkId), 'flow measured 660px on its own — it needs no size').toContain('<figure class="o-flowfig anim"><script');
    expect(innerOf(h, flow.chunkId)).not.toContain('--ob');
  });

  it('animates a stat card whenever the value holds a digit, decorated or not', async () => {
    /* MEASURED through the real render (tools/agent-bridge.mjs, 2026-09-02): the vendored
       runtime's count-up now finds the numeric core of a decorated value with a regex, keeps
       the prefix/suffix around it, and lands the settled frame byte-exact to the attribute —
       "€48k" and "2.1%" animate correctly the same way "48" always did. Only a value with no
       digit at all (a plain label, not a countable number) stays literal text. */
    const h = harness();
    await h.json('create_deck', { title: 'Stats' });
    const res = await h.json('add_fold', {
      title: 'Numbers',
      blocks: [{ stats: [{ value: '48', label: 'Decks' }, { value: '2.1%', label: 'Churn' }, { value: '€48k', label: 'MRR' }, { value: 'n/a', label: 'Target' }] }],
    });
    const inner = innerOf(h, res.chunkId);
    expect(inner).toContain('<div class="big" data-count-to="48">0</div>');
    expect(inner).toContain('<div class="big" data-count-to="2.1%">0</div>');
    expect(inner).toContain('<div class="big" data-count-to="€48k">0</div>');
    expect(inner).toContain('<div class="big">n/a</div>');
    expect(inner).not.toContain('data-count-to="n/a"');
    expect(inner).toContain('data-ocols="4"');
  });

  it('lays two columns out with the attribute the runtime CSS actually targets', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Cols' });
    const res = await h.json('add_fold', {
      title: 'Two tracks',
      columns: 2,
      blocks: [{ text: '<h3>Left</h3>' }, { text: '<h3>Right</h3>' }],
    });
    const inner = innerOf(h, res.chunkId);
    expect(inner).toContain('<div class="o-tcols anim" data-ocols="2">');
    // .o-tcols > .o-text is the grid; a child that is not one is not laid out as a column
    expect(inner.match(/<div class="o-text anim">/g)).toHaveLength(2);
    expect((await h.call('add_fold', { title: 'T', columns: 3, blocks: [{ text: '<p>x</p>' }] })).isError).toBe(true);
  });

  it('escapes text that would otherwise become markup', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Escapes' });
    const res = await h.json('add_fold', {
      title: 'A < B & C',
      eyebrow: '<script>x</script>',
      blocks: [{ bullets: ['1 < 2'] }, { quote: { text: 'a & b', by: '<em>who</em>' } }],
    });
    const inner = innerOf(h, res.chunkId);
    expect(inner).toContain('A &lt; B &amp; C');
    expect(inner).toContain('&lt;script&gt;');
    expect(inner).toContain('1 &lt; 2');
    expect(inner).toContain('&lt;em&gt;who&lt;/em&gt;');
    // and the deck stays inert: nothing smuggled through
    expect(await h.json('add_fold', { title: 'x', blocks: [{ text: '<p>y</p>' }] })).toMatchObject({ activeContent: [] });
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('hands back the addresses set_block takes, for every data block on the card', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Addresses' });
    const res = await h.json('add_fold', {
      title: 'Two charts and a venn',
      blocks: [{ chart: CHART }, { venn: { count: 2, sets: [{ label: 'A', color: '#4A8CC4' }, { label: 'B', color: '#D9A520' }] } }, { chart: { ...CHART, labels: ['Q3', 'Q4'] } }],
    });
    expect(res.blocks).toEqual([{ kind: 'chart', nth: 0 }, { kind: 'venn', nth: 0 }, { kind: 'chart', nth: 1 }]);

    // the addresses are real: writing the second chart leaves the first and the venn alone
    await h.json('set_block', { chunkId: res.chunkId, kind: 'chart', nth: 1, data: { ...CHART, labels: ['Z1', 'Z2'] } });
    const after = await h.json('get_block', { chunkId: res.chunkId });
    expect(after.blocks.map((b: any) => b.kind)).toEqual(['chart', 'venn', 'chart']);
    expect((after.blocks[0].data as any).labels).toEqual(['Q1', 'Q2']);
    expect((after.blocks[2].data as any).labels).toEqual(['Z1', 'Z2']);
  });

  it('add_fold carries no diagram layoutWarning — the runtime now sizes flow/graph to content', async () => {
    /* Before the 2026-09-02 runtime refresh the diagram viewBox was fixed at 1200x660, so a
       flow/graph block alone overflowed 720px and add_fold handed the fact back as
       layoutWarning. The refreshed runtime sizes the viewBox to content instead (a one-row
       flow measures well under half the old height — tests/unit/flow-fit.test.ts), so there is
       no longer a diagram-specific trap to warn about; inspect_render is the arbiter for any
       fold, this kind included. */
    const h = harness();
    await h.json('create_deck', { title: 'Diagram' });
    const flow = await h.json('add_fold', {
      title: 'How a fold ships',
      blocks: [{ flow: { nodes: [{ id: 'a', label: 'Draft', shape: 'pill', tone: 'accent' }, { id: 'b', label: 'Ship', shape: 'pill', tone: 'green' }], edges: [{ from: 'a', to: 'b', label: '' }] } }],
    });
    expect(flow.layoutWarning).toBeUndefined();
    expect((await h.json('add_fold', { title: 'Chart', blocks: [{ chart: CHART }] })).layoutWarning).toBeUndefined();
  });

  it('add_ledger bakes the formulas the human never sees a formula for', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    const res = await h.json('add_ledger', {
      title: 'Q3 budget',
      eyebrow: 'Ledger',
      columns: [{ label: 'Line' }, { label: 'Plan', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Delta', align: 'right' }],
      rows: [['Engineering', '120000', '118400', ''], ['Design', '42000', '39800', ''], ['Total', '', '', '']],
      formulas: { D1: '=B1-C1', D2: '=B2-C2', B3: '=SUM(B1:B2)', C3: '=SUM(C1:C2)', D3: '=SUM(D1:D2)' },
      caption: 'Plan against actual, EUR',
    });
    expect(res).toMatchObject({ label: 'Q3 budget', blocks: [{ kind: 'table', nth: 0 }] });

    const table = (await h.json('get_block', { chunkId: res.chunkId, kind: 'table' })).data;
    expect(table.rows[0][3], 'the calc engine ran on the way in').toBe('1600');
    expect(table.rows[2]).toEqual(['Total', '162000', '158200', '3800']);
    expect(innerOf(h, res.chunkId)).toContain('<h2 class="anim" style="--i:1">Q3 budget</h2>');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('add_ledger refuses a column format given as a STRING — the shape that used to reach save_deck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    const before = h.deck.serialize();
    const res = await h.call('add_ledger', {
      title: 'Bad',
      columns: [{ label: 'Item' }, { label: 'Cost', format: 'currency' }],
      rows: [['Widget', '10']],
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('table.column.format');
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses a fold with a title but nothing on it, rather than adding a blank card', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Empty' });
    for (const args of [{ title: 'T', blocks: [] }, { title: '   ', blocks: [{ text: '<p>x</p>' }] }, { title: 'T' }]) {
      const res = await h.call('add_fold', args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
    }
    expect(h.deck.model().order).toHaveLength(1);
  });

  it('honours position, so a fold can be composed into the middle of a deck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Order' });
    await h.json('add_fold', { title: 'Last', blocks: [{ text: '<p>z</p>' }] });
    const mid = await h.json('add_fold', { title: 'Middle', position: 1, blocks: [{ text: '<p>m</p>' }] });
    expect(mid.index).toBe(1);
    expect(h.deck.model().order.map((id) => h.deck.model().slides.get(id)!.label)).toEqual(['Cover', 'Middle', 'Last']);
  });
});

describe('S4 — themes an agent can own', () => {
  /* Two things went wrong in trial, and both are fixed here.
       - set_deck_meta({themeName:"boardroom"}) renamed the theme and changed NOTHING. themeName
         is a label; no preset existed to apply and nothing said so.
       - A cold model sent {primary, background} — plausible token names from every OTHER design
         system, neither read by the deck stylesheet. validateThemeTokens only checks the VALUE,
         so they were stored in the manifest for ever and did nothing at all. */

  const tokensOf = (h: ReturnType<typeof harness>) => h.deck.model().theme.tokens;

  it('lists the four runtime presets with their complete token maps', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    const res = await h.json('list_themes');
    expect(res.themes.map((t: any) => t.name)).toEqual(['origami-default', 'boardroom', 'meadow', 'dusk']);
    for (const t of res.themes) {
      expect(t.source, t.name).toBe('preset');
      expect(Object.keys(t.tokens).length, t.name).toBeGreaterThanOrEqual(14);
      // a preset that named a token the stylesheet does not read would be a lie in the catalog
      expect(unknownTokens(t.tokens), t.name).toEqual([]);
    }
    expect(res.tokensTheDeckReads).toEqual([...THEME_TOKENS]);
  });

  it('apply_theme really changes the colours, where set_deck_meta({themeName}) does not', async () => {
    /* Read the accent OUT OF THE SERIALIZED FOLD, not out of model.theme.tokens: a fresh deck's
       token map is empty and the style block holds the palette, so the model field would report
       "undefined -> the default" and call that a change. The bytes are the truth here. */
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    const accentInForce = () => /--accent\s*:\s*([^;]+);/.exec(h.deck.serialize())![1]!.trim();
    const before = accentInForce();
    expect(before).toBe('#3F7268');

    // the trial's failure, reproduced: a rename is a rename
    await h.json('set_deck_meta', { themeName: 'boardroom' });
    expect(h.deck.model().theme.name).toBe('boardroom');
    expect(accentInForce(), 'renaming must not restyle').toBe(before);

    const res = await h.json('apply_theme', { name: 'boardroom' });
    expect(res.applied).toBe('boardroom');
    expect(res.source).toBe('preset');
    expect(accentInForce()).toBe('#38628F');
    expect(tokensOf(h).bg).toBe('#F3F5F8');
    // a token the preset does NOT name survives the merge. The presets carry the fourteen
    // palette tokens; the three masthead ones are only ever set by hand, and applying a theme
    // must not silently strip a masthead a human tuned.
    await h.json('set_deck_meta', { themeTokens: { 'chrome-pad': '18px' } });
    await h.json('apply_theme', { name: 'meadow' });
    expect(tokensOf(h)['chrome-pad']).toBe('18px');
    expect(accentInForce()).not.toBe('#38628F');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('is one undo step, and an unknown name is refused with the names that exist', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    const before = h.deck.serialize();
    await h.json('apply_theme', { name: 'dusk' });
    expect(h.deck.serialize()).not.toBe(before);
    await h.json('undo');
    expect(h.deck.serialize()).toBe(before);

    const bad = await h.call('apply_theme', { name: 'corporate-blue' });
    expect(bad.isError).toBe(true);
    const body = JSON.parse(bad.content[0]!.text);
    expect(body.error).toMatch(/unknown theme "corporate-blue"/);
    expect(body.availableThemes).toContain('boardroom');
  });

  it("REFUSES Haiku's primary/background with the tokens the stylesheet really reads", async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    const res = await h.call('save_theme', { name: 'house', tokens: { primary: '#38628F', background: '#F3F5F8' } });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.violations.map((v: any) => v.rule)).toEqual(['theme.token-name', 'theme.token-name']);
    expect(body.violations[0].detail).toMatch(/"primary" is not read by the deck stylesheet/);
    expect(body.tokensTheDeckReads).toEqual([...THEME_TOKENS]);
    // and nothing was kept: a refusal that half-saved would be worse than storing the typo
    expect((await h.json('list_themes')).themes.filter((t: any) => t.source === 'saved')).toEqual([]);
  });

  it('saves a one-token variant of a preset, and apply_theme can then use it', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    const saved = await h.json('save_theme', { name: 'house-navy', label: 'House navy', tokens: { accent: '#1F3A5F' }, basedOn: 'boardroom' });
    expect(saved).toMatchObject({ saved: 'house-navy', replaced: false, basedOn: 'boardroom' });
    // basedOn is the BASE, not a reference: the rest of boardroom came with it
    expect(saved.tokens.accent).toBe('#1F3A5F');
    expect(saved.tokens.bg).toBe('#F3F5F8');
    // saving changes nothing on the Fold
    expect(tokensOf(h).accent).not.toBe('#1F3A5F');

    const listed = (await h.json('list_themes')).themes.find((t: any) => t.name === 'house-navy');
    expect(listed).toMatchObject({ source: 'saved', label: 'House navy' });

    await h.json('apply_theme', { name: 'house-navy' });
    expect(tokensOf(h).accent).toBe('#1F3A5F');
    expect(tokensOf(h).bg).toBe('#F3F5F8');
  });

  it('reports WCAG contrast and warns below 4.5:1', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });

    // black on white is the top of the scale
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
    // a value no ratio can be measured from is null, not a guess
    expect(contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF')).toBeNull();
    expect(contrastRatio('Georgia, serif', '#FFFFFF')).toBeNull();

    const ok = await h.json('save_theme', { name: 'readable', tokens: { ink: '#111111', bg: '#FFFFFF', paper: '#FFFFFF', accent: '#2F5F4A', chrome: '#FFFFFF', 'chrome-ink': '#111111' } });
    expect(ok.contrast.warnings).toEqual([]);
    expect(ok.contrast.pairs.find((p: any) => p.pair === 'ink/bg').ratio).toBeGreaterThan(15);

    const faint = await h.json('save_theme', { name: 'faint', tokens: { ink: '#AAAAAA', bg: '#FFFFFF', paper: '#FFFFFF', accent: '#CCCCCC', chrome: '#FFFFFF', 'chrome-ink': '#111111' } });
    expect(faint.saved).toBe('faint');
    expect(faint.contrast.warnings.length).toBeGreaterThanOrEqual(2);
    expect(faint.contrast.warnings.join(' ')).toMatch(/below the 4\.5:1 WCAG AA minimum/);
    expect(faint.note).toMatch(/read the contrast warnings/);
    // a pair whose colours cannot be read is reported as unmeasured WITH the reason
    const partial = await h.json('save_theme', { name: 'fonts-only', tokens: { 'font-body': 'Georgia, serif' } });
    const inkBg = partial.contrast.pairs.find((p: any) => p.pair === 'ink/bg');
    expect(inkBg).toMatchObject({ ratio: null, passesAA: null });
    expect(inkBg.why).toMatch(/not set in this theme/);
  });

  it('refuses to overwrite or delete a preset, and refuses a name that is not a key', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    expect((await h.call('save_theme', { name: 'boardroom', tokens: { accent: '#000000' } })).isError).toBe(true);
    expect((await h.call('delete_theme', { name: 'boardroom' })).isError).toBe(true);
    expect((await h.call('save_theme', { name: 'House Navy!', tokens: { accent: '#000000' } })).isError).toBe(true);
    expect((await h.json('list_themes')).themes.find((t: any) => t.name === 'boardroom').tokens.accent).toBe('#38628F');
  });

  it('delete_theme forgets the palette but leaves a deck already wearing it alone', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Themes' });
    await h.json('save_theme', { name: 'gone-soon', tokens: { accent: '#B3402A' }, basedOn: 'meadow' });
    await h.json('apply_theme', { name: 'gone-soon' });
    expect(tokensOf(h).accent).toBe('#B3402A');

    const del = await h.json('delete_theme', { name: 'gone-soon' });
    expect(del).toMatchObject({ deleted: 'gone-soon', remaining: [] });
    expect(tokensOf(h).accent, 'a theme is applied BY VALUE — deleting it cannot restyle the deck').toBe('#B3402A');
    expect((await h.call('apply_theme', { name: 'gone-soon' })).isError).toBe(true);
    expect((await h.call('delete_theme', { name: 'gone-soon' })).isError).toBe(true);
  });

  it('keeps saved themes in the injected store, so the page can persist them', async () => {
    /* The tools never touch storage themselves: they take a ThemeStore. That is what lets the
       page put them in localStorage (proved surviving a real reload in tests/e2e/app.spec.ts)
       while every other host gets the in-memory one and behaves the same. */
    const store = new MemoryThemeStore();
    const deck = new DeckStore();
    const registry = createModeRegistry({ deck, proposals: new ProposalStore(), runtimeJs, themes: store }, FOLIO_MODE);
    await registry.invoke('create_deck', { title: 'Store' });
    await registry.invoke('save_theme', { name: 'kept', tokens: { accent: '#123456' } });
    expect(store.all().map((t) => t.name)).toEqual(['kept']);
    expect(store.get('kept')!.tokens.accent).toBe('#123456');

    // a second registry over the SAME store sees it — which is what a reload is
    const second = createModeRegistry({ deck, proposals: new ProposalStore(), runtimeJs, themes: store }, FOLIO_MODE);
    const listed = JSON.parse((await second.invoke('list_themes', {})).content[0]!.text);
    expect(listed.themes.find((t: any) => t.name === 'kept')).toMatchObject({ source: 'saved' });
  });

  it('set_deck_meta now SAYS that themeName is only a label', async () => {
    const h = harness();
    expect(h.registry.get('set_deck_meta')!.description).toMatch(/ON ITS OWN IT CHANGES THE LABEL AND NOTHING ELSE/);
    expect(h.registry.get('set_deck_meta')!.description).toMatch(/apply_theme/);
  });
});

describe('S5 — turns and bytes', () => {
  /* The lead's latency probe found every tool under 6 ms except inspect_render (2.4 s) and
     save_deck (53 ms). So the cost of a deck is not compute — it is turns and payload bytes,
     and these two are the only levers left after add_fold made one fold one call. */

  const CHART = { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19] }], yMax: null };

  it('builds a whole deck in ONE call, in order', async () => {
    const h = harness();
    const res = await h.json('run_batch', {
      calls: [
        { tool: 'create_deck', args: { title: 'Batched', discard: true } },
        { tool: 'add_fold', args: { title: 'Opening', blocks: [{ text: '<p class="lede">One turn.</p>' }] } },
        { tool: 'add_fold', args: { title: 'The numbers', blocks: [{ chart: CHART }] } },
        { tool: 'add_ledger', args: { title: 'Budget', columns: [{ label: 'Line' }, { label: 'Cost' }], rows: [['Rent', '1200'], ['Total', '']], formulas: { B2: '=SUM(B1:B1)' } } },
        { tool: 'apply_theme', args: { name: 'boardroom' } },
      ],
    });
    expect(res).toMatchObject({ requested: 5, completed: 5 });
    expect(res.stoppedAt).toBeUndefined();
    expect(res.results.map((r: any) => r.tool)).toEqual(['create_deck', 'add_fold', 'add_fold', 'add_ledger', 'apply_theme']);
    expect(res.results.every((r: any) => r.ok)).toBe(true);
    // the results are the tools' OWN bodies, parsed — one payload, not five strings to re-parse
    expect(res.results[1].result.chunkId).toBeTypeOf('string');
    expect(res.results[3].result.blocks).toEqual([{ kind: 'table', nth: 0 }]);

    expect(h.deck.model().order.map((id) => h.deck.model().slides.get(id)!.label)).toEqual(['Cover', 'Opening', 'The numbers', 'Budget']);
    expect(h.deck.serialize()).toContain('#38628F');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('records every inner call in the feed, and undo reverses them ONE AT A TIME', async () => {
    /* The batch is a driver, not a second dispatcher: each call goes through
       ToolRegistry.invoke. That is what makes the feed and the undo stack see six steps rather
       than one opaque one — and an agent that undoes after a batch must get its last fold back,
       not the whole build. */
    const h = harness();
    await h.json('create_deck', { title: 'Batched' });
    const before = h.deck.serialize();
    await h.json('run_batch', {
      calls: [
        { tool: 'add_fold', args: { title: 'One', blocks: [{ text: '<p>1</p>' }] } },
        { tool: 'add_fold', args: { title: 'Two', blocks: [{ text: '<p>2</p>' }] } },
        { tool: 'add_fold', args: { title: 'Three', blocks: [{ text: '<p>3</p>' }] } },
      ],
    });
    expect(h.deck.model().order).toHaveLength(4);

    const feed = (await h.json('list_activity', { limit: 20 })).entries.map((e: any) => e.tool);
    expect(feed.filter((t: string) => t === 'add_fold')).toHaveLength(3);
    expect(feed).toContain('run_batch');

    await h.json('undo');
    expect(h.deck.model().order, 'ONE undo takes back ONE fold').toHaveLength(3);
    await h.json('undo');
    await h.json('undo');
    expect(h.deck.serialize()).toBe(before);
  });

  it('stops at the FIRST failure and says exactly where, leaving what already landed', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Batched' });
    const res = await h.json('run_batch', {
      calls: [
        { tool: 'add_fold', args: { title: 'Good', blocks: [{ text: '<p>ok</p>' }] } },
        { tool: 'add_fold', args: { title: 'Bad', blocks: [{ flow: { nodes: [], edges: [] } }] } },
        { tool: 'add_fold', args: { title: 'Never', blocks: [{ text: '<p>no</p>' }] } },
      ],
    });
    expect(res).toMatchObject({ requested: 3, completed: 1, stoppedAt: 1, stoppedOn: 'add_fold' });
    expect(res.results).toHaveLength(2); // the failure is returned, the call after it never ran
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].result.violations.map((v: any) => v.rule)).toContain('flow.nodes.count');
    expect(res.note).toMatch(/DID land/);
    // the first fold really is on the deck: a half-batch is reported, not rolled back
    expect(h.deck.model().order.map((id) => h.deck.model().slides.get(id)!.label)).toEqual(['Cover', 'Good']);
  });

  it('checks the whole list before running anything, so a typo never half-builds a deck', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Batched' });
    const before = h.deck.serialize();
    const res = await h.call('run_batch', {
      calls: [
        { tool: 'add_fold', args: { title: 'Good', blocks: [{ text: '<p>ok</p>' }] } },
        { tool: 'add_fould', args: {} },
      ],
    });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.error).toMatch(/calls\[1\] names unknown tool "add_fould" — nothing was run/);
    expect(body.availableTools).toContain('add_fold');
    expect(h.deck.serialize(), 'the valid first call must NOT have run').toBe(before);
  });

  it('refuses a batch inside a batch, and a batch longer than the cap', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Batched' });
    const nested = await h.call('run_batch', { calls: [{ tool: 'run_batch', args: { calls: [] } }] });
    expect(nested.isError).toBe(true);
    expect(JSON.parse(nested.content[0]!.text).error).toMatch(/cannot contain another batch/);

    const long = await h.call('run_batch', { calls: Array.from({ length: BATCH_MAX + 1 }, () => ({ tool: 'list_chunks', args: {} })) });
    expect(long.isError).toBe(true);
    expect(JSON.parse(long.content[0]!.text)).toMatchObject({ max: BATCH_MAX });

    expect((await h.call('run_batch', { calls: [] })).isError).toBe(true);
    expect((await h.call('run_batch', { calls: [{ args: {} }] })).isError).toBe(true);
  });

  it('origami_guide({topic:"quickstart"}) is the fast path, under 3 KB, with a real example', async () => {
    const h = harness();
    const q = await h.json('origami_guide', { topic: 'quickstart' });
    expect(new TextEncoder().encode(JSON.stringify(q, null, 2)).length).toBeLessThanOrEqual(3_000);

    // the five calls, named in order
    const path = q.theFastPath.join(' ');
    for (const tool of ['create_deck', 'add_fold', 'add_ledger', 'run_batch', 'apply_theme', 'inspect_render', 'save_deck']) {
      expect(path, tool).toContain(tool);
    }
    // and ONE example that really works — parsed out of the answer and RUN
    expect(q.example.call).toBe('add_fold');
    const args = JSON.parse(q.example.args);
    expect(args.blocks.some((b: any) => b.chart), 'the example carries a chart').toBe(true);
    expect(args.blocks.some((b: any) => b.table), 'the example carries a table').toBe(true);

    await h.json('create_deck', { title: 'From the guide' });
    const built = await h.json('add_fold', args);
    expect(built.chunkId).toBeTypeOf('string');
    expect(built.blocks).toEqual([{ kind: 'chart', nth: 0 }, { kind: 'table', nth: 0 }]);
    expect(validateDeck(parseDeck(h.deck.serialize())), 'the guide example must produce a VALID Fold').toEqual([]);
  });

  it("the default guide's FIRST key points at the quickstart", async () => {
    const h = harness();
    const dflt = await h.json('origami_guide');
    expect(Object.keys(dflt)[0]).toBe('start');
    expect(dflt.start).toMatch(/topic: "quickstart"/);
    expect(dflt.topics.quickstart).toMatch(/read this one first/);
    expect(GUIDE_TOPICS).toContain('quickstart');
  });
});

describe('S6 — what BOTH trial agents still tripped on', () => {
  const CHART = { type: 'bar', labels: ['Q1', 'Q2'], series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19] }], yMax: null };
  const innerOf = (h: ReturnType<typeof harness>, id: string) => h.deck.model().slides.get(id)!.inner;

  /* ---- 1. no placeholder in a fresh deck ---------------------------------------------- */

  it('mints a real COVER, so a fresh Fold carries no placeholder text at all', async () => {
    /* create_deck used to mint an h2 reading "New fold" and a lede reading "Write here."
       Haiku overwrote it (read_chunk + write_chunk); Sonnet added its own cover and then had to
       list_chunks + delete_chunk to remove the placeholder. Between them that is five calls
       spent on text the deck could have written itself. */
    const h = harness();
    const created = await h.json('create_deck', { title: 'Q3 review', subtitle: 'Revenue held; delivery cost did not', eyebrow: 'Board pack' });

    expect(created.chunks[0].kind, 'the cover KIND, whose whole schema is .eyebrow / h1 / .lede').toBe('cover');
    const inner = innerOf(h, created.chunks[0].id);
    expect(inner).toContain('<p class="eyebrow anim" style="--i:0">Board pack</p>');
    expect(inner).toContain('<h1 class="anim" style="--i:1">Q3 review</h1>');
    expect(inner).toContain('<p class="lede anim" style="--i:2">Revenue held; delivery cost did not</p>');

    const text = h.deck.serialize();
    expect(text, 'no placeholder ANYWHERE in a fresh Fold').not.toContain('New fold');
    expect(text).not.toContain('Write here.');
    expect(validateDeck(parseDeck(text))).toEqual([]);
  });

  it('emits no empty element when subtitle and eyebrow are absent', async () => {
    const h = harness();
    const created = await h.json('create_deck', { title: 'Bare' });
    const inner = innerOf(h, created.chunks[0].id);
    expect(inner.trim()).toBe('<div class="slide-inner"><h1 class="anim" style="--i:0">Bare</h1></div>');
    expect(inner).not.toContain('eyebrow');
    expect(inner).not.toContain('lede');
    // and it still paints: a cover with a title on it is real content, not a blank fold
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('escapes a title that would otherwise be markup', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'A < B & C', subtitle: '<script>x</script>' });
    const inner = innerOf(h, h.deck.model().order[0]!);
    expect(inner).toContain('A &lt; B &amp; C');
    expect(inner).toContain('&lt;script&gt;');
    expect(validateDeck(parseDeck(h.deck.serialize()))).toEqual([]);
  });

  it('leaves the mini pages minting their own free card, not a cover', async () => {
    // a mini page seeds ONE free card holding its block; the cover kind would be wrong there
    const mini = await miniHarness(CHARTS_MODE);
    expect(mini.deck.model().slides.get(mini.deck.model().order[0]!)!.kind).toBe('free');
  });

  /* ---- 2. required-but-blank diagram fields ------------------------------------------- */

  it('fills flow/graph tone and edge label, which the validator requires and agents read as optional', async () => {
    /* MEASURED against the vendored validators: a flow node with no `tone` is refused with
       "tone must be one of accent|green|amber|red or \"\"" and an edge with no `label` with
       "label must be a string". Both trial agents wrote a diagram without them. "" is the legal
       blank for both, so filling it is a pure default. */
    const h = harness();
    await h.json('create_deck', { title: 'Diagrams' });

    const flow = await h.json('add_fold', {
      title: 'Process',
      blocks: [{ flow: { nodes: [{ id: 'a', label: 'Draft', shape: 'pill' }, { id: 'b', label: 'Ship', shape: 'pill' }], edges: [{ from: 'a', to: 'b' }] } }],
    });
    const stored = (await h.json('get_block', { chunkId: flow.chunkId, kind: 'flow' })).data;
    expect(stored.nodes.map((n: any) => n.tone)).toEqual(['', '']);
    expect(stored.edges.map((e: any) => e.label)).toEqual(['']);

    const graph = await h.json('add_fold', {
      title: 'Map',
      blocks: [{ graph: { nodes: [{ id: 'a', label: 'A', x: 20, y: 20 }, { id: 'b', label: 'B', x: 60, y: 60 }], edges: [{ from: 'a', to: 'b' }] } }],
    });
    const g = (await h.json('get_block', { chunkId: graph.chunkId, kind: 'graph' })).data;
    expect(g.nodes.every((n: any) => n.tone === '')).toBe(true);
    expect(g.edges.every((e: any) => e.label === '')).toBe(true);
  });

  it('set_block fills them too, and a tone the agent DID write is never overwritten', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Diagrams' });
    const added = await h.json('add_chunk', { starter: 'flowchart' });
    await h.json('set_block', {
      chunkId: added.chunkId,
      kind: 'flow',
      data: { nodes: [{ id: 'a', label: 'A', shape: 'pill', tone: 'green' }, { id: 'b', label: 'B', shape: 'box' }], edges: [{ from: 'a', to: 'b', label: 'yes' }, { from: 'b', to: 'a' }] },
    });
    const d = (await h.json('get_block', { chunkId: added.chunkId, kind: 'flow' })).data;
    expect(d.nodes.map((n: any) => n.tone)).toEqual(['green', '']);
    expect(d.edges.map((e: any) => e.label)).toEqual(['yes', '']);
  });

  it('does NOT default anything that carries meaning', async () => {
    /* The line this stops at. A gantt card's `effort` is EASY|MED|DEFER with no blank member, so
       filling one would be inventing content rather than supplying a blank — it stays a refusal. */
    const h = harness();
    await h.json('create_deck', { title: 'Gantt' });
    const res = await h.call('add_fold', {
      title: 'Plan',
      blocks: [{ gantt: { totalWeeks: 4, startDate: null, lenses: [{ name: 'Plan', color: '#4a8cc4' }], swimlanes: [{ name: 'A', owner: 'O' }], cards: [{ id: 'C1', title: 'Do it', swimlane: 'A', start: 'W1', durationWeeks: 1, lens: 'Plan', type: 'Process' }], milestones: [] } }],
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule)).toContain('gantt.card.effort');
  });

  it('tells an agent where the filling stops', async () => {
    const h = harness();
    const kinds = (await h.json('origami_guide', { topic: 'kinds' })).kinds;
    for (const k of ['flow', 'graph']) {
      expect(kinds[k].howToAdd, k).toMatch(/REQUIRED-BUT-BLANK/);
      expect(kinds[k].howToAdd, k).toMatch(/write_chunk and the propose_\* tools do not/);
    }
    expect(kinds.gantt.howToAdd).not.toMatch(/REQUIRED-BUT-BLANK/);
  });

  /* ---- 3. add_ledger currency + inlined shapes ---------------------------------------- */

  it('puts one currency prefix on every currency column, which is what both agents got wrong', async () => {
    /* MEASURED in the vendored cell-format: `const sym = fmt?.currency ?? '$'`, printed
       LITERALLY. Both trial agents wrote € in the prose and the table rendered $. */
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    const res = await h.json('add_ledger', {
      title: 'Q3 budget',
      currency: '€',
      columns: [{ label: 'Line' }, { label: 'Plan', align: 'right', format: { kind: 'currency' } }, { label: 'Actual', align: 'right', format: { kind: 'currency' } }, { label: 'Share', format: { kind: 'percent' } }],
      rows: [['Engineering', '120000', '118400', '0.62'], ['Total', '', '', '']],
      formulas: { B2: '=SUM(B1:B1)', C2: '=SUM(C1:C1)' },
    });
    const cols = (await h.json('get_block', { chunkId: res.chunkId, kind: 'table' })).data.columns;
    expect(cols[1].format).toEqual({ kind: 'currency', currency: '€' });
    expect(cols[2].format).toEqual({ kind: 'currency', currency: '€' });
    expect(cols[3].format, 'a non-currency column is untouched').toEqual({ kind: 'percent' });
    expect(cols[0].format, 'a column with no format at all is untouched').toBeUndefined();
    expect(formatCell('1234.5', cols[1].format)).toBe('€1,234.50');
  });

  it('leaves a column that names its own currency alone, and is a no-op when unset', async () => {
    const h = harness();
    await h.json('create_deck', { title: 'Ledger' });
    const res = await h.json('add_ledger', {
      title: 'Mixed',
      currency: '€',
      columns: [{ label: 'EUR', format: { kind: 'currency' } }, { label: 'GBP', format: { kind: 'currency', currency: '£' } }],
      rows: [['1', '2']],
    });
    const cols = (await h.json('get_block', { chunkId: res.chunkId, kind: 'table' })).data.columns;
    expect(cols.map((c: any) => c.format.currency)).toEqual(['€', '£']);

    const plain = await h.json('add_ledger', { title: 'Default', columns: [{ label: 'Cost', format: { kind: 'currency' } }], rows: [['1']] });
    const one = (await h.json('get_block', { chunkId: plain.chunkId, kind: 'table' })).data.columns[0];
    expect(one.format.currency, 'unset means the format library decides').toBeUndefined();
    expect(formatCell('1234.5', one.format), 'and what it decides is $').toBe('$1,234.50');
  });

  it('carries the kpis / totals / formulas shapes in its own description, so no schema round trip is needed', async () => {
    /* The description is the only thing an agent has when it decides how to call a tool. A KPI
       built from it ALONE has to validate — so the example is parsed straight out of the text. */
    const h = harness();
    const d = h.registry.get('add_ledger')!.description;
    const kpi = JSON.parse(/`kpis` pins cards above the table: (\[.*?\]) /.exec(d)![1]!);
    const totals = JSON.parse(/`totals` is a footer row: (\{.*?\}\}) /.exec(d)![1]!);
    expect(d).toMatch(/format` is an OBJECT/);
    expect(d).toMatch(/prints "\$"/);

    await h.json('create_deck', { title: 'From the description' });
    const res = await h.json('add_ledger', {
      title: 'KPI',
      currency: '€',
      columns: [{ label: 'Line' }, { label: 'Plan', format: { kind: 'currency' } }],
      rows: [['Engineering', '120000'], ['Design', '42000'], ['x', ''], ['x', ''], ['Total', '']],
      formulas: { B5: '=SUM(B1:B4)' },
      kpis: kpi,
      totals,
    });
    expect(res.blocks).toEqual([{ kind: 'table', nth: 0 }]);
    expect(validateDeck(parseDeck(h.deck.serialize())), 'a ledger built from the description alone must be VALID').toEqual([]);
  });

  /* ---- 5. fit with prose --------------------------------------------------------------- */

  it('shrinks a composed chart when the card also carries prose', async () => {
    /* MEASURED at 1280x720 through the real render: the same lede+chart fold is 849px at
       plotHeight 318, 781 at 250, 751 at 220, 731 at 200 and FITS at 180. A paragraph costs the
       chart 107px, which is more than the distance from 250 to the floor — so any prose on the
       card puts the chart at the floor. The e2e test measures it; this pins the arithmetic. */
    const h = harness();
    await h.json('create_deck', { title: 'Fit' });

    const alone = await h.json('add_fold', { title: 'Chart only', blocks: [{ chart: CHART }] });
    expect((await h.json('get_block', { chunkId: alone.chunkId, kind: 'chart' })).data.plotHeight).toBe(COMPOSED_PLOT_HEIGHT);

    for (const prose of [{ text: '<p class="lede">A line.</p>' }, { bullets: ['a', 'b'] }, { stats: [{ value: '1', label: 'x' }] }, { quote: { text: 'Said.' } }]) {
      const withProse = await h.json('add_fold', { title: 'With prose', blocks: [prose, { chart: CHART }] });
      const ph = (await h.json('get_block', { chunkId: withProse.chunkId, kind: 'chart' })).data.plotHeight;
      expect(ph, JSON.stringify(Object.keys(prose))).toBe(MIN_PLOT_HEIGHT);
      expect(ph).toBeLessThan(COMPOSED_PLOT_HEIGHT);
    }

    // the floor holds however much prose is piled on
    const crowded = await h.json('add_fold', { title: 'Crowded', blocks: [{ text: '<p>a</p>' }, { bullets: ['b'] }, { quote: { text: 'c' } }, { chart: CHART }] });
    expect((await h.json('get_block', { chunkId: crowded.chunkId, kind: 'chart' })).data.plotHeight).toBe(MIN_PLOT_HEIGHT);

    // and a chart that names its own height is obeyed, prose or not
    const own = await h.json('add_fold', { title: 'Own', blocks: [{ text: '<p>a</p>' }, { chart: { ...CHART, plotHeight: 600 } }] });
    expect((await h.json('get_block', { chunkId: own.chunkId, kind: 'chart' })).data.plotHeight).toBe(600);
  });

  it('states the rule in the arithmetic, not just in a comment', () => {
    expect(chartPlotHeight([])).toBe(COMPOSED_PLOT_HEIGHT);
    expect(chartPlotHeight([{ chart: {} }])).toBe(COMPOSED_PLOT_HEIGHT);
    expect(chartPlotHeight([{ text: '<p>a</p>' }])).toBe(MIN_PLOT_HEIGHT);
    expect(MIN_PLOT_HEIGHT).toBe(180);
    expect(COMPOSED_PLOT_HEIGHT).toBeGreaterThan(MIN_PLOT_HEIGHT);
  });

  /* ---- 4. per-turn bytes kept honest ---------------------------------------------------- */

  it('keeps every destructive warning and measured caveat that the trim could have cost', () => {
    /* The budget is only worth having if it did not buy the bytes by dropping a warning. Each of
       these is a caveat an agent cannot recover from being wrong about. */
    const h = harness();
    const d = (n: string) => h.registry.get(n)!.description;

    expect(d('delete_chunk')).toMatch(/removes the slide template entirely/);
    expect(d('delete_chunk')).toMatch(/set_chunk_meta\(\{chunkId, hidden:false\}\)/);
    expect(d('delete_theme')).toMatch(/GONE from this browser/);
    expect(d('create_deck')).toMatch(/discard:true/);
    expect(d('save_deck')).toMatch(/saved:true means/);
    expect(d('save_deck')).toMatch(/NEVER reported as saved/);
    expect(d('export_deck')).toMatch(/writes NOTHING, saves NOTHING/);
    expect(d('inspect_render')).toMatch(/never ship on unknown/);
    expect(d('set_deck_meta')).toMatch(/ON ITS OWN IT CHANGES THE LABEL AND NOTHING ELSE/);
    expect(d('save_theme')).toMatch(/REFUSED/);
    expect(d('move_chunk')).toMatch(/REFUSED rather than clamped/);
    expect(d('undo')).toMatch(/no redo/);
    expect(d('add_custom_fold')).toMatch(/padlock/);

    // and every writer still says it writes — a dropped annotation must never be the difference
    for (const name of ['write_chunk', 'add_chunk', 'add_fold', 'add_ledger', 'set_block', 'move_chunk', 'set_chunk_meta', 'set_deck_meta', 'apply_theme', 'run_batch']) {
      expect(d(name), name).toMatch(/CHANGES THE (DECK|COLOURS|OPEN FOLD)/);
    }
    for (const name of ['add_custom_fold', 'define_block', 'delete_block', 'set_header', 'set_fold_type']) {
      expect(d(name), name).toMatch(/CHANGES THE OPEN FOLD/);
    }
  });

  it('undo points at a guide entry that really lists the writers it covers', async () => {
    // the description bought its bytes back by pointing; the pointer has to be true
    const h = harness();
    expect(h.registry.get('undo')!.description).toMatch(/origami_guide\(\{topic:"tools"\}\) lists them/);
    const tools = (await h.json('origami_guide', { topic: 'tools' })).tools;
    for (const name of ['write_chunk', 'add_fold', 'add_ledger', 'set_block', 'apply_theme', 'delete_chunk']) {
      expect(tools.undo, name).toContain(name);
    }
  });
});
