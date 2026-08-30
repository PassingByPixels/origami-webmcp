import {
  COMPOSITE_FIELD_TYPES,
  FOLD_TYPES,
  KINDS,
  activeContentFlags,
  blockInstanceJson,
  coerceChunkReply,
  extractChunk,
  kindSchemaComment,
  parseDeck,
  renderComposite,
  serializeModel,
  stripBlockInstances,
  validateBlockDef,
  validateDeck,
  validateSlideContent,
  type CompositeBlockDef,
  type DeckModel,
  type FoldType,
  type Op,
  type Proposal,
} from '../../vendor/format-dist/index.js';
import { assembleBlankDeck, loadRuntimeJs } from './blank-deck.js';
import { bakeTableInner } from './bake.js';
import type { DeckStore } from './deck-store.js';
import { newDeckId, newProposalId, newSlideId, sha256Hex } from './ids.js';
import { origamiGuide } from './guide.js';
import { analyseRender, unmeasurable, type MeasureFn } from './inspect.js';
import type { ProposalStore } from './proposal-store.js';
import { fail, ok, refuse } from './result.js';
import { ToolRegistry, type ToolDef } from './registry.js';
import { FOLD_STARTERS, findStarter, starterCatalog } from './fold-starters.js';
import { FREE_STARTER_INNER, TABLE_STARTER_INNER } from './starters.js';
import { videoCapsNeeded } from './video-caps.js';

/* ---------------------------------------------------------------------------------------
   Tool names, descriptions and schemas are ported from vendor/mcp-reference/server.ts.
   Descriptions are verbatim except where the stdio reality does not exist in a page; every
   such edit is marked DEVIATION and repeated in README.md.

   Two structural deviations apply to EVERY tool:
     1. No `deck` path argument. One Fold is open in the tab; there is no served folder and
        no path handle, so the parameter would be unanswerable.
     2. No file write. "this WRITES THE FILE (atomic)" becomes "changes the open Fold and
        re-renders it"; the human saves with the Save button.
   --------------------------------------------------------------------------------------- */

/** A path-safe, deck-like filename stem from a title (lowercase, hyphenated, bounded). */
function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deck';
}

type InsertBuild =
  | { error: string; extra?: Record<string, unknown> }
  | { id: string; insert: Extract<Op, { t: 'slide.insert' }>; inner: string; grants: string[] };

/** Ported from server.ts buildInsert. Builds a slide.insert op from add_chunk/propose_add args
    (starters / supplied html / composite block render+bake) so add and propose-add share one path. */
function buildInsert(
  m: DeckModel,
  args: { kind?: string; html?: string; block?: string; fields?: Record<string, unknown>; position?: number; label?: string; starter?: string }
): InsertBuild {
  const { kind = 'free', html, block, fields, position, label, starter } = args;
  let inner = html;
  let slideKind = kind;
  let slideLabel = label;
  if (starter !== undefined) {
    // Ambiguity is an error, not a silent precedence rule: an agent that passes both has a
    // wrong model of the tool and needs to be told, not quietly given one of the two.
    if (html !== undefined || block !== undefined) {
      return { error: 'pass starter OR html/block, not both — a starter already carries its markup' };
    }
    const s = findStarter(starter);
    if (!s) return { error: `unknown starter "${starter}" — call list_starters`, extra: { availableStarters: FOLD_STARTERS.map((x) => x.key) } };
    inner = s.inner();
    slideKind = 'free'; // every starter is a free card holding one block
    slideLabel = slideLabel ?? s.label;
  } else if (block !== undefined) {
    const def = m.blocks[block];
    if (!def) return { error: `unknown composite block "${block}" — this Fold defines none by that name`, extra: { availableBlocks: Object.keys(m.blocks) } };
    const r = renderComposite(def, fields ?? {});
    if (r.violations.length > 0) return { error: 'the block renders active content — fix the def', extra: { violations: r.violations } };
    const fig = `<figure class="o-block anim"><script type="application/json" data-odata="block">${blockInstanceJson(block, fields ?? {})}</script><div class="o-block-out">${r.html}</div></figure>`;
    inner = `<div class="slide-inner">${fig}</div>`;
    slideKind = 'free';
    slideLabel = slideLabel ?? def.name;
  } else if (inner === undefined) {
    if (kind === 'free') inner = FREE_STARTER_INNER;
    else if (kind === 'table') inner = TABLE_STARTER_INNER;
    else return { error: `no built-in starter for kind "${kind}" — call get_kind_schema("${kind}") and supply html (or use block + fields for a composite)` };
  }
  if (slideKind === 'table') inner = bakeTableInner(inner, Date.now());
  const violations = validateSlideContent(inner);
  if (violations.length > 0) return { error: 'the slide would break the deck structure', extra: { violations } };
  const id = newSlideId();
  const index = position === undefined ? m.order.length : position;
  const grants = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
  return {
    id,
    insert: { t: 'slide.insert', id, index, kind: slideKind, label: slideLabel ?? (KINDS[slideKind]?.name ?? 'New slide'), inner },
    inner,
    grants,
  };
}

/** Shared edit-contract gate for write_chunk and propose_chunk: id/kind immutability then the
    hard content policy. Refuses (throws) exactly where the stdio server refuses. */
