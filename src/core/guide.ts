import { FORMAT_BLOCKS, FORMAT_VERSION, KINDS } from '../../vendor/format-dist/index.js';
import { starterCatalog } from './fold-starters.js';
import { recipeCatalog } from './recipes.js';

/**
 * The whole Origami contract, assembled from the live constants (KINDS, FORMAT_VERSION) so it
 * can never drift from what the validator enforces. Returned by the origami_guide tool — an
 * agent that has never seen Origami self-onboards from this.
 *
 * Ported from vendor/mcp-reference/server.ts. Prose is verbatim EXCEPT where the stdio reality
 * (a file path handle, served folders, atomic writes) does not exist in a page. Those lines are
 * marked below and listed in README "Deviations from the stdio server".
 */
/* Which kinds are WHOLE FOLDS and which are blocks that sit on one, read off the format
   library's own registry rather than a list kept here. Every data-carrying kind declares
   placement 'block' ("an in-slide block, any number on any slide"), and its schemaComment says
   the same thing in prose — "a Flowchart fold is a free card holding one". The steer below is
   that recommendation made actionable, and it cannot drift: a kind added upstream picks up the
   right advice with no edit here. */
const PLACEMENT = new Map(FORMAT_BLOCKS.map((b) => [b.key as string, b.data?.placement]));

const placementOf = (key: string): string => (PLACEMENT.get(key) === 'block' ? 'in-slide block' : 'whole fold');

/* The one thing an agent cannot read off a flow/graph schema: `tone` and edge `label` are
   REQUIRED, with "" as their blank. Both cold-agent trials wrote a diagram without them and ate
   a refusal. add_fold and set_block now fill them, so this line says where that stops. */
const DIAGRAM_BLANKS =
  ' REQUIRED-BUT-BLANK: every node needs `tone` and every edge needs `label`, and "" is the legal blank for both — a node with no tone is refused, not defaulted. add_fold and set_block fill them for you; write_chunk and the propose_* tools do not, so put them in the JSON yourself there.';

const howToAdd = (key: string): string =>
  PLACEMENT.get(key) === 'block'
    ? `IN-SLIDE BLOCK, not a slide kind — any number of these may sit on any fold. PREFER a FREE CARD holding one: add_chunk({ kind: "free", html: '<div class="slide-inner"><p class="eyebrow">Section</p><h2>A title</h2>' + <the ${key} figure> + '</div>' }). That is what this kind's own schema recommends, and it gives the block a heading and room for a second block beside it. add_chunk({ kind: "${key}", html: <the figure> }) is also valid and is what the stdio server does, but it makes a fold whose entire body is one untitled figure.`
    : "A WHOLE FOLD: add_chunk({ kind, html }) with the fold's inner markup.";

/** howToAdd plus the diagram blanks, for the two kinds that have them. */
const howToAddFull = (key: string): string => howToAdd(key) + (key === 'flow' || key === 'graph' ? DIAGRAM_BLANKS : '');

/* The same advice howToAdd gives PER KIND, said ONCE. In the default answer the kind entries
   are an index (name + placement) and this carries the steer for both placements, so an agent
   reads it one time instead of paying for the same paragraph on every block kind. The per-kind
   wording is unchanged and still ships with origami_guide({topic:"kinds"}). */
const KINDS_HOW_TO = {
  index:
    'The `kinds` map above is an INDEX: every kind this Fold format knows, with its display name and its placement. It tells you WHAT exists; it deliberately does not carry the markup schemas.',
  schemas:
    'For the markup contract of a kind — what structure and attributes are valid — call get_kind_schema(kind) (or origami_guide({kind})) for one, or origami_guide({topic:"kinds"}) for every kind at once with its schema and its own how-to-add line. Fetch the two or three you are about to use; do not fetch all of them.',
  placementWholeFold:
    'placement "whole fold": the kind IS a slide kind. add_chunk({ kind, html }) with the fold\'s inner markup.',
  placementInSlideBlock:
    'placement "in-slide block": the kind is NOT a slide kind — any number of these may sit on any fold. PREFER a FREE CARD holding one: add_chunk({ kind: "free", html: \'<div class="slide-inner"><p class="eyebrow">Section</p><h2>A title</h2>\' + <the figure> + \'</div>\' }). That is what each of those kinds\' own schema recommends, and it gives the block a heading and room for a second block beside it. add_chunk({ kind: "<that kind>", html: <the figure> }) is also valid and is what the stdio server does, but it makes a fold whose entire body is one untitled figure.',
};

