/* The PAGE-SCOPED guide.
   ------------------------------------------------------------------------------------------
   /folio/'s origami_guide is the whole Origami contract: every kind schema, the recipe cards,
   the starter catalog, the whole Folio tool catalog. On a mini page most of that is noise — there is one
   fold, one block, and eleven-to-thirteen tools — and an agent that reads 56 KB to move a
   rectangle has paid for a library it cannot use.

   So each mini page answers with a SMALL guide: what this page is, the ONE block's schemaComment
   verbatim from the format library, its own tool catalog, and a notAvailableHere that sends
   multi-fold work to /folio/ by name. Nothing is invented here: the schema is the format's own,
   and the tool list is the mode's own, so neither can drift from what is registered. */

import { FORMAT_VERSION, KINDS, kindSchemaComment } from '../../vendor/format-dist/index.js';
import { blockNames } from './block-tools.js';
import type { ToolMode } from './modes.js';
import type { ToolDef } from './registry.js';
import { ok } from './result.js';

/** One line per tool. Every name a mode can register MUST have an entry: the catalog is the API
    description an agent reads first, and a tool missing from it is a tool it never calls. */
const BLURBS: Record<string, string> = {
  origami_guide: 'This — what this page is, the block\'s markup contract, and the tools it has.',
  read_chunk: 'Read the fold to edit it by hand (payload + schema + the slide <template>).',
  write_chunk: 'The RAW escape hatch: apply an edited <template> to the fold. Prefer the typed tools below — they build the figure for you and check it against the block schema.',
  inspect_render: 'Lay the fold out off-screen and report its geometry and layout defects (overflow, masthead clip, an EMPTY figure, colliding labels). The only way to SEE the page from here.',
  undo: 'Reverse the last change to this fold (one tool call = one step; no redo).',
  save_deck: 'Write the file if the page holds a writable handle; otherwise keep the working copy in the browser and report that the human must press Save.',
  export_deck: 'Hand YOURSELF the whole .origami.html text. It saves nothing.',
  list_activity: 'The feed: what has been done in this tab, newest first, whoever did it.',

  list_elements: 'Every element in the drawing with its id, type, geometry and style. Read this before you touch anything.',
  add_element: 'Add one element. id and seed are minted when absent; the draw schema checks the rest.',
  update_element: 'Patch one element by id. An unknown id is refused, never created.',
  remove_element: 'Remove one element by id.',

  get_data: 'The figure as it stands: chart or venn, its whole JSON, its caption.',
  set_chart: 'Replace the figure with a chart, schema-checked. Swaps a venn back to a chart.',
  set_venn: 'Replace the figure with a Venn diagram, schema-checked. Swaps the figure kind.',

  get_roadmap: 'The roadmap JSON as it stands, plus its caption.',
  set_roadmap: 'Replace the whole roadmap, schema-checked.',

  set_caption: 'Set the caption under the figure. Text only; the block data is untouched.',
};

/** Tools that exist on /folio/ and NOT here, each with what it was for. Naming them is the
    point of the section: an agent that asks for one gets told where it lives. */
const ELSEWHERE: Record<string, string> = {
  create_deck: 'Absent: this page HAS a document — the one on screen, created when you arrived. Press New for a fresh one.',
  list_chunks: 'Absent: there is one fold. read_chunk and the block tools already name it.',
  add_chunk: 'Absent: a second fold would be a deck, and a deck is what /folio/ is for.',
  add_custom_fold: 'Absent: same reason as add_chunk.',
  move_chunk: 'Absent: one fold has no order to change.',
  delete_chunk: 'Absent: deleting the only fold would leave an empty document.',
  set_deck_meta: 'Absent: the deck title and theme belong to a document with more than one page — /folio/ carries them.',
  set_header: 'Absent: the masthead is deck chrome; /folio/ carries it.',
  set_fold_type: 'Absent: one fold reads the same either way.',
  define_block: 'Absent (with list_block_defs and delete_block): composite block definitions are a deck-wide registry — /folio/ carries them.',
  propose_chunk: 'Absent (with propose_add, propose_delete, list_proposals, accept_proposal, reject_proposal): the review queue is for work a human should approve before it lands, which is a deck workflow — /folio/ carries it.',
  list_starters: 'Absent: a starter is a whole extra fold. This page is seeded with the one it needs.',
  get_kind_schema: 'Absent: the one schema this page uses is in `block.schema` above, verbatim.',
};

