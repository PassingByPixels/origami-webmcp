import { describe, expect, it } from 'vitest';
import { DEMO_CALLS, DEMO_FOLDS, DEMO_ONBOARDING, bindRefs, learnRefs } from '../../src/app/demo-script.js';
import { harness } from './harness.js';

/**
 * The recorded run, played through the REAL tool registry.
 *
 * Two things drive this list — the landing's replay button and `npm run demo` — and only the
 * first is reachable from a test suite. The demo driver needs a headed Chrome with WebMCP on,
 * so the list it plays is checked here instead: every call must succeed against the same tools
 * the browser registers, and the deck it leaves behind must be one save_deck accepts.
 *
 * This is what catches a broken demo BEFORE someone runs the show in front of an audience.
 */
describe('the recorded demo run', () => {
  it('builds a six-fold Fold that save_deck validates, with the proposal accepted', async () => {
    const h = harness();
    const refs: Record<string, string> = {};
    const bodies: Record<string, any> = {};

    for (const step of [...DEMO_ONBOARDING, ...DEMO_CALLS]) {
      const res = await h.call(step.tool, bindRefs(step.args, refs));
      const body = JSON.parse(res.content[0]!.text);
      expect(res.isError, `${step.tool} (${step.note}) failed: ${JSON.stringify(body).slice(0, 300)}`).not.toBe(true);
      learnRefs(step.tool, body, refs);
      bodies[step.tool] = body;
    }

    // the ids the list could not know are the ones the run minted
    expect(refs['@cover']).toMatch(/^\w+$/);
    expect(refs['@proposal']).toMatch(/^\w+$/);

    // six folds, in the order the demo claims, and no proposal left hanging
    expect(bodies.list_chunks.chunks).toHaveLength(DEMO_FOLDS);
    expect(DEMO_FOLDS).toBe(6);
    expect(bodies.list_chunks.chunks.map((c: any) => c.kind)).toEqual(['free', 'venn', 'draw', 'free', 'free', 'document']);
    expect(h.proposals.count()).toBe(0);

    // the review loop LANDED — the accepted wording, not the proposed-against one
    const exported = await h.json('export_deck');
    expect(exported.text).toContain('Nothing was uploaded. No server saw it.');
    expect(exported.text).not.toContain('Nothing was uploaded and no server saw it.');

    // and the file the demo writes is a valid Fold, not just a rendered one
    const saved = await h.json('save_deck');
    expect(saved.validated, JSON.stringify(saved.violations)).toBe(true);
  });

  it('never ends on a save, so pressing play cannot start a download', () => {
    expect(DEMO_CALLS[0]!.tool).toBe('create_deck');
    expect(DEMO_CALLS.map((c) => c.tool)).not.toContain('save_deck');
  });

  it('charts call counts it actually makes', () => {
    /* The chart fold is authored from numbers counted off this very list. If the list changes
       and the count does not, the fold would state a cost the run never paid. */
    const chart = DEMO_CALLS.find((c) => c.args.label === 'What it cost')!;
    const values = /"values":\[([0-9,]+)\]/.exec(String(chart.args.html))![1]!.split(',').map(Number);
    const before = DEMO_CALLS.slice(0, DEMO_CALLS.indexOf(chart));
    expect(values).toEqual([
      before.filter((c) => c.tool === 'set_header' || c.tool === 'write_chunk').length,
      before.filter((c) => c.args.label === 'Where it lands').length,
      before.filter((c) => c.args.label === 'The pitch, sketched').length,
      before.filter((c) => c.args.label === 'Who does what').length,
      before.filter((c) => c.tool.startsWith('propose_') || c.tool === 'list_proposals' || c.tool === 'accept_proposal').length,
    ]);
    expect(values.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