/** The sections `origami_guide({topic})` can return. Every byte of the full guide is
    reachable through exactly one of them, so the default answer can point instead of paste. */
export const GUIDE_TOPICS = ['quickstart', 'contract', 'kinds', 'recipes', 'starters', 'issues', 'tools'] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

/** The keys that make up the `contract` topic: the protocol prose an agent needs before it
    can act at all. Everything NOT listed here belongs to one of the other five topics. */
const CONTRACT_KEYS = [
  'formatVersion',
  'host',
  'whatIsOrigami',
  'foldTypes',
  'contentModel',
  'editProtocol',
  'reviewProtocol',
  'inertRules',
  'capabilities',
  'notAvailableHere',
] as const;

/**
 * THE FAST PATH, under 3 KB.
 *
 * The default guide is the whole contract, and an agent that reads it knows everything; it is
 * also 15 KB of reading before the first call, and two cold-agent trials spent their opening
 * turns on it and then still hand-assembled figure markup. This answer is the other shape: the
 * five calls that build a deck, and ONE complete add_fold example carrying a chart and a table,
 * so the block vocabulary is learned by copying rather than by reading a schema.
 *
 * It is deliberately INCOMPLETE, and the last key says so. A guide that pointed nowhere would
 * be a trap rather than a shortcut.
 */
const QUICKSTART = {
  topic: 'quickstart',
  theFastPath: [
    '1. create_deck({ title, subtitle?, eyebrow? }) - its FIRST fold is already a cover with that title. No placeholder to overwrite: do not add your own cover.',
    '2. add_fold({ title, eyebrow, blocks }) - ONE call a fold. add_ledger({ title, columns, rows, formulas, currency }) for a ledger. Wrap several in run_batch({calls:[...]}) and the deck is ONE turn.',
    '3. apply_theme({ name }) - a whole palette; list_themes names them. set_deck_meta({themeName}) renames the label only.',
    '4. inspect_render() - lays the deck out for real and names what OVERFLOWS, renders BLANK or is CLIPPED. You cannot see it.',
    '5. save_deck() - always end here, and READ it: it says whether bytes reached disk or the human must press Save.',
  ],
  blocks:
    'Each entry names EXACTLY ONE of: chart, venn, flow, graph, gantt, draw, table (that kind\u2019s own JSON + optional caption), or text (HTML: p, p.lede, h3, ul/li), bullets, stats (up to 4 { value, label }), quote ({ text, by }). Data is validated BEFORE anything lands - refused here, never at save.',
  /* The example is a compact JSON STRING, not a nested object. Tool results are serialized
     with JSON.stringify(..., null, 2), so a nested example is charged two spaces of
     indentation per level - it cost 2 KB of this 3 KB answer as an object and 700 bytes as
     a string. It is also what an agent copies: one line it can paste. */
  example: {
    call: 'add_fold',
    args:
      '{"title":"Revenue by quarter","eyebrow":"Q3 review","blocks":[{"text":"<p class=\\"lede\\">Revenue held; the cost of delivery did not.</p>"},{"stats":[{"value":"48","label":"Decks shipped"},{"value":"2.1%","label":"Churn"}]},{"chart":{"type":"bar","labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"Revenue","color":"#38628F","values":[12,19,15,24]}],"yMax":null},"caption":"EUR m"},{"table":{"columns":[{"label":"Line"},{"label":"Plan","align":"right"},{"label":"Actual","align":"right"},{"label":"Delta","align":"right"}],"rows":[["Engineering","120000","118400",""],["Total","","",""]],"formulas":{"D1":"=B1-C1","B2":"=SUM(B1:B1)","C2":"=SUM(C1:C1)","D2":"=SUM(D1:D1)"}},"caption":"Formulas are baked into values on the way in"}]}',
    returns:
      'chunkId, index, label, and the (kind, nth) address of every data block - what set_block({ chunkId, kind, nth, data }) takes, so a block is rewritten without a read.',
  },
  fiveThingsThatCatchAgents: [
    'A column `format` is an OBJECT - { "kind": "currency" } - not a string. add_ledger({currency:"€"}) sets the prefix; default "$".',
    'flow/graph: node `tone` and edge `label` are REQUIRED ("" is the blank). add_fold/set_block fill them; write_chunk does not.',
    'A bare flow/graph fold can clip under a masthead subtitle/chips bar. Use a free card; check inspect_render.',
    'Themes read 17 token names only (list_themes has them). "primary"/"background" are REFUSED, not stored.',
    'add_fold names the fold from its title, so tabs read as words; `label` overrides.',
  ],
  thisIsNotEverything:
    'The fast path, not the contract. origami_guide() with no topic is everything; get_kind_schema(kind) is one kind.',
};

