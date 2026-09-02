import { describe, expect, it } from 'vitest';
import { KINDS, buildModel, extractDataBlocks, parseDeck, validateDeck } from '../../vendor/format-dist/index.js';
import { CHARTS_MODE, DRAW_MODE, GANTT_MODE, MINI_MODES, MODES } from '../../src/core/modes.js';
import { pageGuide } from '../../src/core/mode-guide.js';
import { origamiGuide } from '../../src/core/guide.js';
import { modeFileName } from '../../src/core/mode-registry.js';
import { autosaveKey } from '../../src/app/files.js';
import { pointerKey } from '../../src/app/opfs.js';
import { harness, miniHarness, sampleDeck } from './harness.js';

/* The mini tool pages (docs/SITE.md, "Mini tools"), against the REAL vendored @origami/format
   and @origami/runtime. Every assertion here is about observable state — what the block's JSON
   holds after a call, what the serialized file contains, what a refusal says — never about which
   internal function ran. */

/** The data block of one kind on the fold this page edits, parsed out of the model. */
function blockData(h: Awaited<ReturnType<typeof miniHarness>>, kind: string): unknown {
  const m = h.deck.model();
  for (const id of m.order) {
    for (const b of extractDataBlocks(m.slides.get(id)!.inner)) {
      if (b.kind === kind) return JSON.parse(b.json);
    }
  }
  return null;
}

/** Which kinds' schemaComment arrays a payload carries, matched by IDENTITY against the format
    library's own — the only way to ask "does this guide ship the sankey contract?" without
    tripping over the word "sankey" inside the chart contract, where it belongs. */
function schemasIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) {
    for (const [key, k] of Object.entries(KINDS)) {
      if (v.length === k.schemaComment.length && v.every((line, i) => line === k.schemaComment[i])) out.push(key);
    }
    // …and keep walking: `alsoOnThisPage` is an array of objects, each carrying a schema
    for (const x of v) schemasIn(x, out);
    return out;
  }
  if (v && typeof v === 'object') for (const x of Object.values(v)) schemasIn(x, out);
  return out;
}

/** The kinds of every data block in the open Fold — proves a figure SWAPPED rather than doubled. */
function blockKinds(h: Awaited<ReturnType<typeof miniHarness>>): string[] {
  const m = h.deck.model();
  return m.order.flatMap((id) => extractDataBlocks(m.slides.get(id)!.inner).map((b) => b.kind));
}

