import type { Violation } from './types.js';
import { type GridColumn, type GridAlign } from './grid-data.js';
/**
 * Ledger `table` kind data — a mirror of the `grid` block (same columns/rows/tone,
 * same inert <script type="application/json" data-odata="table"> carrier, same "<"
 * escaping) PLUS two authoring-only side-maps the distributed viewer never reads:
 *   - `formulas`: A1 -> "=…"  (the cell's live formula; its BAKED value lives in `rows`)
 *   - `named`:    name -> "=…" (this block's @block.output exports)
 * The viewer renders baked `rows` only (see packages/runtime/src/table.ts). Recompute +
 * re-bake happen ONLY in the trusted app on @origami/calc (R3). This format-layer
 * validator checks SHAPE only — never parses or evaluates formulas (the engine's job).
 */
/** Where a self-refreshing table's data comes from. Inert: it carries the QUERY, never a
    credential (those live in the trusted refresh process). Read ONLY by the refresh
    pipeline (desktop / headless CLI); the distributed viewer ignores it entirely. */
export interface TableSource {
    /** Connector id, e.g. "databricks" — resolved to a credential by the trusted process. */
    connector: string;
    /** The query to run (SQL etc.). May contain "<" — tableDataJson escapes it on the wire. */
    query: string;
    /** Optional A1 target range the result maps into (default: the whole table). */
    range?: string;
    /** Optional named query parameters (values, never secrets). */
    params?: Record<string, string>;
}
/** Display-only cell/column format. NEVER changes the baked string in `rows` — the value
    stays canonical; this only tells the renderer how to SHOW it (currency symbol, decimals,
    `.` vs `,`, percent, date mask). Authoring metadata; the viewer applies it at render, no compute. */
export type CellFormat = {
    kind: 'general' | 'number' | 'currency' | 'percent' | 'date' | 'text';
    /** Decimal places (number/currency/percent). 0..10. */
    decimals?: number;
    /** Decimal separator glyph. */
    sep?: '.' | ',';
    /** Thousands grouping on/off (number only). Default true; omitted when true (byte-stability). */
    thou?: boolean;
    /** Currency symbol/ISO (currency only), e.g. "€". */
    currency?: string;
    /** Date mask (date only), e.g. "YYYY-MM-DD". */
    dateFmt?: string;
};
/** Display-only cell style. `fill` and `color` are THEME TOKEN NAMEs (e.g. "fill-3"), never a raw
    colour, so re-theming a doc re-colours its ledgers and no colour is baked into the file — UNLESS
    a strict #rgb/#rrggbb hex is given, which is a fixed custom colour instead (see FILL_TOKEN/FILL_HEX). */
export type CellStyle = {
    b?: 1;
    i?: 1;
    u?: 1;
    s?: 1;
    align?: GridAlign;
    fill?: string;
    /** Multi-line wrap (the row grows to fit); absent/false = today's single-line overflow-hidden. */
    wrap?: boolean;
    /** Font colour — same token-or-hex discipline as `fill` (see FILL_TOKEN/FILL_HEX). */
    color?: string;
    /** Left-indent level, 0..15 (Excel's range) — padding-left steps on left-aligned content. */
    indent?: number;
    /** Text orientation. A NUMBER = integer degrees -90..90 (0 = horizontal; the editor's radial dial
        writes these). The legacy STRINGS stay valid so 0.3.2 decks keep loading — 'up' ≡ -90, 'down' ≡ 90
        (both rendered by the vertical writing-mode mechanism), 'stack' = vertical stacked letters. The
        editor only ever writes a number or 'stack' from now on. */
    orient?: number | 'up' | 'down' | 'stack';
};
/** A table column = a grid column PLUS optional display-only format + pixel width, and an
    optional reference NAME (an identifier, distinct from the display `label`) so a column rule
    can be written as `=Qty*Rate` and resolved per row. The grid block ignores these fields. */
export interface TableColumn extends GridColumn {
    format?: CellFormat;
    /** Rendered width in px; omitted = auto. */
    width?: number;
    /** Reference name for use in column-rule formulas (identifier; distinct from `label`). */
    name?: string;
}
/** Write-once formula TEMPLATES that generate per-cell `formulas` for a whole column or row
    (the alpha's "rules"), keyed by column/row INDEX (as a string). Inert authoring-only: what
    the engine actually sees is the generated per-cell `formulas`; these are kept for re-editing. */
export type TableRules = {
    cols?: Record<string, string>;
    rows?: Record<string, string>;
};
/** A pinned live KPI: a display `name` bound to a `ref` (an A1 address or a cellName that
    resolves to a `named` output). Pinning is decoupled from naming. `value` is an optional PRE-BAKED
    display string, written ONLY by a destructive Publish (publishBakedTable): the sheet is flattened
    to its crop, so the pin's cell may be gone and its value is frozen in. The normal editor never
    writes it, so a working deck stays byte-identical. */
