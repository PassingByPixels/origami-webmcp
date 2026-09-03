import type { DeckModel } from '../../vendor/format-dist/index.js';

/* Layout diagnostics for an agent that cannot see the page.
   ------------------------------------------------------------------------------------------
   Everything here is arithmetic over numbers someone else MEASURED. This file never guesses a
   height, and the tool never reports one it was not given: a fold the page could not measure
   comes back `measured: false` with the reason, not with a plausible number. That split is the
   whole point — a made-up 480px is worse than "I could not measure this fold", because the
   agent cannot tell the two apart.

   The measuring itself is the page's job (src/app/measure.ts) because it needs a real browser
   layout. In a unit test, or any host with no DOM, no measurement function is injected at all
   and inspect_render says so. */

/** One fold's rendered geometry, in CSS pixels, as measured in a real browser layout. */
export interface FoldGeometry {
  id: string;
  /** False when the page could not put this fold on screen (hidden fold, no tab to activate). */
  measured: boolean;
  /** Why it could not be measured. Present only when measured === false. */
  reason?: string;
  /** Top of the fold's first rendered content box, relative to the viewport. */
  contentTop: number;
  /** Height of the fold's rendered content. */
  contentHeight: number;
  /** Bottom edge of the deck masthead (header.o-top), which overlays the stage. 0 = no masthead. */
  mastheadBottom: number;
  /** Element children of the fold's content root. */
  blockCount: number;
  /** Leaf elements that actually painted a box. 0 = the fold rendered nothing visible. */
  paintedLeaves: number;
  /** Length of the fold's rendered text, whitespace collapsed. */
  textLength: number;
  /** Bounding boxes of the <text> nodes inside this fold's SVG blocks (venn, flow, graph, chart). */
  labels: Array<{ text: string; x: number; y: number; w: number; h: number }>;
}

export interface MeasureResult {
  viewport: { width: number; height: number };
  folds: FoldGeometry[];
  /** Present when the measuring budget ran out before every requested fold was reached: what
      DID get measured is in `folds`, the rest are measured:false with the budget as the reason. */
  partial?: { measuredCount: number; requested: number; budgetMs: number };
}

/**
 * The headline of an inspect_render answer, and the ONE rule that decides it: `clean` means
 * "every fold in the deck was measured and none of them has a defect" — nothing less. A
 * measurement that failed, ran out of budget, or covered a subset is `unknown`, never clean;
 * this is the summary a less careful agent acts on, so it must never say the opposite of
 * the per-fold facts under it (an agent shipped on a `clean: true` over a 0x0 viewport once).
 */
export interface Verdict {
  /** clean = every fold in `requested` measured and no warning · defects = at least one warning
      on a measured fold · unknown = a requested fold could not be measured (or none was). */
  outcome: 'clean' | 'defects' | 'unknown';
  /** True ONLY when outcome is clean AND every fold of the deck was requested. */
  clean: boolean;
  coverage: { total: number; requested: number; measured: number };
  /** The folds still to measure — pass them straight back as foldIds. Absent when none. */
  remeasure?: string[];
}

export function summarise(folds: Array<{ id: string; measured?: boolean; skipped?: boolean }>, warnings: InspectWarning[]): Verdict {
  const requested = folds.filter((f) => !f.skipped);
  const measured = requested.filter((f) => f.measured === true);
  const unmeasured = requested.filter((f) => f.measured !== true).map((f) => f.id);
  const outcome: Verdict['outcome'] = unmeasured.length > 0 || requested.length === 0 ? 'unknown' : warnings.length > 0 ? 'defects' : 'clean';
  const out: Verdict = {
    outcome,
    clean: outcome === 'clean' && requested.length === folds.length,
    coverage: { total: folds.length, requested: requested.length, measured: measured.length },
  };
  if (unmeasured.length > 0) out.remeasure = unmeasured;
  return out;
}

/** Injected by the page. Absent === this host cannot measure a render at all. */
export type MeasureFn = (deckText: string, ids: string[], viewport?: { width?: number; height?: number }) => Promise<MeasureResult>;

export interface InspectWarning {
  fold: string;
  label: string;
  issue: 'overflow' | 'masthead-clip' | 'empty-fold' | 'label-collision';
  detail: string;
}

/** Sub-pixel noise: a browser returns fractional heights, and a 1px difference is not a defect. */
const TOL = 2;

/* Two labels collide when their boxes share real area. A HAIRLINE is not a collision: the
   browser's box for a <text> carries the font's ascent/descent, so two lines a chart stacks on
   purpose (a treemap cell's name over its value, 12 units apart at a 10-unit font) report a
   1px-tall sliver across their full width — 20-30px² on a real render — and that read as six
   "collisions" on a chart with nothing wrong. Under TOL in either direction is touching, not
   overlapping. */
