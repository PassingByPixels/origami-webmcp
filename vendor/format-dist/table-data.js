import { GRID_ALIGNS, validateGridData } from './grid-data.js';
import { a1RangeToRect } from './table-core.js';
/** The rect a baked ledger DISPLAYS: the ACTIVE named view's rect (default = the first view) when
    `views` is present, else the legacy single `rect`. Hosts (Publish, the viewer's typed paths) resolve
    the presented crop through this; the editor also mirrors the result into `rect` for forward-compat. */
export function activeBakeRect(bake) {
    // BAKED-ness = presence of `rect`. A bake carrying only saved `views` (no `rect`) is UNBAKED — the
    // author kept the views for the next bake but the ledger renders LIVE/full, with no crop to flatten.
    if (!bake || !bake.rect)
        return undefined;
    const views = bake.views;
    if (views && views.length) {
        const chosen = (bake.active != null ? views.find((v) => v.name === bake.active) : undefined) ?? views[0];
        return chosen?.rect;
    }
    return bake.rect;
}
/** Compile-time field classification consumed by studio-core's sheet-swap. On switch, 'sheet' fields TRAVEL
    with the tab (they are the sheet's own content + display side-maps); 'block' fields STAY PUT on the block
    (the stable `id` + the tab-strip descriptors). The `as const satisfies Record<keyof TableData, …>` is the
    EXHAUSTIVENESS GUARD: adding a future TableData field without classifying it here is a tsc error, so the
    sheet-swap can never silently mis-file a new field. */
export const TABLE_FIELD_KIND = {
    id: 'block', name: 'block', tabName: 'block', tabs: 'block', tabPos: 'block',
    sid: 'sheet',
    columns: 'sheet', rows: 'sheet', formulas: 'sheet', named: 'sheet',
    source: 'sheet', orefreshed: 'sheet', cellFormats: 'sheet', cellStyles: 'sheet',
    cellNames: 'sheet', rowHeights: 'sheet', rules: 'sheet', ruleOverrides: 'sheet',
    kpis: 'sheet', totals: 'sheet', bake: 'sheet', merges: 'sheet', condFmt: 'sheet',
    filter: 'sheet', hidden: 'sheet',
};
const A1_KEY = /^[A-Z]+[0-9]+$/;
const NAMED_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CONNECTOR_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const FORMULA_MAX = 1024;
const QUERY_MAX = 8192;
/** The ONLY fields a `source` may carry — anything else is rejected (no credential can ride
    under an unlisted name). */
const SOURCE_FIELDS = new Set(['connector', 'query', 'range', 'params']);
/** Credential-shaped field/param names (anchored + case-insensitive so "author"/"pattern"
    don't false-match). A name like this anywhere in `source` is rejected — secrets live in
    the trusted process, never the Fold. */
const SECRET_KEY = /^(tokens?|password|passwd|pwd|secret|credentials?|pat|api[_-]?key|apikey|bearer|access[_-]?key|client[_-]?secret|auth)$/i;
/** Non-negative integer, no leading zeros — a row/column index key. */
const INDEX_KEY = /^(0|[1-9][0-9]*)$/;
/** A ledger fill-ramp TOKEN name ("fill-1".."fill-N") — never a raw colour or CSS keyword. The
    "fill-" prefix is required so a bare colour word (red/aqua/none/inherit) can't ride through. */
const FILL_TOKEN = /^fill-[a-z0-9-]{1,27}$/;
/** A raw custom fill colour — a #rgb / #rrggbb hex (fixed; does not re-theme). Strict shape so a
    validated fill can only ever be a colour when the viewer applies it inline. */
const FILL_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FORMAT_KINDS = new Set(['general', 'number', 'currency', 'percent', 'date', 'text']);
const CELL_FORMAT_FIELDS = new Set(['kind', 'decimals', 'sep', 'thou', 'currency', 'dateFmt']);
const CELL_STYLE_FIELDS = new Set(['b', 'i', 'u', 's', 'align', 'fill', 'wrap', 'color', 'indent', 'orient']);
/** Legacy text-orientation STRINGS — 'up'/'down' rotate ±90° (writing-mode), 'stack' is vertical
    stacked letters. Still accepted (0.3.2 decks carry them); the editor now writes numbers or 'stack'. */
const CELL_ORIENTS = new Set(['up', 'down', 'stack']);
/** A numeric orient is an integer angle in this inclusive degree range (the radial dial's domain). */
const ORIENT_DEG_MIN = -90;
const ORIENT_DEG_MAX = 90;
/** Left-indent cap — Excel's own indent range is 0..15. */
const INDENT_MAX = 15;
/** px cap for a column width / row height. */
const DIM_MAX = 4096;
/** char cap for a cellName / KPI name / KPI ref. */
const NAME_MAX = 64;
const AGG_FNS = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']);
/** The conditional-format rule kinds + the ONLY fields a rule may carry (allowlist; per-kind checks
    below then forbid the fields that don't belong to a given kind). */
