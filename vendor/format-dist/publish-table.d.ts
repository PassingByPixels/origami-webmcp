import type { TableData } from './table-data.js';
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
export declare function publishBakedTable(data: TableData): TableData;
/**
 * Publish transform for a whole table BLOCK (its active sheet + every `tabs` sheet). KEEPS every SHOWN
 * sheet (shown = `!hidden || baked`), each flattened by flattenSheet; STRIPS every hidden-unbaked sheet
 * entirely; DROPS `hidden` from every kept sheet (a published copy shows exactly the kept set). When the
 * shown set is empty (the author hid everything unbaked), it falls back to the active sheet alone so a
 * publish never emits nothing. When ONE sheet survives, it collapses to single-sheet form (no
 * tabName/tabs/tabPos). A single-sheet block is thus exactly publishBakedTable (baked) / a hidden-stripped
 * clone (unbaked) — this is the multi-tab generalisation of the destructive-bake publish.
 */
export declare function publishTable(data: TableData): TableData;
