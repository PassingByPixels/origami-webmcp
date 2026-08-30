import { FORMAT_VERSION, KINDS } from '../../vendor/format-dist/index.js';

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
    host: 'Origami Folio Web — the deck is open IN THIS BROWSER TAB, not on disk. Changes are applied to the in-memory Fold and re-rendered live; the human saves the file with the Save button.',
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
    // deck in a tab, so no tool takes a path and step 5 (save_deck) belongs to the human.
    editProtocol: [
      'There is ONE open Fold in this tab and no path handle: every tool acts on it. Call create_deck first if nothing is open.',
      '1. list_chunks() — the table of contents (id, kind, label per chunk).',
      '2. read_chunk(chunkId) — a self-contained payload: deck context + the kind schema + the slide <template>.',
      '3. Edit the <template> inner. The slide id and kind are IMMUTABLE — drift is rejected, not repaired.',
      '4. write_chunk(chunkId, html) to apply, or add_chunk / delete_chunk. Each one changes the open Fold and re-renders it in front of the human immediately.',
      '5. There is no save tool: the HUMAN saves the file to disk from the page. Say when you are done so they can.',
    ],
    reviewProtocol:
      'propose_chunk / propose_add / propose_delete stage a change for review instead of applying it. The staged change appears as a card in the page and ONLY the human can accept or reject it — there is deliberately no accept_proposal tool here. Use the propose_* path when the change is a judgement call; use write_chunk / add_chunk / delete_chunk when you have been told to just do it.',
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
    // DEVIATION: no calc engine in the browser build — see README "Known gaps".
    knownGaps: [
      'table chunks are NOT re-baked on write in this build (no calc engine in the browser). Supply the values you want in `rows`; `formulas` are carried through untouched.',
    ],
    kinds: Object.fromEntries(Object.values(KINDS).map((k) => [k.key, { name: k.name, schema: k.schemaComment }])),
    tools: {
      origami_guide: 'This — the whole contract (optionally one kind).',
      create_deck: 'Create a new blank Fold and open it in this tab — call this first when building something new, then author it.',
      list_chunks: 'Table of contents of the open Fold.',
      read_chunk: 'Read one chunk to edit (payload + schema + template).',
      write_chunk: 'Apply an edited chunk to the open Fold — takes effect immediately.',
      add_chunk: 'Add a new slide (free/table starters; supply html for other kinds).',
      delete_chunk: 'Hide (recoverable) or delete a slide.',
      get_kind_schema: 'The markup contract for one kind (same as origami_guide(kind)).',
      set_header: 'Deck masthead: subtitle + metadata chips.',
      set_fold_type: 'Set the reading experience (deck | scroll | ledger).',
      propose_chunk: 'Stage a chunk edit for the human to review instead of applying it (a "document PR").',
      propose_add: 'Stage a new slide for review (the add equivalent of propose_chunk).',
      propose_delete: 'Stage a hide/delete for review.',
      list_proposals: 'The review queue: staged proposals (edit/add/delete/hide) with before/after + conflict flag.',
    },
    notAvailableHere: {
      accept_proposal: 'Deliberately absent: only the human accepts a proposal, by clicking Accept on its card in the page.',
      reject_proposal: 'Deliberately absent: only the human rejects, by clicking Reject on its card.',
      save_deck: 'Absent: the page has no filesystem. The human saves the Fold with the Save button.',
      list_decks: 'Absent: there are no served folders — one Fold is open in this tab.',
      open_deck: 'Absent: the human opens a Fold with the Open button (or by dropping it on the page).',
    },
  };
}
