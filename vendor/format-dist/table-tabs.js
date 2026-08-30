/** Pure model op for the multi-tab ledger strip. The ACTIVE sheet always occupies the block's
    top-level TableData; the inactive sheets ride in `tabs` (strip order, active NOT among them);
    the active sheet's strip slot is `tabPos` (default 0, omitted). `swapActiveTab` makes a different
    strip slot the active sheet, in place.

    This is a PURE MODEL OP — it imports ONLY the TableData types + the TABLE_FIELD_KIND classifier
    from ./table-data.js, nothing else, and MUST NEVER be imported by packages/runtime (the viewer
    renders the top-level sheet and never reads `tabs`; the IIFE gate greps for this file). */
import { TABLE_FIELD_KIND } from './table-data.js';
/** The 'sheet'-kind field names — the sheet's own content + display side-maps, i.e. everything that
    TRAVELS with a tab on a swap (all fields except the block-level id/tabName/tabs/tabPos). Derived
    FROM TABLE_FIELD_KIND, never a hand list: a future TableData field is classified there (tsc-forced)
    and so is picked up here automatically — a new field can neither be missed nor mis-filed. */
const SHEET_FIELDS = Object.keys(TABLE_FIELD_KIND).filter((k) => TABLE_FIELD_KIND[k] === 'sheet');
/** Pull the 'sheet'-kind fields out of a TableData into a fresh sheet object (field REFERENCES are
    copied — this op transfers ownership, it does not deep-clone). columns/rows are required 'sheet'
    fields so they are always present on the result. */
function extractSheet(src) {
    const out = {};
    for (const k of SHEET_FIELDS)
        if (src[k] !== undefined)
            out[k] = src[k];
    return out;
}
/** Make strip slot `stripIndex` the active sheet, mutating `data` IN PLACE (same object identity — the
    studio holds a live reference to the block's data object). The full strip is `tabs` with the active
    sheet inserted at `tabPos` (default 0), length `tabs.length + 1`; strip order is preserved. The
    incoming slot's fields land on the top level, the outgoing active sheet becomes a `tabs` entry named
    by the outgoing `tabName`, `tabName` becomes the incoming entry's name, and `tabPos` becomes
    `stripIndex` (omitted when 0 — the canonical leading-active shape).

    No-op (returns early) when `tabs` is absent/empty, `stripIndex` is out of range, or it is already the
    active slot. */
export function swapActiveTab(data, stripIndex) {
    const tabs = data.tabs;
    if (!tabs || tabs.length === 0)
        return; // no strip to swap within
    const pos = data.tabPos ?? 0;
    const stripLen = tabs.length + 1;
    if (stripIndex < 0 || stripIndex >= stripLen || stripIndex === pos)
        return; // out of range / already active
    // Materialize the full strip in display order: { name, sheet } per slot, the active sheet inserted
    // at its slot `pos`. extractSheet captures the current field references BEFORE the top level is
    // rewritten below, so nothing is lost when those fields are cleared.
    const strip = tabs.map((t) => ({ name: t.name, sheet: extractSheet(t.data) }));
    strip.splice(pos, 0, { name: data.tabName ?? '', sheet: extractSheet(data) });
    const incoming = strip[stripIndex];
    const rest = strip.filter((_, i) => i !== stripIndex); // the strip minus the newly-active slot, in order
    // Rewrite the top level in place. Clear EVERY 'sheet'-kind field first so a field absent on the
    // incoming sheet is ABSENT afterwards (no stale leftover from the outgoing sheet), then lay down the
    // incoming sheet's fields. columns/rows always ride in incoming.sheet, so the required fields return.
    const top = data;
    for (const k of SHEET_FIELDS)
        delete top[k];
    Object.assign(data, incoming.sheet);
    // Block-level descriptors: incoming name/slot + the remaining sheets as `tabs` in strip order. `id`
    // (the only other 'block' field) is untouched — it stays on the block.
    data.tabName = incoming.name;
    const nextTabs = rest.map((s) => ({ name: s.name, data: s.sheet }));
    data.tabs = nextTabs;
    if (stripIndex === 0)
        delete data.tabPos;
    else
        data.tabPos = stripIndex;
}
/** Materialize the full strip in display order — one slot per sheet, the active sheet inserted at its slot
    `tabPos` (default 0) and flagged. extractSheet captures every field REFERENCE now, before the block is
    rewritten by applyStrip. `moveTab`/`deleteTab` reshuffle this array then decompose it back. */
