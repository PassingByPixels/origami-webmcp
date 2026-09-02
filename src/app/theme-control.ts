import { presetThemes, type SavedTheme, type ThemeStore } from '../core/themes.js';
import { themeTokensInForce } from '../core/tools.js';
import type { DeckStore } from '../core/deck-store.js';
import type { ToolResult } from '../core/result.js';
import { Popover } from './popover.js';

/**
 * THE THEME BUTTON — the human's way into the same four tools an agent has (theme-tools.ts),
 * from the topbar. It never touches the deck or the theme store directly: every change goes
 * through `asHuman`, exactly as Save and Undo already do, so the Activity rail narrates it and
 * apply_theme's Undo step is offered the normal way.
 */

/** A theme this control can show, tagged with where it came from. */
export interface ThemeCandidate extends SavedTheme {
  source: 'preset' | 'saved';
}

/** Every theme apply_theme could use, read straight off the store this page keeps. A
    synchronous local read, not a tool call — painting the button on every deck event must not
    cost a call the way opening the popover's list rightly does (see openPanel). Presets first,
    same order theme-tools.ts's own catalog() builds them in, so "the current one" here can never
    disagree with what list_themes would say. */
function localCatalog(store: ThemeStore): ThemeCandidate[] {
  return [...presetThemes().map((t) => ({ ...t, source: 'preset' as const })), ...store.all().map((t) => ({ ...t, source: 'saved' as const }))];
}

/** The catalog entry whose full token set is already on the deck, first match wins, or null when
    nothing matches — the deck is wearing a hand-edited mix, or a theme this catalog no longer
    has. A theme with no tokens can never match (an empty set is vacuously a subset of anything),
    so it is skipped rather than winning by default. */
export function matchTheme<T extends { tokens: Record<string, string> }>(tokens: Record<string, string> | null, catalog: readonly T[]): T | null {
  if (!tokens) return null;
  for (const t of catalog) {
    const keys = Object.keys(t.tokens);
    if (keys.length === 0) continue;
    if (keys.every((k) => tokens[k] === t.tokens[k])) return t;
  }
  return null;
}

export interface ThemeControlEls {
  button: HTMLButtonElement;
  swatch: HTMLElement;
  label: HTMLElement;
  panel: HTMLElement;
}

export interface ThemeControlDeps {
  deck: DeckStore;
  /** The same store the registry's theme tools read and write — a direct, synchronous read for
      painting the button; every WRITE still goes through `asHuman`. */
  store: ThemeStore;
  /** Runs a theme tool as the human, through the registry — so it is recorded exactly like an
      agent's call and reads the Fold that is actually open. */
  asHuman: (name: string, args: unknown) => Promise<ToolResult>;
  say: (text: string, bad?: boolean) => void;
}

export class ThemeControl {
  private readonly popover: Popover;

