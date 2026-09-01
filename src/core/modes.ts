/* The MODE framework — one shell, four configurations.
   ------------------------------------------------------------------------------------------
   docs/SITE.md gives origami.gratis four tool pages. /folio/ is the whole app: a landing, a
   replay, every tool. /draw/, /charts/ and /gantt/ are the SAME shell scoped to one block —
   the canvas is the landing, one seeded fold is created on load, and the registry holds the
   eight common tools plus that block's own.

   A mode is DATA, not a fork. It names the tag in the header, the storage namespace, the
   document to seed, the block kinds its tools address, the exact tool list to register and
   the console grouping. src/app/shell.ts reads it; nothing else in the app branches on a
   page name. Adding a fifth tool page is one entry here plus one build row. */

import { dataFigure, findStarter } from './fold-starters.js';

/** The seeded chart a /charts/ page opens with. Deliberately NOT a FOLD_STARTERS entry: the
    Folio starter catalog is a shipped surface (list_starters, the guide, its own tests), and a
    page's own seed is not a reason to change what /folio/ advertises. */
const CHART_STARTER = {
  type: 'bar',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [{ name: 'Revenue', color: '#4A8CC4', values: [12, 19, 15, 24] }],
  yMax: null,
  title: 'Example chart',
};

const chartFoldInner = (): string => `
  <div class="slide-inner">
    <p class="eyebrow anim" style="--i:0">Chart</p>
    <h2 class="anim" style="--i:1">Example chart</h2>
    ${dataFigure('chart', 'o-chartfig', 'o-chart', CHART_STARTER, 'Example chart')}
  </div>
`;

/** The document a mini page auto-creates when there is no unsaved work to resume. */
export interface ModeDoc {
  /** Deck title; the suggested filename is slugified from it, exactly as create_deck does. */
  deckTitle: string;
  /** Sidebar label of the single fold. */
  label: string;
  /** The fold's inner markup — a free card holding one seeded block. */
  inner: () => string;
}

export interface ToolMode {
  key: 'folio' | 'draw' | 'charts' | 'gantt';
  /** The subbrand tag beside the wordmark, and the <title> stem. */
  tag: string;
  /** One line for the scoped guide: what this page is. */
  lede: string;
  /** false on a mini page: no landing, no replay, no Sample Fold, no resume card. */
  landing: boolean;
  /** localStorage + OPFS namespace. Folio keeps '' so its historical keys are untouched. */
  storageNs: string;
  /** Mini pages only. */
  doc?: ModeDoc;
  /** Mini pages only: the data-block kinds this page's tools address (first = the seed's). */
  blockKinds?: readonly string[];
  /** Mini pages only: exactly the tools to register, in the order the console lists them.
      undefined = the whole Folio tool set. */
  tools?: readonly string[];
  /** Mini pages only: the console's group headings. */
  consoleGroups?: ReadonlyArray<readonly [string, readonly string[]]>;
}

/** The eight tools every page carries (docs/SITE.md, "Mini tools"). */
export const COMMON_TOOLS = [
  'origami_guide',
  'read_chunk',
  'write_chunk',
  'inspect_render',
  'undo',
  'save_deck',
  'export_deck',
  'list_activity',
] as const;

export const DRAW_TOOLS = ['list_elements', 'add_element', 'update_element', 'remove_element', 'set_caption'] as const;
export const CHART_TOOLS = ['get_data', 'set_chart', 'set_venn', 'set_caption'] as const;
export const GANTT_TOOLS = ['get_roadmap', 'set_roadmap', 'set_caption'] as const;

/** The console groups a mini page uses: its own block first (that is the page's point), then
    the three common headings the Folio console already uses, so the vocabulary never forks. */
const miniGroups = (heading: string, own: readonly string[]): ReadonlyArray<readonly [string, readonly string[]]> => [
  [heading, own],
  ['Learn', ['origami_guide', 'read_chunk', 'inspect_render', 'list_activity']],
  ['Author', ['write_chunk', 'undo']],
  ['File', ['save_deck', 'export_deck']],
];

export const FOLIO_MODE: ToolMode = {
  key: 'folio',
  tag: 'Folio Web',
  lede: 'Origami Folio Web — the whole editor, in this tab.',
  landing: true,
  storageNs: '',
};

export const DRAW_MODE: ToolMode = {
  key: 'draw',
  tag: 'Draw',
  lede: 'Origami Draw — ONE hand-drawn sketch, in this tab.',
  landing: false,
  storageNs: 'draw',
  doc: { deckTitle: 'Untitled drawing', label: 'Drawing', inner: () => findStarter('drawing')!.inner() },
  blockKinds: ['draw'],
  tools: [...COMMON_TOOLS, ...DRAW_TOOLS],
  consoleGroups: miniGroups('Drawing', DRAW_TOOLS),
};

export const CHARTS_MODE: ToolMode = {
  key: 'charts',
  tag: 'Charts',
  lede: 'Origami Charts — ONE chart or Venn diagram, in this tab.',
  landing: false,
  storageNs: 'charts',
  doc: { deckTitle: 'Untitled chart', label: 'Chart', inner: chartFoldInner },
  // chart FIRST: it is what the page seeds, and set_venn swaps the figure to the second kind.
  blockKinds: ['chart', 'venn'],
  tools: [...COMMON_TOOLS, ...CHART_TOOLS],
  consoleGroups: miniGroups('Chart', CHART_TOOLS),
};

export const GANTT_MODE: ToolMode = {
  key: 'gantt',
  tag: 'Gantt',
  lede: 'Origami Gantt — ONE roadmap on a real calendar, in this tab.',
  landing: false,
  storageNs: 'gantt',
  doc: { deckTitle: 'Untitled roadmap', label: 'Roadmap', inner: () => findStarter('roadmap')!.inner() },
  blockKinds: ['gantt'],
  tools: [...COMMON_TOOLS, ...GANTT_TOOLS],
  consoleGroups: miniGroups('Roadmap', GANTT_TOOLS),
};

export const MODES: Record<ToolMode['key'], ToolMode> = {
  folio: FOLIO_MODE,
  draw: DRAW_MODE,
  charts: CHARTS_MODE,
  gantt: GANTT_MODE,
};

/** The three mini modes, in the order the site lists them. */
export const MINI_MODES: readonly ToolMode[] = [DRAW_MODE, CHARTS_MODE, GANTT_MODE];
