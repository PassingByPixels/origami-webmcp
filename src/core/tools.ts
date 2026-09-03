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
import { coverInner } from './compose.js';
import { DATA_BLOCK_REFUSAL, validateDataBlocks } from './data-blocks.js';
import type { DeckStore } from './deck-store.js';
import { newDeckId, newProposalId, newSlideId, sha256Hex } from './ids.js';
import { GUIDE_TOPICS, origamiGuide, type GuideTopic } from './guide.js';
import { analyseRender, summarise, unmeasurable, type MeasureFn } from './inspect.js';
import type { ProposalStore } from './proposal-store.js';
import { fail, ok, refuse } from './result.js';
import { type ToolDef } from './registry.js';
import { FOLD_STARTERS, findStarter, starterCatalog } from './fold-starters.js';
import { FREE_STARTER_INNER, TABLE_STARTER_INNER } from './starters.js';
import type { ThemeStore } from './themes.js';
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
export function buildInsert(
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
  // every table block bakes, whatever the slide kind: a ledger is a free card holding one
  inner = bakeTableInner(inner, Date.now());
  const violations = validateSlideContent(inner);
  if (violations.length > 0) return { error: 'the slide would break the deck structure', extra: { violations } };
  // the data gate, at AUTHORING time: every data block is checked by its own kind's validator —
  // the same functions save_deck runs — so a wrong shape is refused here, not after the deck is built
  const dataViolations = validateDataBlocks(inner, m.blocks);
  if (dataViolations.length > 0) return { error: DATA_BLOCK_REFUSAL, extra: { violations: dataViolations } };
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
  // bake FIRST, then gate: the baked rows are the bytes that would land, so they are the bytes
  // the validator must see (a formula whose result breaks the table schema is still a refusal)
  const baked = bakeTableInner(reply.inner, Date.now());
  const dataViolations = validateDataBlocks(baked, m.blocks);
  if (dataViolations.length > 0) refuse(DATA_BLOCK_REFUSAL, { violations: dataViolations });
  return baked;
}

/**
 * THE add path — build one fold and land it as ONE op, so an add is one undo step.
 *
 * add_chunk, add_custom_fold and add_fold all come here. The capability grant is batched with
 * the insert rather than applied after it: two ops would be two undo steps for one call, and an
 * undo that reversed the grant but left the fold would leave the deck claiming a capability it
 * no longer needs — or the other way round.
 */
