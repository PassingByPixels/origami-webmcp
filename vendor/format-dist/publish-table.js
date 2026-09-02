import { activeBakeRect } from './table-data.js';
import { a1, a1ToRC, a1RangeToRect, fmtAt, mergeRects } from './table-core.js';
import { formatCell } from './cell-format.js';
/** Resolve a KPI ref (an A1 address, or a cellName mapped back via cellNames) to a cell — mirrors the
    viewer's resolveKpiRC and the editor's kpiRef, so a published pin freezes the SAME number. */
function kpiRC(data, ref) {
    const rc = a1ToRC(ref);
    if (rc)
        return rc;
    if (data.cellNames)
        for (const [addr, name] of Object.entries(data.cellNames))
            if (name === ref)
                return a1ToRC(addr);
    return null;
}
/**
 * DESTRUCTIVE bake for Publish. "Share a full copy" keeps the whole sheet + a `bake.rect` the viewer
 * merely WINDOWS (so the recipient could still read the hidden cells in the raw JSON). A PUBLISHED copy
 * must contain ONLY what it presents. So flatten a cropped table to its rect: keep just the baked values
 * inside the crop, shift the display side-maps (formats / styles / row heights) into the crop's
 * coordinate space, FREEZE each pinned KPI (name + formatted value, resolved against the FULL sheet —
 * a pin's cell may sit outside the crop and is gone after this), and DROP every authoring side-map
 * (formulas / named / source / rules / ruleOverrides / cellNames / column names / bake) and the
 * whole-sheet Σ footer. An UN-cropped table is returned unchanged (nothing hidden to strip; the deck is
 * already read-only via markPublished). Pure + calc-free: it copies baked values, never evaluates.
 *
 * With named bake `views`, this flattens to the ACTIVE view's crop (activeBakeRect); `views`/`active`
 * are DROPPED from the output — a published copy is a destructive flatten to the ONE view on show, so
 * the alternates are gone from the bytes along with the hidden cells.
 */
export function publishBakedTable(data) {
    const rect = activeBakeRect(data.bake);
    if (!rect)
        return data;
    const { r0, c0, r1, c1 } = rect;
    const inRect = (r, c) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
    const shift = (m) => {
        if (!m)
            return undefined;
        const out = {};
        for (const [k, v] of Object.entries(m)) {
            const rc = a1ToRC(k);
            if (rc && inRect(rc.r, rc.c))
                out[a1(rc.r - r0, rc.c - c0)] = v;
        }
        return Object.keys(out).length ? out : undefined;
    };
    const columns = [];
    for (let c = c0; c <= c1; c++) {
        const col = data.columns[c] ? { ...data.columns[c] } : { label: '' };
        delete col.name; // reference-by-name is authoring — there are no formulas left to resolve it
        columns.push(col);
    }
    const rows = [];
    for (let r = r0; r <= r1; r++) {
        const row = [];
        for (let c = c0; c <= c1; c++)
            row.push(data.rows[r]?.[c] ?? '');
        rows.push(row);
    }
    const rowHeights = {};
    if (data.rowHeights) {
        for (const [k, v] of Object.entries(data.rowHeights)) {
            const r = Number(k);
            if (Number.isInteger(r) && r >= r0 && r <= r1)
                rowHeights[String(r - r0)] = v;
        }
    }
    const out = { columns, rows };
    const cf = shift(data.cellFormats);
    if (cf)
        out.cellFormats = cf;
    const cs = shift(data.cellStyles);
    if (cs)
        out.cellStyles = cs;
    // merges: shift each merge fully INSIDE the crop into the flattened coordinate space; a merge that
    // crosses (or sits outside) the crop edge is DROPPED — simplest correct rule for a flattened copy.
    if (data.merges?.length) {
        const merges = [];
        for (const m of mergeRects(data.merges)) {
            if (m.r0 >= r0 && m.c0 >= c0 && m.r1 <= r1 && m.c1 <= c1) {
                merges.push(a1(m.r0 - r0, m.c0 - c0) + ':' + a1(m.r1 - r0, m.c1 - c0));
            }
        }
        if (merges.length)
            out.merges = merges;
    }
    // condFmt: re-base each rule's range into crop coords; DROP a rule whose range isn't FULLY inside the
    // crop (merges precedent). Values persist (cropped rows below), so a surviving rule still evaluates.
    if (data.condFmt?.length) {
        const rules = [];
        for (const rule of data.condFmt) {
            const rect = a1RangeToRect(rule.range);
            if (rect && rect.r0 >= r0 && rect.c0 >= c0 && rect.r1 <= r1 && rect.c1 <= c1) {
                rules.push({ ...rule, range: a1(rect.r0 - r0, rect.c0 - c0) + ':' + a1(rect.r1 - r0, rect.c1 - c0) });
            }
        }
        if (rules.length)
            out.condFmt = rules;
    }
    // filter region: carry it through IFF the header row AND every funnel column sit fully INSIDE the crop,
    // re-based to crop coords — a published read-only deck should still filter (the rows below the header
    // persist in the crop). DROP it otherwise (a copy can't filter around cells it no longer contains).
    if (data.filter?.cols.length && data.filter.row >= r0 && data.filter.row <= r1 && data.filter.cols.every((c) => c >= c0 && c <= c1)) {
        out.filter = { row: data.filter.row - r0, cols: data.filter.cols.map((c) => c - c0) };
    }
    if (Object.keys(rowHeights).length)
        out.rowHeights = rowHeights;
    if (data.kpis?.length) {
        out.kpis = data.kpis.map((pin) => {
            const rc = kpiRC(data, pin.ref);
            const name = (rc && data.cellNames?.[a1(rc.r, rc.c)]) || pin.name;
            if (!rc)
                return { name, ref: pin.ref, value: '#REF!' };
            const baked = data.rows[rc.r]?.[rc.c] ?? '';
            const value = baked === '' ? '—' : formatCell(baked, fmtAt(data, rc.r, rc.c));
            return { name, ref: pin.ref, value };
        });
    }
    return out;
}
/** A sheet SHOWS iff it isn't hidden OR it's baked (a `bake.rect` present — bake overrides hidden,
    Passing's explicit rule). The one rule both the viewer and Publish use. */
