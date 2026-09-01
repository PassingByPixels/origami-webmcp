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
  validateThemeTokens,
  type CompositeBlockDef,
  type DeckModel,
  type FoldType,
  type Op,
  type Proposal,
} from '../../vendor/format-dist/index.js';
import { ActivityLog } from './activity.js';
import { assembleBlankDeck, loadRuntimeJs } from './blank-deck.js';
import { bakeTableInner } from './bake.js';
import type { DeckStore } from './deck-store.js';
import { newDeckId, newProposalId, newSlideId, sha256Hex } from './ids.js';
import { GUIDE_TOPICS, origamiGuide, type GuideTopic } from './guide.js';
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
export function slugifyTitle(title: string): string {
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
export function coerceAndValidate(m: DeckModel, chunkId: string, html: string): string {
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

/**
 * THE write path — the one every edit to a fold's markup goes through.
 *
 * write_chunk is the raw route (an agent hands over the whole edited template); the mini tools'
 * block writers are the typed route (set_chart, add_element, …) and they build markup rather
 * than accept it. Both land HERE, so there is exactly one gate: the same coercion, the same
 * content policy, the same capability arithmetic, one op on the undo stack per call.
 */
export function writeFoldInner(deck: DeckStore, chunkId: string, html: string): { caps: string[]; inner: string } {
  return deck.mutate((m) => {
    const inner = coerceAndValidate(m, chunkId, html);
    const caps = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
    const op: Op =
      caps.length > 0
        ? { t: 'batch', ops: [{ t: 'slide.inner', id: chunkId, inner }, { t: 'deck.caps', capabilities: [...m.capabilities, ...caps] }] }
        : { t: 'slide.inner', id: chunkId, inner };
    deck.apply(m, op);
    return { caps, inner };
  });
}

/** What save_deck managed to do. The page owns the how (File System Access, autosave); the
    tool only reports it — and it NEVER throws, so an unattended agent can always finish. */
export interface SaveOutcomeReport {
  /** TRUE only when bytes were written to a real file AND read back to confirm it. */
  written: boolean;
  where: string;
  note: string;
  /** The OPFS backstop: attempted on every save, reported either way. */
  opfs?: { written: boolean; path?: string; bytes?: number; why?: string };
  /** A programmatic download was STARTED. The page cannot see where it landed, so this is
      never the same claim as `written`. */
  downloadStarted?: boolean;
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
  /** The log ToolRegistry.invoke writes into. createRegistry passes the registry's OWN log
      here, so list_activity reads exactly what the hook recorded — never a second list. */
  activity?: ActivityLog;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** export_deck's ceiling. A Fold with embedded images runs to megabytes, and a tool result
    that big is a context-window accident, not an export. */
const EXPORT_MAX_BYTES = 4 * 1024 * 1024;

/* The theme block the deck actually renders from. serializeModel re-projects
   <style id="origami-theme-css"> from model.theme.tokens WHENEVER the theme op changed it
   (vendor/format-dist/model.js, themeChanged -> replaceThemeCss(themeCssFromTokens(...))),
   and it projects those tokens ALONE. Both a Fold this app mints and the shipped sample
   carry manifest.theme = {name:'origami-default', tokens:{}} while their style block holds
   the full 14-token :root — so a deck.theme op built on the model's empty token map would
   wipe every custom property out of the file. These two read the tokens actually in force
   so a patch (or a bare rename) merges onto them instead of erasing them. */
const THEME_BLOCK_RE = /<style id="origami-theme-css"[^>]*>([\s\S]*?)<\/style>/;

function themeTokensInForce(m: DeckModel): Record<string, string> | null {
  if (Object.keys(m.theme.tokens).length > 0) return { ...m.theme.tokens };
  const block = THEME_BLOCK_RE.exec(m.base.text);
  if (!block) return null;
  const tokens: Record<string, string> = {};
  for (const decl of block[1]!.matchAll(/--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)) tokens[decl[1]!] = decl[2]!.trim();
  return Object.keys(tokens).length > 0 ? tokens : null;
}

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
  // createRegistry always passes the registry's log; the fallback only exists so buildTools
  // stays callable on its own (nothing in the app does that).
  const activity = deps.activity ?? new ActivityLog();

  return [
    {
      name: 'origami_guide',
      annotations: { readOnlyHint: true },
      description:
        'START HERE. The whole Origami contract in one call — what a Fold is, the read→edit→write chunk protocol, every kind schema, the inert/active rules, the capability model, and the tool catalog. An agent with no prior knowledge of Origami should call this once on connect to learn the format. The default answer is COMPLETE except for two bulk payloads it points at instead of pasting: the recipe cards\' html and the starter catalog. Pass topic to get one section on its own — contract (the protocol) | kinds | recipes | starters | issues | tools — which is also how you fetch either of those two. Pass kind for just one kind\'s schema.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', description: 'Optional: one kind to detail (else the whole contract)' },
          topic: { type: 'string', enum: GUIDE_TOPICS, description: 'Optional: one section only — contract | kinds | recipes | starters | issues | tools' },
        },
      },
      execute: async ({ kind, topic }) => {
        if (kind) {
          const spec = KINDS[kind];
          if (!spec) return fail(`unknown kind "${kind}"`, { availableKinds: Object.keys(KINDS) });
          return ok({ kind: spec.key, name: spec.name, schema: kindSchemaComment(kind) });
        }
        if (topic !== undefined && !GUIDE_TOPICS.includes(topic)) {
          return fail(`unknown topic "${topic}"`, { availableTopics: [...GUIDE_TOPICS] });
        }
        return ok(origamiGuide(topic as GuideTopic | undefined));
      },
    },

    {
      name: 'get_kind_schema',
      annotations: { readOnlyHint: true },
      description: 'The markup contract for a slide/block kind: what structure and attributes are valid.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
      annotations: { destructiveHint: true },
      // DEVIATION: no filesystem. The stdio version writes a file into the first served folder
      // and returns its path; this one mints the same bytes into the tab and opens them.
      description:
        'Create a NEW blank Fold — a fresh, valid deck with one editable fold — and OPEN IT IN THIS TAB. It renders immediately. Call this FIRST when asked to build something from nothing, then author it with add_chunk / add_custom_fold / write_chunk and finish with save_deck. foldType picks the reading experience: "deck" (default card-stage) | "scroll" (a long-form document — pair it with document-kind folds) | "ledger". If a Fold with UNSAVED changes is already open this refuses rather than throw that work away; pass discard:true to replace it anyway (use that when you are running unattended and the open Fold is not the human\'s work).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
      annotations: { readOnlyHint: true },
      // DEVIATION: "Read fresh from the file every time" -> the open Fold in this tab.
      description:
        'Table of contents of the open Fold: every editable chunk (slide) with id, kind, label and hidden flag, in order. Always reflects what the human is looking at right now.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
      annotations: { readOnlyHint: true },
      description:
        'Read one chunk for editing: a self-contained payload with the deck context, the kind schema (what markup is valid), and the slide <template>. Edit the template and send the whole element back via write_chunk. Always reflects the Fold open in this tab.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
        additionalProperties: false,
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
        const out = writeFoldInner(deck, chunkId, html);
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
        additionalProperties: false,
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
        additionalProperties: false,
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
      // NOT in the stdio server: its ops carry no reorder, so a deck's order was whatever the
      // inserts made it. slide.move is in @origami/format and History inverts it, so a page can
      // offer the reorder a human gets by dragging the rail.
      name: 'move_chunk',
      description:
        'Move one chunk to a different place in the open Fold — this CHANGES THE DECK the human is looking at and re-renders it immediately. `position` is the 0-based index the chunk ENDS UP at, counting hidden folds, and the folds it passes shift by one to make room. Order only: no content, label or kind is touched, nothing is added and nothing is removed. A position outside the deck is refused rather than clamped, so a wrong index never silently means "last". Returns the whole new order. undo reverses it in one step.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          position: { type: 'integer', minimum: 0, description: '0-based index to move it to (0 = first)' },
        },
        required: ['chunkId', 'position'],
      },
      execute: async ({ chunkId, position }) => {
        const listOrder = (m: DeckModel) => m.order.map((id) => ({ id, label: m.slides.get(id)!.label }));
        // gated BEFORE mutate: mutate() dirties the Fold and re-renders it the moment it returns,
        // so a refusal or a no-op that ran inside it would flip the Save button for no change
        const before = deck.model();
        if (!before.slides.has(chunkId)) return fail(`unknown chunk "${chunkId}" — call list_chunks`);
        const from = before.order.indexOf(chunkId);
        const last = before.order.length - 1;
        // applyOp CLAMPS an out-of-range `to` (vendor/format-dist/model.js slide.move), which
        // would answer "moved to 9" for a 3-fold deck. Refuse instead: an agent that miscounted
        // needs to be told, not quietly obeyed.
        if (!Number.isInteger(position) || position < 0 || position > last) {
          return fail(`position ${position} is outside this Fold — it has ${before.order.length} chunk(s), so the valid range is 0 to ${last}`);
        }
        if (from === position) {
          return ok({
            from,
            to: from,
            order: listOrder(before),
            note: `that chunk was already at index ${from} — nothing was changed, nothing was re-rendered, and there is nothing to undo.`,
          });
        }
        const out = deck.mutate((m) => {
          deck.apply(m, { t: 'slide.move', id: chunkId, to: position });
          return { to: m.order.indexOf(chunkId), order: listOrder(m) };
        });
        return ok({
          moved: chunkId,
          from,
          to: out.to,
          order: out.order,
          note: 'reordered in the open Fold and re-rendered — not yet on disk (the human saves).',
        });
      },
    },

    {
      // NOT in the stdio server: it exposes slide.meta only through delete_chunk's hide. The
      // patch op is the same one; this is the rest of it, and the only route back from hidden.
      name: 'set_chunk_meta',
      description:
        'Set one chunk\'s label, speaker notes or hidden flag in the open Fold — this CHANGES THE DECK the human is looking at. `label` is the name in the sidebar and the tabs; `notes` is the presenter text that never renders on the fold; `hidden:true` takes the fold out of the show without deleting it, and `hidden:false` puts it back — that is the ONLY way to un-hide a fold that delete_chunk hid. Fields you do not pass are left alone (pass "" to clear a label or notes). The chunk\'s CONTENT and kind are not touched — use write_chunk for those. Supply at least one field. One call is one undo step.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunkId: { type: 'string', description: 'Chunk id from list_chunks' },
          label: { type: 'string', maxLength: 200, description: 'Sidebar/tab label ("" clears it)' },
          hidden: { type: 'boolean', description: 'true takes the fold out of the show; false puts it back' },
          notes: { type: 'string', description: 'Speaker notes — never rendered on the fold ("" clears them)' },
        },
        required: ['chunkId'],
      },
      execute: async ({ chunkId, label, hidden, notes }) => {
        if (label === undefined && hidden === undefined && notes === undefined) {
          return fail('nothing to set — supply at least one of label, hidden or notes');
        }
        const out = deck.mutate((m) => {
          const slide = m.slides.get(chunkId);
          if (!slide) refuse(`unknown chunk "${chunkId}" — call list_chunks`);
          const patch: Extract<Op, { t: 'slide.meta' }>['patch'] = {};
          if (label !== undefined) patch.label = label;
          if (hidden !== undefined) patch.hidden = hidden;
          if (notes !== undefined) patch.notes = notes;
          deck.apply(m, { t: 'slide.meta', id: chunkId, patch });
          const after = m.slides.get(chunkId)!;
          return { label: after.label, hidden: after.hidden, notes: after.notes };
        });
        return ok({ chunkId, ...out, note: 'applied to the open Fold and re-rendered — not yet on disk (the human saves).' });
      },
    },

    {
      // destructiveHint does NOT reach a Chrome-hosted agent (Chrome 151 drops it and keeps only
      // readOnlyHint), so "removes the slide template entirely" in the description below is the
      // load-bearing warning, not this annotation.
      name: 'delete_chunk',
      annotations: { destructiveHint: true },
      description:
        'Hide or delete a slide in the open Fold — this CHANGES THE DECK the human is looking at. Default mode "hide" keeps the slide in the file but out of the show (the recoverable path — prefer it); mode "delete" removes the slide template entirely. A hidden fold comes back with set_chunk_meta({chunkId, hidden:false}); a deleted one only comes back through undo. Use propose_delete when the human should approve first.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
        additionalProperties: false,
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
      annotations: { readOnlyHint: true },
      description:
        'List the composite block definitions registered in this deck (kind, name, version, fields). Use a kind with add_chunk(block, fields).',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () =>
        ok({
          blocks: Object.values(deck.model().blocks).map((d) => ({ kind: d.kind, name: d.name, version: d.version, fields: d.fields })),
        }),
    },

    {
      name: 'list_starters',
      annotations: { readOnlyHint: true },
      // NOT in the stdio server: its starters are two inner strings chosen by `kind`, with no
      // catalog to list. These are the Studio rail's whole-fold starters, ported verbatim.
      description:
        `The ready-made FOLDS you can add in one call: a roadmap, a flowchart, a node graph, a drawing, a Venn diagram, a ledger. Each is a free card already holding one seeded data block — the exact shape every data kind's schema recommends — copied from the Studio's own palette, so a fold you start from one is what the human would have got by clicking the rail. Add one with add_chunk({starter:"<key>"}), or stage it for review with propose_add({starter:"<key>"}). Use these when a seeded example is a fine starting point; supply html yourself when the content matters more than the shape.`,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => ok({ starters: starterCatalog(), note: 'add one with add_chunk({starter:"roadmap"}) — it lands as a free fold holding that block, seeded and ready to edit.' }),
    },

    {
      name: 'delete_block',
      annotations: { destructiveHint: true },
      description:
        'Delete a composite block definition from the deck. Non-destructive: every placed instance keeps its baked output but loses its data-script, becoming plain inert content — so there is no dangling reference and the deck stays valid. This CHANGES THE OPEN FOLD.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
        additionalProperties: false,
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
      // NOT in the stdio server: it takes the title at create_deck and never revisits it, and it
      // exposes no theme control at all.
      name: 'set_deck_meta',
      description:
        'Set the deck-level title and/or theme of the open Fold — this CHANGES THE DECK the human is looking at and re-renders it. `title` is the name in the manifest and the header bar; it does NOT rename the file (the suggested filename was fixed when the Fold was created, and only the human choosing "Save as…" changes where bytes land). `themeName` renames the theme; on its own it changes the label, NOT the colours — pass themeTokens for those. `themeTokens` patches CSS custom properties: the tokens you name are merged onto the ones the deck is already using, so the rest survive. The tokens the deck stylesheet actually reads are bg, paper, ink, ink-soft, rule, rule-soft, accent, tint-a, tint-b, chrome, chrome-ink, chrome-soft, font-display and font-body, plus chrome-mark, chrome-mark-h and chrome-pad for the masthead bar; a name outside that set is stored and simply never read. Values are colours or font stacks — braces, semicolons, angle brackets, @ and url() are rejected, and nothing is applied when they are. Supply at least one of the three. One call is one undo step.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 200, description: 'Deck title (manifest + header bar); does not rename the file' },
          themeName: { type: 'string', maxLength: 60, description: 'Theme name, e.g. "origami-default" — a label, not a restyle' },
          themeTokens: { type: 'object', description: 'CSS custom properties to patch, e.g. {"accent":"#3F7268"} — merged onto the theme in force' },
        },
      },
      execute: async ({ title, themeName, themeTokens }) => {
        if (title === undefined && themeName === undefined && themeTokens === undefined) {
          return fail('nothing to set — supply title, themeName and/or themeTokens');
        }
        // gate the tokens BEFORE mutate: applyOp validates them too, but it would throw halfway
        // through a batch whose deck.title had already landed
        if (themeTokens !== undefined) {
          const violations = validateThemeTokens(themeTokens);
          if (violations.length > 0) return fail('invalid theme tokens — nothing was changed', { violations });
        }
        const out = deck.mutate((m) => {
          const ops: Op[] = [];
          if (title !== undefined) {
            const next = String(title).trim();
            if (!next) refuse('title must not be empty — nothing was changed');
            ops.push({ t: 'deck.title', title: next });
          }
          if (themeName !== undefined || themeTokens !== undefined) {
            const base = themeTokensInForce(m);
            if (!base) {
              refuse(
                'this Fold carries no readable theme tokens (no <style id="origami-theme-css"> block to read them from), so a theme change would leave it with only the tokens named here — nothing was changed. Pass the COMPLETE token set if that is what you intend.'
              );
            }
            ops.push({ t: 'deck.theme', name: themeName ?? m.theme.name, tokens: { ...base, ...(themeTokens ?? {}) } });
          }
          deck.apply(m, ops.length > 1 ? { t: 'batch', ops } : ops[0]!);
          return { title: m.title, theme: { name: m.theme.name, tokens: m.theme.tokens } };
        });
        return ok({
          title: out.title,
          theme: { name: out.theme.name, tokens: out.theme.tokens },
          note: 'applied to the open Fold and re-rendered — not yet on disk (the human saves).',
        });
      },
    },

    {
      name: 'set_fold_type',
      description:
        'Set the deck\'s reading experience (foldType). "deck" (default) = the card-stage — one fold at a time with tabs/pips, presentable. "scroll" = a continuous-reading document — every fold stacked and read top to bottom (pair it with document-kind folds for a long-form report). "ledger" is reserved. This CHANGES THE OPEN FOLD. "deck" is the default and writes no key, so the file stays byte-stable.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
      annotations: { readOnlyHint: true },
      // NOT in the stdio server: it has no browser, so it cannot lay a deck out. This is the
      // one thing a page can tell an agent that a file-writing process cannot.
      description:
        'SEE THE DECK YOU CANNOT SEE. Lays the open Fold out in a real browser, off-screen, and reports the geometry of every fold as text: how tall the content is against how much screen there is, where the content starts against where the deck masthead ends, how many blocks and diagram labels rendered. It then names four defects it can prove — content that OVERFLOWS the screen, content CLIPPED behind the masthead, an EMPTY fold (a data block whose JSON did not parse renders as nothing at all, and validation will not catch that), and SVG labels that COLLIDE on a venn/flow/graph. Call it after authoring and before save_deck. Layout depends on the SCREEN, so the measurement is taken at a stated viewport (1280x720 by default) and the result names it; pass viewport to re-check a smaller one, which is where folds usually break. It measures the real render, never a model: a fold it could not put on screen comes back measured:false with the reason instead of a number, and a host with no browser layout says so for the whole deck — an absent warning is not a clean bill of health unless measured is true.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
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
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
      name: 'list_activity',
      annotations: { readOnlyHint: true },
      // NOT in the stdio server: a process that exits between calls has no session to keep a
      // feed for. One entry is recorded per call at ToolRegistry.invoke, so this is every route
      // into the tools, not just yours.
      description:
        'What has been DONE in this tab, newest first — one entry per tool call, whoever made it. Each entry carries seq, at (ISO), source (agent | human | console | replay), tool, ok plus the error when it failed, the chunk or proposal it targeted, ms, and a one-line summary. The summary is deliberately thin: it names the tool and its scalar arguments and NEVER carries slide html, so reading the feed can never cost what reading the deck costs — use read_chunk or export_deck for content. Use it to see what a human did while you were working, to find the call that broke something, or to check your own trail. It is NOT the undo stack (undo keeps its own 50 steps and this cannot drive it) and it is not part of the Fold: nothing here is saved to disk, and a page reload starts an empty log. Only the 500 most recent entries are held; a gap in seq means older entries were dropped. Your own call is recorded after this answer is built, so it never appears in its own result.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, description: 'How many of the newest entries to return (default 50, capped at the 500 held)' } },
      },
      execute: async ({ limit }) => {
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
          return fail(`limit must be a positive integer — got ${JSON.stringify(limit)}`);
        }
        const entries = activity.recent(limit ?? 50);
        return ok({ held: activity.count(), returned: entries.length, entries });
      },
    },

    {
      name: 'export_deck',
      annotations: { readOnlyHint: true },
      // NOT in the stdio server: there, the file on disk WAS the deck, so an agent could read it
      // back itself. In a tab the bytes exist nowhere the agent can reach, and save_deck reports
      // an outcome rather than content.
      description:
        'Hand YOURSELF the complete .origami.html text of the open Fold — every byte, as a string in the result. This is the AGENT\'s copy: use it to hash the file, diff it, quote a fragment, or pass it on to something else. It writes NOTHING, saves NOTHING and changes NOTHING; the human still has no file until save_deck runs, so calling this INSTEAD of save_deck ends the job with the work stranded in your context. The bytes are the deck exactly as it stands, byte-identical to what the page renders; save_deck stamps a fresh manifest.modified and this does not, so the two differ by that one field after a save. A Fold over 4 MB (embedded images will do it) is refused with its size rather than returned — that is a context-window accident, not an export; use save_deck.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const text = deck.serialize();
        const bytes = utf8Bytes(text);
        if (bytes > EXPORT_MAX_BYTES) {
          return fail(
            `this Fold is ${bytes} bytes, over the ${EXPORT_MAX_BYTES}-byte export limit — nothing was returned. Call save_deck instead: it writes the same bytes without putting them through your context.`,
            { bytes, limit: EXPORT_MAX_BYTES }
          );
        }
        const m = deck.model();
        return ok({
          name: deck.name(),
          title: m.title,
          slides: m.order.length,
          bytes,
          text,
          note: 'this is YOUR copy — nothing was written. The human still needs save_deck.',
        });
      },
    },

    {
      name: 'save_deck',
      // DEVIATION: the stdio server's edits already wrote through, so save_deck was only a
      // re-validate. Here it is the ONLY route to disk — and it must never throw, or an
      // unattended agent would have no way to finish.
      description:
        `Finish the job: re-validate the Fold and put it somewhere durable. READ THE RESULT — it tells you exactly which of three things happened, and only one of them is a save. (1) saved:true means the page held a writable File System Access handle for the file and the bytes were written AND read back to confirm it. (2) opfs.written means the complete Fold is in this browser's own private file system, which needs no permission and no gesture and has room for a Fold with images; it is real storage but INVISIBLE outside this page, so the human retrieves it with the "Download last save" button. It is also not permanent — the browser may evict it. (3) downloadStarted means a download was fired at the browser; on Chrome that usually lands the file in Downloads, but this page cannot see where it went and a browser may block a repeat, so it is NEVER reported as saved. When saved is false the work is safe but the human still has to press Save (or Save as…) to put it on their own disk — say so rather than reporting success. It never throws and never opens a picker (nobody would be there to click it), so always end on it. Safe to call any number of times; it never changes content.`,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
          ...(outcome.opfs ? { opfs: outcome.opfs } : {}),
          ...(outcome.downloadStarted !== undefined ? { downloadStarted: outcome.downloadStarted } : {}),
          // What is TRUE of the bytes right now, in one field, so an agent does not have to
          // infer it from three booleans and get it wrong.
          durability: outcome.written
            ? "on the human's disk"
            : outcome.opfs?.written
              ? 'in this browser only — retrievable by the human, but evictable and not on their disk'
              : 'in memory only — nothing durable was written',
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
        additionalProperties: false,
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
        additionalProperties: false,
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
        additionalProperties: false,
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
      annotations: { readOnlyHint: true },
      description:
        'The review queue: every staged proposal for the open Fold with author, title, the target chunk, the before/after content, and a conflict flag (true if that chunk changed since the proposal was made). Empty until propose_chunk / propose_add / propose_delete stages something. The human accepts or rejects them by clicking the cards in the page.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
        additionalProperties: false,
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
        additionalProperties: false,
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

/** Build the registry with every tool registered. The registry's activity log is handed to
    the tools, so list_activity reads the very list `invoke` writes — one log, not two. */
export function createRegistry(deps: ToolDeps): ToolRegistry {
  const registry = new ToolRegistry(deps.activity);
  for (const t of buildTools({ ...deps, activity: registry.activity })) registry.register(t);
  return registry;
}
