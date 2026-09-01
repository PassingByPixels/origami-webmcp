import { FORMAT_VERSION, type FoldType, type Manifest } from '../../vendor/format-dist/index.js';
import { FREE_STARTER_INNER } from './starters.js';

/* Ported from the monorepo's packages/mcp/src/new-deck.ts. Same manifest, same assembleDeck,
   so a deck this app mints and one the Studio or the stdio server mints are indistinguishable.

   ONE deviation: the stdio build inlines the viewer IIFE at BUILD time via an esbuild `define`.
   A 242 KB string inlined into the app bundle would be paid for on every page load even by
   someone who only opens an existing deck, so this build ships it as a static sibling asset and
   fetches it once, lazily, on the first create_deck. Same bytes, later.

   @origami/runtime is imported DYNAMICALLY for the same reason: assembleDeck drags the base +
   kinds + theme stylesheets with it (340 KB of the 479 KB bundle), and nothing but create_deck
   needs them. Opening an existing Fold never loads that chunk — the Fold carries its own
   engine, so serializeModel alone renders it. */

export interface BlankDeckOpts {
  title: string;
  foldType: FoldType;
  /** ISO timestamp stamped into created + modified. */
  now: string;
  /** Manifest id, e.g. 'd-1a2b3c4d'. */
  id: string;
  /** Id of the single starter fold. */
  slideId: string;
  /** The built viewer IIFE text (dist/origami-runtime.iife.js). */
  runtimeJs: string;
  /** The single fold's inner markup. Default: the free-card starter create_deck has always
      minted. A mini tool page passes its own seeded block here, so the document it opens on is
      built ONCE, clean — no create-then-edit that would arrive dirty with an undo step in it. */
  inner?: string;
  /** The single fold's sidebar label. Default "Cover". */
  label?: string;
}

/* The dynamic import below code-splits the 440 KB runtime-dist chunk out of the first paint —
   but a LAZY chunk is a live grenade on a static host: replace the files mid-session (a zip
   upload is not atomic) and the first create_deck fetches a chunk that is gone, and the
   browser CACHES that failure in the module map for the life of the page (measured in the
   wild: a ChatGPT agent stranded an hour into a session, 2026-09-01). warmDeckAssembly()
   defuses it: the shell calls it once after first paint, so the chunk and the runtime text
   are in this session before any deploy can swap them. Failures are swallowed here —
   create_deck still reports honestly if the warm never landed. */
export function warmDeckAssembly(): void {
  void import('../../vendor/runtime-dist/index.js').catch(() => {});
  void loadRuntimeJs().catch(() => {});
}

export async function assembleBlankDeck(opts: BlankDeckOpts): Promise<string> {
  const { assembleDeck } = await import('../../vendor/runtime-dist/index.js');
  const { title, foldType, now, id, slideId, runtimeJs, inner = FREE_STARTER_INNER, label = 'Cover' } = opts;
  const manifest: Manifest = {
    v: FORMAT_VERSION,
    id,
    title,
    created: now,
    modified: now,
    theme: { name: 'origami-default', tokens: {} },
    // 'deck' is the default and writes no foldType key (byte-stable); only scroll/ledger set it
    ...(foldType !== 'deck' ? { foldType } : {}),
    order: [slideId],
    hidden: [],
    slides: { [slideId]: { kind: 'free', label, notes: '' } },
    kinds: ['free'],
    customKinds: [],
    capabilities: [],
  };
  return assembleDeck({ manifest, slides: { [slideId]: inner }, assets: {}, runtimeJs });
}

/** Where the viewer IIFE is served from, relative to index.html. */
export const RUNTIME_URL = './origami-runtime.iife.js';

let runtimeCache: string | null = null;

/** Fetch the viewer IIFE once and memoise it. Injectable so unit tests read it off disk. */
export async function loadRuntimeJs(fetchText: (url: string) => Promise<string> = defaultFetchText): Promise<string> {
  if (runtimeCache === null) runtimeCache = await fetchText(RUNTIME_URL);
  return runtimeCache;
}

export function primeRuntimeJs(text: string): void {
  runtimeCache = text;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load the viewer runtime (${url}): HTTP ${res.status}`);
  return res.text();
}