const COND_KINDS = new Set(['dupes', 'gt', 'lt', 'eq', 'top', 'bot', 'scale']);
const COND_RULE_FIELDS = new Set(['range', 'kind', 'value', 'text', 'n', 'fill', 'color', 'from', 'to']);
/** A ledger is a spreadsheet, not a display grid — it gets a far wider column ceiling than
    GRID_MAX_COLS (Excel-classic width, column IV). The author calculates across the whole sheet;
    Bake picks the crop that actually presents. colA1 addresses multi-letter columns (AA…IV), so
    the calc engine + editor already handle the full width. Rows stay at GRID_MAX_ROWS. */
export const TABLE_MAX_COLS = 256;
/** Strict shape check. REJECT, never repair. Reuses grid's column/row/tone/caps
    validation (re-prefixed table.*) and adds SHAPE-ONLY formula/named checks. */
export function validateTableData(data) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return [{ rule: 'table.shape', detail: 'table data must be a JSON object' }];
    }
    const d = data;
    const v = [];
    const isMap = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    // Per-SHEET shape validation: columns/rows/tone/caps + every 'sheet' side-map (see TABLE_FIELD_KIND),
    // shared VERBATIM by the top-level ACTIVE sheet and each inactive tab entry's `data`. `prefix`
    // ("table" or "table.tabs[2]") aims every violation at the right sheet; block-level fields
    // (id/tabName/tabs/tabPos) are the caller's job, NOT checked here.
    const validateSheet = (d, prefix) => {
        for (const x of validateGridData({ columns: d.columns, rows: d.rows }, TABLE_MAX_COLS)) {
            v.push({ rule: x.rule.replace(/^grid\./, `${prefix}.`), detail: x.detail });
        }
        const bad = (rule, detail) => v.push({ rule: `${prefix}.${rule}`, detail });
        // Optional stable per-SHEET id (lazily minted on first chart link to this sheet — see the
        // TableData.sid doc). Sheet-level, so a tab entry may carry it too; same shape rule as `id`.
        if (d.sid !== undefined && (typeof d.sid !== 'string' || d.sid.length === 0 || d.sid.length > 64)) {
            bad('sid', 'sid must be a non-empty string (max 64)');
        }
        // hidden: sheet-level Present-visibility flag. Mirrors the `wrap` discipline — only the literal `true`
        // is ever stored (a shown sheet omits it → byte-identical), so reject anything else, including `false`.
        // Sheet-scoped, so it is checked here and thus permitted inside a tab entry's data too.
        if (d.hidden !== undefined && d.hidden !== true)
            bad('hidden', 'hidden must be true when present');
        const checkFormula = (where, key, val) => {
            // "<" IS allowed — comparisons (=IF(A1<B1,..), =A1<=B1, =A1<>B1) are foundational. Wire-safety
            // comes from tableDataJson escaping every "<" to < (same as source.query/SQL), NOT from
            // this shape check; the viewer never executes formulas. Shape only: "="-prefixed, length cap.
            if (typeof val !== 'string' || !val.startsWith('=') || val.length > FORMULA_MAX) {
                bad(where, `${key}: must be a "="-prefixed string (max ${FORMULA_MAX} chars)`);
            }
        };
        const checkFormat = (where, key, val) => {
            if (!isMap(val)) {
                bad(where, `${key}: format must be an object`);
                return;
            }
            for (const k of Object.keys(val))
                if (!CELL_FORMAT_FIELDS.has(k))
                    bad(where, `${key}: unknown format field "${k}"`);
            if (typeof val.kind !== 'string' || !FORMAT_KINDS.has(val.kind))
                bad(where, `${key}: format.kind must be one of ${[...FORMAT_KINDS].join('|')}`);
            if (val.decimals !== undefined && (typeof val.decimals !== 'number' || !Number.isInteger(val.decimals) || val.decimals < 0 || val.decimals > 10))
                bad(where, `${key}: format.decimals must be an integer 0..10`);
            if (val.sep !== undefined && val.sep !== '.' && val.sep !== ',')
                bad(where, `${key}: format.sep must be "." or ","`);
            if (val.thou !== undefined && typeof val.thou !== 'boolean')
                bad(where, `${key}: format.thou must be a boolean`);
            if (val.currency !== undefined && (typeof val.currency !== 'string' || val.currency.length > 8))
                bad(where, `${key}: format.currency must be a string (max 8)`);
            if (val.dateFmt !== undefined && (typeof val.dateFmt !== 'string' || val.dateFmt.length > 32))
                bad(where, `${key}: format.dateFmt must be a string (max 32)`);
        };
        const checkStyle = (where, key, val) => {
            if (!isMap(val)) {
                bad(where, `${key}: style must be an object`);
                return;
            }
            for (const k of Object.keys(val))
                if (!CELL_STYLE_FIELDS.has(k))
                    bad(where, `${key}: unknown style field "${k}"`);
            for (const flag of ['b', 'i', 'u', 's']) {
                if (val[flag] !== undefined && val[flag] !== 1)
                    bad(where, `${key}: style.${flag} must be 1 when present`);
            }
            if (val.align !== undefined && !GRID_ALIGNS.includes(val.align))
                bad(where, `${key}: style.align must be one of ${GRID_ALIGNS.join('|')}`);
            if (val.fill !== undefined && (typeof val.fill !== 'string' || !(FILL_TOKEN.test(val.fill) || FILL_HEX.test(val.fill))))
                bad(where, `${key}: style.fill must be a theme token (e.g. "fill-3") or a #rgb/#rrggbb hex colour`);
            // wrap mirrors the b/i/u/s discipline: only the "on" value is ever stored (never a written `false`),
            // so a table without it stays byte-identical — reject anything else, including `false`.
            if (val.wrap !== undefined && val.wrap !== true)
                bad(where, `${key}: style.wrap must be true when present`);
            // color is display-only font colour — EXACT same shape discipline as fill (a re-themable token or a
            // fixed hex), so it can never inject anything but a colour when the viewer applies it.
            if (val.color !== undefined && (typeof val.color !== 'string' || !(FILL_TOKEN.test(val.color) || FILL_HEX.test(val.color))))
                bad(where, `${key}: style.color must be a theme token (e.g. "fill-3") or a #rgb/#rrggbb hex colour`);
            if (val.indent !== undefined && (typeof val.indent !== 'number' || !Number.isInteger(val.indent) || val.indent < 0 || val.indent > INDENT_MAX))
                bad(where, `${key}: style.indent must be an integer 0..${INDENT_MAX}`);
            if (val.orient !== undefined) {
                const o = val.orient;
                const okStr = typeof o === 'string' && CELL_ORIENTS.has(o);
                const okNum = typeof o === 'number' && Number.isInteger(o) && o >= ORIENT_DEG_MIN && o <= ORIENT_DEG_MAX;
                if (!okStr && !okNum)
                    bad(where, `${key}: style.orient must be an integer ${ORIENT_DEG_MIN}..${ORIENT_DEG_MAX} or one of ${[...CELL_ORIENTS].join('|')}`);
            }
        };
        const a1Map = (field, val, each) => {
            if (!isMap(val)) {
                bad(field, `${field} must be an object map keyed by A1 address`);
                return;
            }
            for (const [k, v0] of Object.entries(val)) {
                if (!A1_KEY.test(k))
                    bad(`${field}.key`, `${field} key "${k}" must be an A1 cell address (e.g. B3)`);
                each(k, v0);
            }
        };
        if (d.formulas !== undefined) {
            if (d.formulas === null || typeof d.formulas !== 'object' || Array.isArray(d.formulas)) {
                bad('formulas', 'formulas must be an object map of A1 -> formula');
            }
            else {
                for (const [k, val] of Object.entries(d.formulas)) {
                    if (!A1_KEY.test(k))
                        bad('formulas.key', `formula key "${k}" must be an A1 cell address (e.g. B3)`);
                    checkFormula('formulas.value', k, val);
                }
            }
        }
        if (d.named !== undefined) {
            if (d.named === null || typeof d.named !== 'object' || Array.isArray(d.named)) {
                bad('named', 'named must be an object map of name -> formula');
            }
            else {
                for (const [k, val] of Object.entries(d.named)) {
                    if (!NAMED_KEY.test(k))
                        bad('named.key', `named output "${k}" must be an identifier`);
                    checkFormula('named.value', k, val);
                }
            }
        }
        // self-refresh source (§4): shape only — the connector id + a query (which MAY contain "<";
        // tableDataJson escapes it). NO credential field is permitted; secrets live in the trusted
        // process, never the file. range/params are optional.
        if (d.source !== undefined) {
            const s = d.source;
            if (s === null || typeof s !== 'object' || Array.isArray(s)) {
                bad('source', 'source must be an object { connector, query, range?, params? }');
            }
            else {
                const so = s;
                // ALLOWLIST the fields — any other key is rejected, so a credential can't ride under an
                // unlisted/odd-cased name (apiKey, auth, Token, …). A name blocklist is leak-by-omission;
                // an allowlist + a secret-shaped-name check on params is the moat. Secrets live in the
                // trusted process, never the file.
                for (const k of Object.keys(so)) {
                    if (!SOURCE_FIELDS.has(k)) {
                        bad('source.key', `unknown source field "${k}" — source carries only { connector, query, range, params }; credentials live in the trusted process, never the file`);
                    }
                    if (SECRET_KEY.test(k)) {
                        bad('source.secret', `source field "${k}" looks like a credential — secrets live in the trusted process, never the file`);
                    }
                }
                if (typeof so.connector !== 'string' || !CONNECTOR_KEY.test(so.connector)) {
                    bad('source.connector', 'connector must be a short identifier (e.g. "databricks")');
                }
                if (typeof so.query !== 'string' || so.query.length === 0 || so.query.length > QUERY_MAX) {
                    bad('source.query', `query must be a non-empty string (max ${QUERY_MAX} chars)`);
                }
                if (so.range !== undefined && (typeof so.range !== 'string' || so.range.length > 64)) {
                    bad('source.range', 'range must be a string (max 64)');
                }
                if (so.params !== undefined) {
                    if (so.params === null || typeof so.params !== 'object' || Array.isArray(so.params)) {
                        bad('source.params', 'params must be an object map of name -> value');
                    }
                    else {
                        for (const [k, val] of Object.entries(so.params)) {
                            if (!NAMED_KEY.test(k) || typeof val !== 'string' || val.length > 256) {
                                bad('source.params', `param "${k}" must be an identifier -> string (max 256)`);
                            }
                            if (SECRET_KEY.test(k)) {
                                bad('source.secret', `param "${k}" looks like a credential — secrets live in the trusted process, never the file`);
                            }
                        }
                    }
                }
            }
        }
        if (d.orefreshed !== undefined && (typeof d.orefreshed !== 'string' || d.orefreshed.length > 40)) {
            bad('orefreshed', 'orefreshed must be an ISO timestamp string (max 40)');
        }
        // --- Alpha display/authoring side-maps (all optional). SHAPE only, reject-never-repair. ---
        // Per-column display format + width live ON the column objects (grid ignores them).
        if (Array.isArray(d.columns)) {
            d.columns.forEach((c, i) => {
                const o = (c ?? {});
                if (o.format !== undefined)
                    checkFormat('column.format', `column ${i}`, o.format);
                if (o.width !== undefined && (typeof o.width !== 'number' || !(o.width > 0) || o.width > DIM_MAX)) {
                    bad('column.width', `column ${i}: width must be a positive number (max ${DIM_MAX})`);
                }
                if (o.name !== undefined && (typeof o.name !== 'string' || !NAMED_KEY.test(o.name) || A1_KEY.test(o.name) || o.name.length > NAME_MAX)) {
                    // reject an A1-shaped name (e.g. "Q1") — resolveNames lets a real A1 ref win, so a name that
                    // looks like a cell address would silently resolve to that cell in a formula, not this column.
                    bad('column.name', `column ${i}: name must be an identifier that is NOT a cell address (max ${NAME_MAX})`);
                }
                // filterable is REMOVED — superseded by the ledger-level `filter` region (an Excel-like header row).
                // Clean break (0.3.2 never shipped publicly): reject a stray per-column flag rather than silently
                // misread an old deck.
                if (o.filterable !== undefined)
                    bad('column.filterable', `column ${i}: filterable is removed — use the ledger-level filter region`);
            });
        }
        if (d.cellFormats !== undefined)
            a1Map('cellFormats', d.cellFormats, (k, v0) => checkFormat('cellFormats.value', k, v0));
        if (d.cellStyles !== undefined)
            a1Map('cellStyles', d.cellStyles, (k, v0) => checkStyle('cellStyles.value', k, v0));
        if (d.cellNames !== undefined) {
            a1Map('cellNames', d.cellNames, (k, v0) => {
                // an A1-shaped name (e.g. "Q1") would silently resolve to cell Q1 in a formula (resolveNames lets
                // a real A1 ref win), so reject it here too — the editor's naming surface already refuses it.
                if (typeof v0 !== 'string' || !NAMED_KEY.test(v0) || A1_KEY.test(v0) || v0.length > NAME_MAX)
                    bad('cellNames.value', `cellNames["${k}"] must be an identifier that is NOT a cell address (max ${NAME_MAX})`);
            });
        }
        if (d.rowHeights !== undefined) {
            if (!isMap(d.rowHeights))
                bad('rowHeights', 'rowHeights must be an object map of rowIndex -> px');
            else
                for (const [k, v0] of Object.entries(d.rowHeights)) {
                    if (!INDEX_KEY.test(k))
                        bad('rowHeights.key', `rowHeights key "${k}" must be a row index`);
                    if (typeof v0 !== 'number' || !(v0 > 0) || v0 > DIM_MAX)
                        bad('rowHeights.value', `rowHeights["${k}"] must be a positive number (max ${DIM_MAX})`);
                }
        }
        if (d.rules !== undefined) {
            if (!isMap(d.rules))
                bad('rules', 'rules must be an object { cols?, rows? }');
            else {
                for (const axis of ['cols', 'rows']) {
                    const set = d.rules[axis];
                    if (set === undefined)
                        continue;
                    if (!isMap(set)) {
                        bad(`rules.${axis}`, `rules.${axis} must be an object map of index -> "=…" template`);
                        continue;
                    }
                    for (const [k, v0] of Object.entries(set)) {
                        if (!INDEX_KEY.test(k))
                            bad(`rules.${axis}.key`, `rules.${axis} key "${k}" must be a ${axis === 'cols' ? 'column' : 'row'} index`);
                        checkFormula(`rules.${axis}.value`, k, v0);
                    }
                }
            }
        }
        if (d.ruleOverrides !== undefined) {
            if (!Array.isArray(d.ruleOverrides))
                bad('ruleOverrides', 'ruleOverrides must be an array of A1 addresses');
            else
                d.ruleOverrides.forEach((k, i) => {
                    if (typeof k !== 'string' || !A1_KEY.test(k))
                        bad('ruleOverrides', `ruleOverrides[${i}] must be an A1 cell address`);
                });
        }
        if (d.kpis !== undefined) {
            if (!Array.isArray(d.kpis))
                bad('kpis', 'kpis must be an array of { name, ref }');
            else
                d.kpis.forEach((p, i) => {
                    const o = (p ?? {});
                    if (typeof o.name !== 'string' || !NAMED_KEY.test(o.name) || o.name.length > NAME_MAX)
                        bad('kpis.name', `kpis[${i}].name must be an identifier (max ${NAME_MAX})`);
                    if (typeof o.ref !== 'string' || o.ref.length === 0 || o.ref.length > NAME_MAX)
                        bad('kpis.ref', `kpis[${i}].ref must be a non-empty string (max ${NAME_MAX})`);
                    if (o.value !== undefined && (typeof o.value !== 'string' || o.value.length > 64))
                        bad('kpis.value', `kpis[${i}].value must be a string (max 64)`);
                });
        }
        if (d.totals !== undefined) {
            if (!isMap(d.totals))
                bad('totals', 'totals must be an object { on?, fns? }');
            else {
                if (d.totals.on !== undefined && typeof d.totals.on !== 'boolean')
                    bad('totals.on', 'totals.on must be a boolean');
                if (d.totals.fns !== undefined) {
                    if (!isMap(d.totals.fns))
                        bad('totals.fns', 'totals.fns must be an object map of colIndex -> function');
                    else
                        for (const [k, v0] of Object.entries(d.totals.fns)) {
                            if (!INDEX_KEY.test(k))
                                bad('totals.fns.key', `totals.fns key "${k}" must be a column index`);
                            if (typeof v0 !== 'string' || !AGG_FNS.has(v0))
                                bad('totals.fns.value', `totals.fns["${k}"] must be one of ${[...AGG_FNS].join('|')}`);
                        }
                }
            }
        }
        if (d.bake !== undefined) {
            if (!isMap(d.bake))
                bad('bake', 'bake must be an object { rect? }');
            else {
                // allowlist bake's fields: `rect` (the legacy single crop) + the additive `views`/`active`.
                for (const k of Object.keys(d.bake))
                    if (k !== 'rect' && k !== 'views' && k !== 'active')
                        bad('bake.key', `bake: unknown field "${k}"`);
                const nr = Array.isArray(d.rows) ? d.rows.length : 0;
                const rowLens = Array.isArray(d.rows) ? d.rows.map((row) => (Array.isArray(row) ? row.length : 0)) : [];
                const nc = Array.isArray(d.columns) ? Math.max(d.columns.length, 0, ...rowLens) : 0;
                // one crop-rect shape+range check, reused by bake.rect AND every named view's rect. `rule` names
                // the field so the violation points at the right place (bake.rect / bake.views[i].rect).
                const checkRect = (r, rule) => {
                    if (!isMap(r)) {
                        bad(rule, `${rule} must be an object { r0, c0, r1, c1 }`);
                        return;
                    }
                    const KEYS = ['r0', 'c0', 'r1', 'c1'];
                    for (const k of Object.keys(r))
                        if (!KEYS.includes(k))
                            bad(`${rule}.key`, `${rule}: unknown field "${k}"`);
                    const int = (x) => typeof x === 'number' && Number.isInteger(x) && x >= 0;
                    if (!KEYS.every((k) => int(r[k]))) {
                        bad(rule, `${rule} r0/c0/r1/c1 must be non-negative integers`);
                    }
                    else {
                        const { r0, c0, r1, c1 } = r;
                        if (r0 > r1 || c0 > c1)
                            bad(rule, `${rule} must have r0<=r1 and c0<=c1`);
                        else if (r1 >= nr || c1 >= nc)
                            bad(rule, `${rule} is outside the grid (rows ${nr}, cols ${nc})`);
                    }
                };
                if (d.bake.rect !== undefined)
                    checkRect(d.bake.rect, 'bake.rect');
                // additive named views: a non-empty array of { name, rect }; names non-empty ≤NAME_MAX + UNIQUE;
                // `active` (when present) MUST name an existing view. Absent `views` ⇒ none of this runs (back-compat).
                const names = new Set();
                if (d.bake.views !== undefined) {
                    if (!Array.isArray(d.bake.views) || d.bake.views.length === 0) {
                        bad('bake.views', 'bake.views must be a non-empty array of { name, rect }');
                    }
                    else {
                        d.bake.views.forEach((view, i) => {
                            if (!isMap(view)) {
                                bad('bake.views', `bake.views[${i}] must be an object { name, rect }`);
                                return;
                            }
                            for (const k of Object.keys(view))
                                if (k !== 'name' && k !== 'rect')
                                    bad('bake.views.key', `bake.views[${i}]: unknown field "${k}"`);
                            if (typeof view.name !== 'string' || view.name.length === 0 || view.name.length > NAME_MAX) {
                                bad('bake.views.name', `bake.views[${i}].name must be a non-empty string (max ${NAME_MAX})`);
                            }
                            else if (names.has(view.name)) {
                                bad('bake.views.name', `bake.views[${i}].name "${view.name}" must be unique`);
                            }
                            else {
                                names.add(view.name);
                            }
                            checkRect(view.rect, `bake.views[${i}].rect`);
                        });
                    }
                }
                if (d.bake.active !== undefined) {
                    // active is only meaningful with views, and must name one of them (matched above → in `names`).
                    if (d.bake.views === undefined)
                        bad('bake.active', 'bake.active requires bake.views');
                    else if (typeof d.bake.active !== 'string' || !names.has(d.bake.active))
                        bad('bake.active', 'bake.active must name an existing view');
                }
            }
        }
        // Merged cell regions: each a well-formed A1 range of ≥2 cells, in-bounds of the grid, and with NO
        // pairwise overlap (a cell can belong to at most one merge). SHAPE only — reject, never repair.
        if (d.merges !== undefined) {
            if (!Array.isArray(d.merges)) {
                bad('merges', 'merges must be an array of A1 range strings (e.g. "B2:D3")');
            }
            else {
                const nr = Array.isArray(d.rows) ? d.rows.length : 0;
                const rowLens = Array.isArray(d.rows) ? d.rows.map((row) => (Array.isArray(row) ? row.length : 0)) : [];
                const nc = Array.isArray(d.columns) ? Math.max(d.columns.length, 0, ...rowLens) : 0;
                const seen = [];
                d.merges.forEach((m, i) => {
                    if (typeof m !== 'string') {
                        bad('merges', `merges[${i}] must be an A1 range string (e.g. "B2:D3")`);
                        return;
                    }
                    const rect = a1RangeToRect(m);
                    if (!rect) {
                        bad('merges', `merges[${i}] "${m}" is not an A1 range (e.g. "B2:D3")`);
                        return;
                    }
                    if (rect.r0 === rect.r1 && rect.c0 === rect.c1) {
                        bad('merges', `merges[${i}] "${m}" must cover at least 2 cells`);
                        return;
                    }
                    if (rect.r1 >= nr || rect.c1 >= nc) {
                        bad('merges', `merges[${i}] "${m}" is outside the grid (rows ${nr}, cols ${nc})`);
                        return;
                    }
                    for (const o of seen) {
                        if (!(rect.r1 < o.r0 || rect.r0 > o.r1 || rect.c1 < o.c0 || rect.c0 > o.c1)) {
                            bad('merges', `merges[${i}] "${m}" overlaps another merge`);
                            break;
                        }
                    }
                    seen.push(rect);
                });
            }
        }
        // Conditional-format rules: each a well-formed in-bounds range + a known kind, with STRICT per-kind
        // field requirements. SHAPE only — reject, never repair. (Distinct from `rules`, the formula-fill maps.)
        if (d.condFmt !== undefined) {
            if (!Array.isArray(d.condFmt)) {
                bad('condFmt', 'condFmt must be an array of conditional-format rules');
            }
            else {
                const nr = Array.isArray(d.rows) ? d.rows.length : 0;
                const rowLens = Array.isArray(d.rows) ? d.rows.map((row) => (Array.isArray(row) ? row.length : 0)) : [];
                const nc = Array.isArray(d.columns) ? Math.max(d.columns.length, 0, ...rowLens) : 0;
                const okColour = (x) => typeof x === 'string' && (FILL_TOKEN.test(x) || FILL_HEX.test(x));
                d.condFmt.forEach((rule, i) => {
                    if (!isMap(rule)) {
                        bad('condFmt', `condFmt[${i}] must be an object`);
                        return;
                    }
                    for (const k of Object.keys(rule))
                        if (!COND_RULE_FIELDS.has(k))
                            bad('condFmt.field', `condFmt[${i}] unknown field "${k}"`);
                    const kind = rule.kind;
                    if (typeof kind !== 'string' || !COND_KINDS.has(kind))
                        bad('condFmt.kind', `condFmt[${i}].kind must be one of ${[...COND_KINDS].join('|')}`);
                    // range: well-formed A1 range, in-bounds of the grid
                    if (typeof rule.range !== 'string') {
                        bad('condFmt.range', `condFmt[${i}].range must be an A1 range string (e.g. "A1:A10")`);
                    }
                    else {
                        const rect = a1RangeToRect(rule.range);
                        if (!rect)
                            bad('condFmt.range', `condFmt[${i}].range "${rule.range}" is not an A1 range (e.g. "A1:A10")`);
                        else if (rect.r1 >= nr || rect.c1 >= nc)
                            bad('condFmt.range', `condFmt[${i}].range "${rule.range}" is outside the grid (rows ${nr}, cols ${nc})`);
                    }
                    // fill/color, when present, follow the cellStyles colour discipline
                    if (rule.fill !== undefined && !okColour(rule.fill))
                        bad('condFmt.fill', `condFmt[${i}].fill must be a theme token (e.g. "fill-3") or a #rgb/#rrggbb hex`);
                    if (rule.color !== undefined && !okColour(rule.color))
                        bad('condFmt.color', `condFmt[${i}].color must be a theme token (e.g. "fill-3") or a #rgb/#rrggbb hex`);
                    // per-kind: require what the kind needs, forbid what it can't carry
                    if (kind === 'scale') {
                        if (!(typeof rule.from === 'string' && FILL_HEX.test(rule.from)))
                            bad('condFmt.scale', `condFmt[${i}] scale needs a strict-hex "from"`);
                        if (!(typeof rule.to === 'string' && FILL_HEX.test(rule.to)))
                            bad('condFmt.scale', `condFmt[${i}] scale needs a strict-hex "to"`);
                        if (rule.fill !== undefined || rule.color !== undefined || rule.value !== undefined || rule.text !== undefined || rule.n !== undefined)
                            bad('condFmt.scale', `condFmt[${i}] scale takes only from/to (no fill/color/value/text/n)`);
                    }
                    else if (kind === 'gt' || kind === 'lt') {
                        if (typeof rule.value !== 'number' || !Number.isFinite(rule.value))
                            bad('condFmt.value', `condFmt[${i}] ${kind} needs a numeric "value"`);
                        if (rule.text !== undefined || rule.n !== undefined || rule.from !== undefined || rule.to !== undefined)
                            bad('condFmt.field', `condFmt[${i}] ${kind} takes only value + fill/color`);
                        if (rule.fill === undefined && rule.color === undefined)
                            bad('condFmt.paint', `condFmt[${i}] ${kind} needs a fill or a color`);
                    }
                    else if (kind === 'eq') {
                        if (typeof rule.text !== 'string' || rule.text.trim() === '')
                            bad('condFmt.text', `condFmt[${i}] eq needs a non-empty "text"`);
                        if (rule.value !== undefined || rule.n !== undefined || rule.from !== undefined || rule.to !== undefined)
                            bad('condFmt.field', `condFmt[${i}] eq takes only text + fill/color`);
                        if (rule.fill === undefined && rule.color === undefined)
                            bad('condFmt.paint', `condFmt[${i}] eq needs a fill or a color`);
                    }
                    else if (kind === 'top' || kind === 'bot') {
                        if (typeof rule.n !== 'number' || !Number.isInteger(rule.n) || rule.n < 1)
                            bad('condFmt.n', `condFmt[${i}] ${kind} needs an integer "n" ≥ 1`);
                        if (rule.value !== undefined || rule.text !== undefined || rule.from !== undefined || rule.to !== undefined)
                            bad('condFmt.field', `condFmt[${i}] ${kind} takes only n + fill/color`);
                        if (rule.fill === undefined && rule.color === undefined)
                            bad('condFmt.paint', `condFmt[${i}] ${kind} needs a fill or a color`);
                    }
                    else if (kind === 'dupes') {
                        if (rule.value !== undefined || rule.text !== undefined || rule.n !== undefined || rule.from !== undefined || rule.to !== undefined)
                            bad('condFmt.field', `condFmt[${i}] dupes takes only fill/color`);
                        if (rule.fill === undefined && rule.color === undefined)
                            bad('condFmt.paint', `condFmt[${i}] dupes needs a fill or a color`);
                    }
                });
            }
        }
        // Single filter region (see TableFilter): row in-bounds; cols a non-empty, deduped, in-bounds list.
        if (d.filter !== undefined) {
            if (!isMap(d.filter)) {
                bad('filter', 'filter must be an object { row, cols }');
            }
            else {
                const nr = Array.isArray(d.rows) ? d.rows.length : 0;
                const rowLens = Array.isArray(d.rows) ? d.rows.map((row) => (Array.isArray(row) ? row.length : 0)) : [];
                const nc = Array.isArray(d.columns) ? Math.max(d.columns.length, 0, ...rowLens) : 0;
                const fr = d.filter;
                for (const k of Object.keys(fr))
                    if (k !== 'row' && k !== 'cols')
                        bad('filter.key', `filter: unknown field "${k}"`);
                if (typeof fr.row !== 'number' || !Number.isInteger(fr.row) || fr.row < 0 || fr.row >= nr) {
                    bad('filter.row', `filter.row must be a row index in-bounds (rows ${nr})`);
                }
                if (!Array.isArray(fr.cols) || fr.cols.length === 0) {
                    bad('filter.cols', 'filter.cols must be a non-empty array of column indices');
                }
                else {
                    const seen = new Set();
                    for (const c of fr.cols) {
                        if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= nc)
                            bad('filter.cols', `filter.cols has an out-of-bounds column (cols ${nc})`);
                        else if (seen.has(c))
                            bad('filter.cols', `filter.cols has a duplicate column ${c}`);
                        else
                            seen.add(c);
                    }
                }
            }
        }
    };
    const bad = (rule, detail) => v.push({ rule: `table.${rule}`, detail });
    // The ACTIVE sheet occupies the block's top-level TableData.
    validateSheet(d, 'table');
    // Optional stable block id — lazily minted on first chart link (present → shape check, absent → skip).
    if (d.id !== undefined && (typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 64)) {
        bad('id', 'id must be a non-empty string (max 64)');
    }
    // Block-level DISPLAY name (see TableData.name): presentation text, NOT the old cross-ledger link
    // identifier — so any printable string is fine (spaces/unicode ok), only bounded like `id`/`sid`.
    // Non-empty ≤ NAME_MAX; a shown ledger omits it when unnamed → byte-identical. Reject '' / over-length /
    // non-string (the empty case is a CLEAR at the editor, never a stored value).
    if (d.name !== undefined && (typeof d.name !== 'string' || d.name.length === 0 || d.name.length > NAME_MAX)) {
        bad('name', `name must be a non-empty string (max ${NAME_MAX})`);
    }
    // --- Multi-tab strip (block-level; see TABLE_FIELD_KIND). The ACTIVE sheet is this top-level data
    // (named by `tabName`); the inactive sheets ride in `tabs`; `tabPos` is the active sheet's strip slot.
    // Each tab is a FULLY INDEPENDENT sheet — the entry's `data` is recursed through validateSheet, minus
    // the block-level fields. All omitted on a single-sheet ledger, so it serializes byte-identically. ---
    const hasTabs = d.tabs !== undefined;
    const hasTabName = d.tabName !== undefined;
    // tabName: display text (spaces allowed), non-empty, <= NAME_MAX; only meaningful alongside `tabs`.
    if (hasTabName) {
        if (typeof d.tabName !== 'string' || d.tabName.length === 0 || d.tabName.length > NAME_MAX) {
            bad('tabName', `tabName must be a non-empty string (max ${NAME_MAX})`);
        }
        if (!hasTabs)
            bad('tabName', 'tabName requires tabs — it only names the active sheet within a multi-tab strip');
    }
    // tabs: a non-empty array of { name, data }; requires `tabName`; every name UNIQUE across the strip
    // (tabs[].name + tabName). Each entry's `data` is a FULL sheet (recursed), minus block-level fields.
    if (hasTabs) {
        if (!hasTabName)
            bad('tabs', 'tabs requires tabName — the active sheet needs a name once the strip is multi-tab');
        const tabsArr = d.tabs;
        if (!Array.isArray(tabsArr) || tabsArr.length === 0) {
            bad('tabs', 'tabs must be a non-empty array of { name, data }');
        }
        else {
            const names = new Set();
            if (typeof d.tabName === 'string')
                names.add(d.tabName);
            tabsArr.forEach((tab, i) => {
                if (!isMap(tab)) {
                    bad('tabs', `tabs[${i}] must be an object { name, data }`);
                    return;
                }
                for (const k of Object.keys(tab))
                    if (k !== 'name' && k !== 'data')
                        bad('tabs.key', `tabs[${i}]: unknown field "${k}" (a tab entry carries only { name, data })`);
                if (typeof tab.name !== 'string' || tab.name.length === 0 || tab.name.length > NAME_MAX) {
                    bad('tabs.name', `tabs[${i}].name must be a non-empty string (max ${NAME_MAX})`);
                }
                else if (names.has(tab.name)) {
                    bad('tabs.name', `tabs[${i}].name "${tab.name}" must be unique across the strip (tabs + tabName)`);
                }
                else {
                    names.add(tab.name);
                }
                if (!isMap(tab.data)) {
                    bad(`tabs[${i}].data`, `tabs[${i}].data must be an object (a sheet)`);
                    return;
                }
                const sheet = tab.data;
                // block-level fields never ride inside a tab: `id`/`name` stay on the block, and tabs never nest.
                for (const bf of ['id', 'name', 'tabName', 'tabs', 'tabPos']) {
                    if (sheet[bf] !== undefined)
                        bad(`tabs[${i}].${bf}`, `tabs[${i}].data must not carry block-level field "${bf}" (it belongs on the active/top-level sheet; tabs don't nest)`);
                }
                validateSheet(sheet, `table.tabs[${i}]`);
            });
        }
    }
    // tabPos: the active sheet's 0-based slot in the strip of tabs.length + 1; requires `tabs`. A written
    // 0 is VALID (the editor omits it, but reject-never-repair doesn't police a harmless explicit 0).
    if (d.tabPos !== undefined) {
        if (!hasTabs)
            bad('tabPos', 'tabPos requires tabs');
        const nTabs = Array.isArray(d.tabs) ? d.tabs.length : 0;
        if (typeof d.tabPos !== 'number' || !Number.isInteger(d.tabPos) || d.tabPos < 0 || d.tabPos > nTabs) {
            bad('tabPos', `tabPos must be an integer 0..${nTabs} (the active sheet's slot in the strip of ${nTabs + 1})`);
        }
    }
    return v;
}
/** Serialize table data for embedding — "<" escaped (same invariant as gridDataJson). */
export function tableDataJson(data) {
    return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}
