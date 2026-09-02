import { describe, expect, it } from 'vitest';
import { harness } from './harness.js';

/* PER-TURN BYTES.
   ------------------------------------------------------------------------------------------
   A WebMCP host hands the model every registered tool's name, description and inputSchema. On
   /folio/ that is the largest fixed cost of every single turn — measured through the bridge at
   22,565 bytes of descriptions and 14,732 of schemas before this budget existed. A caveat that
   is genuinely load-bearing earns its bytes; an explanation of WHY belongs in
   origami_guide({topic:"tools"}), which an agent fetches once if it wants it.

   The budget is asserted, not aspired to: a description that grows back over it fails here. */

const utf8 = (s: string): number => new TextEncoder().encode(s).length;

/** The ceiling this slice was built to. Raise it only with a measurement that justifies it. */
export const DESCRIPTION_BUDGET = 16_000;

describe('per-turn bytes: what the host hands the model on EVERY turn', () => {
  it(`keeps the /folio/ tool descriptions under ${DESCRIPTION_BUDGET} bytes`, () => {
    const tools = harness().registry.list();
    const perTool = tools
      .map((t) => ({ name: t.name, description: utf8(t.description), schema: utf8(JSON.stringify(t.inputSchema)) }))
      .sort((a, b) => b.description - a.description);
    const descriptions = perTool.reduce((n, t) => n + t.description, 0);
    const schemas = perTool.reduce((n, t) => n + t.schema, 0);

    console.log(
      `/folio/ registered surface: ${tools.length} tools, ${descriptions} bytes of descriptions + ${schemas} bytes of schemas = ${descriptions + schemas} per turn\n` +
        perTool
          .slice(0, 10)
          .map((t) => `    ${String(t.description).padStart(5)}  ${t.name}`)
          .join('\n')
    );

    expect(descriptions).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
  });
});