function coerceAndValidate(m: DeckModel, chunkId: string, html: string): string {
  const slide = m.slides.get(chunkId);
  if (!slide) refuse(`unknown chunk "${chunkId}" — call list_chunks`);
  const reply = coerceChunkReply(html, { slideId: chunkId, kind: slide!.kind });
  if (!reply.coerced && reply.slideId !== chunkId) {
    refuse(`slide id drift: reply targets "${reply.slideId}" but the edit was for "${chunkId}"`);
  }
  if (!reply.coerced && reply.kind !== slide!.kind) {
    refuse(`kind drift: reply declares "${reply.kind}" but "${chunkId}" is "${slide!.kind}"`);
  }
  const violations = validateSlideContent(reply.inner);
  if (violations.length > 0) {
    refuse('the edit would break the deck structure — nothing was applied', { violations });
  }
  return slide!.kind === 'table' ? bakeTableInner(reply.inner, Date.now()) : reply.inner;
}

/** What save_deck managed to do. The page owns the how (File System Access, autosave); the
    tool only reports it — and it NEVER throws, so an unattended agent can always finish. */
export interface SaveOutcomeReport {
  written: boolean;
  where: string;
  note: string;
}
export type SaveFn = (text: string) => Promise<SaveOutcomeReport>;

export interface ToolDeps {
  deck: DeckStore;
  proposals: ProposalStore;
  /** Injected in tests so create_deck does not need a network fetch. */
  runtimeJs?: () => Promise<string>;
  /** Injected by the page. Absent === no disk route at all (unit tests, or a host with no FSA). */
  save?: SaveFn;
  /** Injected by the page. Absent === this host cannot lay a deck out, so inspect_render
      reports that instead of guessing (see src/core/inspect.ts). */
  measure?: MeasureFn;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** A short, honest description of an op for the undo report: what kind of change it was and
    which chunk it touched. A batch names its parts (e.g. an edit that also granted a capability). */
function describeOp(op: Op): Record<string, unknown> {
  if (op.t === 'batch') {
    return { op: 'batch', parts: op.ops.map((o) => o.t), ...(describeOp(op.ops[0]!).targetId ? { targetId: describeOp(op.ops[0]!).targetId } : {}) };
  }
  return { op: op.t, ...('id' in op ? { targetId: op.id } : {}) };
}

export function buildTools(deps: ToolDeps): ToolDef[] {
  const { deck, proposals } = deps;
  const runtimeJs = deps.runtimeJs ?? (() => loadRuntimeJs());

  return [
    {
      name: 'origami_guide',
      description:
        'START HERE. The whole Origami contract in one call — what a Fold is, the read→edit→write chunk protocol, every kind schema, the inert/active rules, the capability model, and the tool catalog. An agent with no prior knowledge of Origami should call this once on connect to learn the format. Pass a kind to get just that kind\'s schema.',
      inputSchema: {
        type: 'object',
        properties: { kind: { type: 'string', description: 'Optional: one kind to detail (else the whole contract)' } },
      },
      execute: async ({ kind }) => {
        if (kind) {
          const spec = KINDS[kind];
          if (!spec) return fail(`unknown kind "${kind}"`, { availableKinds: Object.keys(KINDS) });
          return ok({ kind: spec.key, name: spec.name, schema: kindSchemaComment(kind) });
        }
        return ok(origamiGuide());
      },
    },

    {
      name: 'get_kind_schema',
      description: 'The markup contract for a slide/block kind: what structure and attributes are valid.',
      inputSchema: {
        type: 'object',
        properties: { kind: { type: 'string', description: 'Kind key, e.g. "free", "gantt", "chart"' } },
        required: ['kind'],
      },
      execute: async ({ kind }) => {
        const spec = KINDS[kind];
        if (!spec) return fail(`unknown kind "${kind}"`, { availableKinds: Object.keys(KINDS) });
        return ok({ kind: spec.key, name: spec.name, schema: kindSchemaComment(kind) });
      },
    },

    {
      name: 'create_deck',
      // DEVIATION: no filesystem. The stdio version writes a file into the first served folder
      // and returns its path; this one mints the same bytes into the tab and opens them.
      description:
        'Create a NEW blank Fold — a fresh, valid deck with one editable fold — and OPEN IT IN THIS TAB. It renders immediately. Call this FIRST when asked to build something from nothing, then author it with add_chunk / add_custom_fold / write_chunk and finish with save_deck. foldType picks the reading experience: "deck" (default card-stage) | "scroll" (a long-form document — pair it with document-kind folds) | "ledger". If a Fold with UNSAVED changes is already open this refuses rather than throw that work away; pass discard:true to replace it anyway (use that when you are running unattended and the open Fold is not the human\'s work).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200, description: 'Deck title (default "Untitled deck"); also seeds the suggested filename' },
          foldType: { type: 'string', enum: FOLD_TYPES, description: 'deck (default card-stage) | scroll (long-form document) | ledger' },
          discard: { type: 'boolean', description: 'Replace an open Fold that has unsaved changes, losing them. Default false (refuse instead)' },
        },
      },
      execute: async ({ title, foldType, discard }) => {
        const open = deck.peek();
        if (open?.dirty && discard !== true) {
          return fail('the Fold already open has unsaved changes — save it, or call again with discard:true to replace it anyway', { openTitle: open.model.title });
        }
        const deckTitle = (typeof title === 'string' && title.trim()) || 'Untitled deck';
        const ft = (foldType ?? 'deck') as FoldType;
        const text = await assembleBlankDeck({
          title: deckTitle,
          foldType: ft,
          now: new Date().toISOString(),
          id: newDeckId(),
          slideId: newSlideId(),
          runtimeJs: await runtimeJs(),
        });
        deck.open(text, `${slugifyTitle(deckTitle)}.origami.html`);
        proposals.clear();
        const m = deck.model();
        return ok({
          created: deck.name(),
          title: m.title,
          foldType: m.foldType,
          slides: m.order.length,
          chunks: m.order.map((id) => ({ id, kind: m.slides.get(id)!.kind, label: m.slides.get(id)!.label })),
          note: 'blank Fold created and now open in the tab — author it with add_chunk / write_chunk. It is NOT on disk: the human saves it with the Save button.',
        });
      },
    },

