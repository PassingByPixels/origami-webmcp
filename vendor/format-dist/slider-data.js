import { A1_RE } from './table-core.js';
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
export const SLIDER_STYLES = ['single', 'rows', 'mixer', 'panel'];
/** Field-level checks for ONE fader item — the same VALUE rules the flat slider used
    (reject bad values, never repair), pushed under the caller's rule prefix. */
function validateSliderItem(item, bad) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        bad('item', 'each slider must be a JSON object');
        return;
    }
    const d = item;
    const finite = (x) => typeof x === 'number' && Number.isFinite(x);
    const okMin = finite(d.min), okMax = finite(d.max), okStep = finite(d.step), okValue = finite(d.value);
    if (!okMin)
        bad('min', 'min must be a finite number');
    if (!okMax)
        bad('max', 'max must be a finite number');
    if (!okStep)
        bad('step', 'step must be a finite number');
    if (!okValue)
        bad('value', 'value must be a finite number');
    if (okMin && okMax && !(d.min < d.max))
        bad('range', 'min must be less than max');
    if (okStep && d.step <= 0)
        bad('step', 'step must be greater than 0');
    if (okValue && okMin && okMax && (d.value < d.min || d.value > d.max)) {
        bad('value', 'value must be within [min, max]');
    }
    if (d.label !== undefined && (typeof d.label !== 'string' || d.label.length > 120))
        bad('label', 'label must be a string (max 120)');
    // Optional ledger link (present → strict shape check, absent → skip).
    if (d.link !== undefined) {
        if (d.link === null || typeof d.link !== 'object' || Array.isArray(d.link)) {
            bad('link', 'link must be an object { ledgerId, cell }');
        }
        else {
            const l = d.link;
            if (typeof l.ledgerId !== 'string' || l.ledgerId.length === 0 || l.ledgerId.length > 64)
                bad('link.ledgerId', 'link.ledgerId must be a non-empty string (max 64)');
            if (l.tab !== undefined && (typeof l.tab !== 'string' || l.tab.length === 0 || l.tab.length > 64))
                bad('link.tab', 'link.tab must be a non-empty string (max 64)');
            if (typeof l.cell !== 'string' || !A1_RE.test(l.cell))
                bad('link.cell', 'link.cell must be a single A1 cell like "B3"');
        }
    }
}
/** Strict shape check for a slider CONTAINER. REJECT bad VALUES, never repair — an
    out-of-range value is rejected, not clamped (clamping would mask malformed data);
    an empty `sliders` array is rejected, never back-filled. Unknown extra keys are
    IGNORED, matching validateChartData/Grid/Notes: an old build must still render a
    future slider that gained a field, not reject the whole block (they are simply
    dropped on re-serialize, since sliderDataJson only emits the canonical key set). */
export function validateSliderData(data) {
    const v = [];
    const bad = (rule, detail) => v.push({ rule: `slider.${rule}`, detail });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        bad('shape', 'slider data must be a JSON object');
        return v;
    }
    const d = data;
    if (d.style !== undefined && !SLIDER_STYLES.includes(d.style)) {
        bad('style', "style must be one of 'single', 'rows', 'mixer', 'panel'");
    }
    if (!Array.isArray(d.sliders) || d.sliders.length === 0) {
        bad('sliders', 'sliders must be a non-empty array');
        return v;
    }
    for (const item of d.sliders)
        validateSliderItem(item, bad);
    return v;
}
/** Serialize slider data for embedding — "<" escaped (the carrier invariant). Keys are
    emitted in a FIXED canonical order (present-only optionals): `style` ONLY when it is
    not the default 'single', then `sliders`; each item in min,max,step,value,label?,link?
    order with the link inner as ledgerId,tab?,cell. So a default single slider is
    byte-stable (no style key) and any re-serialized block is deterministic. */
export function sliderDataJson(data) {
    const ordered = {
        ...(data.style !== undefined && data.style !== 'single' ? { style: data.style } : {}), // default omitted
        sliders: data.sliders.map((s) => ({
            min: s.min,
            max: s.max,
            step: s.step,
            value: s.value,
            ...(s.label !== undefined ? { label: s.label } : {}),
            ...(s.link !== undefined
                ? {
                    link: {
                        ledgerId: s.link.ledgerId,
                        ...(s.link.tab !== undefined ? { tab: s.link.tab } : {}), // absent = top-level sheet (byte-stable)
                        cell: s.link.cell,
                    },
                }
                : {}),
        })),
    };
    return JSON.stringify(ordered, null, 2).replace(/</g, '\\u003c');
}
