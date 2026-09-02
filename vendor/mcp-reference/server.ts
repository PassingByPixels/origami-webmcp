import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  FOLD_TYPES,
  FORMAT_VERSION,
  KINDS,
  applyOp,
  extractChunk,
  kindSchemaComment,
  coerceChunkReply,
  parseDeck,
  serializeModel,
  validateDeck,
  validateSlideContent,
  activeContentFlags,
  validateVideoData,
  videoCapability,
  validateBlockDef,
  stripBlockInstances,
  renderComposite,
  blockInstanceJson,
  type CompositeBlockDef,
  type DeckModel,
  type FoldType,
  type Op,
  type TableSource,
} from '@origami/format';
import { atomicWrite } from './save.js';
import { assembleBlankDeck } from './new-deck.js';
import { DeckStore, serialise, skipWrite, type ConsentGrants } from './sessions.js';
import { FREE_STARTER_INNER, TABLE_STARTER_INNER } from './starters.js';
import { bakeTableInner } from './bake.js';
import { chunkHash, innerHash, loadProposals, proposalView, saveProposals, type ProposalOp } from './proposals.js';
import { applyRefresh, databricksConnector, sourceTables, type Connector, type QueryResult } from './refresh.js';

export const SERVER_VERSION = '0.1.0';

/** The host-side capabilities a tool needs to reach the armed browser. Present only when
    the server is hosted by the OrigamiLive helper over the relay (the stdio CLI and the
    bare --http port have no browser, so they pass no bridge → open_deck isn't registered).
    open_deck uses it to ask the user (in the relay tab) before touching a real file. */
export interface AuthorBridge {
  /** Ask the user, via the armed browser, to approve opening + editing this exact file.
      Resolves true (allow) / false (deny, or no answer within the host's timeout). */
  requestOpen(absPath: string): Promise<boolean>;
  /** After approval: start mirroring this file into the relay tab (push now + on every
      save), so the user watches the AI edit it live. */
  onOpened(absPath: string): void;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const fail = (message: string, extra?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }, null, 2) }],
  isError: true,
});

/** A refusal raised from inside a store.edit callback. Throwing (rather than returning) is
    what aborts the write: the file is never touched when the edit is rejected. */
class Refusal extends Error {
  constructor(readonly result: ToolResult) {
    super('refused');
  }
}
const refuse = (message: string, extra?: Record<string, unknown>): never => {
  throw new Refusal(fail(message, extra));
};

/** Tool bodies throw freely; the wire always gets a clean isError result. */
const guard = (fn: (args: any) => Promise<ToolResult>) => async (args: any): Promise<ToolResult> => {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof Refusal) return e.result;
    return fail((e as Error).message);
  }
};

/** Capabilities the slide content needs (video blocks → embed:<host>, F30).
    Mirrors the Studio: the grant rides the same step as the edit. */
const VIDEO_BLOCK_RE = /<script[^>]*\bdata-odata="video"[^>]*>([\s\S]*?)<\/script>/gi;
function videoCapsNeeded(inner: string): string[] {
  const caps = new Set<string>();
  for (const match of inner.matchAll(VIDEO_BLOCK_RE)) {
    try {
      const data = JSON.parse(match[1]);
      if (validateVideoData(data).length === 0) {
        const cap = videoCapability(data.provider);
        if (cap) caps.add(cap);
      }
    } catch {
      /* malformed JSON is validateDeck's catch at save time */
    }
  }
  return [...caps];
}

/** A path-safe, deck-like filename stem from a title (lowercase, hyphenated, bounded). */
function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'deck';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findDecks(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = (await fs.readdir(root, { recursive: true })) as string[];
    } catch {
      continue;
    }
    for (const rel of entries) {
      if (rel.toLowerCase().endsWith('.origami.html') && !rel.includes('node_modules')) {
        out.push(path.join(root, rel));
        if (out.length >= 200) return out;
      }
    }
  }
  return out;
}

/** The whole Origami contract, assembled from the live constants (KINDS, FOLD_TYPES,
    FORMAT_VERSION) so it can never drift from what the validator enforces. Returned by
    the origami_guide tool — an agent that has never seen Origami self-onboards from this. */
