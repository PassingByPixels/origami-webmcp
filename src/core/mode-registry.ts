/* One registry builder, four pages.
   ------------------------------------------------------------------------------------------
   Folio registers everything buildTools makes. A mini page registers EXACTLY the names its mode
   lists — the eight common tools plus its own block tools, with origami_guide replaced by the
   page-scoped one. A name in a mode that matches nothing is a build-time error rather than a
   silently short registry: a page that quietly came up with eleven tools instead of thirteen
   would report the wrong count in its own status line and nobody would know why. */

import { assembleBlankDeck, loadRuntimeJs } from './blank-deck.js';
import { buildBlockTools } from './block-tools.js';
import type { DeckStore } from './deck-store.js';
import { pageGuideTool } from './mode-guide.js';
import type { ToolMode } from './modes.js';
import { ToolRegistry } from './registry.js';
import { buildTools, slugifyTitle, type ToolDeps } from './tools.js';
import { newDeckId, newSlideId } from './ids.js';

export function createModeRegistry(deps: ToolDeps, mode: ToolMode): ToolRegistry {
  const registry = new ToolRegistry(deps.activity);
  const d: ToolDeps = { ...deps, activity: registry.activity };
  const all = buildTools(d);

  if (!mode.tools) {
    for (const t of all) registry.register(t);
    return registry;
  }

  const byName = new Map(all.map((t) => [t.name, t]));
  for (const t of buildBlockTools(d, mode)) byName.set(t.name, t);
  byName.set('origami_guide', pageGuideTool(mode));

  for (const name of mode.tools) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`mode "${mode.key}" lists tool "${name}", which nothing builds`);
    registry.register(tool);
  }
  return registry;
}

/** The suggested filename for a mode's document — slugified from the title by create_deck's own
    rule, so a Fold this page mints is named the way every other Fold in the app is. */
export const modeFileName = (mode: ToolMode): string => `${slugifyTitle(mode.doc!.deckTitle)}.origami.html`;

/**
 * Mint the mini page's document: ONE fold, seeded with that page's block, opened in the tab.
 *
 * It is assembled complete rather than created-then-edited. A create-then-write would arrive
 * dirty (the Save button lit before the human had done anything) and with an undo step that
 * reverses to a blank card the page has no tool to repair.
 */
export async function createModeDoc(deck: DeckStore, mode: ToolMode, runtimeJs = loadRuntimeJs): Promise<string> {
  const doc = mode.doc!;
  const text = await assembleBlankDeck({
    title: doc.deckTitle,
    foldType: 'deck',
    now: new Date().toISOString(),
    id: newDeckId(),
    slideId: newSlideId(),
    runtimeJs: await runtimeJs(),
    inner: doc.inner(),
    label: doc.label,
  });
  deck.open(text, modeFileName(mode));
  return text;
}