function isSheetShown(sheet) {
    return sheet.hidden !== true || !!sheet.bake?.rect;
}
/** Publish ONE sheet to what it presents: a baked sheet flattens to its crop (publishBakedTable — drops
    authoring side-maps + hidden cells); an unbaked sheet is kept live/full (the same per-sheet discipline
    flattenBakedLedgers already applied to the active sheet). Either way `hidden` and every block-level
    field are dropped — a published sheet is shown by construction, and the block wrapper is rebuilt fresh. */
function flattenSheet(sheet) {
    const flat = sheet.bake?.rect ? publishBakedTable(sheet) : { ...sheet };
    delete flat.hidden;
    // block-level fields are dropped here and re-attached ONCE by publishTable's wrapper rebuild (so the
    // presentation `name` + link-target `id` sit at the block, never duplicated inside a flattened sheet).
    delete flat.id;
    delete flat.name;
    delete flat.tabName;
    delete flat.tabs;
    delete flat.tabPos;
    return flat;
}
/**
 * Publish transform for a whole table BLOCK (its active sheet + every `tabs` sheet). KEEPS every SHOWN
 * sheet (shown = `!hidden || baked`), each flattened by flattenSheet; STRIPS every hidden-unbaked sheet
 * entirely; DROPS `hidden` from every kept sheet (a published copy shows exactly the kept set). When the
 * shown set is empty (the author hid everything unbaked), it falls back to the active sheet alone so a
 * publish never emits nothing. When ONE sheet survives, it collapses to single-sheet form (no
 * tabName/tabs/tabPos). A single-sheet block is thus exactly publishBakedTable (baked) / a hidden-stripped
 * clone (unbaked) — this is the multi-tab generalisation of the destructive-bake publish.
 */
export function publishTable(data) {
    // Materialize the strip in display order: the inactive tabs with the active (top-level) sheet inserted
    // at its slot `tabPos` (default 0). `active` marks the author's active sheet within the strip.
    const tabs = Array.isArray(data.tabs) ? data.tabs : [];
    const strip = tabs.map((t) => ({
        name: t.name, sheet: t.data, active: false,
    }));
    const pos = Math.min(Math.max(data.tabPos ?? 0, 0), tabs.length);
    strip.splice(pos, 0, { name: data.tabName ?? '', sheet: data, active: true });
    // shown = !hidden || baked; fall back to the active slot alone when nothing shows.
    let shown = strip.filter((s) => isSheetShown(s.sheet));
    if (shown.length === 0)
        shown = strip.filter((s) => s.active);
    const kept = shown.map((s) => ({ name: s.name, sheet: flattenSheet(s.sheet), active: s.active }));
    // The block DISPLAY name is presentation → it survives Publish (unlike the inert `id`, which is dropped
    // when a single sheet collapses to pristine form). Re-attached at the block wrapper, right after `id`.
    const nameHead = data.name !== undefined ? { name: data.name } : {};
    // one survivor → pristine single-sheet form (no strip descriptors, no hidden) + the presentation name.
    // A block that was ALREADY single-sheet keeps its sole sheet's own name: that name is display text the
    // reader sees (runtime/table.ts draws it as a one-pill name row), so publishing must not silently strip
    // it. A block that HAD a strip still collapses to pristine form — its survivor's name was a switcher
    // label, and there is nothing left to switch between.
    if (kept.length === 1) {
        const sole = { ...nameHead, ...kept[0].sheet };
        if (tabs.length === 0 && typeof data.tabName === 'string' && data.tabName)
            sole.tabName = data.tabName;
        return sole;
    }
    // >=2 survivors → the active sheet stays top-level (else the first shown is promoted); the rest ride in
    // `tabs`, strip order preserved. The BLOCK id (block-level, chart-link target) rides first when present.
    let topIdx = kept.findIndex((s) => s.active);
    if (topIdx < 0)
        topIdx = 0;
    const top = kept[topIdx];
    // the BLOCK id (chart-link target) rides FIRST, then the presentation name, matching the canonical order.
    const out = { ...(data.id !== undefined ? { id: data.id } : {}), ...nameHead, ...top.sheet };
    out.tabName = top.name;
    out.tabs = kept.filter((_, i) => i !== topIdx).map((s) => ({ name: s.name, data: s.sheet }));
    if (topIdx !== 0)
        out.tabPos = topIdx;
    return out;
}