describe('each mini page registers exactly its own toolset', () => {
  it('draw registers 13 tools, charts 12, gantt 11 — and folio is untouched at 29', async () => {
    const counts: Record<string, number> = {};
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      counts[mode.key] = h.registry.list().length;
      // the registry IS the mode's list, in the mode's order — nothing extra, nothing missing
      expect(h.registry.list().map((t) => t.name)).toEqual([...mode.tools!]);
    }
    expect(counts).toEqual({ draw: 13, charts: 12, gantt: 11 });
  });

  it('names exactly the tools docs/SITE.md specifies for each page', async () => {
    const draw = await miniHarness(DRAW_MODE);
    expect(draw.registry.list().map((t) => t.name).sort()).toEqual([
      'add_element', 'export_deck', 'inspect_render', 'list_activity', 'list_elements', 'origami_guide',
      'read_chunk', 'remove_element', 'save_deck', 'set_caption', 'undo', 'update_element', 'write_chunk',
    ]);
    const charts = await miniHarness(CHARTS_MODE);
    expect(charts.registry.list().map((t) => t.name).sort()).toEqual([
      'export_deck', 'get_data', 'inspect_render', 'list_activity', 'origami_guide', 'read_chunk',
      'save_deck', 'set_caption', 'set_chart', 'set_venn', 'undo', 'write_chunk',
    ]);
    const gantt = await miniHarness(GANTT_MODE);
    expect(gantt.registry.list().map((t) => t.name).sort()).toEqual([
      'export_deck', 'get_roadmap', 'inspect_render', 'list_activity', 'origami_guide', 'read_chunk',
      'save_deck', 'set_caption', 'set_roadmap', 'undo', 'write_chunk',
    ]);
  });

  it('registers NONE of the multi-fold tools, and each absence is explained in the guide', async () => {
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      const guide = await h.json('origami_guide');
      for (const absent of ['create_deck', 'add_chunk', 'list_chunks', 'delete_chunk', 'move_chunk', 'propose_chunk', 'set_deck_meta']) {
        expect(h.registry.get(absent), `${mode.key}: ${absent}`).toBeUndefined();
        // an agent that reaches for one must be told where it lives, not left guessing
        expect(guide.notAvailableHere[absent], `${mode.key}: ${absent}`).toMatch(/^Absent\b/);
      }
      expect(guide.notAvailableHere.openTheFullEditor).toMatch(/\/folio\//);
    }
  });

  it('every tool carries a description and an object input schema, like every Folio tool', async () => {
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      for (const t of h.registry.list()) {
        expect(t.description.length, `${mode.key}.${t.name}`).toBeGreaterThan(40);
        expect(t.inputSchema.type, `${mode.key}.${t.name}`).toBe('object');
        for (const req of t.inputSchema.required ?? []) {
          expect(t.inputSchema.properties[req], `${mode.key}.${t.name}.${req}`).toBeDefined();
        }
      }
    }
  });

  it('locks every top-level inputSchema against unknown arguments — additionalProperties:false, Folio and every mini mode', async () => {
    /* A strict WebMCP host may enforce the schema literally: an arg the tool never asked for
       must be REJECTED, not silently ignored. That only holds if every registered tool's
       top-level schema says so — one missed tool is one hole a strict host would exploit.

       Covers every definition site: buildTools(), block-tools, AND pageGuideTool()'s own
       schema (mode-guide.ts) that createModeRegistry swaps in on a mini mode. */
    const folio = harness().registry.list();
    expect(folio.length).toBeGreaterThan(0);
    for (const t of folio) {
      expect(t.inputSchema.additionalProperties, `folio.${t.name}`).toBe(false);
    }
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      expect(h.registry.list().length, mode.key).toBeGreaterThan(0);
      for (const t of h.registry.list()) {
        expect(t.inputSchema.additionalProperties, `${mode.key}.${t.name}`).toBe(false);
      }
    }
  });
});

describe('the page-scoped guide', () => {
  it('advertises every registered tool on that page and no phantom ones', async () => {
    /* The registry↔catalog sync rule the Folio guide already lives under, applied per page: the
       catalog IS the API description an agent reads first, so a tool missing from it is a tool
       that never gets called, and a tool named but not registered is a call that always fails. */
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      const guide = await h.json('origami_guide');
      const registered = h.registry.list().map((t) => t.name).sort();
      expect(Object.keys(guide.tools).sort(), mode.key).toEqual(registered);
      for (const [name, blurb] of Object.entries(guide.tools)) {
        expect(blurb, `${mode.key}.${name}`).not.toBe('(no description registered)');
      }
    }
  });

  it("quotes the block's schemaComment VERBATIM from the format library", async () => {
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      const guide = await h.json('origami_guide');
      const primary = mode.blockKinds![0]!;
      expect(guide.block.kind).toBe(primary);
      expect(guide.block.name).toBe(KINDS[primary]!.name);
      expect(guide.block.schema).toEqual(KINDS[primary]!.schemaComment);
    }
    // charts addresses two kinds, so the second one's schema ships too — set_venn is useless
    // to an agent that has never been told what a venn's JSON looks like
    const charts = await miniHarness(CHARTS_MODE);
    const guide = await charts.json('origami_guide');
    expect(guide.block.alsoOnThisPage).toEqual([{ kind: 'venn', name: KINDS.venn!.name, schema: KINDS.venn!.schemaComment }]);
  });

  it('is SMALL — a mini page must not make an agent read the whole Folio contract', async () => {
    /* Measured against the Folio guide itself rather than a guessed constant, so the bar moves
       with the thing it is a fraction of. The Folio guide's DEFAULT answer already omits the
       recipe cards and the starter catalog and still costs ~15 KB, most of it a kind index and
       protocol prose a one-block page cannot use. */
    const size = (v: unknown) => JSON.stringify(v, null, 2).length;
    const folioDefault = size(origamiGuide());
    const folioWhole = ['contract', 'kinds', 'recipes', 'starters', 'issues', 'tools'].reduce(
      (n, t) => n + size(origamiGuide(t as any)),
      0
    );
    const bytes: Record<string, number> = {};
    for (const mode of MINI_MODES) {
      bytes[mode.key] = size(pageGuide(mode));
      expect(bytes[mode.key], `${mode.key} vs the Folio default answer`).toBeLessThan(folioDefault);
      expect(bytes[mode.key]! * 4, `${mode.key} vs the whole Folio guide`).toBeLessThan(folioWhole);

      const text = JSON.stringify(pageGuide(mode));
      expect(text, `${mode.key} must not carry the recipe cards`).not.toContain('"cards"');
      expect(text, `${mode.key} must not carry the starter catalog`).not.toContain('"folds"');
      // and no kind schema but its OWN. Checked by identity against the format library's
      // schemaComment arrays, not by keyword: "sankey" is a legitimate word inside the CHART
      // contract, so a substring search would call a correct guide wrong.
      expect(schemasIn(pageGuide(mode)).sort(), `${mode.key} ships exactly its own schemas`).toEqual([...mode.blockKinds!].sort());
    }
    // the numbers this test is asserting about, printed so a regression is legible
    console.log('page guide bytes:', JSON.stringify({ ...bytes, folioDefault, folioWhole }, null, 2));
  });
});