const pointer = (what: string, count: number, topic: GuideTopic): string =>
  `${count} ${what} — omitted here to keep this answer small. Call origami_guide({ topic: "${topic}" }) for them in full.`;

function fullGuide(): Record<string, unknown> {
  return {
    formatVersion: FORMAT_VERSION,
    host: 'Origami Folio Web — the deck is open IN THIS BROWSER TAB. Changes are applied to the in-memory Fold and re-rendered live. Finish with save_deck: it writes the real file when the page holds a writable handle for it, and otherwise keeps the working copy in the browser and reports that the human must press Save.',
    whatIsOrigami:
      'An Origami "Fold" is a single self-contained .origami.html file — a deck or document a browser plays on double-click, and that you edit over this MCP. It carries its own renderer inline; recipients need nothing installed. Edits are made one chunk (slide) at a time through the read→edit→write protocol below.',
    foldTypes: {
      deck: 'The card-stage: one fold at a time with tabs/pips; presentable (the default; writes no key).',
      scroll: 'A continuous-reading document: every fold stacked top-to-bottom (pair with document-kind folds for a long-form report).',
      ledger: 'Reserved for data/calc folds.',
    },
    contentModel:
      'A Fold is an ordered list of chunks (slides), each with a kind. Inside a chunk, content is built from inert blocks (headings, text, tables, charts, etc.). Data-driven blocks carry a JSON data block: <script type="application/json" data-odata="KIND">…</script>.',
    // DEVIATION: the stdio protocol takes a deck PATH on every call. There is exactly one open
    // deck in a tab, so no tool takes a path.
    editProtocol: [
      'There is ONE open Fold in this tab and no path handle: every tool acts on it. Call create_deck first if nothing is open.',
      '1. list_chunks() — the table of contents (id, kind, label per chunk).',
      '2. read_chunk(chunkId) — a self-contained payload: deck context + the kind schema + the slide <template>.',
      '3. Edit the <template> inner. The slide id and kind are IMMUTABLE — drift is rejected, not repaired.',
      '4. write_chunk(chunkId, html) to apply, or add_chunk / add_custom_fold / delete_chunk. Each one changes the open Fold and re-renders it immediately.',
      '4b. Unsure a block will pass the content policy? Call write_chunk / add_chunk with dryRun:true first. It runs the WHOLE gate — coercion, table bake, content policy, capability arithmetic — and applies nothing, so you get the same verdict (or the same violations) without touching the human\'s deck.',
      '5. save_deck() — writes the file when the page holds a writable handle for it; otherwise it persists the working copy in the browser and tells you the human must press Save. Either way it re-validates, so end on it.',
    ],
    reviewProtocol:
      'propose_chunk / propose_add / propose_delete stage a change instead of applying it. A staged change can be resolved by EITHER a human (it renders as a card in the page with Accept / Reject buttons) OR by you calling accept_proposal / reject_proposal — so an unattended agent still runs end to end. Both routes apply through the same ops, with the same conflict gate and the same provenance stamp. Use the propose_* path when the change is a judgement call worth showing; use write_chunk / add_chunk / delete_chunk when you have been told to just do it.',
    inertRules: {
      summary:
        'Inert-by-default. The ONLY executable-looking construct allowed without flagging the deck "active" is a JSON data block: <script type="application/json" data-odata="KIND">…</script> (byte-exact opener). Escape "<" in the JSON as \\u003c so it can never terminate the block.',
      hard: [
        'No <template> tags inside slide content (they break the single-file structure).',
        'Balanced <script>/</script>.',
        'These are rejected at write time — nothing is applied.',
      ],
      active:
        'Any real <script>, <style>, <iframe>, <form>, <link>/<meta>/<base>, inline on* handler, javascript: URL, remote (//) src/href, @import, or non-image/non-font data: URI marks the deck ACTIVE. It still saves, but recipients open it behind a padlock until they trust the sender. Prefer inert constructs; use the data-block kinds instead of hand-rolled scripts.',
    },
    capabilities:
      'Embeds (video, dashboards) need a manifest capability "embed:<host>". write_chunk and add_chunk auto-grant it for recognised video blocks; otherwise the deck is flagged for the missing capability.',
    kinds: Object.fromEntries(
      Object.values(KINDS).map((k) => [
        k.key,
        {
          name: k.name,
          schema: k.schemaComment,
          placement: placementOf(k.key),
          howToAdd: howToAddFull(k.key),
        },
      ])
    ),
    knownIssues: {
      flowKindMastheadClip:
        `REPORTED as a Folio runtime bug (a flow-kind fold's figure riding up under the deck masthead) and RE-MEASURED after the 2026-09-02 runtime refresh, which changed the number. With a subtitle and chips set, the masthead (header.o-top) is 100px tall and OVERLAYS the stage. A BARE flow/graph-KIND fold — add_chunk({kind:"flow", html}) with no free-card wrapper, its whole body one untitled figure — now has its topmost PAINTED content measured at 90-97px across viewport heights 240-720 (720px view: 97px), a few px inside the 100px bar; the runtime's tighter content-fit layout removed the empty top padding that used to keep it clear. A flow/graph figure inside a FREE card (see kinds.flow.howToAdd — eyebrow + heading above the figure) still measured content starting at 116-185px, comfortably below the bar, at the same viewport heights. So the fix is the same one the free-card steer already gives, and it now actually matters: wrap a flow/graph figure in a free card rather than adding it as a bare flow/graph-kind fold on a deck with a subtitle or chips. inspect_render measures this on the real render and will say so if it changes again.`,
      dataBlocksAreGatedAtWriteTime:
        `FIXED, and the behaviour changed: every write path (add_chunk, add_custom_fold, write_chunk, the propose_* trio and accept_proposal) now runs the SAME per-kind validator save_deck runs, over every data block in the content. A block that is valid JSON but describes nothing — {"nodes":[],"edges":[]} on a flow, an empty sets array on a venn — is REFUSED at authoring time with the rule named (flow.nodes.count), not accepted and then rejected at save. Unparseable JSON in a data block is refused the same way. dryRun gives the identical verdict and applies nothing. What this gate does NOT catch is a fold that is blank for a layout reason rather than a data one (an empty .slide-inner) — inspect_render still reports that as empty-fold with the painted-element count, so call it before save_deck.`,
      studioTreeShakenCss:
        `A Fold saved by the Studio can have unused kind CSS stripped out of it, so a block you add to someone else's Fold may render unstyled even though it validates and saves. See recipes.styleCaveat. inspect_render measures geometry, not styling, and does not catch this.`,
    },
    starters: {
      howToUse:
        `Whole folds you can add in ONE call: add_chunk({ starter: "<key>" }). Each is a free card already holding one seeded data block, copied from the Studio palette's own rail buttons — so it is exactly the "free card holding the block" shape kinds.<k>.howToAdd steers you to, without you assembling the figure. Reach for a starter when a seeded example is a fine base and you will edit it; supply html yourself when the content matters more than the shape. Do not pass starter together with html or block — that is refused rather than silently resolved.`,
      folds: starterCatalog(),
    },
    recipes: {
      howToUse:
        'Validated, ready-to-use inners for the free-card idioms the kind schemas NAME but do not spell out. Each `html` below is a complete slide inner: pass it to add_chunk({ kind: "free", html }) as it stands, or edit the text and keep the structure. They are copied from the Folio monorepo\'s own block palette (`source` cites where), so a fold you build from one is the same markup the Studio would have produced.',
      whyTheyExist:
        'The free schema lists its vocabulary in one line and stops. It does not tell you that a stat card\'s number lives in a `.big` with data-count-to and the literal text "0", that the column count is the ATTRIBUTE data-ocols rather than a class, or that a footnote is an inline span inside the paragraph. Guessing those produces markup that validates and then renders wrong.',
      styleCaveat:
        'A Fold created here with create_deck carries the FULL base stylesheet, so every recipe styles correctly. A Fold the human OPENED may have been saved by the Studio with unused kind CSS tree-shaken out of it — the sample deck shipped with this app, for instance, has no rule for .o-callout, .o-code, .o-footnote or .o-tcols. Those blocks still validate and still save; they just render unstyled in that deck. inspect_render measures geometry, not styling, so it will not catch this either — prefer the plainer recipes when you are editing a Fold you did not create.',
      cards: recipeCatalog(),
    },
    tools: {
      origami_guide: 'This — the whole contract (optionally one kind, or one topic: contract | kinds | recipes | starters | issues | tools).',
      create_deck: 'Create a new blank Fold and open it in this tab — call this first when building something new, then author it.',
      list_chunks: 'Table of contents of the open Fold.',
      read_chunk: 'Read one chunk to edit (payload + schema + template).',
      write_chunk: 'Apply an edited chunk to the open Fold — takes effect immediately.',
      add_fold: 'BUILD A WHOLE FOLD IN ONE CALL: a title, an eyebrow, and an ordered list of blocks (chart | venn | flow | graph | gantt | draw | table | text | bullets | stats | quote). One call, one fold, one undo step — this is the fast path.',
      add_ledger: 'add_fold with one table block: a titled ledger card from columns + rows + formulas, baked by the calc engine on the way in.',
      add_chunk: 'Add a new slide (free/table starters; supply html for other kinds; or block+fields for a composite). Prefer add_fold when you are building a card from data.',
      add_custom_fold: 'Add a whole CUSTOM FOLD (page) from html — an editable page or a raw report. THE INLINE-EDITABLE VOCABULARY, for a page a human edits by clicking straight on it, all inside a <div class="slide-inner">: headings (<h2>/<h3>), paragraphs (<p>, <p class="lede">, <p class="eyebrow">), lists (<ul><li>…), and stat cards (<div class="card-grid"><div class="stat-card"><div class="big">42</div><div class="lbl">Label</div></div>…</div>). See origami_guide({topic:"recipes"}) for complete, validated examples of each.',
      get_block: "Read one data block's JSON on one fold, by chunkId + kind (+ nth) — or every block on that fold in one call. Read before you replace.",
      set_block: "Replace one data block's WHOLE JSON on one fold, by chunkId + kind (+ nth). Validated by that kind's own schema; tables bake. It never creates a block.",
      delete_chunk: 'Hide (recoverable) or delete a slide.',
      define_block: 'Register (or update) a composite block def (a reusable typed, inert, human-editable component).',
      list_block_defs: 'List the composite block defs registered in this deck.',
      list_starters: 'The ready-made FOLDS (roadmap, flowchart, node graph, drawing, venn, ledger) that add_chunk({starter}) can drop in whole.',
      delete_block: 'Delete a composite block def (its placed instances stay as plain content).',
      get_kind_schema: 'The markup contract for one kind (same as origami_guide(kind)).',
      set_header: 'Deck masthead: subtitle + metadata chips.',
      set_fold_type: 'Set the reading experience (deck | scroll | ledger).',
      inspect_render: 'Lay the open Fold out off-screen and report per-fold geometry + layout defects (overflow, masthead clip, empty fold, colliding diagram labels). The only way to SEE the deck from here. It measures the REAL render, never a model: a fold it could not put on screen comes back measured:false with the reason instead of a number, and a host with no browser layout says so for the whole deck — so an absent warning is not a clean bill of health unless measured is true. Layout is viewport-dependent, which is why the viewport is a parameter and is named in every result: a fold that fits at 1280x720 can still break on a shorter screen.',
      undo: 'Reverse the last change to the open Fold — one tool call is one step, so a run_batch of six is six steps. THE WRITERS IT COVERS: write_chunk, add_chunk, add_fold, add_ledger, add_custom_fold, set_block, move_chunk, set_chunk_meta, set_deck_meta, apply_theme, delete_chunk (hide AND delete), define_block, delete_block, set_header, set_fold_type, and any accepted proposal. It does NOT cross create_deck or a Fold the human opened (both reset the stack), does not change bytes already on disk (save again to push a reversal through), and does not cover a staged proposal (use reject_proposal) or a saved theme (use delete_theme). 50 steps deep, no redo.',
      move_chunk: 'Reorder the folds: move one chunk to a 0-based position. Order only — no content is touched.',
      set_chunk_meta: 'Set one chunk\'s label / notes / hidden flag. hidden:false is the ONLY way to un-hide a fold that delete_chunk hid.',
      set_deck_meta: 'Deck title, theme LABEL and raw CSS custom-property tokens. themeName alone renames without restyling — apply_theme is what changes colours.',
      list_themes: 'Every palette apply_theme can use: the four runtime presets plus anything save_theme kept in this browser, with their full token maps.',
      apply_theme: 'Put a whole named palette on the open Fold — THE tool that restyles a deck. One undo step.',
      save_theme: 'Keep a palette of your own (in this browser) for apply_theme, optionally based on another. Returns a WCAG contrast report. THE 17 TOKENS THE DECK STYLESHEET READS, and the only ones accepted: bg, paper, ink, ink-soft, rule, rule-soft, accent, tint-a, tint-b, chrome, chrome-ink, chrome-soft, font-display, font-body, plus chrome-mark, chrome-mark-h and chrome-pad for the masthead bar. A name outside that set — primary, background, textColor, the names other design systems use — is REFUSED with this list rather than stored and never read.',
      delete_theme: 'Forget a theme you saved. Presets cannot be deleted, and a deck already wearing the colours keeps them.',
      run_batch: 'Run several tool calls in ONE turn, in order, stopping at the first failure. The whole build in one turn; undo still reverses them one at a time.',
      list_activity: 'The feed: what has been done to this Fold, newest first — one entry per tool call, with source, outcome and timing. Use it to see what a human did while you were working, to find the call that broke something, or to check your own trail. Your own call is recorded AFTER the answer is built, so it never appears in its own result.',
      save_deck: 'Write the Fold to disk if the page holds a writable handle; otherwise persist the working copy and report that the human must press Save. WHY THE RESULT MATTERS: three different things can happen and only one is a save. (1) saved:true = the page held a writable File System Access handle and the bytes were written AND read back to confirm it. (2) opfs.written = the complete Fold is in this browser private file system, which needs no permission and no gesture and has room for images; it is real storage but INVISIBLE outside this page, and the browser may evict it, so the human retrieves it with the "Download last save" button. (3) downloadStarted = a download was fired at the browser; on Chrome that usually lands in Downloads, but the page cannot see where it went and a browser may block a repeat, so it is never reported as saved. It never throws and never opens a picker (nobody would be there to click it), so an unattended agent can always finish on it.',
      export_deck: 'Hand YOURSELF the whole .origami.html text (the agent\'s copy). It saves nothing — save_deck is still the human\'s route to disk.',
      propose_chunk: 'Stage a chunk edit for review instead of applying it (a "document PR").',
      propose_add: 'Stage a new slide for review (the add equivalent of propose_chunk).',
      propose_delete: 'Stage a hide/delete for review.',
      list_proposals: 'The review queue: staged proposals (edit/add/delete/hide) with before/after + conflict flag.',
      accept_proposal: 'Apply a staged proposal (refuses on a since-changed or already-gone chunk).',
      reject_proposal: 'Drop a staged proposal.',
    },
    notAvailableHere: {
      list_decks: 'Absent: there are no served folders — one Fold is open in this tab.',
      open_deck: 'Absent: the human opens a Fold with the Open button, or by dropping it on the page; create_deck makes a new one.',
      refresh_sources: 'Absent: connector credentials live in a trusted process, and a browser tab is not one.',
    },
  };
}

