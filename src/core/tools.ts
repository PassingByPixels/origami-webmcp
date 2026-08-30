import {
  FOLD_TYPES,
  KINDS,
  activeContentFlags,
  applyOp,
  blockInstanceJson,
  coerceChunkReply,
  extractChunk,
  kindSchemaComment,
  parseDeck,
  renderComposite,
  serializeModel,
  validateSlideContent,
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
import type { ProposalStore } from './proposal-store.js';
import { fail, ok, refuse } from './result.js';
import { ToolRegistry, type ToolDef } from './registry.js';
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
  args: { kind?: string; html?: string; block?: string; fields?: Record<string, unknown>; position?: number; label?: string }
): InsertBuild {
  const { kind = 'free', html, block, fields, position, label } = args;
  let inner = html;
  let slideKind = kind;
  let slideLabel = label;
  if (block !== undefined) {
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

export interface ToolDeps {
  deck: DeckStore;
  proposals: ProposalStore;
  /** Injected in tests so create_deck does not need a network fetch. */
  runtimeJs?: () => Promise<string>;
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
        'Create a NEW blank Fold — a fresh, valid deck with one editable fold — and OPEN IT IN THIS TAB. The human sees it render immediately. Call this FIRST when asked to build something from nothing, then author it with add_chunk / write_chunk. Nothing is written to disk: the human saves the file with the Save button when they are happy. Refuses if the Fold already open has unsaved changes, so it can never discard the human\'s work. foldType picks the reading experience (deck | scroll | ledger; default deck).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 200, description: 'Deck title (default "Untitled deck"); also seeds the suggested filename' },
          foldType: { type: 'string', enum: FOLD_TYPES, description: 'deck (default card-stage) | scroll (long-form document) | ledger' },
        },
      },
      execute: async ({ title, foldType }) => {
        const open = deck.peek();
        if (open?.dirty) {
          return fail('the Fold already open has unsaved changes — ask the human to save (or discard) it before creating a new one', { openTitle: open.model.title });
        }
        const deckTitle = (typeof title === 'string' && title.trim()) || 'Untitled deck';
        const ft = (foldType ?? 'deck') as FoldType;
        const text = assembleBlankDeck({
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
        'Apply an edited chunk to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it immediately. Send the whole <template data-origami-slide=...> element from read_chunk, edited. The slide id and kind are immutable; drift is rejected. The only hard rule is single-file structure (no stray <template> tags, balanced <script>). Scripts, styles, iframes and remote URLs are ALLOWED — they mark the deck "active" (returned as activeContent; recipients open it locked until they trust the sender). Returns errors instead of applying only when the content would break the file structure. Use propose_chunk instead when the change is a judgement call the human should approve.',
      inputSchema: {
        type: 'object',
        properties: {
          chunkId: { type: 'string', description: 'The chunk the edit was for' },
          html: { type: 'string', description: 'The edited <template> element (a full chunk reply is fine too)' },
        },
        required: ['chunkId', 'html'],
      },
      execute: async ({ chunkId, html }) => {
        const out = deck.mutate((m) => {
          const inner = coerceAndValidate(m, chunkId, html);
          const caps = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
          const op: Op =
            caps.length > 0
              ? { t: 'batch', ops: [{ t: 'slide.inner', id: chunkId, inner }, { t: 'deck.caps', capabilities: [...m.capabilities, ...caps] }] }
              : { t: 'slide.inner', id: chunkId, inner };
          applyOp(m, op);
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
        'Add a new slide to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it immediately. Defaults to a "free" slide with starter content at the end of the deck. For a built-in kind supply html (call get_kind_schema first). For a COMPOSITE block already defined in this Fold, pass block + fields — the block is rendered and baked into a free slide; no html needed.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Slide kind (default "free")' },
          position: { type: 'integer', minimum: 0, description: '0-based insert index (default: end)' },
          label: { type: 'string', description: 'Sidebar label (default: kind/def name)' },
          html: { type: 'string', description: 'Slide inner markup; required for kinds other than "free"' },
          block: { type: 'string', description: 'A composite block kind (x.<name>) already defined in this Fold' },
          fields: { type: 'object', description: 'Field values for the composite block (block instance values)' },
        },
      },
      execute: async (args) => {
        const out = deck.mutate((m) => {
          const b = buildInsert(m, args);
          if ('error' in b) refuse(b.error, b.extra);
          const ins = b as Extract<InsertBuild, { id: string }>;
          const op: Op =
            ins.grants.length > 0
              ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
              : ins.insert;
          applyOp(m, op);
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
          if (mode === 'hide') applyOp(m, { t: 'slide.meta', id: chunkId, patch: { hidden: true } });
          else applyOp(m, { t: 'slide.remove', id: chunkId });
        });
        return ok({ [mode === 'hide' ? 'hidden' : 'deleted']: chunkId, note: 'applied to the open Fold — not yet on disk (the human saves).' });
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
          applyOp(m, { t: 'deck.header', header: next });
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
          applyOp(m, { t: 'deck.foldType', foldType });
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

    /* ---------- propose-review-accept (§3): stage changes for the HUMAN to review ---------- */

    {
      name: 'propose_chunk',
      // DEVIATION: accept_proposal / reject_proposal are not tools here — the human clicks.
      description:
        'Propose an edit to a chunk WITHOUT applying it — STAGED as a review card in the human\'s page, which only THEY can accept or reject (a "document PR"). Same edit contract as write_chunk (send the edited <template>; id+kind immutable; single-file structure validated NOW so a broken proposal never reaches review). The proposal pins the chunk\'s current content; accepting refuses if the chunk changed since — never a silent overwrite. Returns a proposalId. Review the queue with list_proposals; there is deliberately no accept tool.',
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
          note: 'staged for review — NOT applied. It is now a card in the human\'s page; only they can accept or reject it.',
        });
      },
    },

    {
      name: 'propose_add',
      description:
        'Propose a NEW slide WITHOUT adding it — staged as a review card only the human can accept (the add equivalent of propose_chunk). Same content args as add_chunk (kind/html, or block+fields for a composite); the content is rendered and validated now, then a slide.insert is staged. Review with list_proposals.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Slide kind (default "free")' },
          position: { type: 'integer', minimum: 0, description: '0-based insert index (default: end)' },
          label: { type: 'string', description: 'Sidebar label' },
          html: { type: 'string', description: 'Slide inner markup; required for kinds other than "free"' },
          block: { type: 'string', description: 'A composite block kind (x.<name>) already defined in this Fold' },
          fields: { type: 'object', description: 'Field values for the composite block' },
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
          note: 'staged for review — NOT added. It is now a card in the human\'s page; only they can accept or reject it.',
        });
      },
    },

    {
      name: 'propose_delete',
      description:
        'Propose hiding or deleting a slide WITHOUT doing it — staged as a review card only the human can accept. mode "hide" (default, recoverable) or "delete". Accepting refuses if the chunk is already gone.',
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
        return ok({ proposalId: p.id, staged: mode, targetId: chunkId, note: 'staged for review — only the human can accept or reject it.' });
      },
    },

    {
      name: 'list_proposals',
      description:
        'The review queue: every staged proposal for the open Fold with author, title, the target chunk, the before/after content, and a conflict flag (true if that chunk changed since the proposal was made). Empty until propose_chunk / propose_add / propose_delete stages something. The human accepts or rejects them by clicking the cards in the page.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ok({ proposals: await proposals.views(deck.model()) }),
    },
  ];
}

/** Build the registry with every tool registered. */
export function createRegistry(deps: ToolDeps): ToolRegistry {
  const registry = new ToolRegistry();
  for (const t of buildTools(deps)) registry.register(t);
  return registry;
}
