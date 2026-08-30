/**
 * Data-grid kind data — a searchable / sortable table with per-column conditional
 * tone, carried per slide as an inert JSON block:
 * <script type="application/json" data-odata="grid">. Same carrier rules as the
 * tracker/gantt: the serializer escapes every "<" and validateSlideContent
 * enforces the literal script form. The grid is interactive (search/sort) WITHOUT
 * tripping the padlock because all of that lives in the bundled runtime renderer,
 * never in slide-level script — exactly the tracker pattern.
 */
export const GRID_TONES = ['', 'accent', 'green', 'amber', 'red'];
export const GRID_ALIGNS = ['left', 'right', 'center'];
export const GRID_MAX_COLS = 40;
export const GRID_MAX_ROWS = 2000;
/** Strict shape check for a grid data block. REJECT, never repair. `maxCols` lets the
    ledger (a spreadsheet) reuse this with a wider ceiling than the display grid — see
    TABLE_MAX_COLS; grid callers keep the default GRID_MAX_COLS. */
export function validateGridData(data, maxCols = GRID_MAX_COLS) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `grid.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'grid data must be a JSON object');
        return v;
    }
    const d = data;
    if (!Array.isArray(d.columns)) {
        bad('columns', 'columns must be an array');
        return v;
    }
    if (!Array.isArray(d.rows)) {
        bad('rows', 'rows must be an array');
        return v;
    }
    if (d.columns.length === 0)
        bad('columns', 'a grid needs at least one column');
    if (d.columns.length > maxCols)
        bad('columns', `too many columns (max ${maxCols})`);
    if (d.rows.length > GRID_MAX_ROWS)
        bad('rows', `too many rows (max ${GRID_MAX_ROWS})`);
    d.columns.forEach((c, i) => {
        const o = (c ?? {});
        if (typeof o.label !== 'string' || o.label.length > 200)
            bad('column.label', `column ${i}: label must be a string (max 200)`);
        if (o.align !== undefined && !GRID_ALIGNS.includes(o.align))
            bad('column.align', `column ${i}: align must be one of ${GRID_ALIGNS.join('|')}`);
        if (o.tone !== undefined)
            validateTone(o.tone, i, bad);
    });
    d.rows.forEach((r, i) => {
        if (!Array.isArray(r)) {
            bad('row', `row ${i}: must be an array of cells`);
            return;
        }
        if (r.length > maxCols)
            bad('row', `row ${i}: more cells than allowed (max ${maxCols})`);
        r.forEach((cell, c) => {
            if (typeof cell !== 'string' || cell.length > 2000)
                bad('row.cell', `row ${i} cell ${c}: must be a string (max 2000)`);
        });
    });
    return v;
}
function validateTone(tone, i, bad) {
    if (tone === null || typeof tone !== 'object') {
        bad('column.tone', `column ${i}: tone must be an object`);
        return;
    }
    const t = tone;
    if (t.type === 'status') {
        if (t.map === null || typeof t.map !== 'object' || Array.isArray(t.map)) {
            bad('column.tone', `column ${i}: status tone needs a map object`);
            return;
        }
        for (const [k, val] of Object.entries(t.map)) {
            if (!GRID_TONES.includes(val))
                bad('column.tone', `column ${i}: tone for "${k}" must be one of ${GRID_TONES.filter(Boolean).join('|')}`);
        }
    }
    else if (t.type === 'scale') {
        if (typeof t.min !== 'number' || typeof t.max !== 'number')
            bad('column.tone', `column ${i}: scale tone needs numeric min and max`);
        if (t.reverse !== undefined && typeof t.reverse !== 'boolean')
            bad('column.tone', `column ${i}: scale reverse must be a boolean`);
    }
    else {
        bad('column.tone', `column ${i}: tone.type must be "status" or "scale"`);
    }
}
/** Serialize grid data for embedding — "<" escaped (same invariant as trackerDataJson). */
export function gridDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
