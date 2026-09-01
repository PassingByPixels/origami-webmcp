import type { CompositeBlockDef } from './block-def.js';
import type { Violation } from './types.js';
/** Substitute {{field}} placeholders with coerced, escaped values. Returns the html and
    any active-content violations (empty = inert; non-empty = the caller MUST reject). */
export declare function renderComposite(def: CompositeBlockDef, values: Record<string, unknown>): {
    html: string;
    violations: Violation[];
};