export type KpiPin = {
    name: string;
    ref: string;
    value?: string;
};
/** Σ footer totals: whether the footer row shows, and the aggregate function per column index.
    Display-only (computed from baked rows at render); persisted so the choice survives reopen. */
export type TableTotals = {
    on?: boolean;
    fns?: Record<string, 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT'>;
};
/** An inclusive crop rectangle in the FULL grid's coordinates (r0/c0..r1/c1). */
export type BakeRect = {
    r0: number;
    c0: number;
    r1: number;
    c1: number;
};
/** One NAMED bake view — a display `name` (≤64 chars, unique within `views`) over its own crop `rect`.
    Several views let an author freeze e.g. an "Exec view" and a "Detail view" into one baked ledger and
    pick which is ACTIVE; the viewer + Present render the active view's crop. */
export type BakeView = {
    name: string;
    rect: BakeRect;
};
/** A persisted Bake descriptor. `rect` (an inclusive r0/c0..r1/c1 in the FULL grid's coordinates) is
    the crop the inert viewer + Present render — the author calculates across the whole sheet but
    freezes/shows just this region. The full baked rows still ride in the file, so Unbake in the editor
    restores the live table; the viewer slices to `rect` at render.

    BAKED-ness = presence of `rect`. A descriptor carrying ONLY `views`/`active` (no `rect`) is UNBAKED
    with SAVED views: the editor restored the live grid but kept the author's named crops for the next
    bake, and the viewer/Present render the table LIVE/full (no crop, no view pills) until a `rect` is
    re-established (re-baking to a view).

    ADDITIVE (back-compat): `views` carries SEVERAL named crops and `active` names the one on show.
    RULES when `views` is present: it is non-empty; each name is a non-empty string ≤64 chars and UNIQUE;
    `active` (default = the first view) names an existing view; the DISPLAYED rect is the active view's.
    When BAKED, the editor keeps the legacy `rect` field synced to the ACTIVE view's rect at commit time,
    so an OLDER viewer/runtime that reads only `rect` (a 0.3.0/0.3.1 deck) still shows the right window
    (forward-compat). Absent `views` ⇒ EXACTLY the pre-views behaviour and byte-for-byte serialization. */
export type TableBake = {
    rect?: BakeRect;
    views?: BakeView[];
    active?: string;
};
/** The rect a baked ledger DISPLAYS: the ACTIVE named view's rect (default = the first view) when
    `views` is present, else the legacy single `rect`. Hosts (Publish, the viewer's typed paths) resolve
    the presented crop through this; the editor also mirrors the result into `rect` for forward-compat. */
export declare function activeBakeRect(bake: TableBake | undefined): BakeRect | undefined;
/** One INACTIVE sheet in a multi-tab ledger: a display `name` (≤NAME_MAX, UNIQUE across the whole strip —
    the other tabs AND the active sheet's `tabName`) over its OWN fully independent `data`. Tabs are Excel
    sheets, not linked views: no cross-tab references, no shared calc context. `data` is typed TableData for
    structural reuse, but validateTableData FORBIDS the block-level fields (id/tabName/tabs/tabPos) inside it —
    those live on the active/top-level sheet and tabs never nest (see TABLE_FIELD_KIND). The ACTIVE sheet is
    NOT a TableTab: it occupies the block's top-level TableData; only the inactive sheets ride in `tabs` — the
    same forward-compat trick as bake.rect↔bake.views, so an old viewer/runtime renders the top level and
    never reads `tabs`. */
export type TableTab = {
    name: string;
    data: TableData;
};
/** Compile-time field classification consumed by studio-core's sheet-swap. On switch, 'sheet' fields TRAVEL
    with the tab (they are the sheet's own content + display side-maps); 'block' fields STAY PUT on the block
    (the stable `id` + the tab-strip descriptors). The `as const satisfies Record<keyof TableData, …>` is the
    EXHAUSTIVENESS GUARD: adding a future TableData field without classifying it here is a tsc error, so the
    sheet-swap can never silently mis-file a new field. */
