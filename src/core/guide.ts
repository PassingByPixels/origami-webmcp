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

const howToAdd = (key: string): string =>
  PLACEMENT.get(key) === 'block'
    ? `IN-SLIDE BLOCK, not a slide kind — any number of these may sit on any fold. PREFER a FREE CARD holding one: add_chunk({ kind: "free", html: '<div class="slide-inner"><p class="eyebrow">Section</p><h2>A title</h2>' + <the ${key} figure> + '</div>' }). That is what this kind's own schema recommends, and it gives the block a heading and room for a second block beside it. add_chunk({ kind: "${key}", html: <the figure> }) is also valid and is what the stdio server does, but it makes a fold whose entire body is one untitled figure.`
    : "A WHOLE FOLD: add_chunk({ kind, html }) with the fold's inner markup.";

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
export const GUIDE_TOPICS = ['contract', 'kinds', 'recipes', 'starters', 'issues', 'tools'] as const;
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
          howToAdd: howToAdd(k.key),
        },
      ])
    ),
    knownIssues: {
      flowKindMastheadClip:
        `REPORTED as a Folio runtime bug (a flow-kind fold's figure riding up under the deck masthead) and MEASURED here as narrower than reported. With a subtitle and chips set, the masthead (header.o-top) is 100px tall and OVERLAYS the stage; a free-kind fold keeps its content at or below that line. A flow-KIND fold's figure BOX does start above it — measured at 42px — but the top of that box is empty padding: the topmost element that actually PAINTS measured 121px to 253px across every viewport height from 240 to 720, always below the bar. So no rendered content is hidden, and there is nothing to work around today. Putting the figure in a free card (see kinds.flow.howToAdd) is still the safer shape, because a free card's padding is what holds content clear of the bar. inspect_render measures this on the real render and will say so if it ever changes.`,
      emptyDataBlockPassesUntilSave:
        `A data block that is valid JSON but describes nothing — {"nodes":[],"edges":[]} on a flow, an empty sets array on a venn — passes the content policy, so add_chunk returns ok and the fold renders completely blank. save_deck does refuse it at the end (flow.nodes.count), but only then, and as a schema violation rather than "this fold is blank". Call inspect_render before save_deck: a blank fold is reported as empty-fold with the painted-element count.`,
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
      add_chunk: 'Add a new slide (free/table starters; supply html for other kinds; or block+fields for a composite).',
      add_custom_fold: 'Add a whole CUSTOM FOLD (page) from html — an editable page or a raw report.',
      delete_chunk: 'Hide (recoverable) or delete a slide.',
      define_block: 'Register (or update) a composite block def (a reusable typed, inert, human-editable component).',
      list_block_defs: 'List the composite block defs registered in this deck.',
      list_starters: 'The ready-made FOLDS (roadmap, flowchart, node graph, drawing, venn, ledger) that add_chunk({starter}) can drop in whole.',
      delete_block: 'Delete a composite block def (its placed instances stay as plain content).',
      get_kind_schema: 'The markup contract for one kind (same as origami_guide(kind)).',
      set_header: 'Deck masthead: subtitle + metadata chips.',
      set_fold_type: 'Set the reading experience (deck | scroll | ledger).',
      inspect_render: 'Lay the open Fold out off-screen and report per-fold geometry + layout defects (overflow, masthead clip, empty fold, colliding diagram labels). The only way to SEE the deck from here.',
      undo: 'Reverse the last change to the open Fold (one tool call = one step; 50 deep, no redo, and it cannot cross a create_deck).',
      move_chunk: 'Reorder the folds: move one chunk to a 0-based position. Order only — no content is touched.',
      set_chunk_meta: 'Set one chunk\'s label / notes / hidden flag. hidden:false is the ONLY way to un-hide a fold that delete_chunk hid.',
      set_deck_meta: 'Deck title and theme (theme name + CSS custom-property tokens).',
      list_activity: 'The feed: what has been done to this Fold, newest first — one entry per tool call, with source, outcome and timing.',
      save_deck: 'Write the Fold to disk if the page holds a writable handle; otherwise persist the working copy and report that the human must press Save.',
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
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(g)) {
    if (key === 'kinds') {
      out.kinds = kindIndex();
      out.kindsHowTo = KINDS_HOW_TO;
    } else if (key === 'starters') {
      out.starters = { ...starters, folds: pointer('ready-made folds', starters.folds.length, 'starters') };
    } else if (key === 'recipes') {
      out.recipes = { ...recipes, cards: pointer('recipe cards', Object.keys(recipes.cards).length, 'recipes') };
    } else {
      out[key] = value;
    }
  }
  out.topics = {
    howToUse: 'Every section below is also available on its own: origami_guide({ topic }). Ask for one when you need the part this answer only points at.',
    contract: 'The protocol: what a Fold is, the read→edit→write loop, the inert/active rules, the capability model.',
    kinds: 'Every slide/block kind with its FULL markup schema and its own how-to-add line — the bodies behind the index above.',
    recipes: 'Ready-to-paste free-card inners for the idioms the kind schemas name but do not spell out.',
    starters: 'The whole-fold starters add_chunk({starter}) can drop in.',
    issues: 'Defects and traps that were measured, with what was actually observed.',
    tools: 'The tool catalog, plus the tools that exist in the stdio server and NOT here.',
  };
  return out;
}