  constructor(
    private readonly els: ThemeControlEls,
    private readonly deps: ThemeControlDeps
  ) {
    this.popover = new Popover(els.button, els.panel);
    // Popover's own listener runs first (it is added in its constructor, above) and has already
    // toggled the state by the time this one fires — so isOpen() here means "just opened", and a
    // click that just closed the card skips the reload it does not need.
    els.button.addEventListener('click', () => {
      if (this.popover.isOpen()) void this.openPanel();
    });
    els.panel.addEventListener('click', (ev) => void this.onPanelClick(ev));
    els.panel.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const row = (ev.target as HTMLElement).closest<HTMLElement>('.theme-row');
      if (!row || row !== ev.target) return;
      ev.preventDefault();
      void this.applyTheme(row.dataset.name!);
    });
    this.paint();
  }

  /** Redraw the dot and label from the deck as it stands now. No I/O, so every deck event
      (open/change/close) and every apply can call this without waiting on anything. */
  paint(): void {
    const state = this.deps.deck.peek();
    if (!state) {
      this.els.button.disabled = true;
      this.els.label.textContent = 'Theme';
      this.els.swatch.style.background = 'transparent';
      return;
    }
    this.els.button.disabled = false;
    const tokens = themeTokensInForce(state.model);
    const match = matchTheme(tokens, localCatalog(this.deps.store));
    this.els.label.textContent = match?.label ?? 'Custom';
    this.els.swatch.style.background = tokens?.accent ?? 'transparent';
  }

  /** list_themes, through the registry, on every open — the popover's list is the same read an
      agent gets, and a theme saved a minute ago (by the console, or an agent) must show up
      without a reload. */
  private async openPanel(): Promise<void> {
    const res = await this.deps.asHuman('list_themes', {});
    const body = JSON.parse(res.content[0]?.text ?? '{}');
    if (res.isError) {
      this.deps.say(body.error ?? 'Could not list themes.', true);
      this.popover.close();
      return;
    }
    this.renderRows(body.themes as ThemeCandidate[]);
  }

  private renderRows(themes: ThemeCandidate[]): void {
    const state = this.deps.deck.peek();
    const tokens = state ? themeTokensInForce(state.model) : null;
    const current = matchTheme(tokens, themes);
    if (themes.length === 0) {
      const p = document.createElement('p');
      p.className = 'pop-note';
      p.textContent = 'No themes.';
      this.els.panel.replaceChildren(p);
      return;
    }
    this.els.panel.replaceChildren(...themes.map((t) => this.row(t, t === current)));
  }

  private row(theme: ThemeCandidate, isCurrent: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'theme-row';
    row.setAttribute('data-testid', 'theme-row');
    row.dataset.name = theme.name;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (isCurrent) row.setAttribute('aria-current', 'true');

    const swatches = document.createElement('span');
    swatches.className = 'theme-swatches';
    swatches.setAttribute('aria-hidden', 'true');
    for (const key of ['bg', 'accent', 'ink'] as const) {
      const i = document.createElement('i');
      i.style.background = theme.tokens[key] ?? 'transparent';
      swatches.append(i);
    }
    row.append(swatches);

    const label = document.createElement('span');
    label.className = 'theme-row-label';
    label.textContent = theme.label;
    row.append(label);

    if (theme.source === 'saved') {
      const tag = document.createElement('span');
      tag.className = 'chip theme-tag';
      tag.textContent = 'saved';
      row.append(tag);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost theme-row-del';
      del.dataset.act = 'delete';
      del.dataset.name = theme.name;
      del.setAttribute('data-testid', 'theme-row-delete');
      del.textContent = 'Delete';
      del.title = `Forget "${theme.label}" — this cannot be undone. A theme is not part of the Fold, so Undo does not cover a store delete; a deck already wearing these colours keeps them.`;
      row.append(del);
    }

    return row;
  }

  private async onPanelClick(ev: Event): Promise<void> {
    const target = ev.target as HTMLElement;
    const del = target.closest<HTMLButtonElement>('[data-act="delete"]');
    if (del) {
      ev.stopPropagation(); // Delete must not also apply the row it sits on
      await this.deleteTheme(del.dataset.name!);
      return;
    }
    const row = target.closest<HTMLElement>('.theme-row');
    if (row?.dataset.name) await this.applyTheme(row.dataset.name);
  }

  private async applyTheme(name: string): Promise<void> {
    this.popover.close();
    const res = await this.deps.asHuman('apply_theme', { name });
    if (res.isError) {
      const body = JSON.parse(res.content[0]?.text ?? '{}');
      this.deps.say(body.error ?? `Could not apply "${name}".`, true);
    }
    // A successful apply repaints the button via the deck's own 'change' event — see shell.ts.
  }

  private async deleteTheme(name: string): Promise<void> {
    const res = await this.deps.asHuman('delete_theme', { name });
    const body = JSON.parse(res.content[0]?.text ?? '{}');
    if (res.isError) {
      this.deps.say(body.error ?? `Could not delete "${name}".`, true);
      return;
    }
    this.deps.say(`Deleted theme "${name}".`);
    await this.openPanel(); // re-list, so the row is gone without closing the card
  }
}
