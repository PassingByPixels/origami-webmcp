import { FORMAT_VERSION, KINDS } from '../../vendor/format-dist/index.js';
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
export function origamiGuide(): Record<string, unknown> {
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
    kinds: Object.fromEntries(Object.values(KINDS).map((k) => [k.key, { name: k.name, schema: k.schemaComment }])),
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
      origami_guide: 'This — the whole contract (optionally one kind).',
      create_deck: 'Create a new blank Fold and open it in this tab — call this first when building something new, then author it.',
      list_chunks: 'Table of contents of the open Fold.',
      read_chunk: 'Read one chunk to edit (payload + schema + template).',
      write_chunk: 'Apply an edited chunk to the open Fold — takes effect immediately.',
      add_chunk: 'Add a new slide (free/table starters; supply html for other kinds; or block+fields for a composite).',
      add_custom_fold: 'Add a whole CUSTOM FOLD (page) from html — an editable page or a raw report.',
      delete_chunk: 'Hide (recoverable) or delete a slide.',
      define_block: 'Register (or update) a composite block def (a reusable typed, inert, human-editable component).',
      list_block_defs: 'List the composite block defs registered in this deck.',
      delete_block: 'Delete a composite block def (its placed instances stay as plain content).',
      get_kind_schema: 'The markup contract for one kind (same as origami_guide(kind)).',
      set_header: 'Deck masthead: subtitle + metadata chips.',
      set_fold_type: 'Set the reading experience (deck | scroll | ledger).',
      inspect_render: 'Lay the open Fold out off-screen and report per-fold geometry + layout defects (overflow, masthead clip, empty fold, colliding diagram labels). The only way to SEE the deck from here.',
      undo: 'Reverse the last change to the open Fold (one tool call = one step; 50 deep, no redo, and it cannot cross a create_deck).',
      save_deck: 'Write the Fold to disk if the page holds a writable handle; otherwise persist the working copy and report that the human must press Save.',
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