    {
      name: 'list_chunks',
      // DEVIATION: "Read fresh from the file every time" -> the open Fold in this tab.
      description:
        'Table of contents of the open Fold: every editable chunk (slide) with id, kind, label and hidden flag, in order. Always reflects what the human is looking at right now.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const m = deck.model();
        return ok({
          title: m.title,
          theme: m.theme.name,
          foldType: m.foldType,
          capabilities: m.capabilities,
          chunks: m.order.map((id) => {
            const s = m.slides.get(id)!;
            return { id, kind: s.kind, label: s.label, hidden: s.hidden };
          }),
        });
      },
    },

    {
      name: 'read_chunk',
      description:
        'Read one chunk for editing: a self-contained payload with the deck context, the kind schema (what markup is valid), and the slide <template>. Edit the template and send the whole element back via write_chunk. Always reflects the Fold open in this tab.',
      inputSchema: {
        type: 'object',
        properties: { chunkId: { type: 'string', description: 'Chunk id from list_chunks' } },
        required: ['chunkId'],
      },
      execute: async ({ chunkId }) => {
        const model = deck.model();
        if (!model.slides.has(chunkId)) return fail(`unknown chunk "${chunkId}" — call list_chunks`);
        const current = parseDeck(serializeModel(model));
        return ok(extractChunk(current, chunkId));
      },
    },

    {
      name: 'write_chunk',
      // DEVIATION: "this WRITES THE FILE (atomic)" -> applies to the open Fold. `force` dropped:
      // there is no second writer to race in a tab.
      description:
        'Apply an edited chunk to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it immediately. Send the whole <template data-origami-slide=...> element from read_chunk, edited. The slide id and kind are immutable; drift is rejected. The only hard rule is single-file structure (no stray <template> tags, balanced <script>). Scripts, styles, iframes and remote URLs are ALLOWED — they mark the deck "active" (returned as activeContent; recipients open it locked until they trust the sender). Returns errors instead of applying only when the content would break the file structure. Pass dryRun:true to run the WHOLE gate and apply NOTHING — you get the same verdict, or the same violations, a real write would give, and the Fold stays byte-identical. Use propose_chunk instead when the change is a judgement call the human should approve.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string', description: 'The chunk the edit was for' },
          html: { type: 'string', description: 'The edited <template> element (a full chunk reply is fine too)' },
          dryRun: { type: 'boolean', description: 'Validate only: same verdict/error, nothing applied, deck byte-identical. Default false' },
        },
        required: ['chunkId', 'html'],
      },
      execute: async ({ chunkId, html, dryRun }) => {
        if (dryRun === true) {
          // The read-only twin of the write below: the SAME gate (coerceAndValidate refuses
          // identically), the same capability arithmetic, no mutate() — so no dirty flag, no
          // re-render, no autosave. Nothing here may touch the model.
          const m = deck.model();
          const inner = coerceAndValidate(m, chunkId, html);
          return ok({
            dryRun: true,
            wouldApply: chunkId,
            capabilitiesWouldGrant: videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c)),
            activeContent: activeContentFlags(inner).map((v) => v.rule),
            note: 'DRY RUN — validated against the open Fold and NOT applied; the deck is byte-identical. Call again without dryRun to apply it.',
          });
        }
        const out = deck.mutate((m) => {
          const inner = coerceAndValidate(m, chunkId, html);
          const caps = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
          const op: Op =
            caps.length > 0
              ? { t: 'batch', ops: [{ t: 'slide.inner', id: chunkId, inner }, { t: 'deck.caps', capabilities: [...m.capabilities, ...caps] }] }
              : { t: 'slide.inner', id: chunkId, inner };
          deck.apply(m, op);
          return { caps, inner };
        });
        return ok({
          applied: chunkId,
          capabilitiesGranted: out.caps,
          activeContent: activeContentFlags(out.inner).map((v) => v.rule),
          note: 'applied to the open Fold and re-rendered — not yet on disk (the human saves).',
        });
      },
    },

    {
      name: 'add_chunk',
      description:
        'Add a new slide to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it immediately. Defaults to a "free" slide with starter content at the end of the deck. For a built-in kind supply html (call get_kind_schema first). For a COMPOSITE block already defined in this Fold, pass block + fields — the block is rendered and baked into a free slide; no html needed. For a whole ready-made fold — a roadmap, a flowchart, a ledger — pass starter (see list_starters) and nothing else. Pass dryRun:true to build, bake and validate the slide WITHOUT adding it — the same verdict, or the same violations, a real add would give, and the Fold stays byte-identical.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Slide kind (default "free")' },
          position: { type: 'integer', minimum: 0, description: '0-based insert index (default: end)' },
          label: { type: 'string', description: 'Sidebar label (default: kind/def name)' },
          html: { type: 'string', description: 'Slide inner markup; required for kinds other than "free"' },
          block: { type: 'string', description: 'A composite block kind (x.<name>) already defined in this Fold' },
          fields: { type: 'object', description: 'Field values for the composite block (block instance values)' },
          starter: { type: 'string', description: 'A ready-made fold from list_starters (roadmap | flowchart | node-graph | drawing | venn | ledger). Not combinable with html or block' },
          dryRun: { type: 'boolean', description: 'Validate only: same verdict/error, nothing added, deck byte-identical. Default false' },
        },
      },
      execute: async (args) => {
        if (args.dryRun === true) {
          // Read-only twin of the insert below. buildInsert is pure against the model, so the
          // whole gate (starter pick, composite render, table bake, content policy) runs for
          // real — only applyOp is skipped. No chunk id is reported: none was minted.
          const m = deck.model();
          const b = buildInsert(m, args);
          if ('error' in b) refuse(b.error, b.extra);
          const ins = b as Extract<InsertBuild, { id: string }>;
          return ok({
            dryRun: true,
            wouldAdd: { kind: ins.insert.kind, label: ins.insert.label, index: ins.insert.index },
            capabilitiesWouldGrant: ins.grants,
            activeContent: activeContentFlags(ins.inner).map((v) => v.rule),
            note: 'DRY RUN — the slide was built, baked and validated but NOT added; the deck is byte-identical and no chunk id exists yet. Call again without dryRun to add it.',
          });
        }
        const out = deck.mutate((m) => {
          const b = buildInsert(m, args);
          if ('error' in b) refuse(b.error, b.extra);
          const ins = b as Extract<InsertBuild, { id: string }>;
          const op: Op =
            ins.grants.length > 0
              ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
              : ins.insert;
          deck.apply(m, op);
          return { b: ins, index: m.order.indexOf(ins.id) };
        });
        return ok({
          chunkId: out.b.id,
          index: out.index,
          capabilitiesGranted: out.b.grants,
          activeContent: activeContentFlags(out.b.inner).map((v) => v.rule),
          note: 'added to the open Fold and re-rendered — not yet on disk (the human saves).',
        });
      },
    },

    {
      name: 'add_custom_fold',
      description:
        'Add a whole CUSTOM FOLD (a full page) as one fold — the same feature the Studio exposes in its left rail. Pass `html`, the fold\'s inner. For a page a human EDITS by clicking straight on it, compose it from Origami\'s inline-editable blocks inside a <div class="slide-inner">: headings (<h2>/<h3>), paragraphs (<p>, <p class="lede">, <p class="eyebrow">), lists (<ul><li>…), and stat cards (<div class="card-grid"><div class="stat-card"><div class="big">42</div><div class="lbl">Label</div></div>…</div>). Or paste a full report verbatim — active content (scripts, <style>, remote assets) is ALLOWED but flags the deck active so a recipient opens it under the padlock; only a stray <template> or unbalanced <script> is rejected (it would corrupt the single file). This CHANGES THE OPEN FOLD and re-renders it.',
      inputSchema: {
        type: 'object',
        properties: {
          html: { type: 'string', description: "The fold's inner HTML — a whole page (editable Origami blocks in a .slide-inner, or a raw report)" },
          label: { type: 'string', description: 'Sidebar label (default: "Custom fold")' },
          position: { type: 'integer', minimum: 0, description: '0-based insert index (default: end)' },
        },
        required: ['html'],
      },
      execute: async ({ html, label, position }) => {
        const out = deck.mutate((m) => {
          const b = buildInsert(m, { kind: 'free', html, position, label: label ?? 'Custom fold' });
          if ('error' in b) refuse(b.error, b.extra);
          const ins = b as Extract<InsertBuild, { id: string }>;
          const op: Op =
            ins.grants.length > 0
              ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
              : ins.insert;
          deck.apply(m, op);
          return { b: ins, index: m.order.indexOf(ins.id) };
        });
        const active = activeContentFlags(out.b.inner).map((v) => v.rule);
        return ok({
          foldId: out.b.id,
          index: out.index,
          capabilitiesGranted: out.b.grants,
          activeContent: active,
          padlock: active.length > 0,
          note:
            active.length > 0
              ? 'active content present — the deck opens under the padlock (allowed by design)'
              : 'inert — no padlock',
        });
      },
    },

    {
      name: 'delete_chunk',
      description:
        'Hide or delete a slide in the open Fold — this CHANGES THE DECK the human is looking at. Default mode "hide" keeps the slide in the file but out of the show (the recoverable path — prefer it); mode "delete" removes the slide template entirely. Use propose_delete when the human should approve first.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          mode: { type: 'string', enum: ['hide', 'delete'], description: 'Default "hide"' },
        },
        required: ['chunkId'],
      },
      execute: async ({ chunkId, mode = 'hide' }) => {
        deck.mutate((m) => {
          if (!m.slides.has(chunkId)) refuse(`unknown chunk "${chunkId}" — call list_chunks`);
          if (mode === 'hide') deck.apply(m, { t: 'slide.meta', id: chunkId, patch: { hidden: true } });
          else deck.apply(m, { t: 'slide.remove', id: chunkId });
        });
        return ok({ [mode === 'hide' ? 'hidden' : 'deleted']: chunkId, note: 'applied to the open Fold — not yet on disk (the human saves).' });
      },
    },

    {
      name: 'define_block',
      description:
        'Register (or update) a COMPOSITE BLOCK definition in the deck — a reusable typed component a human can still edit field-by-field. The def is a template of inert primitives + a field manifest; once defined, author instances via add_chunk(block, fields). The template MUST render inert (no <script>/<style>/<iframe>/on*/remote URLs) — an active template is rejected. Re-defining the same kind replaces it (bump version). This CHANGES THE OPEN FOLD.',
      inputSchema: {
        type: 'object',
        properties: {
          def: {
            type: 'object',
            description: 'the CompositeBlockDef',
            properties: {
              kind: { type: 'string', description: 'x.<name> — lowercase letters/digits/hyphens; never collides with built-ins' },
              name: { type: 'string' },
              version: { type: 'integer', minimum: 1 },
              fields: {
                type: 'array',
                description: 'the human-edit contract — the Studio auto-generates a control per field',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'identifier, referenced in the template as {{name}}' },
                    type: { type: 'string', enum: COMPOSITE_FIELD_TYPES },
                    label: { type: 'string' },
                    options: { type: 'array', items: { type: 'string' }, description: 'required for type "select"' },
                    default: { type: 'string' },
                  },
                  required: ['name', 'type'],
                },
              },
              template: { type: 'string', description: 'inert HTML using {{field}} placeholders (HTML-escaped at render)' },
              schemaComment: { type: 'array', items: { type: 'string' } },
            },
            required: ['kind', 'name', 'version', 'fields', 'template'],
          },
        },
        required: ['def'],
      },
      execute: async ({ def }) => {
        const violations = validateBlockDef(def);
        if (violations.length > 0) return fail('invalid block def — nothing was registered', { violations });
        const d = def as CompositeBlockDef;
        deck.mutate((m) => deck.apply(m, { t: 'deck.blocks', blocks: { ...m.blocks, [d.kind]: d } }));
        return ok({
          defined: d.kind,
          version: d.version,
          fields: d.fields.map((f) => f.name),
          note: 'now author instances with add_chunk({block:"' + d.kind + '", fields:{…}})',
        });
      },
    },

    {
      name: 'list_block_defs',
      description:
        'List the composite block definitions registered in this deck (kind, name, version, fields). Use a kind with add_chunk(block, fields).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () =>
        ok({
          blocks: Object.values(deck.model().blocks).map((d) => ({ kind: d.kind, name: d.name, version: d.version, fields: d.fields })),
        }),
    },

    {
      name: 'list_starters',
      // NOT in the stdio server: its starters are two inner strings chosen by `kind`, with no
      // catalog to list. These are the Studio rail's whole-fold starters, ported verbatim.
      description:
        `The ready-made FOLDS you can add in one call: a roadmap, a flowchart, a node graph, a drawing, a Venn diagram, a ledger. Each is a free card already holding one seeded data block — the exact shape every data kind's schema recommends — copied from the Studio's own palette, so a fold you start from one is what the human would have got by clicking the rail. Add one with add_chunk({starter:"<key>"}), or stage it for review with propose_add({starter:"<key>"}). Use these when a seeded example is a fine starting point; supply html yourself when the content matters more than the shape.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ok({ starters: starterCatalog(), note: 'add one with add_chunk({starter:"roadmap"}) — it lands as a free fold holding that block, seeded and ready to edit.' }),
    },

    {
      name: 'delete_block',
      description:
        'Delete a composite block definition from the deck. Non-destructive: every placed instance keeps its baked output but loses its data-script, becoming plain inert content — so there is no dangling reference and the deck stays valid. This CHANGES THE OPEN FOLD.',
      inputSchema: {
        type: 'object',
        properties: { kind: { type: 'string', description: 'Block kind x.<name> from list_block_defs' } },
        required: ['kind'],
      },
      execute: async ({ kind }) => {
        const out = deck.mutate((m) => {
          const def = m.blocks[kind];
          if (!def) refuse(`unknown composite block "${kind}"`, { availableBlocks: Object.keys(m.blocks) });
          const nextBlocks = { ...m.blocks };
          delete nextBlocks[kind];
          const ops: Op[] = [{ t: 'deck.blocks', blocks: nextBlocks }];
          let frozen = 0;
          for (const [id, slide] of m.slides) {
            const { inner, removed } = stripBlockInstances(slide.inner, kind);
            if (removed > 0) {
              ops.push({ t: 'slide.inner', id, inner });
              frozen += removed;
            }
          }
          deck.apply(m, ops.length > 1 ? { t: 'batch', ops } : ops[0]!);
          return { name: def!.name, frozen };
        });
        return ok({ deleted: kind, name: out.name, instancesFrozen: out.frozen });
      },
    },

    {
      name: 'set_header',
      description:
        'Set the deck-level masthead shown in the header bar (a corporate report header): a subtitle line under the title and metadata chips (e.g. ["5 plants","Built 2026-06-15","Q3 2026"]). This CHANGES THE OPEN FOLD. The bar COLOURS and thickness are theme tokens (chrome / chrome-ink / chrome-mark / chrome-pad), set in the deck theme or the Studio Header panel — not here. Pass an empty subtitle ("") / chips ([]) to clear.',
      inputSchema: {
        type: 'object',
        properties: {
          subtitle: { type: 'string', maxLength: 200, description: 'A line under the deck title' },
          chips: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8, description: 'Metadata chips' },
        },
      },
      execute: async ({ subtitle, chips }) => {
        if (subtitle === undefined && chips === undefined) return fail('nothing to set — supply subtitle and/or chips');
        const header = deck.mutate((m) => {
          const next = { ...m.header };
          if (subtitle !== undefined) next.subtitle = subtitle;
          if (chips !== undefined) next.chips = chips;
          deck.apply(m, { t: 'deck.header', header: next });
          return m.header;
        });
        return ok({ header });
      },
    },

    {
      name: 'set_fold_type',
      description:
        'Set the deck\'s reading experience (foldType). "deck" (default) = the card-stage — one fold at a time with tabs/pips, presentable. "scroll" = a continuous-reading document — every fold stacked and read top to bottom (pair it with document-kind folds for a long-form report). "ledger" is reserved. This CHANGES THE OPEN FOLD. "deck" is the default and writes no key, so the file stays byte-stable.',
      inputSchema: {
        type: 'object',
        properties: { foldType: { type: 'string', enum: FOLD_TYPES, description: 'deck | scroll | ledger' } },
        required: ['foldType'],
      },
      execute: async ({ foldType }) => {
        const out = deck.mutate((m) => {
          deck.apply(m, { t: 'deck.foldType', foldType });
          // scroll stacks every fold as-is; a deck with no document folds reads as a stack
          // of full-screen card scenes — advise (no behaviour change, no byte impact).
          const noDoc = foldType === 'scroll' && ![...m.slides.values()].some((s) => s.kind === 'document');
          return { foldType: m.foldType, noDoc }; // read back the mutated model, not the input
        });
        return ok({
          foldType: out.foldType,
          ...(out.noDoc
            ? { warning: 'this deck has no document-kind folds — scroll mode stacks every fold as-is; add document folds via add_chunk(kind:"document") for a long-form report' }
            : {}),
        });
      },
    },

    {
      name: 'inspect_render',
      // NOT in the stdio server: it has no browser, so it cannot lay a deck out. This is the
      // one thing a page can tell an agent that a file-writing process cannot.
      description:
        'SEE THE DECK YOU CANNOT SEE. Lays the open Fold out in a real browser, off-screen, and reports the geometry of every fold as text: how tall the content is against how much screen there is, where the content starts against where the deck masthead ends, how many blocks and diagram labels rendered. It then names four defects it can prove — content that OVERFLOWS the screen, content CLIPPED behind the masthead, an EMPTY fold (a data block whose JSON did not parse renders as nothing at all, and validation will not catch that), and SVG labels that COLLIDE on a venn/flow/graph. Call it after authoring and before save_deck. Layout depends on the SCREEN, so the measurement is taken at a stated viewport (1280x720 by default) and the result names it; pass viewport to re-check a smaller one, which is where folds usually break. It measures the real render, never a model: a fold it could not put on screen comes back measured:false with the reason instead of a number, and a host with no browser layout says so for the whole deck — an absent warning is not a clean bill of health unless measured is true.',
      inputSchema: {
        type: 'object',
        properties: {
          viewport: {
            type: 'object',
            description: 'Screen to measure against (default 1280x720). Width 320-3840, height 240-2160.',
            properties: { width: { type: 'integer', description: 'CSS px, 320-3840' }, height: { type: 'integer', description: 'CSS px, 240-2160' } },
          },
        },
      },
      execute: async ({ viewport }) => {
        const model = deck.model();
        if (!deps.measure) {
          return ok(unmeasurable(model, 'this host has no browser layout to measure (no measurement route was injected — unit tests and non-DOM hosts)'));
        }
        let m;
        try {
          m = await deps.measure(deck.serialize(), [...model.order], viewport);
        } catch (e) {
          return ok(unmeasurable(model, `the measurement failed: ${(e as Error).message}`));
        }
        const { folds, warnings } = analyseRender(model, m);
        return ok({
          measured: true,
          viewport: m.viewport,
          note: `measured in a real off-screen render at ${m.viewport.width}x${m.viewport.height} CSS px. Layout is viewport-dependent — a fold that fits here can still break on a shorter screen, so re-run with a smaller viewport before you call a deck safe.`,
          folds,
          warnings,
          clean: warnings.length === 0,
        });
      },
    },

    {
      name: 'undo',
      // NOT in the stdio server: it has no session, so it has no stack to unwind. This is a
      // web-only tool built on @origami/format's History, which the page keeps per open Fold.
      description:
        'Reverse the LAST change made to the open Fold and re-render it. One tool call is one undo step, so calling this twice reverses the last two. It covers write_chunk, add_chunk, add_custom_fold, delete_chunk (hide AND delete), define_block, delete_block, set_header, set_fold_type, and any proposal that was accepted — by you or by the human clicking the card. It does NOT cover: create_deck or the human opening/dropping a different Fold (both replace the whole deck and reset the stack, so you cannot undo across one), a file save_deck already wrote to disk (undo changes the deck in the tab, never the bytes on disk — save again to push the reversal through), or a proposal that is still staged (staging is not a change; use reject_proposal). The stack holds the 50 most recent steps and there is no redo — re-apply by hand if you undo too far.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const undone = deck.undo();
        if (!undone) {
          return fail('nothing to undo — no change has been made to this Fold since it was created or opened (create_deck and opening a Fold both reset the stack)');
        }
        return ok({
          undone: describeOp(undone),
          remainingUndoSteps: deck.undoDepth(),
          chunks: deck.model().order.length,
          note: 'reversed in the open Fold and re-rendered — the file on disk is unchanged until save_deck runs again. There is no redo.',
        });
      },
    },

    {
      name: 'save_deck',
      // DEVIATION: the stdio server's edits already wrote through, so save_deck was only a
      // re-validate. Here it is the ONLY route to disk — and it must never throw, or an
      // unattended agent would have no way to finish.
      description:
        'Finish the job: re-validate the Fold and put it on disk. If the page holds a writable handle for the file (the human opened it with the file picker, or saved it once), this WRITES THAT FILE. If it does not — a Fold created in this tab, a browser without the File System Access API, or a revoked permission — nothing is lost: the working copy is persisted in the browser and the result says the human must press Save. It never fails for want of a handle, so always end on it. Safe to call any number of times; it never changes content.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const text = deck.serialize(new Date().toISOString());
        const violations = validateDeck(parseDeck(text));
        if (violations.length > 0) return fail('the Fold fails format validation — it was NOT saved', { violations });
        const outcome = deps.save
          ? await deps.save(text)
          : {
              written: false,
              where: 'nowhere — this host has no save route',
              note: 'validated only: this build was constructed without a save route, so the Fold exists in memory alone.',
            };
        return ok({
          saved: outcome.written,
          validated: true,
          where: outcome.where,
          bytes: utf8Bytes(text),
          title: deck.model().title,
          slides: deck.model().order.length,
          note: outcome.note,
        });
      },
    },

    /* ---------- propose-review-accept (§3) ----------
       Either side can resolve a proposal: the human clicks Accept / Reject on the card, or an
       agent calls accept_proposal / reject_proposal. Both routes run ProposalStore.accept /
       .reject — one code path, one conflict gate, one provenance stamp. */

    {
      name: 'propose_chunk',
      // Verbatim, plus one sentence: the staged change is also a card in the page, so a human
      // who IS watching can resolve it without you.
      description:
        'Propose an edit to a chunk WITHOUT applying it — STAGED for a human (or another agent) to review and accept (a "document PR"). It appears as a review card in the page, so a human who is watching can Accept or Reject it themselves; if nobody is, resolve it yourself with accept_proposal. Same edit contract as write_chunk (send the edited <template>; id+kind immutable; single-file structure validated NOW so a broken proposal never reaches review). The proposal pins the chunk\'s current content; accept_proposal refuses with a 3-way view if the chunk changed since — never a silent overwrite. Returns a proposalId. Review with list_proposals; apply with accept_proposal; drop with reject_proposal.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string', description: 'The chunk to edit' },
          html: { type: 'string', description: 'The edited <template> element (a full chunk reply is fine)' },
          title: { type: 'string', description: 'Short summary of the change (the PR title)' },
          prompt: { type: 'string', description: 'What you were asked to do (optional provenance)' },
          author: { type: 'string', description: 'Who is proposing (default "agent")' },
        },
        required: ['chunkId', 'html'],
      },
      execute: async ({ chunkId, html, title, prompt, author }) => {
        const m = deck.model();
        const inner = coerceAndValidate(m, chunkId, html);
        const p: Proposal = {
          id: newProposalId(),
          author: author ?? 'agent',
          title: title ?? `Edit ${chunkId}`,
          ...(prompt ? { prompt } : {}),
          op: { t: 'slide.inner', id: chunkId, inner },
          targetId: chunkId,
          baseHash: await sha256Hex(m.slides.get(chunkId)!.inner),
        };
        proposals.add(p);
        return ok({
          proposalId: p.id,
          staged: chunkId,
          activeContent: activeContentFlags(inner).map((v) => v.rule),
          note: 'staged for review — NOT applied. It is a card in the page for a watching human AND an entry in list_proposals; accept_proposal applies it, reject_proposal drops it.',
        });
      },
    },

    {
      name: 'propose_add',
      description:
        'Propose a NEW slide WITHOUT adding it — staged for review (the add equivalent of propose_chunk). Same content args as add_chunk (kind/html, block+fields for a composite, or starter for a ready-made fold); the content is rendered, baked and validated now, then a slide.insert is staged. It appears as a review card in the page for a watching human; resolve it yourself with accept_proposal if nobody is. Review with list_proposals; apply with accept_proposal.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Slide kind (default "free")' },
          position: { type: 'integer', minimum: 0, description: '0-based insert index (default: end)' },
          label: { type: 'string', description: 'Sidebar label' },
          html: { type: 'string', description: 'Slide inner markup; required for kinds other than "free"' },
          block: { type: 'string', description: 'A composite block kind (x.<name>) already defined in this Fold' },
          fields: { type: 'object', description: 'Field values for the composite block' },
          starter: { type: 'string', description: 'A ready-made fold from list_starters. Not combinable with html or block' },
          title: { type: 'string', description: 'Short summary (the PR title)' },
          prompt: { type: 'string', description: 'What you were asked to do (optional provenance)' },
          author: { type: 'string', description: 'Who is proposing (default "agent")' },
        },
      },
      execute: async (args) => {
        const m = deck.model();
        const b = buildInsert(m, args);
        if ('error' in b) return fail(b.error, b.extra);
        const p: Proposal = {
          id: newProposalId(),
          author: args.author ?? 'agent',
          title: args.title ?? `Add ${b.insert.kind} slide`,
          ...(args.prompt ? { prompt: args.prompt } : {}),
          op: b.insert,
          targetId: b.id,
          baseHash: '',
        };
        proposals.add(p);
        return ok({
          proposalId: p.id,
          staged: 'add',
          newChunkId: b.id,
          activeContent: activeContentFlags(b.inner).map((v) => v.rule),
          note: 'staged for review — NOT added. It is a card in the page for a watching human AND an entry in list_proposals; accept_proposal applies it, reject_proposal drops it.',
        });
      },
    },

    {
      name: 'propose_delete',
      description:
        'Propose hiding or deleting a slide WITHOUT doing it — staged for review, as a card in the page for a watching human and as a queue entry you can resolve yourself. mode "hide" (default, recoverable) or "delete". accept_proposal refuses if the chunk is already gone.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          mode: { type: 'string', enum: ['hide', 'delete'], description: 'Default "hide"' },
          title: { type: 'string', description: 'Short summary (the PR title)' },
          prompt: { type: 'string', description: 'Why (optional provenance)' },
          author: { type: 'string', description: 'Who is proposing (default "agent")' },
        },
        required: ['chunkId'],
      },
      execute: async ({ chunkId, mode = 'hide', title, prompt, author }) => {
        const m = deck.model();
        if (!m.slides.has(chunkId)) return fail(`unknown chunk "${chunkId}" — call list_chunks`);
        const op: Proposal['op'] =
          mode === 'hide' ? { t: 'slide.meta', id: chunkId, patch: { hidden: true } } : { t: 'slide.remove', id: chunkId };
        const p: Proposal = {
          id: newProposalId(),
          author: author ?? 'agent',
          title: title ?? `${mode === 'hide' ? 'Hide' : 'Delete'} ${chunkId}`,
          ...(prompt ? { prompt } : {}),
          op,
          targetId: chunkId,
          baseHash: await sha256Hex(m.slides.get(chunkId)!.inner),
        };
        proposals.add(p);
        return ok({ proposalId: p.id, staged: mode, targetId: chunkId, note: 'staged for review — accept_proposal applies it, reject_proposal drops it, or a watching human clicks the card.' });
      },
    },

    {
      name: 'list_proposals',
      description:
        'The review queue: every staged proposal for the open Fold with author, title, the target chunk, the before/after content, and a conflict flag (true if that chunk changed since the proposal was made). Empty until propose_chunk / propose_add / propose_delete stages something. The human accepts or rejects them by clicking the cards in the page.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ok({ proposals: await proposals.views(deck.model()) }),
    },

    {
      name: 'accept_proposal',
      // DEVIATION: no file write ("and write the file immediately (no save_deck needed)" ->
      // applies to the open Fold; call save_deck when you are done).
      description:
        'Accept a staged proposal — apply its edit to the open Fold immediately. Refuses if the target chunk changed since the proposal was made: returns conflicted with the proposed + current content so you can re-propose against the new base (never a silent overwrite). Video capabilities the edit needs are granted on accept. This is the same action the human takes by clicking Accept on the proposal card, so use it when you are running unattended — and prefer leaving the card for the human when one is watching and the change is a judgement call.',
      inputSchema: {
        type: 'object',
        properties: { proposalId: { type: 'string', description: 'Proposal id from list_proposals' } },
        required: ['proposalId'],
      },
      execute: async ({ proposalId }) => {
        const res = await proposals.accept(deck, proposalId);
        if (!res.ok) {
          return fail(res.error, {
            ...(res.conflicted ? { conflicted: true } : {}),
            ...(res.targetId ? { targetId: res.targetId } : {}),
            ...(res.proposed !== undefined ? { proposed: res.proposed } : {}),
            ...(res.current !== undefined ? { current: res.current } : {}),
          });
        }
        return ok({
          accepted: proposalId,
          action: res.action,
          applied: res.targetId,
          capabilitiesGranted: res.capabilitiesGranted,
          remainingProposals: res.remaining,
          note: 'applied to the open Fold — call save_deck when the work is done.',
        });
      },
    },

    {
      name: 'reject_proposal',
      description: 'Drop a staged proposal without applying it. The same action the human takes by clicking Reject on the proposal card.',
      inputSchema: {
        type: 'object',
        properties: { proposalId: { type: 'string', description: 'Proposal id from list_proposals' } },
        required: ['proposalId'],
      },
      execute: async ({ proposalId }) => {
        if (!proposals.reject(proposalId)) return fail(`unknown proposal "${proposalId}" — call list_proposals`);
        return ok({ rejected: proposalId, remainingProposals: proposals.count() });
      },
    },
  ];
}

/** Build the registry with every tool registered. */
export function createRegistry(deps: ToolDeps): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of buildTools(deps)) registry.register(t);
  return registry;
}
