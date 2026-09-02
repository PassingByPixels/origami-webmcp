import { describe, expect, it } from 'vitest';
import { bakeTableInner } from '../../src/core/bake.js';

/* The data block's carrier invariant: no raw "<" may appear inside the JSON, or a cell value
   could open a tag (even a <template>) inside the figure. bake re-serialises the block, so it
   must re-escape every "<" as the six-character sequence backslash-u003c. */
describe('bake keeps the data-block escape', () => {
  it('re-escapes "<" in cell text after baking', () => {
    const inner =
      '<figure><script type="application/json" data-odata="table">' +
      JSON.stringify({ columns: [{ label: 'A' }], rows: [['a ' + String.fromCharCode(60) + ' b', '']], formulas: { B1: '=1+1' } }).replace(/</g, 'ESC') +
      '</script></figure>';
    const out = bakeTableInner(inner.replace(/ESC/g, String.fromCharCode(92) + 'u003c'), 0);
    const body = /data-odata="table">([^]*?)<\/script>/.exec(out)![1]!;
    expect(body.includes(String.fromCharCode(60))).toBe(false);
    expect(body.includes(String.fromCharCode(92) + 'u003c')).toBe(true);
    expect(JSON.parse(body).rows[0][1]).toBe('2');
  });
});
