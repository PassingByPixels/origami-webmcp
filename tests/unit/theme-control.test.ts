import { describe, expect, it } from 'vitest';
import { matchTheme } from '../../src/app/theme-control.js';

/* matchTheme is the pure half of the Theme button: which catalog entry, if any, is already on
   the deck. The button and its popover both read it, so it is tested on its own — no DOM, no
   deck, just the token comparison the label and the "current" row both depend on. */

const paper = { name: 'origami-default', label: 'Paper', tokens: { bg: '#F7F6F1', accent: '#3F7268', ink: '#22251F' } };
const boardroom = { name: 'boardroom', label: 'Boardroom', tokens: { bg: '#F3F5F8', accent: '#38628F', ink: '#19222C' } };
const houseNavy = { name: 'house-navy', label: 'House Navy', tokens: { accent: '#123456' } };
const CATALOG = [paper, boardroom, houseNavy];

describe('matchTheme', () => {
  it('matches a theme whose whole token set is on the deck', () => {
    expect(matchTheme({ bg: '#F3F5F8', accent: '#38628F', ink: '#19222C', rule: '#DDE3EA' }, CATALOG)).toBe(boardroom);
  });

  it('matches a partial theme (fewer keys) by the keys it names, ignoring the rest', () => {
    // house-navy only claims `accent` — it must win on that key alone, even sitting on top of
    // paper's bg/ink, the way apply_theme's merge would actually leave the deck.
    expect(matchTheme({ bg: '#F7F6F1', ink: '#22251F', accent: '#123456' }, CATALOG)).toBe(houseNavy);
  });

  it('returns null when the tokens on the deck match no catalog entry (a hand-edited mix)', () => {
    expect(matchTheme({ bg: '#F7F6F1', accent: '#ABCDEF', ink: '#22251F' }, CATALOG)).toBeNull();
  });

  it('returns null when there are no tokens to read (no readable theme block)', () => {
    expect(matchTheme(null, CATALOG)).toBeNull();
  });

  it('picks the first matching entry when two themes claim the same tokens', () => {
    const dup = { name: 'boardroom-copy', label: 'Boardroom Copy', tokens: { ...boardroom.tokens } };
    // presets-first catalog order (theme-tools.ts's own catalog()) means the preset wins here,
    // not the saved duplicate — the row that IS the preset shows as current, not its clone.
    expect(matchTheme({ ...boardroom.tokens }, [paper, boardroom, dup])).toBe(boardroom);
  });

  it('never matches a theme with an empty token map, even against an empty-token deck', () => {
    const blank = { name: 'blank', label: 'Blank', tokens: {} };
    expect(matchTheme({ accent: '#000000' }, [blank])).toBeNull();
  });
});