/** Every kind, with WHAT it is and WHERE it belongs — and no schema. The schemas are 70% of
    the whole guide, and an agent that reads them all reads a dozen it will never use. */
const kindIndex = (): Record<string, unknown> =>
  Object.fromEntries(Object.values(KINDS).map((k) => [k.key, { name: k.name, placement: placementOf(k.key) }]));

/* The tool catalog is where the prose the DESCRIPTIONS no longer carry now lives (per-turn bytes
   are the scarce thing; this answer is fetched once). That made it the third bulk payload, so
   the default answer carries the same COMPLETE list of tool names — an agent must be able to
   trust it on its own — with one line each, and points at topic:"tools" for the rest. */
const firstSentence = (text: string): string => {
  const at = text.indexOf('. ');
  return at === -1 ? text : text.slice(0, at + 1);
};

const toolIndex = (tools: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(tools).map(([name, text]) => [name, firstSentence(text)]));

/**
 * The guide, whole or by topic.
 *
 * With no topic this returns EVERY section, with three substitutions that cost an agent
 * nothing it cannot fetch in one more call:
 *   - `kinds` becomes an INDEX (name + placement per kind), with `kindsHowTo` carrying the
 *     free-card steer once instead of once per kind, and naming the two routes to a schema;
 *   - the recipe cards' html and the starter catalog become one-line pointers.
 * Nothing is dropped: every one of them comes back in full from its own topic, and a cold
 * agent still learns from the default answer what exists and how to ask for the rest.
 */
