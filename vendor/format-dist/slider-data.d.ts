import type { Violation } from './types.js';
/**
 * Slider BLOCK data — like the chart block, an in-slide block (any number, on any
 * slide), carried by its own inert JSON block:
 *
 *   <figure class="o-sliderfig">
 *     <script type="application/json" data-odata="slider">{…}</script>
 *     <div class="o-slider" data-slider-mount></div>
 *     <figcaption>…</figcaption>
 *   </figure>
 *
 * The block is a CONTAINER: a `style` (visual treatment, cycled from the toolbar) and
 * a NON-EMPTY list of `sliders` (fader items). A single default block is one item with
 * no style — it serialises lean (style omitted, item optionals present-only). Each item
 * may carry its own `link` — a WRITE-side tie to one ledger cell (the write-side mirror
 * of the chart's read-side range link). Same carrier rules as every data block: "<"
 * always escaped, the literal script form enforced by validateSlideContent.
 */
/** The four visual treatments the block cycles through (toolbar ⟳). 'single' is the
    default (omitted on serialize): single = one horizontal fader; rows = a vertical
    stack of horizontal faders; mixer = a row of vertical faders (the control panel);
    panel = mixer wrapped in framed card chrome. */
export declare const SLIDER_STYLES: readonly ["single", "rows", "mixer", "panel"];
export type SliderStyle = (typeof SLIDER_STYLES)[number];
/** A slider→ledger link: the slider WRITES its value into ONE ledger cell. A narrowed
    ChartLink — same ledgerId (== TableData.id) + tab (== sheet sid) semantics, but a
    single target `cell` in place of the chart's range/header/orient. */
export interface SliderLink {
    /** Stable id of the target ledger — matches TableData.id. */
    ledgerId: string;
    /** Stable id of the linked SHEET within that ledger — matches a sheet's TableData.sid (so
        the link survives tab switches, renames and moves). Absent = the top-level (active) sheet. */
    tab?: string;
    /** The single target cell, a plain A1 address like "B3" (never a range). */
    cell: string;
}
/** One fader in a slider block — a min/max/step/value control with an optional label
    and its own optional ledger write-link. */
export interface SliderItem {
    min: number;
    max: number;
    step: number;
    value: number;
    /** Caption drawn beside/under the fader (absent = none). */
    label?: string;
    /** Live write-link to one ledger cell (absent = a standalone fader). */
    link?: SliderLink;
}
export interface SliderData {
    /** Visual treatment (absent = 'single'). */
    style?: SliderStyle;
    /** The faders — always at least one. */
    sliders: SliderItem[];
}
/** Strict shape check for a slider CONTAINER. REJECT bad VALUES, never repair — an
    out-of-range value is rejected, not clamped (clamping would mask malformed data);
    an empty `sliders` array is rejected, never back-filled. Unknown extra keys are
    IGNORED, matching validateChartData/Grid/Notes: an old build must still render a
    future slider that gained a field, not reject the whole block (they are simply
    dropped on re-serialize, since sliderDataJson only emits the canonical key set). */
export declare function validateSliderData(data: unknown): Violation[];
/** Serialize slider data for embedding — "<" escaped (the carrier invariant). Keys are
    emitted in a FIXED canonical order (present-only optionals): `style` ONLY when it is
    not the default 'single', then `sliders`; each item in min,max,step,value,label?,link?
    order with the link inner as ledgerId,tab?,cell. So a default single slider is
    byte-stable (no style key) and any re-serialized block is deterministic. */
export declare function sliderDataJson(data: SliderData): string;