export declare const TABLE_FIELD_KIND: {
    readonly id: "block";
    readonly name: "block";
    readonly tabName: "block";
    readonly tabs: "block";
    readonly tabPos: "block";
    readonly sid: "sheet";
    readonly columns: "sheet";
    readonly rows: "sheet";
    readonly formulas: "sheet";
    readonly named: "sheet";
    readonly source: "sheet";
    readonly orefreshed: "sheet";
    readonly cellFormats: "sheet";
    readonly cellStyles: "sheet";
    readonly cellNames: "sheet";
    readonly rowHeights: "sheet";
    readonly rules: "sheet";
    readonly ruleOverrides: "sheet";
    readonly kpis: "sheet";
    readonly totals: "sheet";
    readonly bake: "sheet";
    readonly merges: "sheet";
    readonly condFmt: "sheet";
    readonly filter: "sheet";
    readonly hidden: "sheet";
};
/** One CONDITIONAL-FORMAT rule (Excel's quick rules) — distinct from `rules` (formula-fill templates).
    Purely DISPLAY: it paints a fill and/or font colour onto the cells in `range` whose value meets the
    test, evaluated at render (never baked into `rows`). The evaluator is @origami/format's calc-free
    evaluateCondFmt, so the inert viewer applies it too. `range` is an inclusive A1 range.
      - dupes : cells whose normalized (trimmed, case-sensitive) string value repeats in the range
      - gt/lt : numeric cells strictly greater/less than `value`
      - eq    : cells equal to `text` — NUMERIC equality when `text` parses as a number (so a numeric
                cell only ever matches a numeric target), else a trimmed CASE-INSENSITIVE string compare
                (Excel's "Equal To" quick rule is case-insensitive)
      - top/bot: the `n` largest/smallest numeric values (ties all match)
      - scale : a two-colour background gradient from `from`→`to` across the range's numeric min..max
    fill/color follow the SAME FILL_TOKEN/FILL_HEX discipline as cellStyles; scale's from/to are STRICT
    hex (interpolation needs concrete colours). */
export type CondRule = {
    range: string;
    kind: 'dupes' | 'gt' | 'lt' | 'eq' | 'top' | 'bot' | 'scale';
    /** gt/lt threshold. */
    value?: number;
    /** eq target — a separate STRING field (kept apart from the numeric `value` used by gt/lt) since the
        target can be text OR a number; the evaluator decides which comparison to run (see the kind list
        above). */
    text?: string;
    /** top/bot count (integer ≥ 1). */
    n?: number;
    /** Fill token-or-hex (dupes/gt/lt/eq/top/bot). */
    fill?: string;
    /** Font-colour token-or-hex (dupes/gt/lt/eq/top/bot). */
    color?: string;
    /** scale gradient endpoints — STRICT #rgb/#rrggbb hex. */
    from?: string;
    to?: string;
};
/** ONE ledger-level filter region (Excel-like). `row` is the 0-based HEADER row that carries the funnels;
    `cols` are the columns whose header-row cell shows a funnel. Filtering hides non-matching rows BELOW
    `row` only (rows at/above the header row never hide); distinct values come from the rows below it.
    The REGION persists (where the funnels sit) but which values are checked / which rows are hidden is
    display-only + TRANSIENT — never serialized, so a reload shows every row. Absent by default → a ledger
    with no filter serializes byte-identically. Validated: `row` in-bounds; `cols` non-empty, deduped,
    in-bounds. */