describe('the seeded document a mini page opens with', () => {
  it('is ONE fold holding ONE block, titled and named per the mode, and it validates', async () => {
    const expected = {
      draw: { title: 'Untitled drawing', file: 'untitled-drawing.origami.html', kind: 'draw' },
      charts: { title: 'Untitled chart', file: 'untitled-chart.origami.html', kind: 'chart' },
      gantt: { title: 'Untitled roadmap', file: 'untitled-roadmap.origami.html', kind: 'gantt' },
    } as const;
    for (const mode of MINI_MODES) {
      const want = expected[mode.key as keyof typeof expected];
      const h = await miniHarness(mode);
      const m = h.deck.model();
      expect(m.title, mode.key).toBe(want.title);
      expect(h.deck.name(), mode.key).toBe(want.file);
      expect(modeFileName(mode), mode.key).toBe(want.file);
      expect(m.order.length, mode.key).toBe(1);
      expect(m.slides.get(m.order[0]!)!.label, mode.key).toBe(mode.doc!.label);
      expect(blockKinds(h), mode.key).toEqual([want.kind]);
      // the whole file passes the format's own validator, data blocks included
      expect(validateDeck(parseDeck(h.deck.serialize())), mode.key).toEqual([]);
    }
  });

  it('arrives CLEAN — nothing to save and nothing to undo before the human has done anything', async () => {
    /* It is assembled complete rather than created-then-edited. A create-then-write would light
       the Save button and leave an undo step that reverses to a blank card the page has no tool
       to repair. */
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      expect(h.deck.peek()!.dirty, mode.key).toBe(false);
      expect(h.deck.undoDepth(), mode.key).toBe(0);
      expect((await h.call('undo')).isError, mode.key).toBe(true);
    }
  });
});

