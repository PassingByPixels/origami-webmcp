/** Starter kind registry. Each kind documents its contract for the AI chunk context.
    P5 extends this; the schema comments are consumed verbatim by extractChunk.

    KINDS is now a DERIVED VIEW of the block registry (packages/format/src/blocks):
    the per-block `blocks/<key>.ts` facets are the source of truth, this is their
    {key,name,schemaComment} projection in registry order. Deliberately kept as a
    named export so extractChunk + external consumers (studio-core, mcp) are
    unchanged. Add a block by adding its facet + a registry entry — not here. */
import { FORMAT_BLOCKS } from './blocks/registry.js';
// @__PURE__ lets esbuild tree-shake this (and thus the whole block registry, incl.
// the verbose schemaComment text) out of the runtime viewer IIFE, which imports
// small format helpers but never KINDS — exactly as the old literal was dropped.
export const KINDS = /* @__PURE__ */ Object.fromEntries(FORMAT_BLOCKS.map((b) => [b.key, { key: b.key, name: b.name, schemaComment: b.schemaComment }]));
export function kindSchemaComment(kind) {
    return KINDS[kind]?.schemaComment ?? ['(no schema registered for this kind)'];
}