export function origamiGuide(topic?: GuideTopic): Record<string, unknown> {
  if (topic === 'quickstart') return { ...QUICKSTART };
  const g = fullGuide();
  if (topic === 'kinds') return { topic, kinds: g.kinds };
  if (topic === 'issues') return { topic, knownIssues: g.knownIssues };
  if (topic === 'tools') return { topic, tools: g.tools, notAvailableHere: g.notAvailableHere };
  if (topic === 'recipes') return { topic, recipes: g.recipes };
  if (topic === 'starters') return { topic, starters: g.starters };
  if (topic === 'contract') {
    const out: Record<string, unknown> = { topic };
    for (const k of CONTRACT_KEYS) out[k] = g[k];
    return out;
  }
  const recipes = g.recipes as { cards: Record<string, unknown> } & Record<string, unknown>;
  const starters = g.starters as { folds: unknown[] } & Record<string, unknown>;
  // built key by key rather than by spread-and-override, so kindsHowTo sits with the index it
  // explains instead of at the far end of the answer
  const out: Record<string, unknown> = {
    // FIRST, deliberately: an agent that reads one line of this answer should read the line
    // that saves it the most turns. The whole contract is still below it.
    start:
      'BUILDING A DECK? Call origami_guide({ topic: "quickstart" }) first - under 3 KB: the five calls that build a deck (create_deck -> add_fold / add_ledger, wrapped in run_batch -> apply_theme -> inspect_render -> save_deck) and ONE complete add_fold example carrying a chart and a table. Everything below is the full contract, for when you need it.',
  };
  for (const [key, value] of Object.entries(g)) {
    if (key === 'kinds') {
      out.kinds = kindIndex();
      out.kindsHowTo = KINDS_HOW_TO;
    } else if (key === 'starters') {
      out.starters = { ...starters, folds: pointer('ready-made folds', starters.folds.length, 'starters') };
    } else if (key === 'recipes') {
      out.recipes = { ...recipes, cards: pointer('recipe cards', Object.keys(recipes.cards).length, 'recipes') };
    } else if (key === 'tools') {
      const full = value as Record<string, string>;
      out.tools = toolIndex(full);
      out.toolsHowTo = `Every tool on this page, one line each. The full entries — including the writers undo covers, what each of save_deck's three outcomes means, and the inline-editable block vocabulary — are in origami_guide({ topic: "tools" }).`;
    } else {
      out[key] = value;
    }
  }
  out.topics = {
    howToUse: 'Every section below is also available on its own: origami_guide({ topic }). Ask for one when you need the part this answer only points at.',
    quickstart: 'The fast path: the five calls that build a deck, with one complete add_fold example. Under 3 KB - read this one first.',
    contract: 'The protocol: what a Fold is, the read→edit→write loop, the inert/active rules, the capability model.',
    kinds: 'Every slide/block kind with its FULL markup schema and its own how-to-add line — the bodies behind the index above.',
    recipes: 'Ready-to-paste free-card inners for the idioms the kind schemas name but do not spell out.',
    starters: 'The whole-fold starters add_chunk({starter}) can drop in.',
    issues: 'Defects and traps that were measured, with what was actually observed.',
    tools: 'The tool catalog, plus the tools that exist in the stdio server and NOT here.',
  };
  return out;
}
