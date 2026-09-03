import { describe, expect, it } from 'vitest';
import { CHART_TYPES } from '../../vendor/format-dist/index.js';
import { validatorFor } from '../../src/core/block-tools.js';
import { fillDiagramDefaults } from '../../src/core/data-blocks.js';
import { harness } from './harness.js';

/* topic:"blocks" — the whole block model in one answer (2026-09-03 feedback: several
   get_kind_schema calls plus a rejected venn-as-chart.type trial to learn venn/flow/graph/
   gantt/draw are their own kinds, and more trial and error on a sankey's shape rules).
   Every claim here is checked against the SAME validators add_fold runs — the topic cannot
   say something the format library would refuse. */

describe('origami_guide({topic:"blocks"})', () => {
  it('every kind example is proven valid against its OWN validator, after fillDiagramDefaults', async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    const kinds = topic.kinds as Record<string, { kind: string; example: unknown }>;

    expect(Object.keys(kinds).length).toBeGreaterThan(5); // chart + venn/flow/graph/gantt/draw/table + sankey/treemap/sunburst
    for (const [key, entry] of Object.entries(kinds)) {
      const validator = validatorFor(entry.kind);
      expect(validator, `${key} names an unknown data kind "${entry.kind}"`).toBeDefined();
      const data = fillDiagramDefaults(entry.kind, entry.example);
      const violations = validator!(data);
      expect(violations, `${key}'s example: ${JSON.stringify(violations)}`).toEqual([]);
    }
  });

  it('names venn, flow, graph, gantt and draw as their OWN kinds, not a chart.type', async () => {
    // This is the exact confusion the feedback report hit: a venn built as { type: "venn" }
    // inside a chart block. Assert the model text says so and the kind map proves it.
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    expect(topic.model).toMatch(/venn, flow, graph, gantt and draw are each their OWN block kind, not a chart\.type/);
    for (const key of ['venn', 'flow', 'graph', 'gantt', 'draw']) {
      expect(topic.kinds[key].kind).toBe(key);
      expect(topic.kinds[key].example.type).toBeUndefined();
    }
  });

  it('covers sankey, treemap and sunburst, each with shape rules beyond a plain chart', async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    expect(topic.kinds.sankey.example.links).toBeDefined();
    expect(topic.kinds.treemap.example.parents).toBeDefined();
    expect(topic.kinds.sunburst.example.sunburst).toBe(true);
    expect(topic.kinds.sunburst.example.parents).toBeDefined(); // sunburst is a treemap + a flag
  });

  it("the chart.type list in the topic equals the validator's own CHART_TYPES", async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    for (const t of CHART_TYPES) {
      expect(topic.kinds.chart.rules.join(' '), t).toMatch(new RegExp(`\\b${t}\\b`));
    }
    // and the stated list is exactly CHART_TYPES, not a stale subset or superset
    const stated = /type must be one of ([a-z|]+)/.exec(topic.kinds.chart.rules[0])![1]!.split('|');
    expect(stated).toEqual(CHART_TYPES);
  });

  it('carries the four prose kinds with one example each, and no shape rules', async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    for (const key of ['text', 'bullets', 'stats', 'quote']) {
      expect(topic.prose[key].example, key).toBeDefined();
      expect(topic.prose[key].rules, key).toBeUndefined();
    }
  });

  it('states run_batch stops at the first failure with earlier calls already landed', async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    expect(topic.model).toMatch(/a refusal STOPS the batch right there/);
    expect(topic.model).toMatch(/every call before it already landed/);
  });

  it('stays under an 8 KB budget', async () => {
    const h = harness();
    const topic = await h.json('origami_guide', { topic: 'blocks' });
    const bytes = Buffer.byteLength(JSON.stringify(topic), 'utf8');
    expect(bytes, `topic:"blocks" is ${bytes} bytes`).toBeLessThanOrEqual(8_192);
  });

  it('origami_guide() with no topic lists "blocks" among the topics, and QUICKSTART points at it', async () => {
    const h = harness();
    const dflt = await h.json('origami_guide');
    expect(dflt.topics.blocks).toMatch(/block model/);
    // dflt.kinds/knownIssues etc. stay as they are — blocks is topic-only, not inlined
    expect(dflt.kinds).toBeDefined();
    expect(dflt.blocks).toBeUndefined();

    const quickstart = await h.json('origami_guide', { topic: 'quickstart' });
    expect(quickstart.blocks).toMatch(/origami_guide\(\{topic:"blocks"\}\)/);
  });

  it('an unknown topic still lists "blocks" as an available one', async () => {
    const h = harness();
    const bad = await h.call('origami_guide', { topic: 'nonsense' });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0]!.text).availableTopics).toContain('blocks');
  });
});