/** The small guide for one mini page. `tools` is the mode's own list, so the catalog and the
    registry are literally the same array. */
export function pageGuide(mode: ToolMode): Record<string, unknown> {
  const names = mode.tools ?? [];
  const blocks = blockNames(mode);
  const primary = blocks[0]!;
  return {
    page: mode.lede,
    formatVersion: FORMAT_VERSION,
    host:
      'A scoped Origami Folio page. ONE Fold is open in this tab and it holds ONE fold carrying ONE ' +
      `${primary.name.toLowerCase()} block. Every tool here acts on it. Changes are applied in memory and re-rendered live; ` +
      'finish with save_deck, which writes the real file when the page holds a writable handle and otherwise keeps the ' +
      'working copy in the browser and says the human must press Save.',
    whatIsOrigami:
      'An Origami "Fold" is a single self-contained .origami.html file — a document a browser plays on double-click, ' +
      'carrying its own renderer inline. Recipients need nothing installed.',
    block: {
      kind: primary.kind,
      name: primary.name,
      // VERBATIM from the format library, so this can never drift from what the validator enforces.
      schema: kindSchemaComment(primary.kind),
      ...(blocks.length > 1
        ? {
            alsoOnThisPage: blocks.slice(1).map((b) => ({ kind: b.kind, name: b.name, schema: kindSchemaComment(b.kind) })),
          }
        : {}),
    },
    editProtocol: [
      'The document already exists — you never create one. Read the block, change it, save.',
      `1. Read it: ${names.includes('list_elements') ? 'list_elements()' : names.includes('get_data') ? 'get_data()' : 'get_roadmap()'}.`,
      '2. Change it with the typed tools below. Each one validates against the block schema above and refuses with the violation named rather than applying half of it.',
      '3. write_chunk is the escape hatch for anything the typed tools do not reach (a heading, a second block, raw markup). read_chunk gives you the <template> to edit.',
      '4. inspect_render before you finish: a data block that parses but describes nothing renders as a completely blank figure, and no validator catches that.',
      '5. save_deck() — end on it. READ THE RESULT; only saved:true means bytes reached the human\'s disk.',
    ],
    inertRules:
      'Inert-by-default. The block is carried as <script type="application/json" data-odata="' +
      `${primary.kind}"> and every "<" inside it is escaped as \\u003c. The typed tools below do that for you; ` +
      'if you write the figure yourself with write_chunk, you must.',
    tools: Object.fromEntries(names.map((n) => [n, BLURBS[n] ?? '(no description registered)'])),
    notAvailableHere: {
      why: `This page is Origami Folio scoped to one ${primary.name.toLowerCase()}. The multi-fold tools are not missing — they are on /folio/, the full editor, which opens the same .origami.html file this page saves.`,
      openTheFullEditor: 'Save this Fold, then open it at /folio/ (the Open button, or drop the file on the page). Everything below is registered there.',
      ...ELSEWHERE,
    },
  };
}

/** The mini page's origami_guide — same name, same START HERE role, a fraction of the payload. */
export function pageGuideTool(mode: ToolMode): ToolDef {
  return {
    name: 'origami_guide',
    annotations: { readOnlyHint: true },
    description:
      `START HERE. Everything this page can do, in one call: what it is, the markup contract for the one block it edits ` +
      `(the format library's own schema, verbatim), the protocol, and the tool catalog. It is deliberately SMALL — this is ` +
      `not the whole Origami contract, because this page is not the whole editor. It also names the tools that exist on ` +
      `/folio/ and not here, and how to get there. An agent with no prior knowledge of Origami should call this once on connect.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ok(pageGuide(mode)),
  };
}

/** Every kind key the guide quotes must be a real one — a typo in a mode config would otherwise
    ship a guide whose `schema` reads "(no schema registered for this kind)". */
export const guideKindsAreReal = (mode: ToolMode): boolean => (mode.blockKinds ?? []).every((k) => k in KINDS);