export type TableFilter = {
    row: number;
    cols: number[];
};
export interface TableData {
    /** Stable per-block id, LAZILY minted only when a chart first links to this ledger (a linked
        chart stores it as ChartLink.ledgerId). Absent by default → an unlinked ledger serializes
        byte-identically. Pinned FIRST in the object so `tableDataJson` (raw JSON.stringify, insertion
        order) keeps a stable key order. Inert — the viewer never reads it. */
    id?: string;
    /** Block-level DISPLAY name (presentation, NOT a link identifier — cross-ledger @-referencing stays
        removed). Any printable text ≤ NAME_MAX, spaces/unicode allowed; the block toolbar's Name chip writes
        it and an empty value clears it. Rides right after `id` at the block level (see TABLE_FIELD_KIND: it
        STAYS on the block, never travels with a sheet), so a tab entry's data must not carry it. Absent by
        default → an unnamed ledger serializes byte-identically. It drives the link picker's option label + the
        chart's link-status line and SURVIVES Publish (publishTable carries it with `id`). */
    name?: string;
    /** Stable per-SHEET id, LAZILY minted when a chart first links TO THIS SHEET (the link stores it as
        ChartLink.tab). Unlike the block-level `id` this is a 'sheet' field (see TABLE_FIELD_KIND): it
        TRAVELS with the sheet on a tab swap, so a linked sheet keeps resolving across switches, renames
        and moves. Allowed inside tab entries — the one per-sheet identity that rides there. Absent by
        default → a never-linked sheet serializes byte-identically. Inert — the viewer never reads it. */
    sid?: string;
    columns: TableColumn[];
    /** BAKED display strings — exactly what the viewer shows. A formula cell carries its baked value here. */
    rows: string[][];
    /** Inert authoring side-map: A1 address -> "=…". Never read by the viewer. */
    formulas?: Record<string, string>;
    /** Inert authoring side-map: output name -> "=…". Exposed to other blocks as @blockId.name. */
    named?: Record<string, string>;
    /** Inert self-refresh side-map: the query this table re-pulls from (never a credential).
        Read only by the trusted refresh pipeline (§4); the viewer never reads it. */
    source?: TableSource;
    /** Freshness stamp (ISO) written by the last refresh — the viewer renders an "as of" chip
        from this BAKED text (no compute). Absent until the table is refreshed. */
    orefreshed?: string;
    /** Per-cell format override (A1 -> format); beats the column's format. Display-only. */
    cellFormats?: Record<string, CellFormat>;
    /** Per-cell style (A1 -> style). Display-only. */
    cellStyles?: Record<string, CellStyle>;
    /** Reference-by-name: A1 -> a user name so a formula can say `=price*qty`. Authoring-only;
        resolved by the engine at bake, distinct from `named` (which exports @block.output). */
    cellNames?: Record<string, string>;
    /** Row heights in px, keyed by row index (string). Sparse; omitted = auto. Display-only. */
    rowHeights?: Record<string, number>;
    /** Column/row write-once formula templates (the alpha's rules). */
    rules?: TableRules;
    /** A1 cells the user hand-edited, so an active rule skips them ("override + restore"). */
    ruleOverrides?: string[];
    /** Pinned live KPIs. */
    kpis?: KpiPin[];
    /** Σ footer totals (footer visibility + per-column aggregate function). */
    totals?: TableTotals;
    /** Persisted Bake crop — the region Present / the shared file shows (see TableBake). */
    bake?: TableBake;
    /** Merged cell regions — inclusive A1 range strings ("B2:D3"). The top-left cell is the ANCHOR
        (keeps its value/formula/format/style); the covered cells render nothing — the anchor td carries
        colspan/rowspan (editor AND inert viewer). Absent when none, so a table with no merges serializes
        byte-identically. Validated: each a well-formed range of ≥2 cells, in-bounds, no pairwise overlap. */
    merges?: string[];
    /** Conditional-format rules (Excel's quick rules — highlight duplicates / greater-or-less-than /
        top-or-bottom N / two-colour scale). Display-only, evaluated at render by evaluateCondFmt in BOTH
        the editor and the inert viewer. Distinct from `rules` (formula-fill templates). Absent when none,
        so a table using no conditional formatting serializes byte-identically. */
    condFmt?: CondRule[];
    /** The single filter region (see TableFilter). Absent when none, so a ledger with no filter
        serializes byte-identically. */
    filter?: TableFilter;
    /** Sheet-level PRESENTATION flag: hide this sheet from the viewer/Present. A sheet SHOWS iff
        `!hidden || baked` (a baked hidden sheet still shows — bake overrides hidden). Only the literal
        `true` is ever stored (mirrors the `wrap`/`thou` discipline): a shown sheet OMITS the key, so it
        serializes byte-identically. It's a 'sheet' field (see TABLE_FIELD_KIND) — it travels with its
        sheet on a tab swap and is allowed inside a tab entry. Editor-only affordance; the recipient never
        sees a hidden-unbaked sheet (it isn't rendered and its data is unreachable). */
    hidden?: true;
    /** Display name of the ACTIVE sheet (the top-level data). Absent on a single-sheet ledger
        (byte-stability); REQUIRED once `tabs` is present (it disambiguates the strip). Display text —
        spaces allowed, ≤NAME_MAX — NOT an identifier. */
    tabName?: string;
    /** The additional INACTIVE sheets, in strip order. The active sheet is NOT in this array — it occupies
        the top level; its own strip slot is `tabPos`. Absent/omitted on a single-sheet ledger. Each entry's
        `data` is validated as a full sheet (grid caps + every side-map), minus the block-level fields. */
    tabs?: TableTab[];
    /** The active sheet's 0-based slot within the full strip of `tabs.length + 1` sheets. Omitted when 0 (the
        editor's default → a leading-active ledger stays byte-identical); a written 0 still validates. */
    tabPos?: number;
}
/** A ledger is a spreadsheet, not a display grid — it gets a far wider column ceiling than
    GRID_MAX_COLS (Excel-classic width, column IV). The author calculates across the whole sheet;
    Bake picks the crop that actually presents. colA1 addresses multi-letter columns (AA…IV), so
    the calc engine + editor already handle the full width. Rows stay at GRID_MAX_ROWS. */
export declare const TABLE_MAX_COLS = 256;
/** Strict shape check. REJECT, never repair. Reuses grid's column/row/tone/caps
    validation (re-prefixed table.*) and adds SHAPE-ONLY formula/named checks. */
export declare function validateTableData(data: unknown): Violation[];
/** Serialize table data for embedding — "<" escaped (same invariant as gridDataJson). */
export declare function tableDataJson(data: TableData): string;
