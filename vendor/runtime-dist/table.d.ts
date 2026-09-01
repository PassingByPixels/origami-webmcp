import { type CellFormat, type CellStyle, type CondRule } from '@origami/format';
/** The subset of TableData the inert viewer renders — baked rows + the display-only side-maps.
    Authoring-only maps (`formulas`, `named`, `source`, `rules`) are deliberately absent: the viewer
    never reads them. */
export interface Ledger {
    columns: {
        label: string;
        align?: 'left' | 'right' | 'center';
        format?: CellFormat;
        width?: number;
    }[];
    rows: string[][];
    cellFormats: Record<string, CellFormat>;
    cellStyles: Record<string, CellStyle>;
    cellNames: Record<string, string>;
    rowHeights: Record<string, number>;
    totals?: {
        on?: boolean;
        fns?: Record<string, string>;
    };
    kpis: {
        name: string;
        ref: string;
        value?: string;
    }[];
    orefreshed?: string;
    /** Merged cell regions (inclusive A1 range strings). The anchor (top-left) renders with colspan/
        rowspan; covered cells render nothing — same mechanism the editor uses. */
    merges: string[];
    /** A persisted Bake crop (inclusive r0/c0..r1/c1 in the FULL grid). renderTable draws only this
        window; KPI cards + the freshness chip still resolve against the whole sheet. Absent = full table. */
    bakeRect?: {
        r0: number;
        c0: number;
        r1: number;
        c1: number;
    };
    /** Named bake views for the transient view-switch PILLS (presentation-only — the viewer NEVER persists
        or serializes them). Present ONLY when the bake carries ≥2 well-formed, in-grid views; a single-view
        or legacy rect-only ledger omits it (no pill row). `activeView` = the initially-displayed view (the
        author's `bake.active`); clicking a pill re-points `bakeRect` transiently (a reload restores it). */
    views?: {
        name: string;
        rect: {
            r0: number;
            c0: number;
            r1: number;
            c1: number;
        };
    }[];
    activeView?: string;
    /** Conditional-format rules — evaluated against the FULL baked sheet at render (evaluateCondFmt), a
        display overlay UNDER any explicit cellStyle. Cleaned defensively (malformed rules dropped). */
    condFmt: CondRule[];
    /** The single filter region (see @origami/format TableFilter): `row` = the 0-based header row that
        carries the funnels, `cols` = the funnel columns. Filtering hides non-matching rows BELOW `row`
        only; transient (never serialized). Absent = no funnels. Cleaned defensively at read. */
    filter?: {
        row: number;
        cols: number[];
    };
}
/** Parse the inert <script data-odata="table"> block into the render model. */
export declare function parseTableSlideData(slide: Element): Ledger | null;
/** The multi-sheet render context (transient, never serialized): the SHOWN sheets in strip order, each
    already parsed to its own Ledger, plus which is initially active. A single-sheet (or single-shown)
    ledger yields one sheet and no tab strip — today's render exactly. */
export interface LedgerDoc {
    sheets: {
        name: string;
        led: Ledger;
    }[];
    active: number;
}
/** The SHOWN sheet indices — the ONE rule both the viewer and Publish use: a sheet shows iff it isn't
    hidden OR it's baked (a `bake.rect` present — bake overrides hidden, Passing's explicit rule). An
    empty shown set falls back to [activeIndex] so the viewer never renders nothing. PURE (no DOM) —
    unit-tested directly against the requirement. */
export declare function shownSheetIndices(sheets: unknown[], activeIndex: number): number[];
/** Render the baked ledger into [data-table-mount]. Static content (no sort/edit); when a filter region
    is set, the header row's funnel cells gain a live, inert filter dropdown that hides rows below
    (display-only, transient). Idempotent. */
export declare function renderTable(slide: HTMLElement, led: Ledger, doc?: LedgerDoc): void;
export declare function renderTableError(slide: HTMLElement): void;
/** Sweep a mounted slide for table blocks and render each baked ledger. Tables are in-slide blocks,
    so this runs on every slide regardless of kind — the mirror of mountCharts. Idempotent. */
export declare function mountTables(slide: Element): void;
/** Print path — the ledger render is already static, so finalize is the same sweep. */
export declare const finalizeTables: typeof mountTables;