const overlap = (a: FoldGeometry['labels'][number], b: FoldGeometry['labels'][number]): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > TOL && h > TOL ? Math.round(w * h) : 0;
};

/**
 * Turn measured geometry into facts and warnings. Pure: same numbers in, same verdict out, so
 * the rules are unit-testable without a browser and the browser test only has to prove that the
 * numbers reaching this function are real.
 */
export function analyseRender(model: DeckModel, m: MeasureResult): { folds: unknown[]; warnings: InspectWarning[] } {
  const byId = new Map(m.folds.map((f) => [f.id, f]));
  const warnings: InspectWarning[] = [];
  const folds: unknown[] = [];

  for (const id of model.order) {
    const slide = model.slides.get(id)!;
    const g = byId.get(id);
    const head = { id, kind: slide.kind, label: slide.label, hidden: slide.hidden };

    if (!g || !g.measured) {
      folds.push({ ...head, measured: false, why: g?.reason ?? 'the page returned no geometry for this fold' });
      continue;
    }

    const available = m.viewport.height;
    const overflowBy = Math.round(g.contentHeight - available);
    const clippedBy = Math.round(g.mastheadBottom - g.contentTop);
    /* Nothing painted. Report THAT and stop: with no ink there is no contentTop to speak of, so
       the fallback (the section's own top, 0) is otherwise reported as "clipped by the masthead"
       — a measured empty flow block did exactly that, and an agent sent to fix a phantom clip
       would never find the real fault, which is that its data block describes nothing. */
    const blank = g.paintedLeaves === 0 || g.blockCount === 0;

    folds.push({
      ...head,
      measured: true,
      contentHeight: Math.round(g.contentHeight),
      availableHeight: Math.round(available),
      contentTop: Math.round(g.contentTop),
      mastheadBottom: Math.round(g.mastheadBottom),
      blocks: g.blockCount,
      svgLabels: g.labels.length,
      rendersAnything: !blank,
      fits: overflowBy <= TOL,
    });

    if (blank) {
      warnings.push({
        fold: id,
        label: slide.label,
        issue: 'empty-fold',
        detail: `nothing rendered: ${g.blockCount} block(s), ${g.paintedLeaves} painted element(s), ${g.textLength} characters of visible text. A data block that parses but describes nothing (an empty nodes/sets array), or an empty .slide-inner, renders as a blank fold.`,
      });
      continue; // every other measurement on a blank fold is meaningless
    }

    if (overflowBy > TOL) {
      warnings.push({
        fold: id,
        label: slide.label,
        issue: 'overflow',
        detail: `content is ${Math.round(g.contentHeight)}px tall but only ${Math.round(available)}px is on screen — the bottom ${overflowBy}px is below the fold. Split it across two folds, or cut copy.`,
      });
    }

    if (clippedBy > TOL) {
      warnings.push({
        fold: id,
        label: slide.label,
        issue: 'masthead-clip',
        detail: `this fold's content starts at ${Math.round(g.contentTop)}px but the deck masthead covers the top ${Math.round(g.mastheadBottom)}px — the first ${clippedBy}px is hidden behind it. See knownIssues.flowKindMastheadClip in origami_guide.`,
      });
    }

    for (let i = 0; i < g.labels.length; i++) {
      for (let j = i + 1; j < g.labels.length; j++) {
        const area = overlap(g.labels[i]!, g.labels[j]!);
        if (area > 0) {
          warnings.push({
            fold: id,
            label: slide.label,
            issue: 'label-collision',
            detail: `the diagram labels "${g.labels[i]!.text}" and "${g.labels[j]!.text}" overlap by ${area}px². Shorten one, or move it with the block's own x/y placement.`,
          });
        }
      }
    }
  }

  return { folds, warnings };
}

/** What inspect_render answers on a host with no measurement route at all. Facts only. */
export function unmeasurable(model: DeckModel, why: string): Record<string, unknown> {
  return {
    measured: false,
    outcome: 'unknown',
    clean: false,
    why,
    viewport: null,
    folds: model.order.map((id) => {
      const s = model.slides.get(id)!;
      return { id, kind: s.kind, label: s.label, hidden: s.hidden, measured: false };
    }),
    warnings: [],
    note: 'NO geometry was measured, so no layout claim is made either way: outcome is "unknown", not clean. An absent warning here does NOT mean the deck lays out correctly.',
  };
}
