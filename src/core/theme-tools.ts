/* The four theme tools. See src/core/themes.ts for WHY they exist.
   ------------------------------------------------------------------------------------------
   apply_theme is the only one that touches the Fold, and it goes through the deck.theme op
   set_deck_meta already uses — merged onto the tokens IN FORCE, so a preset that names fourteen
   tokens does not wipe the three masthead ones the deck also carries. list_themes / save_theme /
   delete_theme never touch the deck at all: a saved palette is the agent's, not the file's. */

import type { Op } from '../../vendor/format-dist/index.js';
import type { ToolDef } from './registry.js';
import { fail, ok, refuse } from './result.js';
import {
  MemoryThemeStore,
  THEME_TOKENS,
  contrastReport,
  findPreset,
  presetThemes,
  validateTokens,
  type SavedTheme,
  type ThemeStore,
} from './themes.js';
import { themeTokensInForce, type ToolDeps } from './tools.js';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Every theme this page can apply, presets first — the answer list_themes returns and the one
    every refusal names, so the two can never disagree. */
function catalog(store: ThemeStore): Array<SavedTheme & { source: 'preset' | 'saved' }> {
  return [
    ...presetThemes().map((t) => ({ ...t, source: 'preset' as const })),
    ...store.all().map((t) => ({ ...t, source: 'saved' as const })),
  ];
}

const names = (store: ThemeStore): string[] => catalog(store).map((t) => t.name);

export function buildThemeTools(deps: ToolDeps): ToolDef[] {
  const { deck } = deps;
  const store = deps.themes ?? new MemoryThemeStore();

  return [
    {
      name: 'list_themes',
      annotations: { readOnlyHint: true },
      description: "Every palette apply_theme can use: the four presets the runtime ships (origami-default, boardroom, meadow, dusk) plus anything save_theme kept in this browser, each with its complete token map and whether it is a preset or saved. Call this before apply_theme rather than guessing a name. Changes nothing.",
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async () => {
        const themes = catalog(store);
        return ok({
          count: themes.length,
          themes,
          tokensTheDeckReads: [...THEME_TOKENS],
          note: 'apply_theme({name}) puts one of these on the open Fold; save_theme({name, tokens, basedOn}) adds your own.',
        });
      },
    },

    {
      name: 'apply_theme',
      description: "Put a whole named palette on the open Fold — this CHANGES THE COLOURS the human is looking at and re-renders it. `name` is a preset or saved theme from list_themes; an unknown name is refused with the ones that exist. Its tokens merge onto the ones in force, so tokens it does not name survive. This is the tool that restyles a deck: set_deck_meta({themeName}) only renames the label. One undo step.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', maxLength: 60, description: 'A theme name from list_themes (preset or saved)' } },
        required: ['name'],
      },
      execute: async ({ name }) => {
        const theme = catalog(store).find((t) => t.name === name);
        if (!theme) return fail(`unknown theme "${name}" — call list_themes`, { availableThemes: names(store) });
        const out = deck.mutate((m) => {
          const base = themeTokensInForce(m);
          if (!base) {
            refuse(
              'this Fold carries no readable theme tokens (no <style id="origami-theme-css"> block to read them from), so applying a theme would leave it with only this theme\'s tokens — nothing was changed.'
            );
          }
          const op: Op = { t: 'deck.theme', name: theme.name, tokens: { ...base, ...theme.tokens } };
          deck.apply(m, op);
          return { name: m.theme.name, tokens: m.theme.tokens };
        });
        return ok({
          applied: theme.name,
          source: theme.source,
          label: theme.label,
          tokens: out.tokens,
          contrast: contrastReport(out.tokens),
          note: 'applied to the open Fold and re-rendered — not yet on disk (the human saves). undo reverses it in one step.',
        });
      },
    },

    {
      name: 'save_theme',
      description: "Keep a palette of your own so apply_theme can use it — stored IN THIS BROWSER, surviving a reload; it does NOT change the open Fold. `basedOn` takes a preset or saved theme as the base and merges your tokens on top, so a one-colour variant is one token. ONLY the 17 custom properties the deck stylesheet reads are accepted (list_themes reports them); anything else — primary, background, textColor — is REFUSED with that list, never stored and silently ignored. Returns a WCAG contrast report for ink/bg, ink/paper, accent/paper and chrome-ink/chrome, warning under 4.5:1. A preset name is refused; one of your own is replaced.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 40, description: 'Theme key: lowercase letters, digits and hyphens, e.g. "house-navy"' },
          label: { type: 'string', maxLength: 60, description: 'Human-facing name (default: the key)' },
          tokens: { type: 'object', description: 'CSS custom properties, e.g. {"accent":"#38628F","ink":"#19222C"} — merged onto basedOn when one is given' },
          basedOn: { type: 'string', maxLength: 60, description: 'A preset or saved theme whose tokens are the base (default: none — tokens stand alone)' },
        },
        required: ['name', 'tokens'],
      },
      execute: async ({ name, label, tokens, basedOn }) => {
        if (typeof name !== 'string' || !NAME_RE.test(name)) {
          return fail(`theme name "${name}" is not usable — use lowercase letters, digits and hyphens, starting with a letter or digit (max 40)`);
        }
        if (findPreset(name)) return fail(`"${name}" is a preset and cannot be overwritten — save your variant under another name`, { presets: presetThemes().map((t) => t.name) });
        if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) return fail('tokens must be an object of CSS custom properties');

        let base: Record<string, string> = {};
        if (basedOn !== undefined) {
          const from = catalog(store).find((t) => t.name === basedOn);
          if (!from) return fail(`unknown basedOn theme "${basedOn}" — call list_themes`, { availableThemes: names(store) });
          base = { ...from.tokens };
        }
        const violations = validateTokens(tokens as Record<string, unknown>);
        if (violations.length > 0) {
          return fail('invalid theme tokens — NOTHING was saved', { violations, tokensTheDeckReads: [...THEME_TOKENS] });
        }
        const merged = { ...base, ...(tokens as Record<string, string>) };
        const replaced = store.get(name) !== undefined;
        store.set({ name, label: typeof label === 'string' && label.trim() ? label.trim() : name, tokens: merged, ...(basedOn ? { basedOn } : {}) });
        const contrast = contrastReport(merged);
        return ok({
          saved: name,
          replaced,
          ...(basedOn ? { basedOn } : {}),
          tokens: merged,
          contrast,
          note:
            (contrast.warnings.length > 0 ? 'SAVED, but read the contrast warnings — a palette that fails AA is one the human cannot read. ' : '') +
            'stored in this browser only; nothing on disk and nothing on the open Fold changed. Put it on the deck with apply_theme.',
        });
      },
    },

    {
      name: 'delete_theme',
      annotations: { destructiveHint: true },
      description: "Forget a theme you saved — it is GONE from this browser and apply_theme can no longer name it. undo does not cover this: a theme is not part of the Fold. A deck already wearing those colours KEEPS them, because a theme is applied by value. Presets cannot be deleted.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string', maxLength: 40, description: 'A saved theme name from list_themes' } },
        required: ['name'],
      },
      execute: async ({ name }) => {
        if (findPreset(name)) return fail(`"${name}" is a preset and cannot be deleted`, { savedThemes: store.all().map((t) => t.name) });
        if (!store.delete(name)) return fail(`no saved theme "${name}" — call list_themes`, { savedThemes: store.all().map((t) => t.name) });
        return ok({ deleted: name, remaining: store.all().map((t) => t.name), note: 'removed from this browser. The open Fold is unchanged.' });
      },
    },
  ];
}
