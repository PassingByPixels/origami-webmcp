/* ONE data gate, run at AUTHORING time instead of only at save time.
   ------------------------------------------------------------------------------------------
   Every data-driven block a fold carries lives in a
   `<script type="application/json" data-odata="KIND">…</script>` block. The content policy
   checks that the carrier is well formed; it says nothing about what is INSIDE it. So until
   this file existed, a chart with a string where a number belongs, or a table column whose
   `format` was given as a string, was accepted by add_chunk and write_chunk and only refused
   by save_deck at the very end — two gates with different opinions, and the disagreement
   surfaced after the agent had already built the deck around the bad block.

   Nothing here re-implements a validator. The checks ARE the format library's own:
   KIND_DATA_SPECS is a derived view of the block registry (spec.validate === validateChartData,
   validateFlowData, validateTableData …), and the composite `block` kind goes through
   validateBlockInstance against the deck's own defs — exactly what validateKindData does inside
   save_deck. Same functions, same rule names, one verdict. */

import {
  KIND_DATA_SPECS,
  extractDataBlocks,
  validateBlockInstance,
  type CompositeBlockDef,
  type Violation,
} from '../../vendor/format-dist/index.js';

/** The message every write path uses when a data block fails its own kind's schema. It names
    the same rules save_deck names, so an agent that hits it here and one that hits it there
    read the same verdict. */
export const DATA_BLOCK_REFUSAL =
  'a data block in this content breaks its own schema — NOTHING was applied and the Fold is unchanged';

/**
 * Validate EVERY data block in a fold inner, by the format library's own per-kind validator.
 *
 * `blocks` is the deck's composite-block registry (DeckModel.blocks); a `block` instance is
 * checked against it, so an instance naming a def this Fold does not carry is caught here
 * rather than at save. Pass {} where there is no registry to hand.
 */
export function validateDataBlocks(inner: string, blocks: Record<string, CompositeBlockDef> = {}): Violation[] {
  const out: Violation[] = [];
  for (const b of extractDataBlocks(inner)) {
    if (!(b.kind in KIND_DATA_SPECS)) {
      out.push({ rule: 'kind-data.unknown', detail: `unknown data-odata kind "${b.kind}"` });
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(b.json);
    } catch (e) {
      out.push({ rule: 'kind-data.json', detail: `${b.kind} data block is not valid JSON: ${(e as Error).message}` });
      continue;
    }
    // the composite kind validates against the deck registry (the def must exist); every other
    // kind uses its own shape validator — this is validateKindData's split, not a new one
    const violations = b.kind === 'block' ? validateBlockInstance(data, blocks) : KIND_DATA_SPECS[b.kind]!.validate(data);
    for (const v of violations) out.push({ rule: v.rule, detail: `${b.kind} block: ${v.detail}` });
  }
  return out;
}

/**
 * Fill the two diagram fields that are REQUIRED but read as optional.
 *
 * validateFlowData refuses a node with no `tone` ("tone must be one of accent|green|amber|red
 * or \"\"") and an edge with no `label` ("label must be a string"); validateGraphData refuses
 * both the same way. Every schema example carries them, so an agent that copies the example is
 * fine — and both cold-agent trials wrote a diagram without them and ate a refusal, because a
 * field whose only legal blank value is "" reads as optional to anyone who has not read the
 * validator.
 *
 * Filling them is a PURE DEFAULT: "" is the no-tone tone and the no-label label, so the picture
 * is byte-identical to one the agent wrote them into by hand. Nothing that carries MEANING is
 * defaulted this way — a gantt card's `effort` is EASY|MED|DEFER with no blank member, so
 * guessing one would be inventing content, and it stays a refusal.
 *
 * Returns a COPY; the caller's object is never mutated.
 */
export function fillDiagramDefaults(kind: string, data: unknown): unknown {
  if ((kind !== 'flow' && kind !== 'graph') || data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const d = data as { nodes?: unknown; edges?: unknown };
  const out: Record<string, unknown> = { ...(data as object) };
  if (Array.isArray(d.nodes)) {
    out.nodes = d.nodes.map((n) =>
      n !== null && typeof n === 'object' && !Array.isArray(n) && (n as { tone?: unknown }).tone === undefined ? { ...(n as object), tone: '' } : n
    );
  }
  if (Array.isArray(d.edges)) {
    out.edges = d.edges.map((e) =>
      e !== null && typeof e === 'object' && !Array.isArray(e) && (e as { label?: unknown }).label === undefined ? { ...(e as object), label: '' } : e
    );
  }
  return out;
}