function origamiGuide(canOpen = false): Record<string, unknown> {
  return {
    formatVersion: FORMAT_VERSION,
    whatIsOrigami:
      'An Origami "Fold" is a single self-contained .origami.html file — a deck or document a browser plays on double-click, and that you edit over this MCP. It carries its own renderer inline; recipients need nothing installed. Edits are made one chunk (slide) at a time through the read→edit→write protocol below.',
    foldTypes: {
      deck: 'The card-stage: one fold at a time with tabs/pips; presentable (the default; writes no key).',
      scroll: 'A continuous-reading document: every fold stacked top-to-bottom (pair with document-kind folds for a long-form report).',
      ledger: 'Reserved for data/calc folds.',
    },
    contentModel:
      'A Fold is an ordered list of chunks (slides), each with a kind. Inside a chunk, content is built from inert blocks (headings, text, tables, charts, etc.). Data-driven blocks carry a JSON data block: <script type="application/json" data-odata="KIND">…</script>.',
    editProtocol: [
      'The deck PATH is the handle: pass it to every call. There is no session — each call reads the file, applies the change, and writes it back atomically.',
      '1. list_chunks(deck) — the table of contents (id, kind, label per chunk).',
      '2. read_chunk(deck, chunkId) — a self-contained payload: deck context + the kind schema + the slide <template>.',
      '3. Edit the <template> inner. The slide id and kind are IMMUTABLE — drift is rejected, not repaired.',
      '4. write_chunk(deck, chunkId, html) to apply, or add_chunk / delete_chunk. Each one WRITES THE FILE.',
      '5. save_deck(deck) — optional final check: re-validates the file and reports its path + size.',
    ],
    inertRules: {
      summary:
        'Inert-by-default. The ONLY executable-looking construct allowed without flagging the deck "active" is a JSON data block: <script type="application/json" data-odata="KIND">…</script> (byte-exact opener). Escape "<" in the JSON as \\u003c so it can never terminate the block.',
      hard: [
        'No <template> tags inside slide content (they break the single-file structure).',
        'Balanced <script>/</script>.',
        'These are rejected at write/save time — nothing is applied.',
      ],
      active:
        'Any real <script>, <style>, <iframe>, <form>, <link>/<meta>/<base>, inline on* handler, javascript: URL, remote (//) src/href, @import, or non-image/non-font data: URI marks the deck ACTIVE. It still saves, but recipients open it behind a padlock until they trust the sender. Prefer inert constructs; use the data-block kinds instead of hand-rolled scripts.',
    },
    capabilities:
      'Embeds (video, dashboards) need a manifest capability "embed:<host>". write_chunk and add_chunk auto-grant it for recognised video blocks; otherwise the deck is flagged for the missing capability.',
    kinds: Object.fromEntries(
      Object.values(KINDS).map((k) => [k.key, { name: k.name, schema: k.schemaComment }])
    ),
    tools: {
      origami_guide: 'This — the whole contract (optionally one kind).',
      create_deck: 'Create a new blank deck from nothing (no pre-existing file needed) and get its path — call this first when building something new, then author it (every edit writes the file).',
      ...(canOpen
        ? {
            open_deck:
              "Open an EXISTING deck by absolute path from anywhere on the user's machine (the user approves it in the browser first); then edit it live with the read→edit→write protocol — each write lands on the real file. Use this when asked to open/edit a specific existing file.",
          }
        : {}),
      list_decks: 'Find .origami.html files in the served folders.',
      list_chunks: 'Table of contents of one deck.',
      read_chunk: 'Read one chunk to edit (payload + schema + template).',
      write_chunk: 'Apply an edited chunk — writes the file immediately.',
      add_chunk: 'Add a new slide (free/table starters; supply html for other kinds; or block+fields for a composite).',
      add_custom_fold: 'Add a whole CUSTOM FOLD (page) from html — an editable page (Origami blocks in a .slide-inner) or a raw report (active content allowed, opens under the padlock).',
      delete_chunk: 'Hide (recoverable) or delete a slide.',
      define_block: 'Register (or update) a composite block def (a reusable typed, inert, human-editable component).',
      list_block_defs: 'List the composite block defs registered in this deck.',
      delete_block: 'Delete a composite block def (its placed instances stay as plain content).',
      get_kind_schema: 'The markup contract for one kind (same as origami_guide(kind)).',
      set_header: 'Deck masthead: subtitle + metadata chips.',
      set_fold_type: 'Set the reading experience (deck | scroll | ledger).',
      save_deck: 'Optional final check — every edit already wrote through; this re-validates the file and reports its size.',
      propose_chunk: 'Stage a chunk edit for review instead of applying it (a "document PR").',
      propose_add: 'Stage a new slide for review (the add equivalent of propose_chunk).',
      propose_delete: 'Stage a hide/delete for review.',
      list_proposals: 'The review queue: staged proposals (edit/add/delete/hide) with before/after + conflict flag.',
      accept_proposal: 'Apply a staged proposal (refuses on a since-changed or already-gone chunk).',
      reject_proposal: 'Drop a staged proposal.',
      refresh_sources: 'Re-pull every self-refreshing table (a `source` side-map) through its connector, re-bake, stamp freshness; returns changed cells to narrate.',
    },
  };
}

/** Build a slide.insert op from add_chunk/propose_add args (starters / supplied html /
    composite block render+bake). Shared so add_chunk applies it and propose_add stages it
    from one code path. Returns an error envelope or the op + its inner + needed video caps. */
type InsertBuild =
  | { error: string; extra?: Record<string, unknown> }
  | { id: string; insert: Extract<Op, { t: 'slide.insert' }>; inner: string; grants: string[] };

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
    if (!def) return { error: `unknown composite block "${block}" — define it with define_block first`, extra: { availableBlocks: Object.keys(m.blocks) } };
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
  inner = bakeTableInner(inner, Date.now());
  const violations = validateSlideContent(inner);
  if (violations.length > 0) return { error: 'the slide would break the deck structure', extra: { violations } };
  const id = 's' + randomBytes(4).toString('hex');
  const index = position === undefined ? m.order.length : position;
  const grants = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
  return {
    id,
    insert: { t: 'slide.insert', id, index, kind: slideKind, label: slideLabel ?? (KINDS[slideKind]?.name ?? 'New slide'), inner },
    inner,
    grants,
  };
}

/** create_deck's probe-and-write queue, keyed on the target file name it is about to claim.
    Module-level, not per-server: two requests under 2026-07-28 build their OWN server instance
    from the same process, so a per-instance map would not serialise them at all. */
const createLocks = new Map<string, Promise<unknown>>();

/* Every tool takes the deck PATH as its handle and reads/writes the FILE (2026-07-28
   stateless — there is no session to accumulate edits in). Mutating tools write through
   immediately via store.edit; save_deck is now a confirm-and-validate, kept because it is
   the step every Origami agent guide ends on. `grants` is the open_deck consent set, owned
   by the armed helper process and shared across requests (see sessions.ts). */
