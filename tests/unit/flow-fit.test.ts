import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

/* vitest.config.ts runs this suite in the 'node' environment — no DOM, and jsdom is not a
   dependency of this repo. The vendored diagram layout (vendor/runtime-dist/index.js,
   renderFlow) needs SOMETHING implementing createElementNS/appendChild/setAttribute to build
   its SVG tree, but never reads back layout (no getComputedStyle/getBBox/offsetWidth in its
   own body — checked by hand) — it is pure geometry math wearing a DOM API. FakeEl below is
   the smallest shim that satisfies that surface, so this test drives the REAL vendored layout
   function, not a reimplementation of it. */
class FakeEl {
  tagName: string;
  private attrs = new Map<string, string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string): string | null {
    return this.attrs.has(k) ? this.attrs.get(k)! : null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  appendChild(c: FakeEl) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  addEventListener() {}
  removeEventListener() {}
  closest() {
    return null;
  }
  querySelector(sel: string): FakeEl | null {
    const m = /\[data-([a-z-]+)-mount\]/.exec(sel);
    if (!m) return null;
    const want = `data-${m[1]}-mount`;
    const walk = (el: FakeEl): FakeEl | null => {
      if (el.hasAttribute(want)) return el;
      for (const c of el.children) {
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    return walk(this);
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
  set textContent(_v: string) {
    this.children = [];
  }
}

(globalThis as any).document = {
  createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
  createElement: (tag: string) => new FakeEl(tag),
};

const runtimeIndex = fileURLToPath(new URL('../../vendor/runtime-dist/index.js', import.meta.url));

function buildFlowSlide(): FakeEl {
  const slide = new FakeEl('div');
  const figure = new FakeEl('figure');
  const mount = new FakeEl('div');
  mount.setAttribute('data-flow-mount', '');
  figure.appendChild(mount);
  slide.appendChild(figure);
  return slide;
}

describe('the vendored flow layout fits a one-row flowchart', () => {
  it('a 4-node single-row flow gets a viewBox well under the 660 fixed-height era', async () => {
    const { renderFlow } = await import(runtimeIndex);
    const slide = buildFlowSlide();
    renderFlow(slide, {
      nodes: [
        { id: 'plan', label: 'Plan', shape: 'pill', tone: '' },
        { id: 'build', label: 'Build', shape: 'box', tone: '' },
        { id: 'review', label: 'Review', shape: 'diamond', tone: 'amber' },
        { id: 'ship', label: 'Ship', shape: 'pill', tone: 'green' },
      ],
      edges: [
        { from: 'plan', to: 'build', label: '' },
        { from: 'build', to: 'review', label: '' },
        { from: 'review', to: 'ship', label: 'approved' },
        { from: 'review', to: 'build', label: 'needs work' },
      ],
    });

    const mount = slide.children[0]!.children[0]!;
    const svg = mount.children.find((c) => c.tagName === 'SVG');
    expect(svg, 'renderFlow must mount an <svg> on the figure').toBeDefined();
    const viewBox = svg!.getAttribute('viewBox');
    expect(viewBox).toMatch(/^0 0 \d+ \d+$/);
    const height = Number(viewBox!.split(' ')[3]);
    // MEASURED: this shim's run of the vendored runtime returns "0 0 1200 221" for this flow —
    // asserted with headroom (< 330, half the old fixed 660) rather than pinned to 221, so a
    // future content-fit tweak does not break this test for staying content-fit.
    expect(height, `viewBox was "${viewBox}"`).toBeLessThan(330);
  });
});
