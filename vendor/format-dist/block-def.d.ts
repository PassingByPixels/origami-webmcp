import type { Violation } from './types.js';
/** Field control types the Studio auto-generates. (Repeatable lists are a future
    extension — v1 is scalar fields, which cover KPI cards, callouts, badges, etc.) */
export type CompositeFieldType = 'text' | 'number' | 'select' | 'color';
export declare const COMPOSITE_FIELD_TYPES: readonly CompositeFieldType[];
export interface CompositeField {
    /** Identifier referenced in the template as {{name}}. */
    name: string;
    type: CompositeFieldType;
    /** Human label for the auto-generated control (defaults to name). */
    label?: string;
    /** Options for a 'select' field. */
    options?: string[];
    default?: string | number;
}
export interface CompositeBlockDef {
    /** Namespaced kind, x.<name> — never collides with built-in kinds. */
    kind: string;
    name: string;
    version: number;
    fields: CompositeField[];
    /** HTML of inert primitives with {{field}} placeholders. */
    template: string;
    /** Optional schema notes fed to agents (like a built-in kind's schemaComment). */
    schemaComment?: string[];
}
/** Validate one block def: well-formed shape AND its template, rendered with defaults,
    is structurally valid + INERT (a def that would bake to active content is rejected —
    `define_block` and the deck.blocks op both call this, so an active custom block can
    never enter a deck). */
export declare function validateBlockDef(def: unknown): Violation[];
/** Validate one composite-block INSTANCE. Shape always; the def-exists check only when a
    `registry` is supplied (validateKindData passes the deck's manifest.blocks; the bare
    KIND_DATA_SPECS entry calls it shape-only). The renderer coerces/defaults individual
    values, so value checking stays light — this guards integrity, not perfection. */
export declare function validateBlockInstance(data: unknown, registry?: Record<string, CompositeBlockDef>): Violation[];
/** Serialize a composite-block instance's data block JSON, escaping "<" so it can never
    terminate the inert <script>. Mirrors gridDataJson / setKindData escaping. */
export declare function blockInstanceJson(block: string, values: Record<string, unknown>): string;
/** Strip the inert data-script from every composite-block instance of `kind` in a slide's
    inner HTML, leaving the baked .o-block-out as plain inert content. Deleting a def this way
    never destroys placed content and leaves no dangling def reference (the deck stays valid).
    Zero-dep (regex): the instance JSON escapes "<" as \\u003c, so "</script>" can't appear
    inside it and the non-greedy match always ends at the real closer. */
export declare function stripBlockInstances(inner: string, kind: string): {
    inner: string;
    removed: number;
};