describe('draw: the element tools', () => {
  it('add_element mints an id and a seed, and the element comes back from list_elements', async () => {
    const h = await miniHarness(DRAW_MODE);
    const before = (await h.json('list_elements')).count;

    const added = await h.json('add_element', { type: 'rect', x: 300, y: 300, width: 120, height: 60, stroke: '#B3402A' });
    expect(added.added, 'an id was minted').toMatch(/^e[0-9a-f]{8}$/);
    expect(Number.isInteger(added.seed) && added.seed >= 1 && added.seed <= 2147483647, 'a seed was minted').toBe(true);

    const after = await h.json('list_elements');
    expect(after.count).toBe(before + 1);
    const el = after.elements.find((e: any) => e.id === added.added);
    expect(el).toMatchObject({ type: 'rect', x: 300, y: 300, width: 120, height: 60, stroke: '#B3402A', seed: added.seed });
    // and it is really in the FILE, not just in a tool's answer
    expect((blockData(h, 'draw') as any).elements.at(-1).id).toBe(added.added);
  });

  it('honours an id and a seed that are supplied, and refuses a duplicate id', async () => {
    const h = await miniHarness(DRAW_MODE);
    await h.json('add_element', { id: 'mine', seed: 42, type: 'ellipse', x: 10, y: 10, width: 40, height: 40, stroke: '#333333' });
    const el = (await h.json('list_elements')).elements.find((e: any) => e.id === 'mine');
    expect(el).toMatchObject({ id: 'mine', seed: 42 });

    const dup = await h.call('add_element', { id: 'mine', type: 'rect', x: 0, y: 0, width: 1, height: 1, stroke: '#333333' });
    expect(dup.isError).toBe(true);
    expect(JSON.parse(dup.content[0]!.text).error).toMatch(/already exists/);
  });

  it('refuses a bad element with the schema violation NAMED, and applies nothing', async () => {
    const h = await miniHarness(DRAW_MODE);
    const before = h.deck.serialize();

    const badHex = await h.call('add_element', { type: 'rect', x: 0, y: 0, width: 10, height: 10, stroke: 'red' });
    expect(badHex.isError).toBe(true);
    const body = JSON.parse(badHex.content[0]!.text);
    expect(body.violations.map((v: any) => v.rule)).toContain('draw.element.stroke');
    expect(body.violations[0].detail).toMatch(/#hex/);

    const badType = await h.call('add_element', { type: 'hexagon', x: 0, y: 0, width: 10, height: 10, stroke: '#333333' });
    expect(JSON.parse(badType.content[0]!.text).violations.map((v: any) => v.rule)).toContain('draw.element.type');

    // an arrow with no points is refused by the same gate
    const noPoints = await h.call('add_element', { type: 'arrow', x: 0, y: 0, width: 10, height: 0, stroke: '#333333' });
    expect(JSON.parse(noPoints.content[0]!.text).violations.map((v: any) => v.rule)).toContain('draw.element.points');

    expect(h.deck.serialize(), 'three refusals must leave the Fold byte-identical').toBe(before);
    expect(h.deck.peek()!.dirty).toBe(false);
  });

  it('update_element patches by id, leaves the other fields alone, and REFUSES an unknown id', async () => {
    const h = await miniHarness(DRAW_MODE);
    const first = (await h.json('list_elements')).elements[0];

    const res = await h.json('update_element', { id: first.id, patch: { x: 999, stroke: '#4A8CC4' } });
    expect(res.updated).toBe(first.id);
    const after = (await h.json('list_elements')).elements.find((e: any) => e.id === first.id);
    expect(after.x).toBe(999);
    expect(after.stroke).toBe('#4A8CC4');
    // everything NOT named in the patch survived
    expect(after.y).toBe(first.y);
    expect(after.width).toBe(first.width);
    expect(after.seed).toBe(first.seed);

    const missing = await h.call('update_element', { id: 'no-such-element', patch: { x: 1 } });
    expect(missing.isError).toBe(true);
    const body = JSON.parse(missing.content[0]!.text);
    expect(body.error).toMatch(/unknown element "no-such-element"/);
    expect(body.availableIds, 'the refusal names the ids that DO exist').toContain(first.id);
    // and nothing was created for it
    expect((await h.json('list_elements')).elements.some((e: any) => e.id === 'no-such-element')).toBe(false);
  });

  it('a patch that breaks the schema is refused with the violation named', async () => {
    const h = await miniHarness(DRAW_MODE);
    const first = (await h.json('list_elements')).elements[0];
    const bad = await h.call('update_element', { id: first.id, patch: { strokeWidth: 99 } });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text).violations.map((v: any) => v.rule)).toContain('draw.element.strokeWidth');
    expect((await h.json('list_elements')).elements[0].strokeWidth).toBe(first.strokeWidth);
  });

  it('remove_element takes one element out, refuses an unknown id, and warns on the last one', async () => {
    const h = await miniHarness(DRAW_MODE);
    const list = (await h.json('list_elements')).elements;
    const victim = list[0].id;

    const gone = await h.json('remove_element', { id: victim });
    expect(gone.removed).toBe(victim);
    expect(gone.count).toBe(list.length - 1);
    expect((await h.json('list_elements')).elements.some((e: any) => e.id === victim)).toBe(false);

    expect((await h.call('remove_element', { id: victim })).isError, 'removing it twice').toBe(true);

    for (const e of (await h.json('list_elements')).elements) await h.json('remove_element', { id: e.id });
    const last = await h.json('list_elements');
    expect(last.count).toBe(0);
  });
});