export function insertFold(
  deck: DeckStore,
  args: { kind?: string; html?: string; block?: string; fields?: Record<string, unknown>; position?: number; label?: string; starter?: string }
): { id: string; index: number; inner: string; grants: string[] } {
  return deck.mutate((m) => {
    const b = buildInsert(m, args);
    if ('error' in b) refuse(b.error, b.extra);
    const ins = b as Extract<InsertBuild, { id: string }>;
    const op: Op =
      ins.grants.length > 0
        ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
        : ins.insert;
    deck.apply(m, op);
    return { id: ins.id, index: m.order.indexOf(ins.id), inner: ins.inner, grants: ins.grants };
  });
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
  /** The log ToolRegistry.invoke writes into. createModeRegistry passes the registry's OWN log
      here, so list_activity reads exactly what the hook recorded — never a second list. */
  activity?: ActivityLog;
  /** Where save_theme keeps a palette between calls. The page implements it on localStorage so
      a theme survives a reload; absent === in-memory, which is every non-DOM host. */
  themes?: ThemeStore;
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

export function themeTokensInForce(m: DeckModel): Record<string, string> | null {
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
      description: "START HERE. The Origami contract: what a Fold is, the read-edit-write chunk protocol, every kind schema, the inert/active rules, the capability model and the tool catalog. Pass topic:\"quickstart\" FIRST if you are building a deck — under 3 KB, the five calls that do it, with a complete add_fold example. topic: quickstart | contract | kinds | recipes | starters | issues | tools | blocks. Pass kind for one kind's schema.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', description: 'Optional: one kind to detail (else the whole contract)' },
          topic: { type: 'string', enum: GUIDE_TOPICS, description: 'Optional: one section only — contract | kinds | recipes | starters | issues | tools | blocks' },
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
      description: "The markup contract for one slide/block kind: what structure and attributes are valid. Changes nothing.",
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
      description: "Create a NEW Fold and OPEN IT IN THIS TAB. It renders immediately. Call this FIRST when building from nothing, then add folds with add_fold and finish with save_deck. The single fold it mints is a real COVER carrying your title (plus subtitle/eyebrow if given) — there is no placeholder text to overwrite or delete, so do NOT add a cover fold of your own. foldType: \"deck\" (default) | \"scroll\" (long-form document) | \"ledger\". If a Fold with UNSAVED changes is already open this refuses; pass discard:true to replace it anyway.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', maxLength: 200, description: 'Deck title (default "Untitled deck"); the cover h1, and it seeds the suggested filename' },
          subtitle: { type: 'string', maxLength: 300, description: 'A supporting line under the title on the cover (.lede). Omitted entirely when absent' },
          eyebrow: { type: 'string', maxLength: 80, description: 'A small label above the title on the cover, e.g. "Q3 review". Omitted entirely when absent' },
          foldType: { type: 'string', enum: FOLD_TYPES, description: 'deck (default card-stage) | scroll (long-form document) | ledger' },
          discard: { type: 'boolean', description: 'Replace an open Fold that has unsaved changes, losing them. Default false (refuse instead)' },
        },
      },
      execute: async ({ title, foldType, discard, subtitle, eyebrow }) => {
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
          // a real cover, not a placeholder: `cover` is a registered kind whose whole schema is
          // .eyebrow / h1 / .lede, which is exactly what the deck already knows about itself
          inner: coverInner(deckTitle, subtitle, eyebrow),
          kind: 'cover',
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
          note: 'Fold created and open in the tab, its first fold already a cover carrying the title — add the rest with add_fold. It is NOT on disk: the human saves it with the Save button.',
        });
      },
    },

    {
      name: 'list_chunks',
      annotations: { readOnlyHint: true },
      // DEVIATION: "Read fresh from the file every time" -> the open Fold in this tab.
      description: "Table of contents of the open Fold: every editable chunk with id, kind, label and hidden flag, in order, plus the deck title, theme, foldType and capabilities.",
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
      description: "Read one chunk for editing: the deck context, the kind schema and the slide <template>. Edit it and send the whole element back via write_chunk. Prefer get_block when you only want a data block's JSON.",
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
      description: "Apply an edited chunk to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it. Send the whole <template data-origami-slide=...> element from read_chunk, edited; the slide id and kind are immutable and drift is rejected. Scripts, styles, iframes and remote URLs are ALLOWED but mark the deck \"active\" (recipients open it locked). Refused only when the content would break the single-file structure, or a data block fails its kind's schema. dryRun:true runs the WHOLE gate and applies nothing — same verdict, deck byte-identical.",
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
      description: "Add a new slide to the open Fold — this CHANGES THE DECK the human is looking at and re-renders it. Prefer add_fold when building a card from data; use this for raw markup, a starter, or a composite block. Defaults to a \"free\" slide with starter content at the end. Supply html for a built-in kind (get_kind_schema first), block + fields for a COMPOSITE defined in this Fold, or starter for a ready-made seeded fold (list_starters). dryRun:true builds and validates WITHOUT adding — same verdict, deck byte-identical.",
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
        const out = insertFold(deck, args);
        return ok({
          chunkId: out.id,
          index: out.index,
          capabilitiesGranted: out.grants,
          activeContent: activeContentFlags(out.inner).map((v) => v.rule),
          note: 'added to the open Fold and re-rendered — not yet on disk (the human saves).',
        });
      },
    },

    {
      name: 'add_custom_fold',
      description: "Add a whole CUSTOM FOLD (a full page) as one fold — this CHANGES THE OPEN FOLD and re-renders it. Pass `html`, the fold's inner. Prefer add_fold when building a card from data; use this to paste a report verbatim, or for markup add_fold cannot express. For a page a human EDITS by clicking, use inline-editable blocks in a <div class=\"slide-inner\">: h2/h3, p, p.lede, p.eyebrow, ul>li, .card-grid>.stat-card. Active content is ALLOWED but flags the deck active so recipients open it under the padlock; a stray <template>, an unbalanced <script>, or a data block that fails its schema is rejected.",
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
        const out = insertFold(deck, { kind: 'free', html, position, label: label ?? 'Custom fold' });
        const active = activeContentFlags(out.inner).map((v) => v.rule);
        return ok({
          foldId: out.id,
          index: out.index,
          capabilitiesGranted: out.grants,
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
      description: "Move one chunk to a different place in the open Fold — this CHANGES THE DECK the human is looking at and re-renders it. `position` is the 0-based index the chunk ENDS UP at, counting hidden folds. Order only: no content, label or kind is touched. A position outside the deck is REFUSED rather than clamped, so a wrong index never silently means \"last\". One undo step.",
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
      description: "Set one chunk's label, speaker notes or hidden flag — this CHANGES THE DECK the human is looking at. `label` is the sidebar and tab name; `notes` is presenter text that never renders; hidden:true takes a fold out of the show without deleting it, and set_chunk_meta({chunkId, hidden:false}) is the ONLY way back for a fold delete_chunk hid. Fields you do not pass are left alone (\"\" clears). Content and kind are untouched. One undo step.",
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
      description: "Hide or DELETE a slide in the open Fold — this CHANGES THE DECK the human is looking at. Default mode \"hide\" keeps the slide in the file but out of the show (recoverable — prefer it); mode \"delete\" removes the slide template entirely. A hidden fold comes back with set_chunk_meta({chunkId, hidden:false}); a deleted one only comes back through undo. Use propose_delete when the human should approve first.",
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
      description: "Register (or update) a COMPOSITE BLOCK definition in the deck — a reusable typed component a human can still edit field by field: a template of inert primitives plus a field manifest. Author instances with add_chunk({block, fields}). The template MUST render inert — no <script>, <style>, <iframe>, on* handlers or remote URLs — and an active one is rejected. This CHANGES THE OPEN FOLD.",
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
      description: "List the composite block definitions registered in this deck (kind, name, version, fields). Use a kind with add_chunk({block, fields}).",
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
      description: "The ready-made FOLDS you can add in one call: roadmap, flowchart, node-graph, drawing, venn, ledger. Each is a free card already holding one seeded data block, copied from the Studio's own palette. Add one with add_chunk({starter:\"<key>\"}). Use a starter when a seeded example is a fine base you will edit; use add_fold when you already have the data.",
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => ok({ starters: starterCatalog(), note: 'add one with add_chunk({starter:"roadmap"}) — it lands as a free fold holding that block, seeded and ready to edit.' }),
    },

    {
      name: 'delete_block',
      annotations: { destructiveHint: true },
      description: "Delete a composite block definition. Non-destructive to content: every placed instance keeps its baked output but loses its data-script, becoming plain inert content, so nothing dangles and the deck stays valid. This CHANGES THE OPEN FOLD.",
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
      description: "Set the deck-level masthead in the header bar: a subtitle line under the title and metadata chips (e.g. [\"5 plants\",\"Q3 2026\"]). This CHANGES THE OPEN FOLD. The bar's COLOURS and thickness are theme tokens, not set here. Pass \"\" or [] to clear.",
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
      description: "Set the deck TITLE and/or theme — this CHANGES THE DECK the human is looking at and re-renders it. `title` is the manifest and header-bar name; it does NOT rename the file. `themeName` renames the theme; ON ITS OWN IT CHANGES THE LABEL AND NOTHING ELSE — use apply_theme for colours. `themeTokens` patches CSS custom properties onto the ones in force (the rest survive); only the 17 the stylesheet reads are honoured, and braces, semicolons, angle brackets, @ and url() are rejected with nothing applied. One undo step.",
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
      description: "Set the deck's reading experience — this CHANGES THE OPEN FOLD. \"deck\" (default) is the card-stage: one fold at a time with tabs and pips. \"scroll\" is a continuous document: every fold stacked top to bottom (pair with document-kind folds). \"ledger\" is reserved. \"deck\" writes no key, so the file stays byte-stable.",
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
      description: "SEE THE DECK YOU CANNOT SEE. Lays the open Fold out in a real browser, off-screen, reports each fold's geometry and names four defects it can PROVE: OVERFLOW, masthead CLIP, EMPTY fold, SVG label COLLISION. Stated viewport, 1280x720 default. Read `outcome` first: clean | defects | unknown — unknown = something was NOT measured; never ship on unknown. `clean` is true only for a clean WHOLE deck. Too big for the 15s budget? It answers with the folds it reached plus `remeasure`: pass that back as `foldIds` (or use `maxFolds`) to measure a subset directly.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          viewport: {
            type: 'object',
            description: 'Screen to measure against (default 1280x720). Width 320-3840, height 240-2160.',
            properties: { width: { type: 'integer', description: 'CSS px, 320-3840' }, height: { type: 'integer', description: 'CSS px, 240-2160' } },
          },
          foldIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Measure ONLY these chunk ids (deck order is kept). An unknown id is refused. Folds not listed come back skipped:true and the deck-level `clean` stays false.',
          },
          maxFolds: { type: 'integer', minimum: 1, description: 'Measure at most this many folds, from the top of the deck (after foldIds, if both are given).' },
        },
      },
      execute: async ({ viewport, foldIds, maxFolds }) => {
        const model = deck.model();
        // the subset is resolved BEFORE the host check, so a bad id is refused the same way everywhere
        let ids = [...model.order];
        if (foldIds !== undefined) {
          if (!Array.isArray(foldIds) || foldIds.length === 0 || !foldIds.every((id) => typeof id === 'string')) {
            return fail(`foldIds must be a non-empty array of chunk ids — got ${JSON.stringify(foldIds)}`);
          }
          const unknown = foldIds.filter((id) => !model.slides.has(id));
          if (unknown.length > 0) return fail(`no such chunk: ${unknown.join(', ')} — list_chunks names the ids`, { unknown });
          const wanted = new Set(foldIds as string[]);
          ids = ids.filter((id) => wanted.has(id));
        }
        if (maxFolds !== undefined) {
          if (!Number.isInteger(maxFolds) || maxFolds < 1) return fail(`maxFolds must be a positive integer — got ${JSON.stringify(maxFolds)}`);
          ids = ids.slice(0, maxFolds);
        }
        if (!deps.measure) {
          return ok(unmeasurable(model, 'this host has no browser layout to measure (no measurement route was injected — unit tests and non-DOM hosts)'));
        }
        let m;
        try {
          m = await deps.measure(deck.serialize(), ids, viewport);
        } catch (e) {
          return ok(unmeasurable(model, `the measurement failed: ${(e as Error).message}`));
        }
        if (!m.viewport || !(m.viewport.width > 0) || !(m.viewport.height > 0)) {
          // belt and braces: measure.ts already rejects this, but a third-party measure route may not
          return ok(unmeasurable(model, `the measurement reported a ${m.viewport?.width ?? 0}x${m.viewport?.height ?? 0} viewport — no layout was done, so no fold was measured`));
        }
        const requested = new Set(ids);
        const analysed = analyseRender(model, m);
        const folds = (analysed.folds as Array<Record<string, unknown> & { id: string }>).map((f) =>
          requested.has(f.id) ? f : { id: f.id, kind: f.kind, label: f.label, hidden: f.hidden, skipped: true, measured: false, why: 'not requested (foldIds / maxFolds)' }
        );
        const verdict = summarise(folds, analysed.warnings);
        const budget = m.partial
          ? ` The ${m.partial.budgetMs / 1000}s measuring budget ran out after ${m.partial.measuredCount} of ${m.partial.requested} folds — the rest are measured:false; pass \`remeasure\` back as foldIds to finish.`
          : '';
        const subset = verdict.coverage.requested < verdict.coverage.total ? ` Only ${verdict.coverage.requested} of ${verdict.coverage.total} folds were requested, so \`clean\` is about this subset, not the deck.` : '';
        return ok({
          measured: verdict.coverage.measured > 0,
          outcome: verdict.outcome,
          clean: verdict.clean,
          coverage: verdict.coverage,
          ...(verdict.remeasure ? { remeasure: verdict.remeasure } : {}),
          viewport: m.viewport,
          note: `measured in a real off-screen render at ${m.viewport.width}x${m.viewport.height} CSS px.${budget}${subset} Layout is viewport-dependent — a fold that fits here can still break on a shorter screen, so re-run with a smaller viewport before you call a deck safe.`,
          folds,
          warnings: analysed.warnings,
          ...(m.partial ? { partial: m.partial } : {}),
        });
      },
    },

    {
      name: 'undo',
      // NOT in the stdio server: it has no session, so it has no stack to unwind. This is a
      // web-only tool built on @origami/format's History, which the page keeps per open Fold.
      description: "Reverse the LAST change to the open Fold and re-render it. One tool call is one undo step, so a run_batch of six is six steps. It covers every writer (origami_guide({topic:\"tools\"}) lists them). It does NOT cross create_deck or a Fold the human opened — both reset the stack — does not touch bytes already on disk, and does not cover a staged proposal (reject_proposal) or a saved theme (delete_theme). 50 steps deep, no redo. revert_to_saved drops a whole run_batch in one call.",
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
      name: 'revert_to_saved',
      annotations: { destructiveHint: true },
      // NOT in the stdio server, for the same reason undo is not: it has no session and no
      // History to jump. This is the "safe pivot" a run_batch that went sideways needs — undo
      // is one call per step (a 19-call batch is 19 undos), this is one call, period.
      description:
        "Drop EVERY unsaved change on the open Fold in ONE call — NOT undo (one step at a time). Jumps to the last save_deck, or to how the Fold was created/opened if never saved, clearing the undo stack in the same move — the safe pivot after a bad run_batch. Cannot itself be undone. Touches no disk. Refuses when nothing is open or nothing is unsaved.",
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const result = deck.revertToSaved();
        if (result === null) {
          return fail('nothing to revert — no change since the Fold was created, opened or last saved');
        }
        return ok({
          revertedTo: result.revertedTo,
          droppedUndoSteps: result.droppedUndoSteps,
          chunks: deck.model().order.length,
          note: 'reverted in the open Fold and re-rendered — nothing on disk or in browser storage was touched, and the undo stack was cleared by the revert, so this cannot itself be undone.',
        });
      },
    },

    {
      name: 'list_activity',
      annotations: { readOnlyHint: true },
      // NOT in the stdio server: a process that exits between calls has no session to keep a
      // feed for. One entry is recorded per call at ToolRegistry.invoke, so this is every route
      // into the tools, not just yours.
      description: "What has been DONE in this tab, newest first — one entry per tool call, whoever made it: seq, at, source (agent | human | console | replay), tool, ok plus the error, the target, ms and a one-line summary. The summary NEVER carries slide html, so reading the feed cannot cost what reading the deck costs — use read_chunk or export_deck for content. It is not the undo stack and not part of the Fold: nothing here is saved, a reload starts empty, and only the 500 newest are held.",
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
      description: "Hand YOURSELF the complete .origami.html text of the open Fold, as a string in the result — to hash it, diff it, or quote a fragment. It writes NOTHING, saves NOTHING and changes NOTHING, so calling this INSTEAD of save_deck ends the job with the work stranded in your context. save_deck stamps a fresh manifest.modified and this does not. A Fold over 4 MB is refused with its size — use save_deck.",
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
      description: "FINISH THE JOB: re-validate the Fold and put it somewhere durable. READ THE RESULT — only one of three outcomes is a save. saved:true means bytes were written to a real file AND read back. opfs.written means it is safe in this browser's private storage — invisible outside the page and evictable; the human retrieves it with \"Download last save\". downloadStarted means a download was fired but the page cannot see where it landed, so it is NEVER reported as saved. When saved is false the human must still press Save — say so rather than reporting success. It never throws and never opens a picker, so always end on it. Safe to call repeatedly; it changes no content.",
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
      description: "Propose an edit to a chunk WITHOUT applying it — STAGED for a human (or another agent) to review (a \"document PR\"). It appears as a review card in the page; if nobody is watching, resolve it yourself with accept_proposal. Same edit contract as write_chunk, validated NOW so a broken proposal never reaches review. accept_proposal refuses with a 3-way view if the chunk changed since — never a silent overwrite. Returns a proposalId.",
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
      description: "Propose a NEW slide WITHOUT adding it — staged for review (the add equivalent of propose_chunk). Same content args as add_chunk; the content is rendered, baked and validated now, then a slide.insert is staged. It appears as a review card for a watching human; resolve it yourself with accept_proposal if nobody is.",
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
      description: "Propose hiding or deleting a slide WITHOUT doing it — staged for review, as a card in the page and a queue entry you can resolve yourself. mode \"hide\" (default, recoverable) or \"delete\". accept_proposal refuses if the chunk is already gone.",
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
      description: "The review queue: every staged proposal with author, title, target chunk, the before/after content and a conflict flag (true if that chunk changed since). Empty until a propose_* call stages something. The human accepts or rejects by clicking the cards.",
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => ok({ proposals: await proposals.views(deck.model()) }),
    },

    {
      name: 'accept_proposal',
      // DEVIATION: no file write ("and write the file immediately (no save_deck needed)" ->
      // applies to the open Fold; call save_deck when you are done).
      description: "Accept a staged proposal — apply its edit to the open Fold immediately. Refuses if the target chunk changed since, returning the proposed and current content so you can re-propose against the new base (never a silent overwrite), and re-checks the data blocks against the CURRENT deck. Same action the human takes by clicking Accept, so use it when running unattended.",
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
            ...(res.violations !== undefined ? { violations: res.violations } : {}),
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
      description: "Drop a staged proposal without applying it. The same action the human takes by clicking Reject on the card.",
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
