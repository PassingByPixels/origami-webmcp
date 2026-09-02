/* THEMES an agent can own.
   ------------------------------------------------------------------------------------------
   Until now the only colour control was set_deck_meta({themeTokens}), which patches raw CSS
   custom properties. Two things went wrong with that in trial, and both are the reason this
   file exists:

     1. set_deck_meta({themeName:"boardroom"}) renamed the theme and changed NOTHING. themeName
        is a label; nothing in the guide said so, and no preset existed to apply. An agent asked
        for a palette and got the default one with a different name on it.
     2. A model that had never seen a Fold sent {primary:"#…", background:"#…"} — plausible
        token names from every other design system, and neither is read by the deck stylesheet.
        validateThemeTokens accepts an unknown key (it only checks the VALUE), so those were
        stored in the manifest for ever and did nothing at all.

   So: the four runtime presets are exposed as first-class themes, the seventeen tokens the deck
   stylesheet actually reads are an allowlist rather than a documentation note, and a saved
   theme is checked for contrast before an agent ships a deck nobody can read. */

import { THEMES } from '../../vendor/runtime-dist/index.js';
import { validateThemeTokens, type Violation } from '../../vendor/format-dist/index.js';

/**
 * The ONLY custom properties the deck stylesheet reads. Fourteen are the palette the runtime's
 * own presets carry; the last three style the masthead bar. A token outside this list is not a
 * style choice the deck can honour — it is a typo that would live in the manifest for ever, so
 * it is refused with this list rather than stored.
 */
export const THEME_TOKENS = [
  'bg', 'paper', 'ink', 'ink-soft', 'rule', 'rule-soft', 'accent', 'tint-a', 'tint-b',
  'chrome', 'chrome-ink', 'chrome-soft', 'font-display', 'font-body',
  'chrome-mark', 'chrome-mark-h', 'chrome-pad',
] as const;

const TOKEN_SET = new Set<string>(THEME_TOKENS);

export interface SavedTheme {
  /** The key apply_theme takes. */
  name: string;
  /** Human-facing name (defaults to the name). */
  label: string;
  tokens: Record<string, string>;
  /** The preset or saved theme these tokens were merged onto, when one was named. */
  basedOn?: string;
}

/**
 * Where a theme an agent saved lives between calls.
 *
 * The page implements this on localStorage so a theme survives a reload on that browser; every
 * other host (unit tests, a non-DOM build) gets the in-memory one and behaves identically for
 * the length of a session. Nothing here writes into the DECK: a saved theme is a palette the
 * agent keeps, and apply_theme is the only thing that changes a Fold.
 */
export interface ThemeStore {
  all(): SavedTheme[];
  get(name: string): SavedTheme | undefined;
  set(theme: SavedTheme): void;
  /** false when there was nothing by that name. */
  delete(name: string): boolean;
}

export class MemoryThemeStore implements ThemeStore {
  private readonly map = new Map<string, SavedTheme>();
  all(): SavedTheme[] {
    return [...this.map.values()];
  }
  get(name: string): SavedTheme | undefined {
    return this.map.get(name);
  }
  set(theme: SavedTheme): void {
    this.map.set(theme.name, theme);
  }
  delete(name: string): boolean {
    return this.map.delete(name);
  }
}

/** The runtime's own presets, as themes. THEMES[0] is the default new-deck theme. */
export const presetThemes = (): SavedTheme[] => THEMES.map((t) => ({ name: t.name, label: t.label, tokens: { ...t.tokens } }));

export const findPreset = (name: string): SavedTheme | undefined => presetThemes().find((t) => t.name === name);

/** Every token key that is not one the deck stylesheet reads, with the list it should have come from. */
export function unknownTokens(tokens: Record<string, unknown>): string[] {
  return Object.keys(tokens).filter((k) => !TOKEN_SET.has(k));
}

/** The format library's value gate (no braces, semicolons, angle brackets, @ or url()) PLUS the
    key allowlist it deliberately does not enforce. */
export function validateTokens(tokens: Record<string, unknown>): Violation[] {
  const out: Violation[] = validateThemeTokens(tokens);
  for (const key of unknownTokens(tokens)) {
    out.push({
      rule: 'theme.token-name',
      detail: `token "${key}" is not read by the deck stylesheet — it would be stored and never used. Valid tokens: ${THEME_TOKENS.join(', ')}`,
    });
  }
  return out;
}

/* ---------------------------------------------------------------- contrast ------------------ */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** sRGB channels 0-1 from an OPAQUE colour, or null when the value is not one this can read
    (a named colour, an rgba() with alpha, a font stack, a gradient). */
function channels(value: string): [number, number, number] | null {
  const v = value.trim();
  if (HEX.test(v)) {
    const h = v.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (!rgb) return null;
  // an alpha below 1 composites against whatever is behind it, which this function cannot know —
  // reporting a ratio for it would be a guess dressed as a measurement
  if (rgb[4] !== undefined && parseFloat(rgb[4]) < (rgb[4].endsWith('%') ? 100 : 1)) return null;
  return [1, 2, 3].map((i) => Number(rgb[i]) / 255) as [number, number, number];
}

/** WCAG 2.1 relative luminance. */
function luminance(c: [number, number, number]): number {
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1..21, or null when either colour cannot be read. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return null;
  const la = luminance(ca);
  const lb = luminance(cb);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
}

/** WCAG AA for body text. */
export const AA_BODY = 4.5;

/** The four pairs a reader actually looks at: body ink on the stage, body ink on a card, the
    accent on a card, and the masthead's ink on the masthead. */
const PAIRS: Array<[string, string]> = [
  ['ink', 'bg'],
  ['ink', 'paper'],
  ['accent', 'paper'],
  ['chrome-ink', 'chrome'],
];

export interface ContrastReport {
  pairs: Array<{ pair: string; ratio: number | null; passesAA: boolean | null; why?: string }>;
  warnings: string[];
}

/**
 * What a reader can and cannot read, before the deck is shipped. A pair whose colours this
 * cannot parse is reported as ratio null WITH the reason — a missing warning must never be
 * mistaken for a clean bill of health.
 */
export function contrastReport(tokens: Record<string, string>): ContrastReport {
  const pairs: ContrastReport['pairs'] = [];
  const warnings: string[] = [];
  for (const [fg, bg] of PAIRS) {
    const name = `${fg}/${bg}`;
    const a = tokens[fg];
    const b = tokens[bg];
    if (a === undefined || b === undefined) {
      pairs.push({ pair: name, ratio: null, passesAA: null, why: `${a === undefined ? fg : bg} is not set in this theme` });
      continue;
    }
    const ratio = contrastRatio(a, b);
    if (ratio === null) {
      pairs.push({ pair: name, ratio: null, passesAA: null, why: 'not an opaque #hex or rgb() colour, so no ratio can be measured' });
      continue;
    }
    const passesAA = ratio >= AA_BODY;
    pairs.push({ pair: name, ratio, passesAA });
    if (!passesAA) warnings.push(`${name} is ${ratio}:1 — below the ${AA_BODY}:1 WCAG AA minimum for body text. Darken ${fg} or lighten ${bg}.`);
  }
  return { pairs, warnings };
}