describe('charts: set_chart, set_venn and the kind swap', () => {
  it('set_chart replaces the whole chart and the values reach the file', async () => {
    const h = await miniHarness(CHARTS_MODE);
    const chart = {
      type: 'bar',
      labels: ['North', 'South', 'East'],
      series: [{ name: 'Units', color: '#3D8B5A', values: [7, 11, 4] }],
      yMax: null,
    };
    const res = await h.json('set_chart', { chart, caption: 'Units by region' });
    expect(res).toMatchObject({ kind: 'chart', was: 'chart', type: 'bar' });
    expect(blockData(h, 'chart')).toEqual(chart);
    expect(h.deck.serialize()).toContain('Units by region');
    expect((await h.json('get_data')).data).toEqual(chart);
  });

  it('refuses a values/labels length mismatch with the violation named, and applies nothing', async () => {
    const h = await miniHarness(CHARTS_MODE);
    const before = h.deck.serialize();
    const bad = await h.call('set_chart', {
      chart: { type: 'bar', labels: ['A', 'B', 'C'], series: [{ name: 'x', color: '#4A8CC4', values: [1, 2] }], yMax: null },
    });
    expect(bad.isError).toBe(true);
    const body = JSON.parse(bad.content[0]!.text);
    expect(body.violations.map((v: any) => v.rule)).toContain('chart.series.values');
    expect(body.violations[0].detail).toMatch(/one number per label \(3\)/);
    expect(h.deck.serialize()).toBe(before);
  });

  it('refuses a colour that is not a #hex, and an unknown chart type', async () => {
    const h = await miniHarness(CHARTS_MODE);
    const badHex = await h.call('set_chart', {
      chart: { type: 'bar', labels: ['A'], series: [{ name: 'x', color: 'cornflower', values: [1] }], yMax: null },
    });
    expect(JSON.parse(badHex.content[0]!.text).violations.map((v: any) => v.rule)).toContain('chart.series.color');

    const badType = await h.call('set_chart', {
      chart: { type: 'wordcloud', labels: ['A'], series: [{ name: 'x', color: '#4A8CC4', values: [1] }], yMax: null },
    });
    expect(JSON.parse(badType.content[0]!.text).violations.map((v: any) => v.rule)).toContain('chart.type');
  });

  it('set_venn SWAPS the figure kind — one block, not two — and get_data reads it back', async () => {
    const h = await miniHarness(CHARTS_MODE);
    expect(blockKinds(h)).toEqual(['chart']);

    const venn = {
      count: 2,
      sets: [{ label: 'Inert', color: '#557A4E' }, { label: 'Editable', color: '#4A8CC4' }],
      overlaps: [{ sets: [0, 1], label: 'A Fold', x: 50, y: 52 }],
    };
    await h.json('set_venn', { venn, caption: 'What a Fold is' });

    expect(blockKinds(h), 'the chart block is GONE, replaced — never both').toEqual(['venn']);
    const data = await h.json('get_data');
    expect(data.kind).toBe('venn');
    expect(data.data).toEqual(venn);
    expect(data.caption).toBe('What a Fold is');
    /* The figure's own markup follows the venn schema, mount and all. Asserted on the FOLD's
       inner, not the whole file: a Fold carries the viewer runtime inline, and that bundle
       mentions every mount attribute in the format — so "the file does not contain
       data-chart-mount" would be false on a page that had never seen a chart. */
    const text = h.deck.serialize();
    const reopened = buildModel(parseDeck(text));
    const inner = reopened.slides.get(reopened.order[0]!)!.inner;
    expect(inner).toContain('<figure class="o-vennfig anim">');
    expect(inner).toContain('<div class="o-venn" data-venn-mount></div>');
    expect(inner, 'the chart mount went with the chart block').not.toContain('data-chart-mount');
    expect(validateDeck(parseDeck(text))).toEqual([]);

    // …and set_chart swaps it back
    await h.json('set_chart', { chart: { type: 'pie', labels: ['A', 'B'], series: [{ name: 's', color: '#4A8CC4', values: [1, 2] }], yMax: null } });
    expect(blockKinds(h)).toEqual(['chart']);
    expect((await h.json('get_data')).kind).toBe('chart');
  });

  it('refuses a venn whose sets do not match its count', async () => {
    const h = await miniHarness(CHARTS_MODE);
    const bad = await h.call('set_venn', { venn: { count: 3, sets: [{ label: 'A', color: '#557A4E' }, { label: 'B', color: '#4A8CC4' }] } });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text).violations.map((v: any) => v.rule)).toContain('venn.sets.count');
    expect(blockKinds(h), 'the chart it already had is untouched').toEqual(['chart']);
  });
});

