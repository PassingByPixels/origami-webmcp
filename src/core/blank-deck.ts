import { FORMAT_VERSION, type FoldType, type Manifest } from '../../vendor/format-dist/index.js';
import { assembleDeck } from '../../vendor/runtime-dist/index.js';
import { FREE_STARTER_INNER } from './starters.js';

/* Ported from the monorepo's packages/mcp/src/new-deck.ts. Same manifest, same assembleDeck,
   so a deck this app mints and one the Studio or the stdio server mints are indistinguishable.

   ONE deviation: the stdio build inlines the viewer IIFE at BUILD time via an esbuild `define`.
   A 242 KB string inlined into the app bundle would be paid for on every page load even by
   someone who only opens an existing deck, so this build ships it as a static sibling asset and
   fetches it once, lazily, on the first create_deck. Same bytes, later. */

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
}

export function assembleBlankDeck(opts: BlankDeckOpts): string {
  const { title, foldType, now, id, slideId, runtimeJs } = opts;
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
    slides: { [slideId]: { kind: 'free', label: 'Cover', notes: '' } },
    kinds: ['free'],
    customKinds: [],
    capabilities: [],
  };
  return assembleDeck({ manifest, slides: { [slideId]: FREE_STARTER_INNER }, assets: {}, runtimeJs });
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
