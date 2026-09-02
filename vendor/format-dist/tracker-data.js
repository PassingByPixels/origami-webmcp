/**
 * Tracker kind data — the Coty action tracker, carried per slide as an inert
 * JSON block: <script type="application/json" data-odata="tracker">.
 * Same carrier rules as the gantt (see gantt-data.ts): the serializer escapes
 * every "<" and validateSlideContent enforces the literal script form.
 *
 * TWO SHAPES, one reader. A tracker is either
 *   LEGACY  — no `columns` ARRAY: exactly the six fixed columns below, with the
 *             optional `columns` label map, `hidden` list and `statuses` list; or
 *   CUSTOM  — `columns` is an ARRAY of author-defined column specs, each with its
 *             own key/label/type/options; `hidden`/`statuses` are then illegal
 *             because a column carries its own `hidden` flag and its own options.
 * Absence of a `columns` ARRAY means exactly the legacy six, so every tracker
 * written before this shape existed still parses and still saves byte-identical.
 */
export const TRACKER_STATUSES = ['Open', 'In progress', 'Blocked', 'Closed'];
/** The LEGACY tracker's columns, in render order. */
export const TRACKER_COLUMNS = ['action', 'owner', 'comments', 'due', 'status', 'done'];
/** The default LEGACY column headings. Absence of an override means exactly these (byte-stable). */
export const TRACKER_COLUMN_LABELS = {
    action: 'Action',
    owner: 'Owner',
    comments: 'Comments',
    due: 'Due',
    status: 'Status',
    done: 'Done',
};
/** What a column holds. The type decides the cell editor, the default width and the sort order. */
export const TRACKER_COLUMN_TYPES = ['text', 'person', 'date', 'select', 'check', 'number'];
export const TRACKER_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
export const TRACKER_WIDTH_MIN = 60;
export const TRACKER_WIDTH_MAX = 600;
export const TRACKER_MAX_COLUMNS = 24;
/** Header width per type when a column names none. */
export const TRACKER_TYPE_WIDTHS = {
    text: 220,
    person: 140,
    date: 120,
    select: 150,
    check: 64,
    number: 100,
};
/** The widths the legacy six have always rendered at — kept verbatim so a legacy tracker's
    header is pixel-identical to what it was before columns became author-defined. */
export const TRACKER_LEGACY_WIDTHS = {
    action: '26%',
    owner: '12%',
    comments: '',
    due: '9%',
    status: '12%',
    done: '64px',
};
/** The types the legacy six have always had, now written down rather than hard-coded in a renderer. */
const TRACKER_LEGACY_TYPES = {
    action: 'text',
    owner: 'person',
    comments: 'text',
    due: 'date',
    status: 'select',
    done: 'check',
};
/** The author's own column list, or null for a legacy tracker. `Array.isArray` IS the mode flag. */
export function trackerCustomColumns(data) {
    return Array.isArray(data.columns) ? data.columns : null;
}
/** The legacy six materialised as specs — the label map, the `hidden` list and `statuses` folded
    in. THE migration input, and the effective column list of every legacy tracker. */