describe('gantt: set_roadmap', () => {
  it('round-trips a whole roadmap through the file and back out of get_roadmap', async () => {
    const h = await miniHarness(GANTT_MODE);
    const roadmap = {
      totalWeeks: 8,
      startDate: '2026-09-07',
      lenses: [{ name: 'Build', color: '#4a8cc4' }],
      swimlanes: [{ name: 'Platform', owner: 'Origami' }],
      cards: [
        {
          id: 'C01', title: 'Ship the mini tools', swimlane: 'Platform', start: 'W2', durationWeeks: 3,
          lens: 'Build', type: 'Technical', effort: 'MED',
          what: 'draw, charts, gantt', needs: '', caveat: '', deliverable: '', sources: '', completed: false,
        },
      ],
      milestones: [{ label: 'Live', week: 6, color: '#3d8b5a' }],
    };
    const res = await h.json('set_roadmap', { roadmap, caption: 'Q4 plan' });
    expect(res).toMatchObject({ swimlanes: 1, cards: 1 });

    // out of the MODEL…
    expect(blockData(h, 'gantt')).toEqual(roadmap);
    // …and back through a full serialize + re-parse, which is what a saved file really is
    const reopened = buildModel(parseDeck(h.deck.serialize()));
    const block = extractDataBlocks(reopened.slides.get(reopened.order[0]!)!.inner)[0]!;
    expect(JSON.parse(block.json)).toEqual(roadmap);
    expect(await h.json('get_roadmap')).toMatchObject({ roadmap, caption: 'Q4 plan' });
  });

  it('refuses a card naming a swimlane or a lens that is not declared', async () => {
    const h = await miniHarness(GANTT_MODE);
    const before = h.deck.serialize();
    const bad = await h.call('set_roadmap', {
      roadmap: {
        totalWeeks: 4,
        startDate: null,
        lenses: [{ name: 'Build', color: '#4a8cc4' }],
        swimlanes: [{ name: 'Platform', owner: '' }],
        cards: [{ id: 'C01', title: 'x', swimlane: 'Ghost lane', start: 'W1', durationWeeks: 1, lens: 'Nope', type: 'Technical', effort: 'MED', what: '', needs: '', caveat: '', deliverable: '', sources: '', completed: false }],
        milestones: [],
      },
    });
    expect(bad.isError).toBe(true);
    const rules = JSON.parse(bad.content[0]!.text).violations.map((v: any) => v.rule);
    expect(rules).toContain('gantt.card.swimlane');
    expect(rules).toContain('gantt.card.lens');
    expect(h.deck.serialize()).toBe(before);
  });
});

describe('set_caption, on every page', () => {
  it('survives a serialize + re-parse, and escapes markup instead of carrying it', async () => {
    for (const mode of MINI_MODES) {
      const h = await miniHarness(mode);
      await h.json('set_caption', { caption: 'A < B & C' });

      const reopened = buildModel(parseDeck(h.deck.serialize()));
      const inner = reopened.slides.get(reopened.order[0]!)!.inner;
      expect(inner, mode.key).toContain('<figcaption>A &lt; B &amp; C</figcaption>');
      expect(validateDeck(parseDeck(h.deck.serialize())), mode.key).toEqual([]);

      // the block's own data is untouched by a caption change
      const kind = mode.blockKinds![0]!;
      const data = blockData(h, kind);
      await h.json('set_caption', { caption: '' });
      expect(blockData(h, kind), mode.key).toEqual(data);
      expect(buildModel(parseDeck(h.deck.serialize())).slides.get(reopened.order[0]!)!.inner, mode.key).toContain('<figcaption></figcaption>');
    }
  });
});