function materializeStrip(data) {
    const tabs = data.tabs ?? [];
    const pos = Math.min(Math.max(data.tabPos ?? 0, 0), tabs.length);
    const strip = tabs.map((t) => ({ name: t.name, sheet: extractSheet(t.data), active: false }));
    strip.splice(pos, 0, { name: data.tabName ?? '', sheet: extractSheet(data), active: true });
    return strip;
}
/** Write a reshuffled strip back onto the block IN PLACE (same object identity). `activeIndex` names the
    slot that becomes the active/top-level sheet: its fields land on the top level, the rest ride in `tabs`
    in strip order. When ONLY the active slot remains, every strip descriptor (tabName/tabs/tabPos) is
    dropped, so the block collapses to a byte-identical single-sheet ledger (the same orphan-drop the
    commit-path normalize does). Mirrors swapActiveTab's rewrite: clear every 'sheet' field first so an
    incoming sheet missing an optional field leaves no stale leftover. */
function applyStrip(data, strip, activeIndex) {
    const active = strip[activeIndex];
    const rest = strip.filter((_, i) => i !== activeIndex);
    const top = data;
    for (const k of SHEET_FIELDS)
        delete top[k];
    Object.assign(data, active.sheet);
    if (rest.length === 0) {
        delete data.tabName;
        delete data.tabs;
        delete data.tabPos; // sole sheet → pristine single-sheet bytes
        return;
    }
    data.tabName = active.name;
    data.tabs = rest.map((s) => ({ name: s.name, data: s.sheet }));
    if (activeIndex === 0)
        delete data.tabPos;
    else
        data.tabPos = activeIndex;
}
/** Reorder the strip: move the sheet at strip slot `from` to slot `to`, mutating `data` IN PLACE. The
    ACTIVE sheet stays the same sheet — only strip order (and `tabPos`, coherently) changes. No-op when
    `tabs` is absent/empty, either index is out of range, or `from === to`. */
export function moveTab(data, from, to) {
    const tabs = data.tabs;
    if (!tabs || tabs.length === 0)
        return;
    const stripLen = tabs.length + 1;
    if (from < 0 || from >= stripLen || to < 0 || to >= stripLen || from === to)
        return;
    const strip = materializeStrip(data);
    const [moved] = strip.splice(from, 1);
    strip.splice(to, 0, moved);
    applyStrip(data, strip, strip.findIndex((s) => s.active));
}
/** Remove the sheet at strip slot `stripIndex`, mutating `data` IN PLACE. Deleting an INACTIVE sheet keeps
    the active one (its `tabPos` re-derived). Deleting the ACTIVE sheet hands active to its RIGHT neighbour
    (or the left one when it was rightmost). Removing the last extra sheet collapses to a byte-identical
    single-sheet ledger (applyStrip drops the strip descriptors). No-op when `tabs` is absent/empty or the
    index is out of range. */
export function deleteTab(data, stripIndex) {
    const tabs = data.tabs;
    if (!tabs || tabs.length === 0)
        return;
    const stripLen = tabs.length + 1;
    if (stripIndex < 0 || stripIndex >= stripLen)
        return;
    const strip = materializeStrip(data);
    const wasActive = strip[stripIndex].active;
    strip.splice(stripIndex, 1);
    // active removed → its right neighbour (now sitting at `stripIndex`), else the new rightmost slot.
    const activeIndex = wasActive ? Math.min(stripIndex, strip.length - 1) : strip.findIndex((s) => s.active);
    applyStrip(data, strip, activeIndex);
}
