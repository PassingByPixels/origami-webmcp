/** @origami/calc — cleanroom calc engine. AUTHORING-LAYER ONLY: loaded by the Studio,
    the desktop app, and the MCP server; NEVER imported by @origami/runtime / bundled
    into the distributed viewer IIFE (a CI bundle-grep enforces this — see
    packages/runtime/build.mjs). The distributed .origami.html stays inert. */
export { recalc } from './recalc.js';
export { recalcTabs } from './tabs.js';
export { shiftFormula } from './fill.js';
export { spliceFormula, spliceSheetRefs, remapLine, remapRange } from './splice.js';
export { resolveNames } from './names.js';
export { rewriteFormula, quoteSheetName, renameSheetInFormula, breakSheetRefsInFormula } from './rewrite.js';
export { FUNCTIONS } from './functions/index.js';
export { CALC_ENGINE_SENTINEL } from './errors.js';