describe('the block tools go through write_chunk\'s own gate', () => {
  it('one call is one undo step, and undo really reverses it', async () => {
    /* The gate is shared (writeFoldInner). The observable consequence — and the reason it has to
       be shared — is that the undo stack cannot tell a typed writer from a raw write_chunk. */
    const h = await miniHarness(CHARTS_MODE);
    const original = blockData(h, 'chart');

    await h.json('set_chart', { chart: { type: 'pie', labels: ['A', 'B'], series: [{ name: 's', color: '#4A8CC4', values: [3, 4] }], yMax: null } });
    expect(h.deck.undoDepth()).toBe(1);
    await h.json('set_caption', { caption: 'two slices' });
    expect(h.deck.undoDepth()).toBe(2);

    await h.json('undo');
    expect(h.deck.serialize()).not.toContain('two slices');
    await h.json('undo');
    expect(blockData(h, 'chart'), 'back to the seeded chart').toEqual(original);
    expect(h.deck.undoDepth()).toBe(0);
  });

  it('write_chunk is still the escape hatch, and the typed tools read what it wrote', async () => {
    const h = await miniHarness(DRAW_MODE);
    const chunkId = h.deck.model().order[0]!;
    const read = await h.text('read_chunk', { chunkId });
    // the raw route changes the heading; the drawing beside it is untouched
    const edited = read.slice(read.indexOf('<template')).replace('<h2 class="anim" style="--i:1">Drawing</h2>', '<h2 class="anim" style="--i:1">My sketch</h2>');
    const written = await h.json('write_chunk', { chunkId, html: edited });
    expect(written.applied).toBe(chunkId);
    expect(h.deck.serialize()).toContain('My sketch');

    const list = await h.json('list_elements');
    expect(list.count).toBeGreaterThan(0);
    // and a typed write after it keeps the hand edit
    await h.json('add_element', { type: 'rect', x: 600, y: 350, width: 50, height: 30, stroke: '#333333' });
    expect(h.deck.serialize()).toContain('My sketch');
  });

  it('refuses every block tool with a usable message once the block is gone', async () => {
    const h = await miniHarness(GANTT_MODE);
    const chunkId = h.deck.model().order[0]!;
    await h.json('write_chunk', { chunkId, html: '<div class="slide-inner"><h2>No block here</h2></div>' });

    for (const name of ['get_roadmap', 'set_roadmap', 'set_caption']) {
      const res = await h.call(name, { roadmap: {}, caption: 'x' });
      expect(res.isError, name).toBe(true);
      expect(JSON.parse(res.content[0]!.text).error, name).toMatch(/carries no gantt block/);
    }
  });
});