export function buildServer(
  roots: string[],
  connector: Connector = databricksConnector(),
  bridge?: AuthorBridge,
  grants?: ConsentGrants
): McpServer {
  const store = new DeckStore(roots, grants);
  const server = new McpServer({ name: 'origami', version: SERVER_VERSION });

  server.registerTool(
    'origami_guide',
    {
      description:
        'START HERE. The whole Origami contract in one call — what a Fold is, the read→edit→write chunk protocol, every kind schema, the inert/active rules, the capability model, and the tool catalog. An agent with no prior knowledge of Origami should call this once on connect to learn the format. Pass a kind to get just that kind\'s schema.',
      inputSchema: { kind: z.string().optional().describe('Optional: one kind to detail (else the whole contract)') },
    },
    guard(async ({ kind }) => {
      if (kind) {
        const spec = KINDS[kind];
        if (!spec) return fail(`unknown kind "${kind}"`, { availableKinds: Object.keys(KINDS) });
        return ok({ kind: spec.key, name: spec.name, schema: kindSchemaComment(kind) });
      }
      return ok(origamiGuide(!!bridge));
    })
  );

  server.registerTool(
    'list_decks',
    {
      description:
        'List the .origami.html decks in the served folders. Returns path (use it as the "deck" argument everywhere), title, slide count and last-modified.',
      inputSchema: {},
    },
    guard(async () => {
      const decks = [];
      for (const p of await findDecks(store.roots)) {
        try {
          const d = parseDeck(await fs.readFile(p, 'utf8'));
          decks.push({
            path: p,
            title: d.manifest.title,
            slides: d.manifest.order.length,
            modified: d.manifest.modified,
          });
        } catch (e) {
          decks.push({ path: p, error: `unreadable deck: ${(e as Error).message}` });
        }
      }
      return ok({ roots: store.roots, decks });
    })
  );

  server.registerTool(
    'create_deck',
    {
      description:
        'Create a NEW blank deck — a fresh, valid .origami.html with one editable fold — and return its path. The file exists on disk the moment this returns. Removes the need for a pre-existing file: call this FIRST when asked to build something from nothing, then author it with add_chunk / write_chunk / define_block (pass the returned path as "deck"; every one of those calls writes the file itself). Writes into the first served folder; the filename is derived from the title and never overwrites an existing deck. foldType picks the reading experience (deck | scroll | ledger; default deck).',
      inputSchema: {
        title: z.string().max(200).optional().describe('Deck title (default "Untitled deck"); also seeds the filename'),
        foldType: z.enum(FOLD_TYPES).optional().describe('deck (default card-stage) | scroll (long-form document) | ledger'),
      },
    },
    guard(async ({ title, foldType }) => {
      const root = store.roots[0];
      if (!root) return fail('no served folder to create a deck in');
      const deckTitle = (typeof title === 'string' && title.trim()) || 'Untitled deck';
      const ft = (foldType ?? 'deck') as FoldType;
      const stem = slugifyTitle(deckTitle);
      // The probe-and-write must be ONE critical section. Unlocked, two same-title creates both
      // probed "<stem>.origami.html is free" and then both wrote it: one deck silently lost, and
      // a fan-out of 8 collided on the temp name too and reported a file lock that did not exist.
      // Keyed on the target name (root + stem), so unrelated titles still create in parallel.
      const createKey = path.join(root, stem);
      return serialise(createLocks, process.platform === 'win32' ? createKey.toLowerCase() : createKey, async () => {
        // re-probed INSIDE the lock: whatever the previous create in this queue wrote is visible
        let file = `${stem}.origami.html`;
        for (let n = 2; await pathExists(path.join(root, file)); n++) file = `${stem}-${n}.origami.html`;
        const abs = path.join(root, file);
        const text = assembleBlankDeck({
          title: deckTitle,
          foldType: ft,
          now: new Date().toISOString(),
          id: 'd-' + randomBytes(4).toString('hex'),
          slideId: 's' + randomBytes(4).toString('hex'),
        });
        const violations = validateDeck(parseDeck(text));
        if (violations.length > 0) return fail('internal: assembled an invalid blank deck', { violations });
        await atomicWrite(abs, text);
        return ok({
          created: abs,
          deck: abs,
          title: deckTitle,
          foldType: ft,
          slides: 1,
          note: 'blank deck created and written to disk — author it with add_chunk / write_chunk / define_block (each call writes the file; pass this path as "deck")',
        });
      });
    })
  );

  // open_deck only exists when a browser is on the other end to consent (the armed relay).
  // The stdio CLI and the bare --http port pass no bridge → an agent there edits only the
  // served folders, never an arbitrary file, with no one to approve it.
  if (bridge) {
    server.registerTool(
      'open_deck',
      {
        description:
          "Open an EXISTING .origami.html deck ANYWHERE on the user's computer to edit it — beyond the served folders. The user gets a one-time prompt in their browser to allow editing THIS file; nothing is read until they approve. On approval the deck opens in their live view (they watch your edits) and you edit it with list_chunks / read_chunk / write_chunk — pass the returned path as \"deck\". Every write lands on the REAL file in place, immediately. Use this when asked to open or edit a specific existing deck by its path; use create_deck instead to build a new one.",
        inputSchema: {
          path: z.string().describe("Absolute path to an existing .origami.html deck on the user's machine"),
        },
      },
      guard(async ({ path: deckPath }) => {
        if (typeof deckPath !== 'string' || !deckPath.trim()) return fail('open_deck needs a file path');
        const abs = path.resolve(deckPath);
        if (!abs.toLowerCase().endsWith('.origami.html')) {
          return fail(`not a deck: "${deckPath}" (decks end in .origami.html)`);
        }
        // CONSENT FIRST — never touch the filesystem on an AI-supplied path before the user
        // approves it. Reading/parsing first would leak existence + format (and parse errors
        // echo file bytes) for any *.origami.html path with zero user interaction. The prompt
        // shows the exact path, so asking before the read costs nothing.
        const approved = await bridge.requestOpen(abs);
        if (!approved) {
          return fail('the user declined to open this deck (or did not respond) — nothing was opened');
        }
        // approved: now it's safe to read the real file and confirm it's a deck
        let text: string;
        try {
          text = await fs.readFile(abs, 'utf8');
        } catch {
          return fail(`approved, but there is no such deck on disk: "${abs}" (open_deck opens an EXISTING file)`);
        }
        let title: string;
        let slides: number;
        try {
          const d = parseDeck(text);
          title = d.manifest.title;
          slides = d.manifest.order.length;
        } catch (e) {
          return fail(`approved, but this file isn't a readable Origami deck: ${(e as Error).message}`);
        }
        store.allow(abs); // widen the sandbox to this one approved file (not its folder)
        bridge.onOpened(abs); // mirror it into the relay view now + on every save
        return ok({
          opened: abs,
          deck: abs,
          title,
          slides,
          note: 'approved by the user — they are watching it live. Edit with list_chunks / read_chunk / write_chunk (pass this path as "deck"); every write lands on the real file immediately.',
        });
      })
    );
  }

  server.registerTool(
    'list_chunks',
    {
      description:
        'Table of contents of one deck: every editable chunk (slide) with id, kind, label and hidden flag, in order. Read fresh from the file every time.',
      inputSchema: { deck: z.string().describe('Deck path, as returned by list_decks') },
    },
    guard(async ({ deck }) => {
      const { model: m } = await store.open(deck);
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
    })
  );

  server.registerTool(
    'read_chunk',
    {
      description:
        'Read one chunk for editing: a self-contained payload with the deck context, the kind schema (what markup is valid), and the slide <template>. Edit the template and send the whole element back via write_chunk. Always reflects the current file on disk.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        chunkId: z.string().describe('Chunk id from list_chunks'),
      },
    },
    guard(async ({ deck, chunkId }) => {
      const { model } = await store.open(deck);
      const current = parseDeck(serializeModel(model));
      return ok(extractChunk(current, chunkId));
    })
  );

  server.registerTool(
    'write_chunk',
    {
      description:
        'Apply an edited chunk to the deck — this WRITES THE FILE (atomic). Send the whole <template data-origami-slide=...> element from read_chunk, edited. The slide id and kind are immutable; drift is rejected. The only hard rule is single-file structure (no stray <template> tags, balanced <script>). Scripts, styles, iframes and remote URLs are ALLOWED — they mark the deck "active" (returned as activeContent; recipients open it locked until they trust the sender). Returns errors instead of applying only when the content would break the file structure.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        chunkId: z.string().describe('The chunk the edit was for'),
        html: z.string().describe('The edited <template> element (a full chunk reply is fine too)'),
        force: z.boolean().optional().describe('Overwrite even if another writer changed the file mid-edit'),
      },
    },
    guard(async ({ deck, chunkId, html, force }) => {
      const out = await store.edit(
        deck,
        (m) => {
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
          // bake-at-write: every table block's formulas -> values (within-block; structure unchanged).
          // Kind-blind on purpose: a ledger is usually a FREE card holding a table figure.
          const inner = bakeTableInner(reply.inner, Date.now());

          const caps = videoCapsNeeded(inner).filter((c) => !m.capabilities.includes(c));
          const op: Op =
            caps.length > 0
              ? {
                  t: 'batch',
                  ops: [
                    { t: 'slide.inner', id: chunkId, inner },
                    { t: 'deck.caps', capabilities: [...m.capabilities, ...caps] },
                  ],
                }
              : { t: 'slide.inner', id: chunkId, inner };
          applyOp(m, op);
          return { caps, inner };
        },
        { force }
      );
      const { caps, inner } = out.value;
      return ok({
        applied: chunkId,
        capabilitiesGranted: caps,
        activeContent: activeContentFlags(inner).map((v) => v.rule),
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'add_chunk',
    {
      description:
        'Add a new slide — this WRITES THE FILE (atomic). Defaults to a "free" slide with starter content at the end of the deck. For a built-in kind supply html (call get_kind_schema first). For a COMPOSITE block, pass block + fields (a kind from define_block / list_block_defs) — the server renders + bakes the block into a free slide; no html needed.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        kind: z.string().optional().describe('Slide kind (default "free")'),
        position: z.number().int().min(0).optional().describe('0-based insert index (default: end)'),
        label: z.string().optional().describe('Sidebar label (default: kind/def name)'),
        html: z.string().optional().describe('Slide inner markup; required for kinds other than "free"'),
        block: z.string().optional().describe('A composite block kind (x.<name>) from define_block — renders + bakes an instance'),
        fields: z.record(z.unknown()).optional().describe('Field values for the composite block (block instance values)'),
      },
    },
    guard(async ({ deck, kind, position, label, html, block, fields }) => {
      const out = await store.edit(deck, (m) => {
        const b = buildInsert(m, { kind, html, block, fields, position, label });
        if ('error' in b) refuse(b.error, b.extra);
        const ins = b as Extract<InsertBuild, { id: string }>;
        const op: Op =
          ins.grants.length > 0
            ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
            : ins.insert;
        applyOp(m, op);
        return { b: ins, index: m.order.indexOf(ins.id) };
      });
      const { b, index } = out.value;
      return ok({
        chunkId: b.id,
        index,
        capabilitiesGranted: b.grants,
        activeContent: activeContentFlags(b.inner).map((v) => v.rule),
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'add_custom_fold',
    {
      description:
        'Add a whole CUSTOM FOLD (a full page) as one fold — the same feature the Studio exposes in its left rail. Pass `html`, the fold\'s inner. For a page a human EDITS by clicking straight on it, compose it from Origami\'s inline-editable blocks inside a <div class="slide-inner">: headings (<h2>/<h3>), paragraphs (<p>, <p class="lede">, <p class="eyebrow">), lists (<ul><li>…), and stat cards (<div class="card-grid"><div class="stat-card"><div class="big">42</div><div class="lbl">Label</div></div>…</div>). Or paste a full report verbatim — active content (scripts, <style>, remote assets) is ALLOWED but flags the deck active so a recipient opens it under the padlock; only a stray <template> or unbalanced <script> is rejected (it would corrupt the single file). This WRITES THE FILE (atomic).',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        html: z.string().describe('The fold\'s inner HTML — a whole page (editable Origami blocks in a .slide-inner, or a raw report)'),
        label: z.string().optional().describe('Sidebar label (default: "Custom fold")'),
        position: z.number().int().min(0).optional().describe('0-based insert index (default: end)'),
      },
    },
    guard(async ({ deck, html, label, position }) => {
      const out = await store.edit(deck, (m) => {
        const b = buildInsert(m, { kind: 'free', html, position, label: label ?? 'Custom fold' });
        if ('error' in b) refuse(b.error, b.extra);
        const ins = b as Extract<InsertBuild, { id: string }>;
        const op: Op =
          ins.grants.length > 0
            ? { t: 'batch', ops: [ins.insert, { t: 'deck.caps', capabilities: [...m.capabilities, ...ins.grants] }] }
            : ins.insert;
        applyOp(m, op);
        return { b: ins, index: m.order.indexOf(ins.id) };
      });
      const { b, index } = out.value;
      const active = activeContentFlags(b.inner).map((v) => v.rule);
      return ok({
        foldId: b.id,
        index,
        capabilitiesGranted: b.grants,
        activeContent: active,
        padlock: active.length > 0,
        written: out.key,
        bytes: out.bytes,
        note:
          active.length > 0
            ? 'active content present — the deck opens under the padlock (allowed by design)'
            : 'inert — no padlock',
      });
    })
  );

  server.registerTool(
    'delete_chunk',
    {
      description:
        'Hide or delete a slide — this WRITES THE FILE (atomic). Default mode "hide" keeps the slide in the file but out of the show (the recoverable path — prefer it); mode "delete" removes the slide template entirely.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        chunkId: z.string().describe('Chunk id from list_chunks'),
        mode: z.enum(['hide', 'delete']).optional().describe('Default "hide"'),
      },
    },
    guard(async ({ deck, chunkId, mode = 'hide' }) => {
      const out = await store.edit(deck, (m) => {
        if (!m.slides.has(chunkId)) refuse(`unknown chunk "${chunkId}" — call list_chunks`);
        if (mode === 'hide') applyOp(m, { t: 'slide.meta', id: chunkId, patch: { hidden: true } });
        else applyOp(m, { t: 'slide.remove', id: chunkId });
      });
      return ok({
        [mode === 'hide' ? 'hidden' : 'deleted']: chunkId,
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'get_kind_schema',
    {
      description: 'The markup contract for a slide/block kind: what structure and attributes are valid.',
      inputSchema: { kind: z.string().describe('Kind key, e.g. "free", "gantt", "chart"') },
    },
    guard(async ({ kind }) => {
      const spec = KINDS[kind];
      if (!spec) {
        return fail(`unknown kind "${kind}"`, { availableKinds: Object.keys(KINDS) });
      }
      return ok({ kind: spec.key, name: spec.name, schema: kindSchemaComment(kind) });
    })
  );

  server.registerTool(
    'define_block',
    {
      description:
        'Register (or update) a COMPOSITE BLOCK definition in the deck — a reusable typed component a human can still edit field-by-field. The def is a template of inert primitives + a field manifest; once defined, author instances via add_chunk(block, fields). The template MUST render inert (no <script>/<style>/<iframe>/on*/remote URLs) — an active template is rejected. Re-defining the same kind replaces it (bump version). This WRITES THE FILE (atomic).',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        def: z
          .object({
            kind: z.string().describe('x.<name> — lowercase letters/digits/hyphens; never collides with built-ins'),
            name: z.string(),
            version: z.number().int().min(1),
            fields: z
              .array(
                z.object({
                  name: z.string().describe('identifier, referenced in the template as {{name}}'),
                  type: z.enum(['text', 'number', 'select', 'color']),
                  label: z.string().optional(),
                  options: z.array(z.string()).optional().describe('required for type "select"'),
                  default: z.union([z.string(), z.number()]).optional(),
                })
              )
              .describe('the human-edit contract — the Studio auto-generates a control per field'),
            template: z.string().describe('inert HTML using {{field}} placeholders (HTML-escaped at render)'),
            schemaComment: z.array(z.string()).optional(),
          })
          .describe('the CompositeBlockDef'),
      },
    },
    guard(async ({ deck, def }) => {
      const violations = validateBlockDef(def);
      if (violations.length > 0) return fail('invalid block def — nothing was registered', { violations });
      const d = def as CompositeBlockDef;
      const out = await store.edit(deck, (m) => {
        applyOp(m, { t: 'deck.blocks', blocks: { ...m.blocks, [d.kind]: d } });
      });
      return ok({
        defined: d.kind,
        version: d.version,
        fields: d.fields.map((f) => f.name),
        written: out.key,
        bytes: out.bytes,
        note: 'now author instances with add_chunk({block:"' + d.kind + '", fields:{…}})',
      });
    })
  );

  server.registerTool(
    'list_block_defs',
    {
      description: 'List the composite block definitions registered in this deck (kind, name, version, fields). Use a kind with add_chunk(block, fields).',
      inputSchema: { deck: z.string().describe('Deck path') },
    },
    guard(async ({ deck }) => {
      const { model } = await store.open(deck);
      return ok({
        blocks: Object.values(model.blocks).map((d) => ({ kind: d.kind, name: d.name, version: d.version, fields: d.fields })),
      });
    })
  );

  server.registerTool(
    'delete_block',
    {
      description:
        'Delete a composite block definition from the deck. Non-destructive: every placed instance keeps its baked output but loses its data-script, becoming plain inert content — so there is no dangling reference and the deck stays valid. This WRITES THE FILE (atomic).',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        kind: z.string().describe('Block kind x.<name> from list_block_defs'),
      },
    },
    guard(async ({ deck, kind }) => {
      const out = await store.edit(deck, (m) => {
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
        applyOp(m, ops.length > 1 ? { t: 'batch', ops } : ops[0]);
        return { name: def!.name, frozen };
      });
      return ok({
        deleted: kind,
        name: out.value.name,
        instancesFrozen: out.value.frozen,
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'set_header',
    {
      description:
        'Set the deck-level masthead shown in the header bar (a corporate report header): a subtitle line under the title and metadata chips (e.g. ["5 plants","Built 2026-06-15","Q3 2026"]). This WRITES THE FILE (atomic). The bar COLOURS and thickness are theme tokens (chrome / chrome-ink / chrome-mark / chrome-pad), set in the deck theme or the Studio Header panel — not here. Pass an empty subtitle ("") / chips ([]) to clear.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        subtitle: z.string().max(200).optional().describe('A line under the deck title'),
        chips: z.array(z.string().max(60)).max(8).optional().describe('Metadata chips'),
      },
    },
    guard(async ({ deck, subtitle, chips }) => {
      if (subtitle === undefined && chips === undefined) {
        return fail('nothing to set — supply subtitle and/or chips');
      }
      const out = await store.edit(deck, (m) => {
        const header = { ...m.header };
        if (subtitle !== undefined) header.subtitle = subtitle;
        if (chips !== undefined) header.chips = chips;
        applyOp(m, { t: 'deck.header', header });
        return m.header;
      });
      return ok({ header: out.value, written: out.key, bytes: out.bytes });
    })
  );

  server.registerTool(
    'set_fold_type',
    {
      description:
        'Set the deck\'s reading experience (foldType). "deck" (default) = the card-stage — one fold at a time with tabs/pips, presentable. "scroll" = a continuous-reading document — every fold stacked and read top to bottom (pair it with document-kind folds for a long-form report). "ledger" is reserved. This WRITES THE FILE (atomic). "deck" is the default and writes no key, so the file stays byte-stable.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        foldType: z.enum(FOLD_TYPES).describe('deck | scroll | ledger'),
      },
    },
    guard(async ({ deck, foldType }) => {
      const out = await store.edit(deck, (m) => {
        applyOp(m, { t: 'deck.foldType', foldType });
        // scroll stacks every fold as-is; a deck with no document folds reads as a stack
        // of full-screen card scenes — advise (no behaviour change, no byte impact).
        const noDoc = foldType === 'scroll' && ![...m.slides.values()].some((s) => s.kind === 'document');
        return { foldType: m.foldType, noDoc }; // read back the mutated model, not the input
      });
      return ok({
        foldType: out.value.foldType,
        ...(out.value.noDoc
          ? { warning: 'this deck has no document-kind folds — scroll mode stacks every fold as-is; add document folds via add_chunk(kind:"document") for a long-form report' }
          : {}),
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'save_deck',
    {
      description:
        'Confirm the deck. Every edit tool already wrote the file (the protocol is stateless — there is no unsaved buffer), so this is the optional final check: it re-reads the file, re-validates the format, and reports the path and size. Safe to call any number of times; it never changes content.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        force: z.boolean().optional().describe('Accepted and ignored — kept so older agent scripts still run'),
      },
    },
    guard(async ({ deck }) => {
      const key = store.resolve(deck);
      const text = await fs.readFile(key, 'utf8');
      const violations = validateDeck(parseDeck(text));
      if (violations.length > 0) {
        return fail('the deck on disk fails format validation', { violations, path: key });
      }
      return ok({
        saved: true,
        path: key,
        bytes: Buffer.byteLength(text, 'utf8'),
        note: 'already on disk — each edit writes through atomically as it is made',
      });
    })
  );

  /* ---------- propose-review-accept (§3): stage edits for review instead of applying ---------- */

  server.registerTool(
    'propose_chunk',
    {
      description:
        'Propose an edit to a chunk WITHOUT applying it — STAGED for a human (or another agent) to review and accept (a "document PR"). Same edit contract as write_chunk (send the edited <template>; id+kind immutable; single-file structure validated NOW so a broken proposal never reaches review). The proposal pins the chunk\'s current content; accept_proposal refuses with a 3-way view if the chunk changed since — never a silent overwrite. Returns a proposalId. Review with list_proposals; apply with accept_proposal; drop with reject_proposal.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        chunkId: z.string().describe('The chunk to edit'),
        html: z.string().describe('The edited <template> element (a full chunk reply is fine)'),
        title: z.string().optional().describe('Short summary of the change (the PR title)'),
        prompt: z.string().optional().describe('What you were asked to do (optional provenance)'),
        author: z.string().optional().describe('Who is proposing (default "agent")'),
      },
    },
    // Serialised on the deck's lock: the sidecar is a read-modify-write like any other, and
    // without it six parallel proposes each read the same empty list and the last write won.
    guard(async ({ deck, chunkId, html, title, prompt, author }) =>
      store.withLock(deck, async () => {
        const { key, model: m } = await store.open(deck);
        const slide = m.slides.get(chunkId);
        if (!slide) return fail(`unknown chunk "${chunkId}" — call list_chunks`);

        const reply = coerceChunkReply(html, { slideId: chunkId, kind: slide.kind });
        if (!reply.coerced && reply.slideId !== chunkId) {
          return fail(`slide id drift: reply targets "${reply.slideId}" but the edit was for "${chunkId}"`);
        }
        if (!reply.coerced && reply.kind !== slide.kind) {
          return fail(`kind drift: reply declares "${reply.kind}" but "${chunkId}" is "${slide.kind}"`);
        }
        const violations = validateSlideContent(reply.inner);
        if (violations.length > 0) {
          return fail('the edit would break the deck structure — not staged', { violations });
        }
        const inner = bakeTableInner(reply.inner, Date.now());
        const id = 'p' + randomBytes(4).toString('hex');
        const proposals = await loadProposals(key);
        proposals.push({
          id,
          author: author ?? 'agent',
          title: title ?? `Edit ${chunkId}`,
          prompt,
          op: { t: 'slide.inner', id: chunkId, inner },
          targetId: chunkId,
          baseHash: chunkHash(m, chunkId),
        });
        await saveProposals(key, proposals);
        return ok({
          proposalId: id,
          staged: chunkId,
          activeContent: activeContentFlags(inner).map((v) => v.rule),
          note: 'staged for review — not applied. Use list_proposals / accept_proposal / reject_proposal.',
        });
      })
    )
  );

  server.registerTool(
    'list_proposals',
    {
      description:
        'The review queue: every staged proposal for a deck with author, title, the target chunk, the before/after content, and a conflict flag (true if that chunk changed since the proposal was made). Empty until propose_chunk stages something.',
      inputSchema: { deck: z.string().describe('Deck path') },
    },
    guard(async ({ deck }) => {
      const { key, model } = await store.open(deck);
      const proposals = await loadProposals(key);
      return ok({
        proposals: proposals.map((p) => {
          const cur = model.slides.get(p.targetId);
          return proposalView(p, model, cur ? innerHash(cur.inner) : undefined);
        }),
      });
    })
  );

  server.registerTool(
    'accept_proposal',
    {
      description:
        'Accept a staged proposal — apply its edit to the deck and write the file immediately (no save_deck needed). Refuses if the target chunk changed since the proposal was made: returns conflicted with the proposed + current content so you can re-propose against the new base (never a silent overwrite). Video capabilities the edit needs are granted on accept.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        proposalId: z.string().describe('Proposal id from list_proposals'),
      },
    },
    guard(async ({ deck, proposalId }) => {
      const out = await store.edit(deck, async (m, handle) => {
        const proposals = await loadProposals(handle.key);
        const i = proposals.findIndex((p) => p.id === proposalId);
        if (i === -1) refuse(`unknown proposal "${proposalId}" — call list_proposals`);
        const p = proposals[i];

        // conflict gate per op kind — never a silent overwrite or a double-remove
        if (p.op.t === 'slide.inner') {
          const cur = m.slides.get(p.targetId);
          if (!cur) refuse(`the target chunk "${p.targetId}" no longer exists — this proposal is stale`, { conflicted: true });
          if (innerHash(cur!.inner) !== p.baseHash) {
            refuse('the target chunk changed since this proposal — review and re-propose against the new content', {
              conflicted: true,
              targetId: p.targetId,
              proposed: p.op.inner,
              current: cur!.inner,
            });
          }
        } else if (p.op.t === 'slide.remove' || p.op.t === 'slide.meta') {
          if (!m.slides.has(p.targetId)) refuse(`the target chunk "${p.targetId}" is already gone — this proposal is stale`, { conflicted: true });
        }
        // slide.insert never conflicts — it carries a fresh id

        const newInner = p.op.t === 'slide.inner' || p.op.t === 'slide.insert' ? p.op.inner : '';
        const caps = newInner ? videoCapsNeeded(newInner).filter((c) => !m.capabilities.includes(c)) : [];
        const ops: Op[] = [p.op];
        if (caps.length > 0) ops.push({ t: 'deck.caps', capabilities: [...m.capabilities, ...caps] });
        // provenance: stamp who authored the chunk that persists (edit / add) — inert manifest meta
        if (p.author && (p.op.t === 'slide.inner' || p.op.t === 'slide.insert')) {
          ops.push({ t: 'slide.meta', id: p.targetId, patch: { oby: p.author } });
        }
        applyOp(m, ops.length > 1 ? { t: 'batch', ops } : ops[0]);
        proposals.splice(i, 1);
        await saveProposals(handle.key, proposals);
        const action = { 'slide.inner': 'edit', 'slide.insert': 'add', 'slide.remove': 'delete', 'slide.meta': 'hide' }[p.op.t];
        return { action, targetId: p.targetId, caps, remaining: proposals.length };
      });
      const v = out.value;
      return ok({
        accepted: proposalId,
        action: v.action,
        applied: v.targetId,
        capabilitiesGranted: v.caps,
        remainingProposals: v.remaining,
        written: out.key,
        bytes: out.bytes,
      });
    })
  );

  server.registerTool(
    'reject_proposal',
    {
      description: 'Drop a staged proposal without applying it.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        proposalId: z.string().describe('Proposal id from list_proposals'),
      },
    },
    guard(async ({ deck, proposalId }) =>
      store.withLock(deck, async () => {
        const { key } = await store.open(deck);
        const proposals = await loadProposals(key);
        const i = proposals.findIndex((p) => p.id === proposalId);
        if (i === -1) return fail(`unknown proposal "${proposalId}" — call list_proposals`);
        proposals.splice(i, 1);
        await saveProposals(key, proposals);
        return ok({ rejected: proposalId, remainingProposals: proposals.length });
      })
    )
  );

  server.registerTool(
    'propose_add',
    {
      description:
        'Propose a NEW slide WITHOUT adding it — staged for review (the add equivalent of propose_chunk). Same content args as add_chunk (kind/html, or block+fields for a composite); the server renders + bakes + validates now, then stages a slide.insert. Review with list_proposals; apply with accept_proposal.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        kind: z.string().optional().describe('Slide kind (default "free")'),
        position: z.number().int().min(0).optional().describe('0-based insert index (default: end)'),
        label: z.string().optional().describe('Sidebar label'),
        html: z.string().optional().describe('Slide inner markup; required for kinds other than "free"'),
        block: z.string().optional().describe('A composite block kind (x.<name>) from define_block'),
        fields: z.record(z.unknown()).optional().describe('Field values for the composite block'),
        title: z.string().optional().describe('Short summary (the PR title)'),
        prompt: z.string().optional().describe('What you were asked to do (optional provenance)'),
        author: z.string().optional().describe('Who is proposing (default "agent")'),
      },
    },
    guard(async ({ deck, kind, position, label, html, block, fields, title, prompt, author }) =>
      store.withLock(deck, async () => {
        const { key, model: m } = await store.open(deck);
        const b = buildInsert(m, { kind, html, block, fields, position, label });
        if ('error' in b) return fail(b.error, b.extra);
        const pid = 'p' + randomBytes(4).toString('hex');
        const proposals = await loadProposals(key);
        proposals.push({
          id: pid,
          author: author ?? 'agent',
          title: title ?? `Add ${b.insert.kind} slide`,
          prompt,
          op: b.insert,
          targetId: b.id,
          baseHash: '',
        });
        await saveProposals(key, proposals);
        return ok({
          proposalId: pid,
          staged: 'add',
          newChunkId: b.id,
          activeContent: activeContentFlags(b.inner).map((v) => v.rule),
          note: 'staged for review — not added. Use list_proposals / accept_proposal / reject_proposal.',
        });
      })
    )
  );

  server.registerTool(
    'propose_delete',
    {
      description:
        'Propose hiding or deleting a slide WITHOUT doing it — staged for review. mode "hide" (default, recoverable) or "delete". accept_proposal refuses if the chunk is already gone.',
      inputSchema: {
        deck: z.string().describe('Deck path'),
        chunkId: z.string().describe('Chunk id from list_chunks'),
        mode: z.enum(['hide', 'delete']).optional().describe('Default "hide"'),
        title: z.string().optional().describe('Short summary (the PR title)'),
        prompt: z.string().optional().describe('Why (optional provenance)'),
        author: z.string().optional().describe('Who is proposing (default "agent")'),
      },
    },
    guard(async ({ deck, chunkId, mode = 'hide', title, prompt, author }) =>
      store.withLock(deck, async () => {
        const { key, model: m } = await store.open(deck);
        if (!m.slides.has(chunkId)) return fail(`unknown chunk "${chunkId}" — call list_chunks`);
        const op: ProposalOp =
          mode === 'hide' ? { t: 'slide.meta', id: chunkId, patch: { hidden: true } } : { t: 'slide.remove', id: chunkId };
        const pid = 'p' + randomBytes(4).toString('hex');
        const proposals = await loadProposals(key);
        proposals.push({
          id: pid,
          author: author ?? 'agent',
          title: title ?? `${mode === 'hide' ? 'Hide' : 'Delete'} ${chunkId}`,
          prompt,
          op,
          targetId: chunkId,
          baseHash: chunkHash(m, chunkId),
        });
        await saveProposals(key, proposals);
        return ok({ proposalId: pid, staged: mode, targetId: chunkId, note: 'staged for review — use list_proposals / accept_proposal / reject_proposal.' });
      })
    )
  );

  server.registerTool(
    'refresh_sources',
    {
      description:
        'Self-refreshing Ledger (§4): re-pull every table that carries a `source` side-map through its connector, map the result in, re-bake formulas, and stamp freshness — this WRITES THE FILE (atomic) when anything changed. Credentials live in the trusted process (env/keychain); the Fold only ever carries the query. Returns which chunks changed and the per-chunk changed-cell count, so you can then propose_chunk a narrative update describing the change ("revenue up 12% QoQ"). The distributed file stays inert + baked.',
      inputSchema: { deck: z.string().describe('Deck path') },
    },
    guard(async ({ deck }) => {
      const out = await store.edit(deck, async (m) => {
        // unique sources across the deck (duplicate queries share one fetch)
        const sources = new Map<string, TableSource>();
        for (const id of m.order) for (const s of sourceTables(m.slides.get(id)!.inner)) sources.set(JSON.stringify(s), s);
        if (sources.size === 0) {
          skipWrite({ refreshed: [], errors: [], note: 'no self-refreshing tables (no `source` side-maps) in this deck' });
        }

        // run each query — creds resolved by the connector from the trusted process, never the Fold
        const results = new Map<string, QueryResult>();
        const errors: Array<{ connector: string; error: string }> = [];
        for (const [key, source] of sources) {
          try {
            results.set(key, await connector.run(source));
          } catch (e) {
            errors.push({ connector: source.connector, error: (e as Error).message });
          }
        }

        // rewrite each slide's source-tables; apply the changed slides as ONE undo step
        const now = Date.now();
        const ops: Op[] = [];
        const refreshed: Array<{ chunkId: string; changedCells: number }> = [];
        for (const id of m.order) {
          const inner = m.slides.get(id)!.inner;
          const r = applyRefresh(inner, results, now);
          if (r.inner !== inner) {
            ops.push({ t: 'slide.inner', id, inner: r.inner });
            refreshed.push({ chunkId: id, changedCells: r.changed });
          }
        }
        if (ops.length === 0) skipWrite({ refreshed, errors, note: 'no tables changed' });
        applyOp(m, ops.length > 1 ? { t: 'batch', ops } : ops[0]);
        return { refreshed, errors, note: 'written — then propose_chunk a narrative update for the changed cells' };
      });
      return ok({ ...out.value, ...(out.bytes > 0 ? { written: out.key, bytes: out.bytes } : {}) });
    })
  );

  return server;
}
