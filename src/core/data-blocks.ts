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