describe('a Fold the human opened, rather than the one the page minted', () => {
  it('finds the page\'s block wherever it sits — not blindly on fold 1', async () => {
    /* Open… and drag-and-drop still work on a mini page, so the Fold on screen may be a whole
       deck. The block tools look for the FIRST fold carrying a block of this page's kinds; the
       sample deck's charts are not on its cover, so "fold 0" would have found nothing. */
    const h = await miniHarness(CHARTS_MODE);
    h.deck.open(await sampleDeck(), 'welcome.origami.html');
    const m = h.deck.model();
    expect(m.order.length, 'a real multi-fold deck').toBeGreaterThan(3);

    const data = await h.json('get_data');
    expect(data.kind).toBe('chart');
    expect(data.chunkId, 'the chart is NOT on the cover').not.toBe(m.order[0]);
    expect(data.data.type).toBeTruthy();

    // and a write lands on that same fold, leaving every other one alone
    const others = m.order.filter((id) => id !== data.chunkId).map((id) => m.slides.get(id)!.inner);
    await h.json('set_caption', { caption: 'Edited on the charts page' });
    const after = h.deck.model();
    expect(after.slides.get(data.chunkId)!.inner).toContain('Edited on the charts page');
    expect(after.order.filter((id) => id !== data.chunkId).map((id) => after.slides.get(id)!.inner)).toEqual(others);
  });

  it('refuses honestly when the open Fold holds no block this page can edit', async () => {
    const h = await miniHarness(DRAW_MODE);
    // the sample deck has charts, gantts, flows and videos — and no drawing
    h.deck.open(await sampleDeck(), 'welcome.origami.html');
    const res = await h.call('list_elements');
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0]!.text);
    expect(body.error).toMatch(/carries no draw block/);
    expect(body.error, 'and it says what to do about it').toMatch(/Press New/);
    expect(body.blockKinds).toEqual(['draw']);
  });

  it('refuses a block whose JSON has been corrupted, instead of throwing something opaque', async () => {
    /* The corruption is put in through the FILE, not through a tool: every write path now runs
       the data gate, so write_chunk refuses to lay down unparseable JSON (asserted below). A
       Fold the human opened is the only way this state still arises — and it does arise, so the
       block reader still has to answer it with a sentence rather than a stack trace. */
    const h = await miniHarness(GANTT_MODE);
    const chunkId = h.deck.model().order[0]!;
    const broken = h.deck.model().slides.get(chunkId)!.inner.replace('"totalWeeks": 16,', '"totalWeeks": ,');

    const refused = await h.call('write_chunk', { chunkId, html: broken });
    expect(refused.isError, 'the gate refuses the corruption at write time').toBe(true);
    expect(JSON.parse(refused.content[0]!.text).violations.map((v: any) => v.rule)).toContain('kind-data.json');

    h.deck.open(h.deck.serialize().replace('"totalWeeks": 16,', '"totalWeeks": ,'), 'hand-edited.origami.html');
    const res = await h.call('get_roadmap');
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).error).toMatch(/not valid JSON/);
  });

  it('refuses a call with no data at all, naming the shape it wanted', async () => {
    const charts = await miniHarness(CHARTS_MODE);
    for (const [tool, rule] of [['set_chart', 'chart.shape'], ['set_venn', 'venn.shape']] as const) {
      const res = await charts.call(tool, {});
      expect(res.isError, tool).toBe(true);
      expect(JSON.parse(res.content[0]!.text).violations.map((v: any) => v.rule), tool).toContain(rule);
    }
    const gantt = await miniHarness(GANTT_MODE);
    expect(JSON.parse((await gantt.call('set_roadmap', {})).content[0]!.text).violations.map((v: any) => v.rule)).toContain('gantt.shape');

    const draw = await miniHarness(DRAW_MODE);
    const bare = await draw.call('add_element', {});
    expect(bare.isError).toBe(true);
    expect(JSON.parse(bare.content[0]!.text).violations.map((v: any) => v.rule)).toEqual(
      expect.arrayContaining(['draw.element.type', 'draw.element.xy', 'draw.element.size', 'draw.element.stroke'])
    );
    // a caption that is not a string is refused before it can reach the markup
    expect((await draw.call('set_caption', { caption: 42 })).isError).toBe(true);
  });

  it('ignores an id inside an update patch — an id addresses an element, it is not a field of one', async () => {
    const h = await miniHarness(DRAW_MODE);
    const first = (await h.json('list_elements')).elements[0];
    await h.json('update_element', { id: first.id, patch: { id: 'renamed', x: 5 } });
    const list = (await h.json('list_elements')).elements;
    expect(list.some((e: any) => e.id === 'renamed')).toBe(false);
    expect(list.find((e: any) => e.id === first.id).x).toBe(5);
  });
});

describe('storage is namespaced per page', () => {
  it('no two pages share an autosave slot or a last-save pointer', () => {
    /* localStorage and OPFS are per-ORIGIN and origami.gratis serves four tool pages from one.
       Sharing a key would make /charts/ resume the drawing from /draw/ — silently. */
    const namespaces = Object.values(MODES).map((m) => m.storageNs);
    expect(namespaces).toEqual(['', 'draw', 'charts', 'gantt']);

    const autosave = namespaces.map(autosaveKey);
    const pointers = namespaces.map(pointerKey);
    expect(new Set(autosave).size, 'four distinct autosave keys').toBe(4);
    expect(new Set(pointers).size, 'four distinct last-save pointers').toBe(4);
    expect(new Set([...autosave, ...pointers]).size, 'and no autosave key equals a pointer key').toBe(8);

    // Folio keeps its HISTORICAL keys byte for byte: work already in a human's browser must not
    // be orphaned by the day the mini tools shipped.
    expect(autosaveKey('')).toBe('origami-webmcp:autosave/v1');
    expect(pointerKey('')).toBe('origami-webmcp:lastsave/v1');
  });
});
