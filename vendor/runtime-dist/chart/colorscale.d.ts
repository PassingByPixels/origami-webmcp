/** Colour for a position `t` on the ramp. `t` is clamped to [0,1]; a non-finite `t` reads as 0 rather
    than emitting `#NaNNaNNaN`, which would paint nothing and say nothing. */
export declare function rampColor(t: number): string;
/** The higher-contrast of the two inks over `bg` — a #hex the caller sets as a presentation
    ATTRIBUTE, never as inline style (a CSS rule on the same element would beat inline nothing, and
    the deck has no CSP exception for style=). */
export declare function inkOn(bg: string): string;
/** Gutter a chart must add to its right margin to hold this legend: strip + gap + a tick number. */
export declare const SCALE_LEGEND_W = 72;
/** Clear space between the plot's right edge and the strip. */
export declare const LEGEND_GAP = 12;
/** The number rule described above, for a scale whose top is `hi`. Same value, same string, every
    render — pure arithmetic over its argument with no clock, no state and no measurement. */
export declare function scaleFormat(hi: number): (v: number) => string;
/** A vertical colour ramp with numeric ticks, `hi` at the top and `lo` at the bottom, occupying
    [y, y+h] at `x`. `fmt` formats a tick value; `snap` quantises one before it is formatted and
    positioned (a hexbin's counts are whole numbers, a heatmap's values are not).

    THE TICK COUNT COMES FROM THE STRIP HEIGHT. It used to be a hard-coded five whatever height the
    legend was given, and a heatmap's plot is `rows x 34` — so a ONE-ROW heatmap got five baselines
    8.5 units apart carrying 15-unit glyph boxes, and all five overprinted into an illegible stack.
    That is the most ordinary shape the type has, and the legend is the reader's only decoder for a
    cell whose number did not fit. Deriving the count from the height instead gives a one-row strip
    three ticks 17 units apart — the same spacing the two-row strip already had and was legible at —
    and leaves every strip from two rows up exactly as it was. */
export declare function scaleLegend(svg: SVGElement, x: number, y: number, h: number, lo: number, hi: number, fmt?: (v: number) => string, snap?: (v: number) => number): void;