export function trackerLegacyColumnSpecs(data) {
    const labels = (Array.isArray(data.columns) ? undefined : data.columns) ?? {};
    const hidden = new Set(data.hidden ?? []);
    const statuses = data.statuses && data.statuses.length > 0 ? data.statuses.slice() : [...TRACKER_STATUSES];
    return TRACKER_COLUMNS.map((key) => {
        const override = labels[key];
        const spec = {
            key,
            label: typeof override === 'string' && override.length > 0 ? override : TRACKER_COLUMN_LABELS[key],
            type: TRACKER_LEGACY_TYPES[key],
        };
        if (key === 'status') {
            spec.options = statuses;
            spec.status = true;
        }
        if (key === 'done')
            spec.done = true;
        // `action` is never hideable on a legacy tracker
        if (key !== 'action' && hidden.has(key))
            spec.hidden = true;
        return spec;
    });
}
/** The effective column list, in render order, INCLUDING the hidden ones. */
export function trackerColumnSpecs(data) {
    return trackerCustomColumns(data) ?? trackerLegacyColumnSpecs(data);
}
/** The columns that render, in order. */
export function trackerVisibleColumnSpecs(data) {
    return trackerColumnSpecs(data).filter((c) => c.hidden !== true);
}
/** The keys of the columns that render, in order. */
export function trackerVisibleColumns(data) {
    return trackerVisibleColumnSpecs(data).map((c) => c.key);
}
/** The effective heading for one column — the author's label, or the key if no such column exists. */
export function trackerColumnLabel(data, key) {
    return trackerColumnSpecs(data).find((c) => c.key === key)?.label ?? key;
}
/** The column driving done/reopen: a `select` marked `status`. null = no such column. */
export function trackerStatusColumn(data) {
    return trackerColumnSpecs(data).find((c) => c.type === 'select' && c.status === true) ?? null;
}
/** The completion toggle: a `check` marked `done`. null = the tracker has no done/strike behaviour. */
export function trackerDoneColumn(data) {
    return trackerColumnSpecs(data).find((c) => c.type === 'check' && c.done === true) ?? null;
}
/** The tracker's status options — the status column's list, or [] when it has no status column. */
export function trackerStatuses(data) {
    return trackerStatusColumn(data)?.options ?? [];
}
/** The header width for one column: the legacy %/px it has always used, or px from the spec/type. */
export function trackerColumnWidth(data, spec) {
    if (!trackerCustomColumns(data))
        return TRACKER_LEGACY_WIDTHS[spec.key] ?? '';
    const w = typeof spec.width === 'number' ? spec.width : TRACKER_TYPE_WIDTHS[spec.type];
    return `${w}px`;
}
// --- validation ---------------------------------------------------------------------------------
const isStr = (x, min, max) => typeof x === 'string' && x.length >= min && x.length <= max;
/** The CUSTOM arm: an author-defined column list, plus rows keyed by it. */
function validateCustomColumns(d, bad) {
    const cols = d.columns;
    if (cols.length < 1 || cols.length > TRACKER_MAX_COLUMNS) {
        bad('columns.count', `columns must hold 1-${TRACKER_MAX_COLUMNS} column definitions`);
        return;
    }
    // one source of truth: a custom column carries its own hidden flag and its own options
    if (d.statuses !== undefined)
        bad('statuses', 'statuses is the legacy key — a custom status column carries its own options');
    if (d.hidden !== undefined)
        bad('hidden', 'hidden is the legacy key — a custom column carries its own "hidden" flag');
    const specs = [];
    const seen = new Set();
    let statusCount = 0;
    let doneCount = 0;
    cols.forEach((raw, i) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
            bad('columns.shape', `column ${i}: must be a JSON object`);
            return;
        }
        const c = raw;
        if (typeof c.key !== 'string' || !TRACKER_KEY_RE.test(c.key)) {
            bad('columns.key', `column ${i}: key must match ${TRACKER_KEY_RE.source}`);
            return;
        }
        if (seen.has(c.key)) {
            bad('columns.key', `column ${i}: duplicate key "${c.key}"`);
            return;
        }
        seen.add(c.key);
        if (!isStr(c.label, 1, 40))
            bad('columns.label', `column ${i}: label must be a 1-40 character string`);
        if (typeof c.type !== 'string' || !TRACKER_COLUMN_TYPES.includes(c.type)) {
            bad('columns.type', `column ${i}: type must be one of ${TRACKER_COLUMN_TYPES.join('|')}`);
            return;
        }
        const type = c.type;
        if (type === 'select') {
            const o = c.options;
            const ok = Array.isArray(o) &&
                o.length >= 1 &&
                o.length <= 12 &&
                o.every((s) => isStr(s, 1, 40)) &&
                new Set(o).size === o.length;
            if (!ok)
                bad('columns.options', `column ${i}: a select column needs 1-12 distinct option labels (max 40 chars)`);
        }
        else if (c.options !== undefined) {
            bad('columns.options', `column ${i}: only a select column may carry options`);
        }
        if (c.width !== undefined) {
            const w = c.width;
            if (typeof w !== 'number' || !Number.isInteger(w) || w < TRACKER_WIDTH_MIN || w > TRACKER_WIDTH_MAX) {
                bad('columns.width', `column ${i}: width must be an integer ${TRACKER_WIDTH_MIN}-${TRACKER_WIDTH_MAX} px`);
            }
        }
        if (c.hidden !== undefined && typeof c.hidden !== 'boolean')
            bad('columns.hidden', `column ${i}: hidden must be a boolean`);
        if (c.status !== undefined) {
            if (typeof c.status !== 'boolean')
                bad('columns.status', `column ${i}: status must be a boolean`);
            else if (c.status) {
                if (type !== 'select')
                    bad('columns.status', `column ${i}: only a select column can be the status column`);
                else
                    statusCount++;
            }
        }
        if (c.done !== undefined) {
            if (typeof c.done !== 'boolean')
                bad('columns.done', `column ${i}: done must be a boolean`);
            else if (c.done) {
                if (type !== 'check')
                    bad('columns.done', `column ${i}: only a check column can be the done column`);
                else
                    doneCount++;
            }
        }
        specs.push(c);
    });
    if (statusCount > 1)
        bad('columns.status', 'at most ONE select column may be marked status:true');
    if (doneCount > 1)
        bad('columns.done', 'at most ONE check column may be marked done:true');
    const byKey = new Map(specs.map((s) => [s.key, s]));
    d.rows.forEach((r, i) => {
        if (r === null || typeof r !== 'object' || Array.isArray(r)) {
            bad('row.shape', `row ${i}: must be a JSON object`);
            return;
        }
        // a cell may be ABSENT (that column is blank for this row); a cell that IS there must fit its type
        for (const [k, val] of Object.entries(r)) {
            const spec = byKey.get(k);
            if (!spec) {
                bad('row.key', `row ${i}: "${k}" names no column`);
                continue;
            }
            const fail = (want) => bad(`row.${spec.type}`, `row ${i}: "${k}" must be ${want}`);
            if (spec.type === 'check') {
                if (typeof val !== 'boolean')
                    fail('a boolean');
            }
            else if (spec.type === 'number') {
                if (val !== '' && !(typeof val === 'number' && Number.isFinite(val)))
                    fail("a finite number (or '' for blank)");
            }
            else if (spec.type === 'select') {
                if (!(spec.options ?? []).includes(val))
                    fail(`one of ${(spec.options ?? []).join('|')}`);
            }
            else if (!isStr(val, 0, 2000)) {
                fail('a string (max 2000)');
            }
        }
    });
}
/** Strict shape check for a tracker data block. REJECT, never repair. */
export function validateTrackerData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `tracker.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'tracker data must be a JSON object');
        return v;
    }
    const d = data;
    if (!Array.isArray(d.rows)) {
        bad('rows', 'rows must be an array');
        return v;
    }
    // a `columns` ARRAY switches the whole block to the author-defined model
    if (Array.isArray(d.columns)) {
        validateCustomColumns(d, bad);
        return v;
    }
    // --- the legacy six -----------------------------------------------------
    // optional custom status options; absent = the default four
    let allowed = TRACKER_STATUSES;
    if (d.statuses !== undefined) {
        if (!Array.isArray(d.statuses) ||
            d.statuses.length < 1 ||
            d.statuses.length > 12 ||
            !d.statuses.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 40)) {
            bad('statuses', 'statuses must be an array of 1–12 short (≤40 char) strings');
        }
        else {
            allowed = d.statuses;
        }
    }
    // optional column heading overrides; a key absent = that column's default heading
    if (d.columns !== undefined) {
        const c = d.columns;
        if (c === null || typeof c !== 'object') {
            bad('columns', 'columns must be a JSON object of column → label, or an array of column definitions');
        }
        else {
            const entries = Object.entries(c);
            if (!entries.every(([k]) => TRACKER_COLUMNS.includes(k))) {
                bad('columns', `columns keys must be among ${TRACKER_COLUMNS.join('|')}`);
            }
            else if (!entries.every(([, l]) => typeof l === 'string' && l.length >= 1 && l.length <= 40)) {
                bad('columns', 'every column label must be a 1–40 character string');
            }
        }
    }
    // optional hidden columns; absent = every column shows. `action` can never be hidden.
    if (d.hidden !== undefined) {
        const h = d.hidden;
        const ok = Array.isArray(h) &&
            h.every((k) => typeof k === 'string' && k !== 'action' && TRACKER_COLUMNS.includes(k)) &&
            new Set(h).size === h.length;
        if (!ok)
            bad('hidden', 'hidden must be an array of distinct hideable column keys (action can never be hidden)');
    }
    const str = (x, max) => typeof x === 'string' && x.length <= max;
    d.rows.forEach((r, i) => {
        const o = (r ?? {});
        if (!str(o.action, 2000))
            bad('row.action', `row ${i}: action must be a string (max 2000)`);
        if (!str(o.owner, 200))
            bad('row.owner', `row ${i}: owner must be a string (max 200)`);
        if (!str(o.comments, 2000))
            bad('row.comments', `row ${i}: comments must be a string (max 2000)`);
        if (!str(o.due, 60))
            bad('row.due', `row ${i}: due must be a string (max 60)`);
        if (!allowed.includes(o.status)) {
            bad('row.status', `row ${i}: status must be one of ${allowed.join('|')}`);
        }
        if (typeof o.done !== 'boolean')
            bad('row.done', `row ${i}: done must be a boolean`);
    });
    return v;
}
/** Serialize tracker data for embedding — "<" escaped (same invariant as ganttDataJson). */
export function trackerDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
