/** Pure model op for the multi-tab ledger strip. The ACTIVE sheet always occupies the block's
    top-level TableData; the inactive sheets ride in `tabs` (strip order, active NOT among them);
    the active sheet's strip slot is `tabPos` (default 0, omitted). `swapActiveTab` makes a different
    strip slot the active sheet, in place.

    This is a PURE MODEL OP — it imports ONLY the TableData types + the TABLE_FIELD_KIND classifier
    from ./table-data.js, nothing else, and MUST NEVER be imported by packages/runtime (the viewer
    renders the top-level sheet and never reads `tabs`; the IIFE gate greps for this file). */
import { type TableData } from './table-data.js';
/** Make strip slot `stripIndex` the active sheet, mutating `data` IN PLACE (same object identity — the
    studio holds a live reference to the block's data object). The full strip is `tabs` with the active
    sheet inserted at `tabPos` (default 0), length `tabs.length + 1`; strip order is preserved. The
    incoming slot's fields land on the top level, the outgoing active sheet becomes a `tabs` entry named
    by the outgoing `tabName`, `tabName` becomes the incoming entry's name, and `tabPos` becomes
    `stripIndex` (omitted when 0 — the canonical leading-active shape).

    No-op (returns early) when `tabs` is absent/empty, `stripIndex` is out of range, or it is already the
    active slot. */
export declare function swapActiveTab(data: TableData, stripIndex: number): void;
/** Reorder the strip: move the sheet at strip slot `from` to slot `to`, mutating `data` IN PLACE. The
    ACTIVE sheet stays the same sheet — only strip order (and `tabPos`, coherently) changes. No-op when
    `tabs` is absent/empty, either index is out of range, or `from === to`. */
export declare function moveTab(data: TableData, from: number, to: number): void;
/** Remove the sheet at strip slot `stripIndex`, mutating `data` IN PLACE. Deleting an INACTIVE sheet keeps
    the active one (its `tabPos` re-derived). Deleting the ACTIVE sheet hands active to its RIGHT neighbour
    (or the left one when it was rightmost). Removing the last extra sheet collapses to a byte-identical
    single-sheet ledger (applyStrip drops the strip descriptors). No-op when `tabs` is absent/empty or the
    index is out of range. */
export declare function deleteTab(data: TableData, stripIndex: number): void;
